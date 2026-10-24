import { wait } from "@trigger.dev/sdk";
import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { AnswerWaitpointBody, WaitpointRequestSchema } from "@/lib/contracts";
import { AnswerSchema } from "@/lib/agent/waitpoints";
import { HttpError, handler, json, parseBody } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string; waitpointId: string }> };

/**
 * Answers a waitpoint and resumes the paused run, exactly once. The first answer wins through a
 * conditional PENDING -> RESOLVED update; duplicate submits (double clicks, retries, other tabs)
 * get the stored answer back and never complete the token a second time.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { chatId, waitpointId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  const { choice } = await parseBody(req, AnswerWaitpointBody);

  const wp = await db.waitpoint.findFirst({ where: { id: waitpointId, run: { chatId } } });
  if (!wp) throw new HttpError(404, "Request not found");
  const request = WaitpointRequestSchema.parse(wp.payload);
  if (!request.options.includes(choice)) throw new HttpError(400, "That isn't one of the options.");

  if (wp.status === "RESOLVED") return json({ id: wp.id, status: "RESOLVED" as const, choice: AnswerSchema.parse(wp.response).choice });
  if (wp.status === "EXPIRED" || wp.expiresAt <= new Date()) {
    throw new HttpError(410, "This request expired. Send your message again to continue.");
  }

  const won = await db.waitpoint.updateMany({
    where: { id: wp.id, status: "PENDING" },
    data: { status: "RESOLVED", response: { choice }, resolvedAt: new Date() },
  });
  if (won.count === 0) {
    // Lost a race with another submit (or the expiry); report whatever won.
    const now = await db.waitpoint.findUniqueOrThrow({ where: { id: wp.id } });
    if (now.status !== "RESOLVED") throw new HttpError(410, "This request expired. Send your message again to continue.");
    return json({ id: wp.id, status: "RESOLVED" as const, choice: AnswerSchema.parse(now.response).choice });
  }

  try {
    await wait.completeToken(wp.token, { choice });
  } catch (err) {
    // Reopen so the user can retry; completing a Trigger.dev token twice is a no-op anyway.
    await db.waitpoint.update({ where: { id: wp.id }, data: { status: "PENDING", response: Prisma.DbNull, resolvedAt: null } });
    console.error("waitpoint completion failed", { chatId, waitpointId, waitpointTokenId: wp.token, err });
    throw new HttpError(502, "Couldn't resume the task. Please try again.");
  }
  return json({ id: wp.id, status: "RESOLVED" as const, choice });
});
