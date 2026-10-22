import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { defineTool } from "./types";

// Magica node gpt_image_2: sub-model picked by whether source images are supplied.
const SUB_MODEL = { text: "gpt-image-2-text", edit: "gpt-image-2-edit" } as const;

export const gptImage2 = defineTool({
  name: "gpt_image_2",
  description:
    "Generate an image from a text prompt, or edit existing images with a prompt by passing their URLs in input_images.",
  input: z.object({
    prompt: z.string().min(1).max(4000),
    input_images: z.array(z.string().url()).min(1).max(10).optional(),
    aspect_ratio: z.enum(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "auto"]).optional(),
  }),
  output: z.object({ image_url: z.string().url() }),
  async execute(input, ctx) {
    const mode = input.input_images?.length ? "edit" : "text";
    const run = await runMagica(
      "gpt_image_2",
      // Only send fields the model is known to accept; Magica rejects unknown input keys.
      {
        prompt: input.prompt,
        ...(input.aspect_ratio ? { aspect_ratio: input.aspect_ratio } : {}),
        ...(mode === "edit" ? { input_images: input.input_images } : {}),
      },
      { subModelId: SUB_MODEL[mode], signal: ctx.signal },
    );
    return {
      output: { image_url: firstOutputUrl(run.output, ["images", "image_url"]) },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
