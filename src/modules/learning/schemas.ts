import { z } from "zod";

export const studyTimeSchema = z.object({
  seconds: z.number().int().positive().max(24 * 60 * 60),
});

export const studyReminderSchema = z.object({
  intervalMinutes: z.number().int().positive().max(1440),
  enabled: z.boolean(),
});

export const videoIdParamsSchema = z.object({ videoId: z.string().min(1).max(200) });

export const videoHistoryUpsertSchema = z.object({
  videoUrl: z.string().min(1).max(2000),
  positionSeconds: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative().optional(),
  completed: z.boolean().optional(),
  title: z.string().max(300).optional(),
  channel: z.string().max(200).optional(),
  lessonId: z.string().max(100).optional(),
});
