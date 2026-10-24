import { runs } from "@trigger.dev/sdk";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import type { ToolEvent } from "@/lib/contracts";
import { HttpError, handler, json } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED"]);

/**
 * Stops a run. The DB is marked CANCELLED even if the Trigger.dev cancel fails (a run that already
 * ended can't be cancelled), and the streamed partial reply is saved from the run metadata, since a
 * cancelled worker may be killed before its own catch block persists it.
 */
export const POST = handler<Ctx>(async (_req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId } });
  if (!run) throw new HttpError(404, "Run not found");
  if (TERMINAL.has(run.status)) return json({ id: run.id, status: run.status });

  const live = run.triggerRunId ? await runs.retrieve(run.triggerRunId).catch(() => null) : null;
  const meta = live?.metadata as { text?: string; tools?: ToolEvent[] } | undefined;
  const content =
    typeof meta?.text === "string" ? ({ text: meta.text, tools: meta.tools ?? [] } as Prisma.InputJsonValue) : undefined;

  await Promise.all([
    run.triggerRunId ? runs.cancel(run.triggerRunId).catch(() => null) : null,
    db.$transaction([
      db.agentRun.update({ where: { id: runId }, data: { status: "CANCELLED" } }),
      ...(run.assistantMessageId
        ? [db.message.update({ where: { id: run.assistantMessageId }, data: { status: "CANCELLED", content } })]
        : []),
    ]),
  ]);
  return json({ id: run.id, status: "CANCELLED" });
});
