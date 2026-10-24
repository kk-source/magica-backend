import { z } from "zod";
import { firstOutputUrl, runMagica, toAppCredits } from "./magica";
import { creditApproval, defineTool } from "./types";

export const mergeVideos = defineTool({
  name: "merge_videos",
  description: "Concatenate 2–100 videos in the given order into one video, with an optional transition between clips.",
  input: z.object({
    video_urls: z.array(z.string().url()).min(2).max(100),
    transition: z.enum(["none", "fade", "dissolve"]).default("none"),
  }),
  output: z.object({ video_url: z.string().url() }),
  // Roughly 1 credit per second of output in practice; ~15 for two short clips.
  approval: (input) => creditApproval(5 * input.video_urls.length, `Merging ${input.video_urls.length} videos`),
  async execute(input, ctx) {
    const run = await runMagica("merge_videos", input, { signal: ctx.signal });
    return {
      output: { video_url: firstOutputUrl(run.output, ["video_url", "videos"]) },
      magicaRunId: run.id,
      creditCost: toAppCredits(run.creditUsed),
    };
  },
});
