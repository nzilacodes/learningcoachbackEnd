import { z } from "zod";

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const userIdParamsSchema = z.object({ id: z.string().uuid() });

export const updateUserSchema = z.object({
  fullName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  country: z.string().trim().max(100).optional(),
  roles: z.array(z.enum(["admin", "user"])).min(1).optional(),
});

export const updateMeSchema = z.object({
  fullName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  country: z.string().trim().max(100).optional(),
  age: z.number().int().min(4).max(120).optional(),
  nativeLanguage: z.string().trim().max(100).optional(),
  learningGoal: z.string().trim().max(100).optional(),
  interests: z.array(z.string().trim().max(50)).optional(),
  avatarUrl: z.string().trim().max(2000).optional(),
  demoCompleted: z.boolean().optional(),
  selectedPlan: z.string().trim().max(50).optional(),
  // cefr_level is intentionally excluded — backend/diagnostic-derived only, never client-writable.
  onboardingStatus: z.enum(["profile", "placement", "plan", "demo", "checkout", "complete"]).optional(),
});
