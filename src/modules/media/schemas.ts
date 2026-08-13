import { z } from "zod";

export const mediaIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateMediaSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  visibility: z.enum(["private", "class", "public"]).optional(),
  classId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  lessonId: z.string().uuid().nullable().optional(),
});

export const listMediaQuerySchema = z.object({
  type: z.enum(["video", "audio", "image", "document"]).optional(),
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  courseId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  trashed: z.coerce.boolean().default(false),
  scope: z.enum(["mine", "all"]).default("mine"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
