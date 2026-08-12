import { z } from "zod";

export const NOTIFICATION_CATEGORIES = ["system", "learning", "assessment", "account"] as const;

export const listNotificationsQuerySchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  unreadOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const notificationIdParamsSchema = z.object({ id: z.string().uuid() });
