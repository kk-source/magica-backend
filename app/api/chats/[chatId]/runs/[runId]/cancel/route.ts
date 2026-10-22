import { runs } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED"]);

export const POST = handler<Ctx>(async (_req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId } });
  if (!run) throw new HttpError(404, "Run not found");
  if (TERMINAL.has(run.status)) return json({ id: run.id, status: run.status });

  if (run.triggerRunId) await runs.cancel(run.triggerRunId);
  await db.$transaction([
    db.agentRun.update({ where: { id: runId }, data: { status: "CANCELLED" } }),
    ...(run.assistantMessageId
      ? [db.message.update({ where: { id: run.assistantMessageId }, data: { status: "CANCELLED" } })]
      : []),
  ]);
  return json({ id: run.id, status: "CANCELLED" });
});
