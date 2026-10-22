import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { toChatDto } from "@/lib/contracts";
import { handler, json } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string }> };

export const GET = handler<Ctx>(async (_req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  const chat = await requireChat(user.id, chatId);
  return json({ chat: toChatDto(chat) });
});

export const DELETE = handler<Ctx>(async (_req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  await db.chat.delete({ where: { id: chatId } });
  return new Response(null, { status: 204 });
});
