import { z } from "zod";
import { loadSkillBody } from "@/lib/skills/registry";
import { defineTool } from "./types";

export const loadSkill = defineTool({
  name: "load_skill",
  description: "Load the full instructions for a skill by name. Call this before doing a task that matches a listed skill.",
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string(), instructions: z.string(), contentHash: z.string() }),
  async execute({ name }) {
    const skill = await loadSkillBody(name);
    return { output: { name: skill.name, instructions: skill.body, contentHash: skill.contentHash } };
  },
});
