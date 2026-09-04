import { z } from "zod";

export const studyTimeSchema = z.object({
  seconds: z.number().int().positive().max(24 * 60 * 60),
});

export const studyReminderSchema = z.object({
  intervalMinutes: z.number().int().positive().max(1440),
  enabled: z.boolean(),
});

export const studySessionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(84),
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
  orderIndex: z.number().int().nonnegative().optional(),
  skillId: z.string().uuid().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  learningObjective: z.string().trim().max(500).optional(),
});

export const lessonPrerequisiteSchema = z.object({
  requiresLessonId: z.string().uuid(),
});

export const lessonPrerequisiteParamsSchema = z.object({
  id: z.string().uuid(),
  requiresLessonId: z.string().uuid(),
});

// Mirrors public.lesson_type (see migrations/20260705145641_...sql) exactly —
// keep the two in sync if a lesson type is ever added.
export const LESSON_TYPES = [
  "vocabulary",
  "grammar",
  "reading",
  "listening",
  "writing",
  "speaking",
  "pronunciation",
  "ipa",
  "review",
  "quiz",
  "final_test",
  "project",
] as const;

export const unitIdParamsSchema = z.object({ id: z.string().uuid() });

export const createUnitSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1000).optional(),
  orderIndex: z.number().int().nonnegative().default(0),
  // Omitted -> service defaults to the age band that maps sequentially from
  // the course's CEFR level (same bootstrap rule as the seed migration), so
  // a freshly created unit is never invisible in the "by age" browser.
  ageGroupIds: z.array(z.string().uuid()).optional(),
});

export const updateUnitSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(1000).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  // Full replace, not merge — same convention as updateUserSchema's `roles`.
  ageGroupIds: z.array(z.string().uuid()).optional(),
});

export const createLessonSchema = z.object({
  unitId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  lessonType: z.enum(LESSON_TYPES),
  summary: z.string().trim().max(1000).optional(),
  xpReward: z.number().int().nonnegative().max(1000).default(10),
  orderIndex: z.number().int().nonnegative().default(0),
});

export const deleteWithForceQuerySchema = z.object({
  force: z.coerce.boolean().default(false),
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
  // Review workflow for AI-generated content (see src/jobs/generate-lesson-content.ts):
  // admins flip draft -> in_review -> published from the existing exercise
  // editor once they've checked a generated exercise is correct.
  contentStatus: z.enum(["draft", "in_review", "published"]).optional(),
});

export const listExercisesAdminQuerySchema = z.object({
  status: z.enum(["draft", "in_review", "published"]).optional(),
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
