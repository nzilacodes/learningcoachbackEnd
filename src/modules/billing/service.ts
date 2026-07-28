import type { Sql } from "postgres";
import { env } from "../../config/env.js";
import * as repo from "./repository.js";

class ForbiddenError extends Error {
  statusCode = 403;
}
class NotFoundError extends Error {
  statusCode = 404;
}

export const listPlans = repo.listActivePlans;

export function createCheckoutSession(
  sql: Sql,
  userId: string,
  input: { planId: string; method: string; phone?: string; provider?: string },
) {
  return repo.createSubscriptionOrder(sql, userId, input);
}

export const listMyPayments = repo.listMyPayments;
export const listMySubscriptions = repo.listMySubscriptions;

/**
 * Sandbox-only self-service payment confirmation, ported from
 * simulatePaymentConfirmation: the customer who just created the order
 * confirms it themselves, standing in for a real gateway webhook that
 * doesn't exist yet. Gated by SANDBOX_PAYMENTS_ENABLED (must stay false in
 * production) plus an explicit ownership check, since getPaymentById has no
 * built-in owner filter.
 */
export async function simulatePayment(sql: Sql, userId: string, paymentId: string) {
  if (!env.SANDBOX_PAYMENTS_ENABLED) {
    throw new ForbiddenError("Sandbox payment simulation is disabled");
  }
  const payment = await repo.getPaymentById(sql, paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.user_id !== userId) throw new ForbiddenError("You do not own this payment");
  if (payment.status === "paid") return payment;
  return repo.markPaymentSimulatedPaid(sql, paymentId);
}
