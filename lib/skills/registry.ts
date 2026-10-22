import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

export const SKILLS_DIR = path.resolve(process.cwd(), "agent-skills");
const MAX_SKILL_BYTES = 50 * 1024;

const Frontmatter = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "name must be kebab-case"),
  description: z.string().min(1).max(1024),
});

export type SkillMeta = z.infer<typeof Frontmatter> & { dir: string };
export type SkillBody = { name: string; body: string; contentHash: string };

/** Resolves `child` inside `root`, rejecting anything that escapes it (../, absolute paths, symlink tricks via normalize). */
export function safeJoin(root: string, child: string): string {
  const resolved = path.resolve(root, path.normalize(child));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Path escapes skill root: ${child}`);
  return resolved;
}

async function readSkillFile(dir: string) {
  const file = safeJoin(SKILLS_DIR, path.join(dir, "SKILL.md"));
  const stat = await fs.stat(file);
  if (stat.size > MAX_SKILL_BYTES) throw new Error(`${dir}/SKILL.md exceeds 50KB`);
  return fs.readFile(file, "utf8");
}

let cache: Promise<Map<string, SkillMeta>> | undefined;

async function scan(): Promise<Map<string, SkillMeta>> {
  const skills = new Map<string, SkillMeta>();
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const { data } = matter(await readSkillFile(entry.name));
      const meta = Frontmatter.parse(data);
      if (skills.has(meta.name)) throw new Error(`duplicate skill name "${meta.name}"`);
      skills.set(meta.name, { ...meta, dir: entry.name });
    } catch (err) {
      // One bad skill must not take down the agent; log and skip it.
      console.warn(`[skills] skipping ${entry.name}: ${(err as Error).message}`);
    }
  }
  return skills;
}

function registry() {
  cache ??= scan();
  return cache;
}

/** Metadata only — bodies are loaded lazily through the load_skill tool. */
export async function listSkills(): Promise<SkillMeta[]> {
  return [...(await registry()).values()];
}

export async function getSkill(name: string): Promise<SkillMeta | undefined> {
  return (await registry()).get(name);
}

export async function loadSkillBody(name: string): Promise<SkillBody> {
  const meta = await getSkill(name);
  if (!meta) throw new Error(`Unknown skill: ${name}`);
  const raw = await readSkillFile(meta.dir);
  return { name, body: matter(raw).content.trim(), contentHash: createHash("sha256").update(raw).digest("hex") };
}
