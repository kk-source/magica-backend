import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { defineTool } from "./types";

// Magica node gpt_image_2: sub-model picked by whether source images are supplied.
const SUB_MODEL = { text: "gpt-image-2-text", edit: "gpt-image-2-edit" } as const;

// Magica takes a fixed `size`, not a ratio; map each ratio to the closest supported size.
const SIZE_FOR_RATIO = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "4:3": "1536x1024",
  "16:9": "2048x1152",
  "2:3": "1024x1536",
  "3:4": "1024x1536",
  "9:16": "1024x1536",
} as const;

export const gptImage2 = defineTool({
  name: "gpt_image_2",
  description:
    "Generate an image from a text prompt, or edit existing images with a prompt by passing their URLs in input_images.",
  input: z.object({
    prompt: z.string().min(1).max(4000),
    input_images: z.array(z.string().url()).min(1).max(10).optional(),
    aspect_ratio: z.enum(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]).optional(),
  }),
  output: z.object({ image_url: z.string().url(), width: z.number().optional(), height: z.number().optional() }),
  async execute(input, ctx) {
    const mode = input.input_images?.length ? "edit" : "text";
    // A known size lets the agent compute pixel crops on the result. Edits without a ratio keep the source's.
    const size = input.aspect_ratio || mode === "text" ? SIZE_FOR_RATIO[input.aspect_ratio ?? "1:1"] : "Auto";
    const [width, height] = size === "Auto" ? [] : size.split("x").map(Number);
    const run = await runMagica(
      "gpt_image_2",
      // Field names from Magica's live schema (GET /v1/models/gpt-image-2-{text,edit}/schema).
      {
        prompt: input.prompt,
        size,
        // Medium is roughly twice as fast as Magica's High default with little visible loss.
        quality: "Medium",
        ...(mode === "edit" ? { uploadedImages: input.input_images } : {}),
      },
      { subModelId: SUB_MODEL[mode], signal: ctx.signal },
    );
    return {
      output: { image_url: firstOutputUrl(run.output, ["images", "image_url"]), width, height },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
