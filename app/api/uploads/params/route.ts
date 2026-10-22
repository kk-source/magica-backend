import { createHmac } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError, handler, json } from "@/lib/http";

const EXPIRES_MS = 60 * 60 * 1000;

/** Transloadit wants `YYYY/MM/DD HH:mm:ss+00:00`. */
const transloaditDate = (d: Date) => d.toISOString().replace(/-/g, "/").replace("T", " ").replace(/\.\d+Z$/, "+00:00");

/**
 * Signed Assembly params for Uppy's Transloadit plugin. The secret never leaves the server;
 * signing pins the steps so clients can't run arbitrary robots on our account.
 */
export const POST = handler(async () => {
  const user = await requireUser();
  const { TRANSLOADIT_KEY, TRANSLOADIT_SECRET, TRANSLOADIT_TEMPLATE_ID } = env();
  if (!TRANSLOADIT_KEY || !TRANSLOADIT_SECRET) throw new HttpError(503, "Uploads are not configured");

  const params = JSON.stringify({
    auth: { key: TRANSLOADIT_KEY, expires: transloaditDate(new Date(Date.now() + EXPIRES_MS)) },
    ...(TRANSLOADIT_TEMPLATE_ID
      ? { template_id: TRANSLOADIT_TEMPLATE_ID }
      : { steps: { ":original": { robot: "/upload/handle" } } }),
    fields: { userId: user.id },
  });
  const signature = `sha384:${createHmac("sha384", TRANSLOADIT_SECRET).update(params).digest("hex")}`;
  return json({ params, signature });
});
