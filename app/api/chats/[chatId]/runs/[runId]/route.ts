import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import type { RunDto } from "@/lib/contracts";
import { HttpError, handler, json } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

export const GET = handler<Ctx>(async (_req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId } });
  if (!run) throw new HttpError(404, "Run not found");
  const dto: RunDto = { id: run.id, triggerRunId: run.triggerRunId, status: run.status };
  return json({ run: dto });
});
