import { logger, metadata, task } from "@trigger.dev/sdk";
import type OpenAI from "openai";
import type { Prisma } from "@/lib/generated/prisma/client";
import { runAgent, type AgentEvent } from "@/lib/agent/loop";
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
      const text = (m.content as { text?: string } | null)?.text ?? "";
      const files = m.attachments.map((a) => `[attachment ${a.mimeType}] ${a.fileUrl}`).join("\n");
      return m.role === "USER"
        ? { role: "user" as const, content: files ? `${text}\n\n${files}` : text }
        : { role: "assistant" as const, content: text };
    });
}

export const agentRun = task({
  id: "agent-run",
  run: async ({ chatId, runId }: Payload, { signal }) => {
    await db.agentRun.update({ where: { id: runId }, data: { status: "RUNNING" } });

    const history = await db.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: { attachments: true },
    });
    const assistant = await db.message.create({
      data: { chatId, role: "ASSISTANT", content: { text: "" }, status: "STREAMING" },
    });
    metadata.set("assistantMessageId", assistant.id);

    let text = "";
    const toolEvents: Exclude<AgentEvent, { type: "text" | "done" }>[] = [];
    let lastFlush = 0;
    const flush = (force = false) => {
      if (!force && Date.now() - lastFlush < FLUSH_MS) return;
      lastFlush = Date.now();
      metadata.set("text", text);
      metadata.set("tools", JSON.parse(JSON.stringify(toolEvents)));
    };

    try {
      for await (const ev of runAgent({ messages: toChatMessages(history.reverse()), runId, signal })) {
        if (ev.type === "text") text += ev.delta;
        else if (ev.type !== "done") toolEvents.push(ev);
        flush(ev.type !== "text");
      }
      flush(true);

      await db.$transaction([
        db.message.update({
          where: { id: assistant.id },
          data: { content: { text, tools: toolEvents } as Prisma.InputJsonValue, status: "COMPLETE" },
        }),
        db.agentRun.update({ where: { id: runId }, data: { status: "COMPLETED" } }),
      ]);
      return { assistantMessageId: assistant.id };
    } catch (err) {
      const cancelled = signal.aborted;
      logger.error("agent run failed", { err: String(err), cancelled });
      await db.$transaction([
        db.message.update({
          where: { id: assistant.id },
          data: {
            content: { text, tools: toolEvents } as Prisma.InputJsonValue,
            status: cancelled ? "CANCELLED" : "FAILED",
          },
        }),
        db.agentRun.update({ where: { id: runId }, data: { status: cancelled ? "CANCELLED" : "FAILED" } }),
      ]);
      throw err;
    }
  },
});
