import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("openrouter/free"),
  MAGICA_API_KEY: z.string().min(1),
  MAGICA_API_BASE_URL: z.string().url().default("https://inference.magica.com/v1"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Lazily validated so `next build` doesn't require runtime secrets. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
