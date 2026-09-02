import { z } from "zod";

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  severity: z.string().optional(),
  action: z.string().optional(),
});

export const loginAttemptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const lockoutsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const reportLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
});

export const performanceStudentsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const studentIdParamsSchema = z.object({ id: z.string().uuid() });

export const studentAttemptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
