import type { SupabaseClient } from "@supabase/supabase-js";

export async function listActivePlans(db: SupabaseClient) {
  const { data, error } = await db.from("subscription_plans").select("*").eq("is_active", true).order("price_kz");
  if (error) throw error;
  return data ?? [];
}

/**
 * Calls the existing create_subscription_order SQL function via the user's
 * own JWT-bound client — it's already the safe pattern (amount derived
 * server-side from subscription_plans.price_kz, not accepted from the
 * caller), so there's no reason to reimplement it in TypeScript.
 */
export async function createSubscriptionOrder(
  userDb: SupabaseClient,
  params: { planId: string; method: string; phone?: string; provider?: string },
) {
  const { data, error } = await userDb.rpc("create_subscription_order", {
    _plan_id: params.planId,
    _method: params.method,
    _phone: params.phone ?? undefined,
    _provider: params.provider ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function listMyPayments(userDb: SupabaseClient, userId: string) {
  const { data, error } = await userDb
    .from("payments")
    .select("*, subscription_plans(tier, billing_cycle, price_kz, duration_days)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listMySubscriptions(userDb: SupabaseClient, userId: string) {
  const { data, error } = await userDb
    .from("subscriptions")
    .select("*, subscription_plans(tier, billing_cycle, price_kz, duration_days, features)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPaymentById(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("payments").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function markPaymentSimulatedPaid(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from("payments")
    .update({ status: "paid", provider_transaction_id: `SANDBOX-${Date.now()}` })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
