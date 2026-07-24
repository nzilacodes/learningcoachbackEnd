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
