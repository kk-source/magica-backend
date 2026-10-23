import { auth, runs } from "@trigger.dev/sdk";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { readContent, type Run, type ToolEvent } from "@/lib/contracts";
import { HttpError, handler, json } from "@/lib/http";
import { toToolSteps, totalCredits } from "@/lib/agent/steps";

const TOKEN_TTL = "2h";

const DEAD = new Set(["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED", "CANCELED"]);

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

/**
 * Run status. While active it also hands out a read-only Trigger.dev Realtime token so the client
 * can subscribe to the run's metadata (text, tool steps) instead of polling. Live text/tool events
 * come from the run metadata while streaming; once finished, from the persisted assistant message.
 */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId }, include: { assistantMessage: true } });
  if (!run) throw new HttpError(404, "Run not found");

  let { text, tools = [] } = run.assistantMessage ? readContent(run.assistantMessage.content) : { text: "", tools: [] };

  if ((run.status === "PENDING" || run.status === "STREAMING") && run.triggerRunId) {
    const live = await runs.retrieve(run.triggerRunId).catch(() => null);
    const meta = live?.metadata as { text?: string; tools?: ToolEvent[] } | undefined;
    if (typeof meta?.text === "string") text = meta.text;
    if (Array.isArray(meta?.tools)) tools = meta.tools;

    // A worker killed without reaching its catch block (crash, timeout, redeploy) leaves the run
    // active forever; reconcile from Trigger.dev and keep whatever it had streamed.
    if (live && DEAD.has(live.status)) {
      run.status = "FAILED";
      run.error = "The agent stopped unexpectedly. Please try again.";
      await db.$transaction([
        db.agentRun.update({ where: { id: run.id }, data: { status: run.status, error: run.error } }),
        ...(run.assistantMessageId
          ? [
              db.message.update({
                where: { id: run.assistantMessageId },
                data: { status: "FAILED", content: { text, tools } as Prisma.InputJsonValue },
              }),
            ]
          : []),
      ]);
    }
  }

  const active = run.status === "PENDING" || run.status === "STREAMING";
  // Best effort: without a token the client falls back to polling this route.
  const accessToken =
    active && run.triggerRunId
      ? await auth
          .createPublicToken({ scopes: { read: { runs: [run.triggerRunId] } }, expirationTime: TOKEN_TTL })
          .catch(() => null)
      : null;
  const realtime = accessToken && run.triggerRunId ? { runId: run.triggerRunId, accessToken } : null;

  const dto: Run = {
    id: run.id,
    chatId,
    status: run.status,
    text,
    tools,
    toolSteps: toToolSteps(tools),
    credits: totalCredits(tools),
    error: run.error,
    realtime,
  };
  return json(dto);
});
