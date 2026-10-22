import type { z } from "zod";

export type ToolContext = { runId: string; signal?: AbortSignal };

export type ToolResult<O> = { output: O; magicaRunId?: string; creditCost?: number };

export type Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  output: O;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<ToolResult<z.infer<O>>>;
};

export const defineTool = <I extends z.ZodType, O extends z.ZodType>(tool: Tool<I, O>) => tool;
