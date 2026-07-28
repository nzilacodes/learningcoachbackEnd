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
