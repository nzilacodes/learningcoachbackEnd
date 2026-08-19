import { z } from "zod";

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
