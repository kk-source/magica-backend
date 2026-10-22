import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getSkill, safeJoin, SKILLS_DIR } from "@/lib/skills/registry";
import { defineTool } from "./types";

const MAX_ASSET_BYTES = 50 * 1024;

export const readSkillAsset = defineTool({
  name: "read_skill_asset",
  description: "Read a text asset file (template, reference, example) that a loaded skill points to, by path relative to the skill folder.",
  input: z.object({ skill: z.string(), path: z.string().min(1).max(256) }),
  output: z.object({ path: z.string(), content: z.string() }),
  async execute(input) {
    const meta = await getSkill(input.skill);
    if (!meta) throw new Error(`Unknown skill: ${input.skill}`);
    if (path.isAbsolute(input.path)) throw new Error("Asset path must be relative");
    const skillRoot = safeJoin(SKILLS_DIR, meta.dir);
    const file = safeJoin(skillRoot, input.path);
    // Resolve symlinks too, so a link inside the skill can't point outside it.
    const [real, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(skillRoot)]);
    if (!real.startsWith(realRoot + path.sep)) throw new Error("Path escapes skill folder");
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error("Not a file");
    if (stat.size > MAX_ASSET_BYTES) throw new Error("Asset exceeds 50KB");
    return { output: { path: input.path, content: await fs.readFile(real, "utf8") } };
  },
});
