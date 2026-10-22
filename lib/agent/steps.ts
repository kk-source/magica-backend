import type { ToolEvent, ToolStep } from "@/lib/contracts";

// Turns raw tool events into the user-facing step list ("Cropping image **1024×1024**  2.1s").

const LABELS: Record<string, string> = {
  load_skill: "Loading skill",
  read_skill_asset: "Reading skill file",
  crop_image: "Cropping image",
  gpt_image_2: "Generating image",
  merge_videos: "Merging videos",
};

// Past tense once a step has finished ("Loaded skill" vs "Loading skill").
const DONE_LABELS: Record<string, string> = {
  load_skill: "Loaded skill",
  read_skill_asset: "Read skill file",
  crop_image: "Cropped image",
  gpt_image_2: "Generated image",
  merge_videos: "Merged videos",
};

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function keyArg(name: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "load_skill":
      return typeof i.name === "string" ? i.name : null;
    case "read_skill_asset":
      return typeof i.path === "string" ? i.path : null;
    case "crop_image":
      return typeof i.aspect_ratio === "string" ? i.aspect_ratio : i.region ? "custom area" : null;
    case "gpt_image_2":
      return typeof i.prompt === "string" ? truncate(i.prompt) : null;
    case "merge_videos":
      return Array.isArray(i.video_urls) ? `${i.video_urls.length} videos` : null;
    default:
      return null;
  }
}

export function toToolSteps(events: ToolEvent[], now = Date.now()): ToolStep[] {
  const ends = new Map(events.filter((e) => e.type === "tool_end").map((e) => [e.id, e]));
  return events
    .filter((e) => e.type === "tool_start")
    .map((start) => {
      const end = ends.get(start.id);
      const done = !!end && !end.error;
      const editing =
        start.name === "gpt_image_2" && !!(start.input as { input_images?: unknown[] })?.input_images?.length;
      const label = editing
        ? done ? "Edited image" : "Editing image"
        : ((done ? DONE_LABELS : LABELS)[start.name] ?? start.name);
      return {
        label,
        boldArg: keyArg(start.name, start.input),
        elapsedMs: Math.max(0, (end?.at ?? now) - (start.at ?? now)),
        status: !end ? "running" : end.error ? "failed" : "done",
      };
    });
}

export const totalCredits = (events: ToolEvent[]) =>
  events.reduce((sum, e) => sum + (e.type === "tool_end" ? (e.creditCost ?? 0) : 0), 0);

/** Follow-up chips based on the last successful creative tool. */
export function suggestionsFor(events: ToolEvent[]): string[] {
  const last = [...events].reverse().find((e) => e.type === "tool_end" && !e.error && e.name in SUGGESTIONS);
  return last ? SUGGESTIONS[last.name]! : [];
}

const SUGGESTIONS: Record<string, string[]> = {
  gpt_image_2: ["Make it 16:9", "Crop it to a square", "Try a different style"],
  crop_image: ["Crop it tighter", "Edit the cropped image", "Make a 9:16 version"],
  merge_videos: ["Add a fade transition", "Merge in another clip", "Reverse the clip order"],
};
