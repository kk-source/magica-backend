import type { z } from "zod";
import type { WaitpointRequest } from "@/lib/contracts";

export type ToolContext = {
  runId: string;
  signal?: AbortSignal;
  /** The user's answer when the tool paused on a waitpoint (see `approval`). */
  choice?: string;
};

export type ToolResult<O> = { output: O; magicaRunId?: string; creditCost?: number };

export type Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  output: O;
  /**
   * Asks the user before executing. Returning a request pauses the run on a waitpoint; `execute`
   * then runs with the answer in `ctx.choice`, unless the user picks the request's `cancelChoice`.
   */
  approval?: (input: z.infer<I>) => WaitpointRequest | null;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<ToolResult<z.infer<O>>>;
};

export const defineTool = <I extends z.ZodType, O extends z.ZodType>(tool: Tool<I, O>) => tool;

/** Credit approval for a paid tool; skipped when the estimate is under CREDIT_APPROVAL_MIN. */
export const creditApproval = (estimatedCredits: number, action: string): WaitpointRequest => ({
  type: "credit",
  question: `${action} will use about ${estimatedCredits} credits. Continue?`,
  options: ["Approve", "Cancel"],
  cancelChoice: "Cancel",
  estimatedCredits,
});
