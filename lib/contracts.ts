import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";

// HTTP contract. Mirrors magica-frontend lib/api/schemas.ts — keep the two in sync.

export const RunStatusSchema = z.enum(["PENDING", "STREAMING", "COMPLETE", "FAILED", "CANCELLED"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const ToolEventSchema = z.object({
  type: z.enum(["tool_start", "tool_end"]),
  id: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),
  status: RunStatusSchema.nullish(),
  runId: z.string().nullish(),
  attachments: z.array(z.object({ url: z.string(), mimeType: z.string(), fileName: z.string() })),
  tools: z.array(ToolEventSchema),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const RunSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  status: RunStatusSchema,
  text: z.string(),
  tools: z.array(ToolEventSchema),
  error: z.string().nullish(),
});
export type Run = z.infer<typeof RunSchema>;

// ---- Requests ----

export const CreateChatBody = z.object({ title: z.string().trim().min(1).max(200).optional() });

export const AttachmentInput = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    assemblyId: z.string().optional(),
    mimeType: z.string().optional(),
    fileName: z.string().max(255).optional(),
    fileSizeBytes: z.number().int().nonnegative().optional(),
  }),
]);

export const SendMessageBody = z.object({
  content: z.string().trim().min(1).max(20_000),
  attachments: z.array(AttachmentInput).max(10).default([]),
  /** Optional; can also be sent as the Idempotency-Key header. Resends return the existing run. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const MessagesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---- Mappers ----

/** Stored message content shape (Message.content JSON column). */
export type StoredContent = { text: string; tools?: ToolEvent[] };

export const readContent = (json: Prisma.JsonValue): StoredContent => {
  const c = (json ?? {}) as Partial<StoredContent>;
  return { text: typeof c.text === "string" ? c.text : "", tools: Array.isArray(c.tools) ? c.tools : [] };
};

export const toChat = (c: { id: string; title: string; pinned: boolean; createdAt: Date; updatedAt: Date }): Chat => ({
  id: c.id,
  title: c.title,
  pinned: c.pinned,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

type MessageRow = Prisma.MessageGetPayload<{ include: { attachments: true; reply: { select: { id: true } } } }>;

export const messageInclude = { attachments: true, reply: { select: { id: true } } } as const;

export const toMessage = (m: MessageRow): Message => {
  const content = readContent(m.content);
  return {
    id: m.id,
    chatId: m.chatId,
    role: m.role.toLowerCase() as Message["role"],
    content: content.text,
    status: m.role === "ASSISTANT" ? m.status : null,
    runId: m.reply?.id ?? null,
    attachments: m.attachments.map((a) => ({ url: a.fileUrl, mimeType: a.mimeType, fileName: a.fileName })),
    tools: content.tools ?? [],
    createdAt: m.createdAt.toISOString(),
  };
};
