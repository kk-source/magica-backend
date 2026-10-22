import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

/** Resolves the Clerk session to our User row, creating it on first request. */
export async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new HttpError(401, "Unauthorized");
  return db.user.upsert({
    where: { clerkId: userId },
    update: {},
    create: { clerkId: userId, ledger: { create: { amount: 1000, type: "GRANT", description: "Signup grant" } } },
  });
}

/** Loads a chat and asserts it belongs to the user (404 otherwise, to avoid leaking existence). */
export async function requireChat(userId: string, chatId: string) {
  const chat = await db.chat.findFirst({ where: { id: chatId, userId } });
  if (!chat) throw new HttpError(404, "Chat not found");
  return chat;
}
