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
// "lesson_complete" is deliberately excluded: it already has its own
// authoritative path, POST /lessons/:id/complete (modules/learning), which
// verifies the lesson exists, dedupes repeat completions, and enforces the
// free-tier weekly cap. Accepting it here too would let a client award
// itself lesson XP — and silently bypass that cap — without ever completing
// (or even referencing) a real lesson.
export const CLIENT_AWARDABLE_SOURCES = [
  "watch_video",
  "exercise",
  "reading",
  "speaking",
  "listening",
  "daily_study",
  "diagnostic_complete",
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
