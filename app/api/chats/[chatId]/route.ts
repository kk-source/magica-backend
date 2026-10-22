import { db } from "@/lib/db";
import { requireChat, requireUser } from "@/lib/auth";
import { messageInclude, toChat, toMessage } from "@/lib/contracts";
import { handler, json } from "@/lib/http";

type Ctx = { params: Promise<{ chatId: string }> };

const INITIAL_MESSAGES = 50;

/** Chat plus its latest messages (oldest first). Older pages come from /messages?cursor=. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  const chat = await requireChat(user.id, chatId);
  const rows = await db.message.findMany({
    where: { chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: INITIAL_MESSAGES,
    include: messageInclude,
  });
  return json({ ...toChat(chat), messages: rows.reverse().map(toMessage) });
});

export const DELETE = handler<Ctx>(async (_req, { params }) => {
  const { chatId } = await params;
  const user = await requireUser();
  await requireChat(user.id, chatId);
  await db.chat.delete({ where: { id: chatId } });
  return new Response(null, { status: 204 });
});
