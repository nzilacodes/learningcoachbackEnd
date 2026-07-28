import { z } from "zod";

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(500),
  kind: z.enum(["text", "voice"]).default("text"),
});
