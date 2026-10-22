import { env } from "@/lib/env";

// Magica inference client: POST /nodes/{nodeType}/run → { runId }, then poll GET /nodes/runs/{runId}.
// https://magica.com/docs/api-reference/nodes/run

export type MagicaRun = {
  id: string;
  nodeType: string;
  subModelId: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
  output: Record<string, unknown> | null;
  error: string | null;
  userMessage: string | null;
  /** Microcredits; may be 0 until settled. */
  creditUsed: number;
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELED"]);
const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60_000;
const MAX_RETRIES = 4;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const { MAGICA_API_BASE_URL, MAGICA_API_KEY } = env();
  const res = await fetch(`${MAGICA_API_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${MAGICA_API_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  // Back off on rate limits and transient server errors.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, init.signal ?? undefined);
    return request<T>(path, init, attempt + 1);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(`Magica ${res.status}: ${body?.message ?? body?.error ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Starts a Magica node run and polls until it reaches a terminal state. */
export async function runMagica(
  nodeType: string,
  input: Record<string, unknown>,
  opts: { subModelId?: string; signal?: AbortSignal } = {},
): Promise<MagicaRun> {
  const { runId } = await request<{ runId: string }>(`/nodes/${nodeType}/run`, {
    method: "POST",
    body: JSON.stringify({ input, ...(opts.subModelId ? { subModelId: opts.subModelId } : {}) }),
    signal: opts.signal,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    await sleep(POLL_MS, opts.signal);
    const run = await request<MagicaRun>(`/nodes/runs/${runId}`, { signal: opts.signal });
    if (TERMINAL.has(run.status)) {
      if (run.status !== "COMPLETED") throw new Error(run.userMessage ?? run.error ?? `Magica run ${run.status}`);
      return run;
    }
    if (Date.now() > deadline) throw new Error(`Magica run ${runId} timed out`);
  }
}

/** Output shapes vary by node (`image_url`, `video_url`, `images[]`…); take the first URL found. */
export function firstOutputUrl(output: unknown, preferredKeys: string[]): string {
  const obj = (output ?? {}) as Record<string, unknown>;
  const candidates = [...preferredKeys.map((k) => obj[k]), ...Object.values(obj)];
  for (const v of candidates) {
    const url = Array.isArray(v) ? v.find((x) => typeof x === "string") : v;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  throw new Error("Magica run completed without an output URL");
}

/** Magica bills in microcredits; app credits are 1/1000 of a Magica credit, min 1 per paid call. */
export const toAppCredits = (micro: number) => Math.max(1, Math.ceil(micro / 1000));
