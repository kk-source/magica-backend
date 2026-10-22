import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { defineTool } from "./types";

// Sub-model ids per Magica's model list (GET /v1/models → gpt_image_2.subModels).
const SUB_MODEL = { text: "gpt-image-2-text", edit: "gpt-image-2-edit" } as const;

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
  async execute({ prompt, image_url, mode }, ctx) {
    const input = mode === "edit" && image_url ? { prompt, image_urls: [image_url] } : { prompt };
    const run = await runMagica("gpt_image_2", input, { subModelId: SUB_MODEL[mode], signal: ctx.signal });
    return {
      output: { image_url: firstOutputUrl(run.output, ["images", "image_url"]) },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
