import { randomUUID } from "node:crypto";
import { tasks } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { ACTIVE_RUN_STATUSES, MessagesQuery, SendMessageBody, messageInclude, toMessage } from "@/lib/contracts";
import { env } from "@/lib/env";
import { HttpError, handler, json, parseBody, parseQuery } from "@/lib/http";
import type { agentRun } from "@/trigger/agent-run";

type Ctx = { params: Promise<{ chatId: string }> };

/** Trigger.dev maxDuration (15 min) plus slack, measured from the run's last status change. */
const STALE_RUN_MS = 20 * 60_000;

/**
 * Cursor-paginated history. Returns a page (oldest first) ending just before `cursor`;
 * the cursor for the next older page is in the `X-Next-Cursor` header.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const { cursor, limit } = parseQuery(req, MessagesQuery);

  const rows = await db.message.findMany({
    where: { chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: messageInclude,
  });
  const page = rows.slice(0, limit);
  const res = json(page.reverse().map(toMessage));
  if (rows.length > limit && page[0]) res.headers.set("X-Next-Cursor", page[0].id);
  return res;
});

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

function normalizeAttachment(a: string | { url: string; assemblyId?: string; mimeType?: string; fileName?: string; fileSizeBytes?: number }) {
  const att = typeof a === "string" ? { url: a } : a;
  const fileName = att.fileName ?? decodeURIComponent(new URL(att.url).pathname.split("/").pop() || "file");
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return {
    fileUrl: att.url,
    assemblyId: att.assemblyId,
    fileName,
    mimeType: att.mimeType ?? MIME_BY_EXT[ext] ?? "application/octet-stream",
    fileSizeBytes: att.fileSizeBytes ?? 0,
  };
}

/** Persists the user turn and dispatches the agent run. Idempotent on the idempotency key. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  const chat = await requireChat(user.id, chatId);
  const body = await parseBody(req, SendMessageBody);
  const { MIN_RUN_CREDITS } = env();
  if (user.credits < MIN_RUN_CREDITS) {
    throw new HttpError(402, `Not enough credits to start a task (${user.credits} left, ${MIN_RUN_CREDITS} needed).`);
  }
  const idempotencyKey = body.idempotencyKey ?? req.headers.get("idempotency-key") ?? randomUUID();

  const existing = await db.agentRun.findUnique({
    where: { idempotencyKey },
    include: { message: { include: messageInclude } },
  });
  if (existing) return json({ message: toMessage(existing.message), runId: existing.id });

  const { message, run } = await db.$transaction(async (tx) => {
    // One active run per chat: lock the chat row so concurrent sends serialize on this check.
    await tx.$queryRaw`SELECT id FROM "Chat" WHERE id = ${chatId} FOR UPDATE`;
    const active = await tx.agentRun.findFirst({
      where: {
        chatId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
        // Untouched for longer than the worker's max duration (or a waitpoint's timeout) means a dead
        // lock; don't let it block the chat. Entering and leaving WAITING bumps updatedAt.
        updatedAt: { gt: new Date(Date.now() - Math.max(STALE_RUN_MS, (env().WAITPOINT_TIMEOUT_MINUTES + 5) * 60_000)) },
      },
    });
    if (active) throw new HttpError(409, "A reply is still in progress in this chat. Stop it or wait for it to finish.");

    const message = await tx.message.create({
      data: {
        chatId,
        role: "USER",
        content: { text: body.content },
        attachments: { create: body.attachments.map(normalizeAttachment) },
      },
      include: messageInclude,
    });
    const run = await tx.agentRun.create({ data: { chatId, messageId: message.id, idempotencyKey } });
    // First message names the chat.
    const title = chat.title === "New chat" ? body.content.slice(0, 60) : undefined;
    await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date(), ...(title ? { title } : {}) } });
    return { message, run };
  });

  try {
    const handle = await tasks.trigger<typeof agentRun>(
      "agent-run",
      { chatId, runId: run.id, userMessageId: message.id },
      { idempotencyKey, tags: [`chat_${chatId}`, `user_${user.id}`] },
    );
    await db.agentRun.update({ where: { id: run.id }, data: { triggerRunId: handle.id } });
  } catch (err) {
    await db.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: "Failed to start agent run" } });
    throw err;
  }

  return json({ message: toMessage(message), runId: run.id }, 202);
});
