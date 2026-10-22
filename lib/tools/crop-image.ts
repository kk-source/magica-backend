import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { defineTool } from "./types";

export const cropImage = defineTool({
  name: "crop_image",
  description:
    "Crop an image to a pixel rectangle measured from the top-left corner. Omit x/y to center a width×height crop.",
  input: z.object({
    image_url: z.string().url(),
    crop: z.object({
      x: z.number().int().nonnegative().optional(),
      y: z.number().int().nonnegative().optional(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  output: z.object({ image_url: z.string().url() }),
  async execute({ image_url, crop }, ctx) {
    const run = await runMagica(
      "crop_image",
      { image_url, width_px: crop.width, height_px: crop.height, x_px: crop.x, y_px: crop.y },
      { signal: ctx.signal },
    );
    return {
      output: { image_url: firstOutputUrl(run.output, ["image_url", "images"]) },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
