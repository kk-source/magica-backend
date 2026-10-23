import { logger, metadata, task } from "@trigger.dev/sdk";
import type OpenAI from "openai";
import type { Prisma } from "@/lib/generated/prisma/client";
import { runAgent } from "@/lib/agent/loop";
import { readContent, type ToolEvent } from "@/lib/contracts";
import { suggestionsFor, toToolSteps, totalCredits } from "@/lib/agent/steps";
import { db } from "@/lib/db";

type Payload = { chatId: string; runId: string; userMessageId: string };

const HISTORY_LIMIT = 40;
const FLUSH_MS = 150;

function toChatMessages(
  rows: { role: string; content: Prisma.JsonValue; attachments: { fileUrl: string; mimeType: string }[] }[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return rows
    .filter((m) => m.role === "USER" || m.role === "ASSISTANT")
    .map((m) => {
      const { text, tools = [] } = readContent(m.content);
      if (m.role === "USER") {
        const files = m.attachments.map((a) => `[attachment ${a.mimeType}] ${a.fileUrl}`).join("\n");
        return { role: "user" as const, content: files ? `${text}\n\n${files}` : text };
      }
      // Keep earlier tool outputs (URLs) visible so follow-ups like "now crop that" can chain.
      const results = tools
        .filter((t) => t.type === "tool_end" && t.output)
        .map((t) => `[${t.name} result] ${JSON.stringify(t.output)}`)
        .join("\n");
      return { role: "assistant" as const, content: results ? `${results}\n\n${text}` : text };
    })
    .filter((m) => m.content);
}

/** Debits the Magica tool calls that completed in this run (once: the run reaches one terminal write). */
async function settleCredits(chatId: string, runId: string, toolEvents: ToolEvent[]) {
  const cost = totalCredits(toolEvents);
  if (cost <= 0) return [];
  const { userId } = await db.chat.findUniqueOrThrow({ where: { id: chatId }, select: { userId: true } });
  return [
    db.user.update({ where: { id: userId }, data: { credits: { decrement: cost } } }),
    db.creditLedger.create({ data: { userId, runId, amount: -cost, type: "DEBIT", description: "Agent run" } }),
  ];
}

export const agentRun = task({
  id: "agent-run",
  run: async ({ chatId, runId }: Payload, { signal }) => {
    let text = "";
    const toolEvents: ToolEvent[] = [];
    let lastFlush = 0;
    const flush = (force = false) => {
      if (!force && Date.now() - lastFlush < FLUSH_MS) return;
      lastFlush = Date.now();
      metadata.set("text", text);
      metadata.set("tools", JSON.parse(JSON.stringify(toolEvents)));
      metadata.set("toolSteps", toToolSteps(toolEvents));
    };
    // Set once the assistant row exists; setup failures before that still mark the run FAILED.
    let assistantId: string | undefined;

    try {
      const history = await db.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        include: { attachments: true },
      });
      const assistant = await db.message.create({
        data: { chatId, role: "ASSISTANT", content: { text: "" }, status: "STREAMING" },
      });
      assistantId = assistant.id;
      await db.agentRun.update({ where: { id: runId }, data: { status: "STREAMING", assistantMessageId: assistant.id } });
      metadata.set("assistantMessageId", assistant.id);
      metadata.set("status", "STREAMING");

      for await (const ev of runAgent({ messages: toChatMessages(history.reverse()), runId, signal })) {
        if (ev.type === "text") text += ev.delta;
        else if (ev.type !== "done") toolEvents.push(ev);
        flush(ev.type !== "text");
      }
      flush(true);

      await db.$transaction([
        db.message.update({
          where: { id: assistant.id },
          data: {
            content: { text, tools: toolEvents, suggestions: suggestionsFor(toolEvents) } as Prisma.InputJsonValue,
            status: "COMPLETE",
          },
        }),
        db.agentRun.update({ where: { id: runId }, data: { status: "COMPLETE" } }),
        ...(await settleCredits(chatId, runId, toolEvents)),
      ]);
      metadata.set("status", "COMPLETE");
      return { assistantMessageId: assistant.id };
    } catch (err) {
      const cancelled = signal.aborted;
      const error = err instanceof Error ? err.message : String(err);
      logger.error("agent run failed", { error, cancelled });
      const status = cancelled ? "CANCELLED" : "FAILED";
      metadata.set("status", status);
      await db
        .$transaction([
          ...(assistantId
            ? [
                db.message.update({
                  where: { id: assistantId },
                  data: { content: { text, tools: toolEvents } as Prisma.InputJsonValue, status },
                }),
              ]
            : []),
          db.agentRun.update({ where: { id: runId }, data: { status, error: cancelled ? null : error } }),
          // Magica work that finished before the failure was still billed to us.
          ...(await settleCredits(chatId, runId, toolEvents).catch(() => [])),
        ])
        .catch((e) => logger.error("failed to record run failure", { error: String(e) }));
      throw err;
    }
  },
});
