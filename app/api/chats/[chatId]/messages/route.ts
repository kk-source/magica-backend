import { auth as triggerAuth, tasks } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { MessagesQuery, SendMessageBody, type MessageDto } from "@/lib/contracts";
import { handler, json, parseBody, parseQuery } from "@/lib/http";
import type { agentRun } from "@/trigger/agent-run";

type Ctx = { params: Promise<{ chatId: string }> };

/** Newest-first cursor pagination; the client reverses for display. */
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
    include: { attachments: true },
  });
  const page = rows.slice(0, limit);
  const messages: MessageDto[] = page.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }));
  return json({ messages, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null });
});

/** Persists the user turn and dispatches the agent run. Idempotent on `idempotencyKey`. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const body = await parseBody(req, SendMessageBody);

  const existing = await db.agentRun.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  if (existing) return json({ runId: existing.id, messageId: existing.messageId, triggerRunId: existing.triggerRunId });

  const { message, run } = await db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        chatId,
        role: "USER",
        content: { text: body.text },
        attachments: { create: body.attachments },
      },
    });
    const run = await tx.agentRun.create({
      data: { chatId, messageId: message.id, idempotencyKey: body.idempotencyKey },
    });
    await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    return { message, run };
  });

  const handle = await tasks.trigger<typeof agentRun>(
    "agent-run",
    { chatId, runId: run.id, userMessageId: message.id },
    { idempotencyKey: body.idempotencyKey, tags: [`chat_${chatId}`, `user_${user.id}`] },
  );
  await db.agentRun.update({ where: { id: run.id }, data: { triggerRunId: handle.id } });

  const publicAccessToken = await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } });
  return json({ runId: run.id, messageId: message.id, triggerRunId: handle.id, publicAccessToken }, 202);
});
