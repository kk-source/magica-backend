import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  OPENROUTER_API_KEY: z.string().min(1),
  // The brief allows only OpenRouter's free router (or explicit `:free` variants), never a paid fallback.
  OPENROUTER_MODEL: z
    .string()
    .default("openrouter/free")
    .refine((m) => m === "openrouter/free" || m.endsWith(":free"), "OPENROUTER_MODEL must be openrouter/free or a :free model"),
  STARTING_CREDITS: z.coerce.number().int().nonnegative().default(1000),
  /** Minimum balance needed to start a turn; roughly one image generation. */
  MIN_RUN_CREDITS: z.coerce.number().int().nonnegative().default(250),
  /** Paid tools estimated at or above this many credits ask the user first; 0 always asks. */
  CREDIT_APPROVAL_MIN: z.coerce.number().int().nonnegative().default(50),
  /** How long a run waits for an answer before the request expires. */
  WAITPOINT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  MAGICA_API_KEY: z.string().min(1),
  MAGICA_API_BASE_URL: z.string().url().default("https://inference.magica.com/v1"),
  // Optional so the rest of the API runs without uploads configured.
  TRANSLOADIT_KEY: z.string().min(1).optional(),
  TRANSLOADIT_SECRET: z.string().min(1).optional(),
  TRANSLOADIT_TEMPLATE_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Lazily validated so `next build` doesn't require runtime secrets. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
