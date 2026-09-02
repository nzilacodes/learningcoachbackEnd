import type { Sql, JSONValue } from "postgres";

/**
 * Explicit audit-trail insert for admin-initiated destructive actions.
 *
 * Deliberately does NOT call the DB's own `public.log_audit_event(...)`
 * function (added for the Supabase/PostgREST-era schema) — that function
 * reads the acting user from `auth.uid()`, which only resolves inside a
 * PostgREST request carrying a JWT-derived Postgres session. This backend
 * talks to Postgres over a single service-role-equivalent `postgres.js`
 * connection with no per-request session context (see plugins/roles.ts's
 * own comment: "there is no RLS/PostgREST in this architecture at all") —
 * `auth.uid()` would just resolve to NULL, so `log_audit_event` would log
 * every admin action as done by no one. This inserts the same row shape
 * directly, with the admin's id/email passed in explicitly instead.
 */
export async function logAdminAction(
  sql: Sql,
  params: {
    adminUserId: string;
    action: string;
    entity: string;
    entityId: string;
    severity?: "info" | "warning" | "critical";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const [row] = await sql<{ email: string | null }[]>`
    SELECT email FROM public.app_users WHERE id = ${params.adminUserId}
  `;
  await sql`
    INSERT INTO public.audit_logs (user_id, actor_email, action, entity, entity_id, severity, metadata)
    VALUES (
      ${params.adminUserId}, ${row?.email ?? null}, ${params.action}, ${params.entity}, ${params.entityId},
      ${params.severity ?? "warning"}, ${sql.json((params.metadata ?? {}) as JSONValue)}
    )
  `;
}
