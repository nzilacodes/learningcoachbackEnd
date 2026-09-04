import { z } from "zod";
import { cefrLevelSchema } from "../../lib/cefr.js";

export const issueCertificateSchema = z.object({
  level: cefrLevelSchema,
  courseId: z.string().uuid().optional(),
  courseTitle: z.string().min(1).max(200).optional(),
});

// Admin manual issuance — unlike issueCertificateSchema (self-serve, always
// derives score from the caller's own passed level_exam_attempts row), an
// admin targets an arbitrary learner and may supply a score directly (e.g.
// crediting an offline/legacy assessment) instead of requiring an exam
// attempt on record. service.issueCertificateAdmin falls back to the
// learner's passed attempt when score is omitted.
export const issueCertificateAdminSchema = z.object({
  userId: z.string().uuid(),
  level: cefrLevelSchema,
  score: z.number().min(0).max(100).optional(),
  courseId: z.string().uuid().optional(),
  courseTitle: z.string().min(1).max(200).optional(),
});

export const verifyCertificateParamsSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export const certificateIdParamsSchema = z.object({ id: z.string().uuid() });

export const listCertificatesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
