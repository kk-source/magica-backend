import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";

/** Current user's credit balance for the sidebar and top bar. */
export const GET = handler(async () => {
  const user = await requireUser();
  return json({ id: user.id, credits: user.credits });
});
