import { imageSize } from "image-size";
import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { defineTool } from "./types";

const RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "5:4", "4:3", "3:2", "16:9"] as const;

const pct = z.number().min(0).max(100);
const px = z.number().int().min(0);

/** Reads width/height from the image header so crops can be exact without the model knowing the size. */
async function dimensions(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  const { width, height } = imageSize(new Uint8Array(await res.arrayBuffer()));
  if (!width || !height) throw new Error("Could not read image dimensions");
  return { width, height };
}

export const cropImage = defineTool({
  name: "crop_image",
  description:
    "Crop an image. `region` is a rectangle in percent of the image (0–100, from the top-left); omit it to use the whole image. " +
    "`aspect_ratio` takes the largest rectangle of that ratio centered inside the region. " +
    'Examples: square → {aspect_ratio:"1:1"}; left half → {region:{x:0,y:0,width:50,height:100}}; ' +
    'square around a subject in the upper middle → {region:{x:20,y:0,width:60,height:70}, aspect_ratio:"1:1"}. ' +
    "Use `crop` instead of `region` only when exact pixel coordinates are known.",
  input: z.object({
    image_url: z.string().url(),
    region: z.object({ x: pct, y: pct, width: pct.positive(), height: pct.positive() }).optional(),
    /** Exact rectangle in pixels, from the top-left. */
    crop: z
      .object({ x: px, y: px, width: px.positive(), height: px.positive() })
      .optional(),
    aspect_ratio: z.enum(RATIOS).optional(),
  }).refine((i) => !(i.region && i.crop), "Pass either region (percent) or crop (pixels), not both"),
  output: z.object({ image_url: z.string().url(), width: z.number(), height: z.number() }),
  async execute({ image_url, region, crop: pixels, aspect_ratio }, ctx) {
    const img = await dimensions(image_url, ctx.signal);
    if (pixels && (pixels.x + pixels.width > img.width || pixels.y + pixels.height > img.height)) {
      throw new Error(`Crop rectangle falls outside the ${img.width}×${img.height} image`);
    }
    const r = pixels
      ? {
          x: (pixels.x / img.width) * 100,
          y: (pixels.y / img.height) * 100,
          width: (pixels.width / img.width) * 100,
          height: (pixels.height / img.height) * 100,
        }
      : (region ?? { x: 0, y: 0, width: 100, height: 100 });
    let x = (r.x / 100) * img.width;
    let y = (r.y / 100) * img.height;
    let w = Math.min((r.width / 100) * img.width, img.width - x);
    let h = Math.min((r.height / 100) * img.height, img.height - y);
    if (aspect_ratio) {
      const [rw, rh] = aspect_ratio.split(":").map(Number) as [number, number];
      const target = rw / rh;
      const [nw, nh] = w / h > target ? [h * target, h] : [w, w / target];
      x += (w - nw) / 2;
      y += (h - nh) / 2;
      [w, h] = [nw, nh];
    }
    const crop = { x_px: Math.round(x), y_px: Math.round(y), width_px: Math.max(1, Math.round(w)), height_px: Math.max(1, Math.round(h)) };
    const run = await runMagica("crop_image", { image_url, ...crop }, { signal: ctx.signal });
    return {
      output: { image_url: firstOutputUrl(run.output, ["image_url", "images"]), width: crop.width_px, height: crop.height_px },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
