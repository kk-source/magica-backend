import { env } from "@/lib/env";

// Thin Magica inference client. Endpoint paths/payloads are placeholders until wired
// against https://magica.com/docs — keep all HTTP details here so tools stay declarative.

export type MagicaRun = { id: string; status: string; output?: Record<string, unknown>; error?: string; cost?: number };

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const { MAGICA_API_BASE_URL, MAGICA_API_KEY } = env();
  const res = await fetch(`${MAGICA_API_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${MAGICA_API_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`Magica ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Starts a Magica job and polls until it finishes. */
export async function runMagica(model: string, input: unknown, signal?: AbortSignal): Promise<MagicaRun> {
  // TODO(day2): confirm endpoint + response shape from Magica docs.
  let run = await request<MagicaRun>(`/runs`, { method: "POST", body: JSON.stringify({ model, input }), signal });
  const deadline = Date.now() + 10 * 60_000;
  while (!["succeeded", "failed", "cancelled"].includes(run.status)) {
    if (Date.now() > deadline) throw new Error(`Magica run ${run.id} timed out`);
    await new Promise((r) => setTimeout(r, 2000));
    run = await request<MagicaRun>(`/runs/${run.id}`, { signal });
  }
  if (run.status !== "succeeded") throw new Error(run.error ?? `Magica run ${run.id} ${run.status}`);
  return run;
}
