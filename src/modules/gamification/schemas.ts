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
