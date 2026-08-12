import type { Sql } from "postgres";
export { PaymentRequiredError } from "./errors.js";

export async function hasActiveSubscription(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM public.subscriptions
    WHERE user_id = ${userId} AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `;
  return rows.length > 0;
}
