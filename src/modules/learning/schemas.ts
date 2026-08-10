import { z } from "zod";

export const studyTimeSchema = z.object({
  seconds: z.number().int().positive().max(24 * 60 * 60),
});

export const studyReminderSchema = z.object({
  intervalMinutes: z.number().int().positive().max(1440),
  enabled: z.boolean(),
});

export const videoIdParamsSchema = z.object({ videoId: z.string().min(1).max(200) });

export const lessonIdParamsSchema = z.object({ id: z.string().uuid() });

export const updateLessonSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(1000).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  durationMin: z.number().int().positive().max(300).optional(),
  xpReward: z.number().int().nonnegative().max(1000).optional(),
  isPublished: z.boolean().optional(),
});

export const exerciseIdParamsSchema = z.object({ id: z.string().uuid() });

export const createExerciseSchema = z.object({
  type: z.string().trim().min(1).max(50),
  prompt: z.string().trim().min(1).max(2000),
  data: z.record(z.string(), z.unknown()).optional(),
  correctAnswer: z.unknown().optional(),
  xpReward: z.number().int().nonnegative().max(200).default(5),
  orderIndex: z.number().int().nonnegative().default(0),
});

export const updateExerciseSchema = z.object({
  type: z.string().trim().min(1).max(50).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  correctAnswer: z.unknown().optional(),
  xpReward: z.number().int().nonnegative().max(200).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export const videoHistoryUpsertSchema = z.object({
  videoUrl: z.string().min(1).max(2000),
  positionSeconds: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative().optional(),
  completed: z.boolean().optional(),
  title: z.string().max(300).optional(),
  channel: z.string().max(200).optional(),
  lessonId: z.string().max(100).optional(),
});
