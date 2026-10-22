import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handler, json } from "@/lib/http";

// Temporary: returns Magica's live input schemas for the three tools so their definitions can be
// checked against the real API. Remove once the tools are verified.
const MODEL_IDS = ["gpt-image-2-text", "gpt-image-2-edit", "gpt_image_2", "crop_image", "merge_videos"];

export const GET = handler(async () => {
  await requireUser();
  const { MAGICA_API_BASE_URL, MAGICA_API_KEY } = env();
  const get = async (path: string) => {
    const res = await fetch(`${MAGICA_API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${MAGICA_API_KEY}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const schemas = Object.fromEntries(
    await Promise.all(MODEL_IDS.map(async (id) => [id, await get(`/models/${id}/schema`)] as const)),
  );
  const models = await get("/models");
  const list = Array.isArray(models.body) ? models.body : ((models.body as { data?: unknown[] })?.data ?? models.body);
  const related = Array.isArray(list)
    ? list.filter((m) => /gpt_image|gpt-image|crop|merge_videos/.test(JSON.stringify(m)))
    : list;
  return json({ schemas, models: { status: models.status, related } });
});
