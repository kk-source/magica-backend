import { auth, runs } from "@trigger.dev/sdk";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { isActiveRun, readContent, toWaitpoint, type Run, type ToolEvent } from "@/lib/contracts";
import { HttpError, handler, json } from "@/lib/http";
import { toToolSteps, totalCredits } from "@/lib/agent/steps";

const TOKEN_TTL = "2h";

const DEAD = new Set(["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED", "CANCELED"]);

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

/**
 * Run status. While active it also hands out a read-only Trigger.dev Realtime token so the client
 * can subscribe to the run's metadata (text, tool steps) instead of polling. Live text/tool events
 * come from the run metadata while streaming; once finished, from the persisted assistant message.
 * Clients already subscribed pass `?realtime=0` to skip minting another token.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId }, include: { assistantMessage: true } });
  if (!run) throw new HttpError(404, "Run not found");

  let { text, tools = [] } = run.assistantMessage ? readContent(run.assistantMessage.content) : { text: "", tools: [] };

  if (isActiveRun(run.status) && run.triggerRunId) {
    const live = await runs.retrieve(run.triggerRunId).catch(() => null);
    const meta = live?.metadata as { text?: string; tools?: ToolEvent[] } | undefined;
    if (typeof meta?.text === "string") text = meta.text;
    if (Array.isArray(meta?.tools)) tools = meta.tools;

    // A worker killed without reaching its catch block (crash, timeout, redeploy) leaves the run
    // active forever; reconcile from Trigger.dev and keep whatever it had streamed.
    if (live && DEAD.has(live.status)) {
      // A cancel can land on Trigger.dev before the cancel route's DB write; that's a stop, not a crash.
      const cancelled = live.status === "CANCELED";
      run.status = cancelled ? "CANCELLED" : "FAILED";
      run.error = cancelled ? null : "The agent stopped unexpectedly. Please try again.";
      await db.$transaction([
        db.agentRun.update({ where: { id: run.id }, data: { status: run.status, error: run.error } }),
        ...(run.assistantMessageId
          ? [
              db.message.update({
                where: { id: run.assistantMessageId },
                data: { status: run.status, content: { text, tools } as Prisma.InputJsonValue },
              }),
            ]
          : []),
      ]);
    }
  }

  const active = isActiveRun(run.status);
  // The pending question comes from Postgres, so it survives reloads and missed realtime updates.
  const waitpoint =
    run.status === "WAITING"
      ? await db.waitpoint.findFirst({
          where: { runId: run.id, status: "PENDING", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        })
      : null;
  // Best effort: without a token the client falls back to polling this route.
  const wantsToken = new URL(req.url).searchParams.get("realtime") !== "0";
  const accessToken =
    active && wantsToken && run.triggerRunId
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
    waitpoint: waitpoint ? toWaitpoint(waitpoint) : null,
  };
  return json(dto);
});
