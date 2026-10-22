import { z } from "zod";
import { runMagica } from "./magica";
import { defineTool } from "./types";

export const cropImage = defineTool({
  name: "crop_image",
  description: "Crop an image to a pixel rectangle. Coordinates are measured from the top-left corner.",
  input: z.object({
    image_url: z.string().url(),
    crop: z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  output: z.object({ image_url: z.string().url() }),
  async execute(input, ctx) {
    const run = await runMagica("crop-image", input, ctx.signal);
    return { output: { image_url: String(run.output?.image_url) }, magicaRunId: run.id, creditCost: run.cost ?? 1 };
  },
});
