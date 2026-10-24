import { logger, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { WaitpointRequest } from "@/lib/contracts";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const AnswerSchema = z.object({ choice: z.string() });

/** Options always ask; credit approvals only above the configured estimate. */
export const needsAnswer = (req: WaitpointRequest) =>
  req.type !== "credit" || (req.estimatedCredits ?? 0) >= env().CREDIT_APPROVAL_MIN;

/**
 * Creates (or, on a task retry, reuses) the waitpoint for one tool call: a Trigger.dev token plus the
 * durable Waitpoint row the answer route resolves.
 */
export async function openWaitpoint(runId: string, callId: string, request: WaitpointRequest) {
  const idempotencyKey = `${runId}:${callId}`;
  const existing = await db.waitpoint.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const minutes = env().WAITPOINT_TIMEOUT_MINUTES;
  const token = await wait.createToken({ idempotencyKey, timeout: `${minutes}m`, tags: [`run_${runId}`] });
  const row = await db.waitpoint.create({
    data: {
      runId,
      token: token.id,
      idempotencyKey,
      type: request.type,
      payload: request as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    },
  });
  logger.info("waitpoint opened", { runId, waitpointId: row.id, waitpointTokenId: token.id, type: request.type });
  return row;
}

/**
 * Suspends the task until the user answers (no compute is used while checkpointed). Returns the
 * choice, or null when the token timed out, in which case the row is marked EXPIRED.
 */
export async function awaitAnswer(wp: { id: string; runId: string; token: string }): Promise<string | null> {
  const result = await wait.forToken<{ choice: string }>(wp.token);
  const answer = result.ok ? AnswerSchema.safeParse(result.output) : null;
  if (answer?.success) {
    logger.info("waitpoint answered", { runId: wp.runId, waitpointTokenId: wp.token, choice: answer.data.choice });
    return answer.data.choice;
  }
  await db.waitpoint.updateMany({ where: { id: wp.id, status: "PENDING" }, data: { status: "EXPIRED" } });
  logger.warn("waitpoint expired", { runId: wp.runId, waitpointTokenId: wp.token });
  return null;
}
