import { z } from "zod";
import { runMagica } from "./magica";
import { defineTool } from "./types";

export const gptImage2 = defineTool({
  name: "gpt_image_2",
  description:
    "Generate an image from a text prompt (mode 'text'), or edit an existing image with a prompt (mode 'edit', requires image_url).",
  input: z
    .object({
      prompt: z.string().min(1).max(4000),
      image_url: z.string().url().optional(),
      mode: z.enum(["text", "edit"]),
    })
    .refine((v) => v.mode === "text" || v.image_url, { message: "image_url is required when mode is 'edit'" }),
  output: z.object({ image_url: z.string().url() }),
  async execute(input, ctx) {
    const run = await runMagica("gpt-image-2", input, ctx.signal);
    return { output: { image_url: String(run.output?.image_url) }, magicaRunId: run.id, creditCost: run.cost ?? 5 };
  },
});
