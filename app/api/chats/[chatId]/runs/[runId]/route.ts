import { runs } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { readContent, type Run, type ToolEvent } from "@/lib/contracts";
import { HttpError, handler, json } from "@/lib/http";
import { toToolSteps, totalCredits } from "@/lib/agent/steps";

type Ctx = { params: Promise<{ chatId: string; runId: string }> };

/**
 * Run status for polling. While streaming, live text/tool events come from the Trigger.dev
 * run metadata; once finished, from the persisted assistant message.
 */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { chatId, runId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const run = await db.agentRun.findFirst({ where: { id: runId, chatId }, include: { assistantMessage: true } });
  if (!run) throw new HttpError(404, "Run not found");

  let { text, tools = [] } = run.assistantMessage ? readContent(run.assistantMessage.content) : { text: "", tools: [] };
  if (run.status === "STREAMING" && run.triggerRunId) {
    const live = await runs.retrieve(run.triggerRunId).catch(() => null);
    const meta = live?.metadata as { text?: string; tools?: ToolEvent[] } | undefined;
    if (typeof meta?.text === "string") text = meta.text;
    if (Array.isArray(meta?.tools)) tools = meta.tools;
  }

  const dto: Run = {
    id: run.id,
    chatId,
    status: run.status,
    text,
    tools,
    toolSteps: toToolSteps(tools),
    credits: totalCredits(tools),
    error: run.error,
  };
  return json(dto);
});
