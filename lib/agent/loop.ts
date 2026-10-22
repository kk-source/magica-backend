import OpenAI from "openai";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { listSkills } from "@/lib/skills/registry";
import { toolDefinitions, toolsByName } from "@/lib/tools/registry";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown; at: number }
  | { type: "tool_end"; id: string; name: string; output?: unknown; error?: string; at: number; creditCost?: number }
  | { type: "done"; text: string };

const MAX_STEPS = 10;

export async function buildSystemPrompt(): Promise<string> {
  const skills = await listSkills();
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return [
    "You are Galaxy, a helpful creative assistant that can edit images, generate images and merge videos.",
    "Before using a creative tool, call load_skill for the matching skill and follow its instructions.",
    `Available skills:\n${list}`,
    "Keep replies short. Never invent URLs; only use URLs from the user or from tool results.",
  ].join("\n\n");
}

/**
 * Runs the tool-calling loop against OpenRouter, yielding text deltas and tool events.
 * Tool invocations and loaded skills are persisted against `runId`.
 */
export async function* runAgent(opts: {
  messages: ChatMessage[];
  runId: string;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { OPENROUTER_API_KEY, OPENROUTER_MODEL } = env();
  const client = new OpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  const messages: ChatMessage[] = [{ role: "system", content: await buildSystemPrompt() }, ...opts.messages];
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = await client.chat.completions.create(
      { model: OPENROUTER_MODEL, messages, tools: toolDefinitions, stream: true },
      { signal: opts.signal },
    );

    let text = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        yield { type: "text", delta: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
    }
    finalText += text;

    if (calls.size === 0) break;

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: [...calls.values()].map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    for (const call of calls.values()) {
      const result = yield* executeTool(call, opts.runId, opts.signal);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  yield { type: "done", text: finalText };
}

async function* executeTool(
  call: { id: string; name: string; args: string },
  runId: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent, unknown> {
  let rawInput: unknown;
  try {
    rawInput = JSON.parse(call.args || "{}");
  } catch {
    rawInput = call.args;
  }
  yield { type: "tool_start", id: call.id, name: call.name, input: rawInput, at: Date.now() };

  const tool = toolsByName.get(call.name);
  const invocation = await db.toolInvocation.create({
    data: { runId, toolName: call.name, input: rawInput as Prisma.InputJsonValue, status: "RUNNING" },
  });
  const started = Date.now();

  try {
    if (!tool) throw new Error(`Unknown tool: ${call.name}`);
    const input = tool.input.parse(rawInput);
    const { output, magicaRunId, creditCost = 0 } = await tool.execute(input, { runId, signal });

    if (tool.name === "load_skill") {
      const o = output as { name: string; contentHash: string };
      await db.runSkill.upsert({
        where: { runId_skillName: { runId, skillName: o.name } },
        update: { contentHash: o.contentHash },
        create: { runId, skillName: o.name, contentHash: o.contentHash },
      });
    }
    await db.toolInvocation.update({
      where: { id: invocation.id },
      data: {
        status: "SUCCEEDED",
        output: output as Prisma.InputJsonValue,
        magicaRunId,
        creditCost,
        durationMs: Date.now() - started,
      },
    });
    yield { type: "tool_end", id: call.id, name: call.name, output, creditCost, at: Date.now() };
    return output;
  } catch (err) {
    // Errors go back to the model as tool results so it can recover or explain.
    const error = err instanceof Error ? err.message : String(err);
    await db.toolInvocation.update({
      where: { id: invocation.id },
      data: { status: "FAILED", output: { error }, durationMs: Date.now() - started },
    });
    yield { type: "tool_end", id: call.id, name: call.name, error, at: Date.now() };
    return { error };
  }
}
