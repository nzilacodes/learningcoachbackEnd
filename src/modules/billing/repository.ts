import type { Sql } from "postgres";
import crypto from "node:crypto";

class NotAvailableError extends Error {
  statusCode = 409;
}

export async function listActivePlans(sql: Sql) {
  return sql`SELECT * FROM public.subscription_plans WHERE is_active = true ORDER BY price_kz`;
}

/**
 * Ports the old create_subscription_order SQL function into application code.
 * It can no longer run as a Postgres function called via RPC because it read
 * auth.uid() — which comes from a Supabase-issued JWT's claims set by
 * PostgREST. There's no PostgREST in this architecture anymore, so auth.uid()
 * is always NULL; userId now comes in explicitly from the caller's own
 * session instead. The amount-from-plan pattern (never trusting a
 * client-supplied amount) is preserved exactly.
 */
export async function createSubscriptionOrder(
  sql: Sql,
  userId: string,
  params: { planId: string; method: string; phone?: string; provider?: string },
) {
  return sql.begin(async (tx) => {
    const [plan] = await tx`
      SELECT * FROM public.subscription_plans WHERE id = ${params.planId} AND is_active = true
    `;
    if (!plan) throw new NotAvailableError("Plan not available");

    const reference = String(Math.floor(100000000 + crypto.randomInt(900000000)));
    const entity = "11333";

    const [subscription] = await tx<{ id: string }[]>`
      INSERT INTO public.subscriptions (user_id, plan_id, status)
      VALUES (${userId}, ${params.planId}, 'pending')
      RETURNING id
    `;

    const [seqRow] = await tx<{ invoice_seq: string }[]>`SELECT nextval('public.invoice_number_seq')::text AS invoice_seq`;
    const invoiceNumber = `INV-${new Date().getFullYear()}-${seqRow!.invoice_seq.padStart(6, "0")}`;

    const [payment] = await tx<{ id: string }[]>`
      INSERT INTO public.payments (
        user_id, subscription_id, plan_id, amount_kz, status, method, reference, entity, phone, provider, invoice_number, metadata
      ) VALUES (
        ${userId}, ${subscription!.id}, ${params.planId}, ${plan.price_kz}, 'pending', ${params.method},
        ${reference}, ${entity}, ${params.phone ?? null}, ${params.provider ?? "paypay"}, ${invoiceNumber}, '{}'::jsonb
      )
      RETURNING id
    `;

    return {
      subscription_id: subscription!.id,
      payment_id: payment!.id,
      reference,
      entity,
      invoice_number: invoiceNumber,
      amount_kz: plan.price_kz as number,
    };
  });
}

export async function listMyPayments(sql: Sql, userId: string) {
  return sql`
    SELECT p.*, jsonb_build_object(
      'tier', sp.tier, 'billing_cycle', sp.billing_cycle, 'price_kz', sp.price_kz, 'duration_days', sp.duration_days
    ) AS subscription_plans
    FROM public.payments p
    LEFT JOIN public.subscription_plans sp ON sp.id = p.plan_id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC
  `;
}

export async function listMySubscriptions(sql: Sql, userId: string) {
  return sql`
    SELECT s.*, to_jsonb(sp.*) AS subscription_plans
    FROM public.subscriptions s
    LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC
  `;
}

export async function getPaymentById(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.payments WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function markPaymentSimulatedPaid(sql: Sql, id: string) {
  const [row] = await sql`
    UPDATE public.payments SET status = 'paid', provider_transaction_id = ${"SANDBOX-" + Date.now()}
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

const ADMIN_PAYMENT_COLUMNS = `
  p.id, p.user_id, p.subscription_id, p.status, p.method, p.provider, p.amount_kz, p.reference, p.entity, p.phone,
  p.invoice_number, p.provider_transaction_id, p.created_at, p.paid_at, p.expires_at,
  to_jsonb(sp.*) AS subscription_plans,
  jsonb_build_object('activation_code', s.activation_code, 'expires_at', s.expires_at, 'status', s.status) AS subscriptions,
  jsonb_build_object('full_name', pr.full_name, 'email', u.email) AS profiles
`;

export async function listPaymentsAdmin(sql: Sql, limit: number, offset: number) {
  const items = await sql`
    SELECT ${sql.unsafe(ADMIN_PAYMENT_COLUMNS)}
    FROM public.payments p
    LEFT JOIN public.subscription_plans sp ON sp.id = p.plan_id
    LEFT JOIN public.subscriptions s ON s.id = p.subscription_id
    LEFT JOIN public.app_users u ON u.id = p.user_id
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [countRow] = await sql<{ count: string }[]>`SELECT count(*)::text FROM public.payments`;
  return { items, total: Number(countRow!.count) };
}

export async function markPaymentActivated(sql: Sql, id: string, providerTransactionId?: string) {
  const [row] = await sql`
    UPDATE public.payments
    SET status = 'paid', provider_transaction_id = COALESCE(${providerTransactionId ?? null}, provider_transaction_id)
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function setSubscriptionActivationCode(sql: Sql, subscriptionId: string, code: string) {
  await sql`UPDATE public.subscriptions SET activation_code = ${code} WHERE id = ${subscriptionId}`;
}

export async function cancelPaymentAdmin(sql: Sql, id: string) {
  const [row] = await sql`
    UPDATE public.payments SET status = 'cancelled' WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

const ADMIN_SUBSCRIPTION_COLUMNS = `
  s.id, s.user_id, s.plan_id, s.status, s.starts_at, s.expires_at, s.activation_code, s.created_at,
  to_jsonb(sp.*) AS subscription_plans,
  jsonb_build_object('full_name', pr.full_name, 'email', u.email) AS profiles
`;

export async function listSubscriptionsAdmin(sql: Sql, limit: number, offset: number) {
  const items = await sql`
    SELECT ${sql.unsafe(ADMIN_SUBSCRIPTION_COLUMNS)}
    FROM public.subscriptions s
    LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
    LEFT JOIN public.app_users u ON u.id = s.user_id
    LEFT JOIN public.profiles pr ON pr.id = s.user_id
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [countRow] = await sql<{ count: string }[]>`SELECT count(*)::text FROM public.subscriptions`;
  return { items, total: Number(countRow!.count) };
}

export async function cancelSubscriptionAdmin(sql: Sql, id: string) {
  const [row] = await sql`
    UPDATE public.subscriptions SET status = 'cancelled' WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function getAdminStats(sql: Sql) {
  const [row] = await sql<
    { total_users: string; active_subscriptions: string; pending_payments: string; month_revenue: string }[]
  >`
    SELECT
      (SELECT count(*) FROM public.app_users)::text AS total_users,
      (SELECT count(*) FROM public.subscriptions WHERE status = 'active')::text AS active_subscriptions,
      (SELECT count(*) FROM public.payments WHERE status = 'pending')::text AS pending_payments,
      (SELECT COALESCE(SUM(amount_kz), 0) FROM public.payments
        WHERE status = 'paid' AND paid_at >= date_trunc('month', now()))::text AS month_revenue
  `;
  return {
    totalUsers: Number(row!.total_users),
    activeSubscriptions: Number(row!.active_subscriptions),
    pendingPayments: Number(row!.pending_payments),
    monthRevenue: Number(row!.month_revenue),
  };
}
