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

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
