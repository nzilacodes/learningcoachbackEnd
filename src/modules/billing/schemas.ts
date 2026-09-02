import { z } from "zod";

export const paymentMethodSchema = z.enum(["card", "reference", "transfer", "mobile_money"]);

export const createCheckoutSessionSchema = z.object({
  planId: z.string().uuid(),
  method: paymentMethodSchema,
  phone: z.string().max(30).optional(),
  provider: z.string().max(50).optional(),
});

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const subscriptionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const activatePaymentSchema = z.object({
  providerTransactionId: z.string().max(200).optional(),
});

// max raised from 100 to 500, mirroring users/schemas.ts's listUsersQuerySchema
// fix: the admin subscriptions panel fetches with limit=200 in one shot (no
// pagination UI), which rejected with a raw ZodError on every single load
// (confirmed via Sentry, LEARNINGCOACHBACKEND-2 — 112 occurrences, one per
// page view since 2026-08-17).
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
