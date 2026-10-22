import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CreateChatBody, toChatDto } from "@/lib/contracts";
import { handler, json, parseBody } from "@/lib/http";

export const GET = handler(async () => {
  const user = await requireUser();
  const chats = await db.chat.findMany({
    where: { userId: user.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return json({ chats: chats.map(toChatDto) });
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, CreateChatBody);
  const chat = await db.chat.create({ data: { userId: user.id, title: body.title ?? "New chat" } });
  return json({ chat: toChatDto(chat) }, 201);
});
