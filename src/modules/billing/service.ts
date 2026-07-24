import type { SupabaseClient } from "@supabase/supabase-js";
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
  userDb: SupabaseClient,
  input: { planId: string; method: string; phone?: string; provider?: string },
) {
  return repo.createSubscriptionOrder(userDb, input);
}

export const listMyPayments = repo.listMyPayments;
export const listMySubscriptions = repo.listMySubscriptions;

/**
 * Sandbox-only self-service payment confirmation, ported from
 * simulatePaymentConfirmation. Gated behind an explicit admin role check and
 * SANDBOX_PAYMENTS_ENABLED — the old flow's only real protection was an
 * admin-only RLS UPDATE policy on `payments`, invisible in the TS handler.
 */
export async function simulatePayment(db: SupabaseClient, paymentId: string) {
  if (!env.SANDBOX_PAYMENTS_ENABLED) {
    throw new ForbiddenError("Sandbox payment simulation is disabled");
  }
  const payment = await repo.getPaymentById(db, paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status === "paid") return payment;
  return repo.markPaymentSimulatedPaid(db, paymentId);
}
