import { z } from "zod";

// Shared request/response schemas for the HTTP API. The frontend mirrors these.

export const ChatDto = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatDto = z.infer<typeof ChatDto>;

export const CreateChatBody = z.object({ title: z.string().trim().min(1).max(200).optional() });

export const AttachmentInput = z.object({
  assemblyId: z.string().optional(),
  fileUrl: z.string().url(),
  mimeType: z.string(),
  fileName: z.string().max(255),
  fileSizeBytes: z.number().int().nonnegative(),
});

export const SendMessageBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  attachments: z.array(AttachmentInput).max(10).default([]),
  /** Client-generated; resending the same key returns the existing run instead of starting a new one. */
  idempotencyKey: z.string().min(8).max(128),
});

export const MessagesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const MessageDto = z.object({
  id: z.string(),
  role: z.enum(["USER", "ASSISTANT", "SYSTEM", "TOOL"]),
  content: z.unknown(),
  status: z.enum(["PENDING", "STREAMING", "COMPLETE", "FAILED", "CANCELLED"]),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const RunDto = z.object({
  id: z.string(),
  triggerRunId: z.string().nullable(),
  status: z.enum(["QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"]),
  /** Trigger.dev public token scoped to this run, for Realtime subscription from the browser. */
  publicAccessToken: z.string().optional(),
});
export type RunDto = z.infer<typeof RunDto>;

export const toChatDto = (c: { id: string; title: string; pinned: boolean; createdAt: Date; updatedAt: Date }): ChatDto => ({
  id: c.id,
  title: c.title,
  pinned: c.pinned,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
