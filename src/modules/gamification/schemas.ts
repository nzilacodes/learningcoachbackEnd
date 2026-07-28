import { z } from "zod";

export const ACTIVITY_SOURCES = [
  "watch_video",
  "lesson_complete",
  "exercise",
  "reading",
  "speaking",
  "listening",
  "daily_study",
  "diagnostic_complete",
] as const;

export const awardActivitySchema = z.object({
  source: z.enum(ACTIVITY_SOURCES),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const missionIdParamsSchema = z.object({ id: z.string().uuid() });
export const itemIdParamsSchema = z.object({ id: z.string().uuid() });

export const equipItemSchema = z.object({ equipped: z.boolean() });

export const addFriendSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});
