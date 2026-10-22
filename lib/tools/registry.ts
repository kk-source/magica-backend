import { z } from "zod";
import type OpenAI from "openai";
import { cropImage } from "./crop-image";
import { gptImage2 } from "./gpt-image-2";
import { loadSkill } from "./load-skill";
import { mergeVideos } from "./merge-videos";
import { readSkillAsset } from "./read-skill-asset";
import type { Tool } from "./types";

export const tools: Tool[] = [loadSkill, readSkillAsset, cropImage, gptImage2, mergeVideos];

export const toolsByName = new Map(tools.map((t) => [t.name, t]));

/** OpenRouter (OpenAI-compatible) function definitions. */
export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>,
  },
}));
