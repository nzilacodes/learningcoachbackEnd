import { z } from "zod";

export const listMessagesQuerySchema = z.object({
  // When set, only messages created after this timestamp are returned (no
  // 200-cap needed — a 3s poll window has few new rows) instead of the full
  // last-200 snapshot every poll. See community.tsx's incremental fetch.
  since: z.string().datetime().optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(500),
  kind: z.enum(["text", "voice"]).default("text"),
});

export const reportMessageSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const messageIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});
