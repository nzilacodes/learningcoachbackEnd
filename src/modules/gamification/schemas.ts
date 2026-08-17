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
  "game",
] as const;

// What POST /v1/xp/events (the public, client-callable endpoint) accepts.
// "lesson_complete" and "diagnostic_complete" are deliberately excluded: each
// already has its own authoritative path — POST /lessons/:id/complete
// (modules/learning) and POST /assessments/diagnostic (modules/diagnostic)
// respectively — which verifies the activity actually happened before
// awarding XP. Accepting them here too would let a client award itself XP
// (and, for diagnostic_complete, bump its streak once every cooldown window)
// without ever completing — or even referencing — the real activity.
export const CLIENT_AWARDABLE_SOURCES = [
  "watch_video",
  "exercise",
  "reading",
  "speaking",
  "listening",
  "daily_study",
  "game",
] as const;

export const awardActivitySchema = z.object({
  source: z.enum(CLIENT_AWARDABLE_SOURCES),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const missionIdParamsSchema = z.object({ id: z.string().uuid() });
export const itemIdParamsSchema = z.object({ id: z.string().uuid() });

export const equipItemSchema = z.object({ equipped: z.boolean() });

export const addFriendSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  country: z.string().trim().max(100).optional(),
});

export const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});
