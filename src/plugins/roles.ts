import type { FastifyRequest, FastifyReply } from "fastify";

class ForbiddenError extends Error {
  statusCode = 403;
}

/**
 * Explicit application-layer role check. The DB's own admin gating lives only
 * inside RLS policies / SECURITY DEFINER functions (private.has_role), which
 * is invisible once the backend talks to Postgres via the service-role key —
 * service role bypasses RLS entirely, so this check is the only enforcement
 * left once a route is ported here.
 */
export function requireRole(role: string) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply) {
    const { data, error } = await request.server.supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", request.userId)
      .eq("role", role)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new ForbiddenError(`Requires role: ${role}`);
  };
}
