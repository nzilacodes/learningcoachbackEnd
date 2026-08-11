import type { Sql } from "postgres";
import crypto from "node:crypto";
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

export const listPaymentsAdmin = repo.listPaymentsAdmin;
export const listSubscriptionsAdmin = repo.listSubscriptionsAdmin;
export const getAdminStats = repo.getAdminStats;

function generateActivationCode(): string {
  const part = () => crypto.randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
  return `LEC-${part()}-${part()}`;
}

export async function activatePayment(sql: Sql, paymentId: string, providerTransactionId?: string) {
  const payment = await repo.getPaymentById(sql, paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status === "paid") return { ...payment, activationCode: null };
  // The activate_subscription_on_payment DB trigger activates the linked
  // subscription (status/starts_at/expires_at) on the status->paid transition;
  // it doesn't mint a human-readable code, so that part happens here, in the
  // same transaction as the paid-status update (see activatePaymentAtomic).
  const activationCode = payment.subscription_id ? generateActivationCode() : null;
  const updated = await repo.activatePaymentAtomic(sql, paymentId, activationCode, providerTransactionId);
  return { ...updated, activationCode };
}

export async function cancelPaymentAdmin(sql: Sql, paymentId: string) {
  const payment = await repo.getPaymentById(sql, paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  return repo.cancelPaymentAdmin(sql, paymentId);
}

export async function cancelSubscriptionAdmin(sql: Sql, subscriptionId: string) {
  return repo.cancelSubscriptionAdmin(sql, subscriptionId);
}
