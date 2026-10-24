import { z } from "zod";
import { defineTool } from "./types";

/** Lets the model pause for a choice (options, or approving a plan) instead of guessing. */
export const askUser = defineTool({
  name: "ask_user",
  description:
    "Ask the user to pick one of 2-4 short options and wait for the answer. Use it when the request is ambiguous or before a multi-step plan; don't use it for simple confirmations.",
  input: z.object({
    question: z.string().min(1).max(300),
    options: z.array(z.string().min(1).max(80)).min(2).max(4),
  }),
  output: z.object({ choice: z.string() }),
  approval: ({ question, options }) => ({ type: "options", question, options }),
  async execute(_input, ctx) {
    return { output: { choice: ctx.choice ?? "" } };
  },
});
