import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CreateChatBody, toChat } from "@/lib/contracts";
import { handler, json, parseBody } from "@/lib/http";

export const GET = handler(async () => {
  const user = await requireUser();
  const chats = await db.chat.findMany({
    where: { userId: user.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return json(chats.map(toChat));
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, CreateChatBody);
  const chat = await db.chat.create({ data: { userId: user.id, title: body.title ?? "New chat" } });
  return json(toChat(chat), 201);
});
