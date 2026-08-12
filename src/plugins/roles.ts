import type { FastifyRequest, FastifyReply } from "fastify";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Explicit application-layer role check — there is no RLS/PostgREST in this
 * architecture at all, so this is the only enforcement for admin-only routes.
 */
export function requireRole(role: string) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply) {
    const rows = await request.server.sql<{ role: string }[]>`
      SELECT role FROM public.user_roles WHERE user_id = ${request.userId} AND role = ${role}
    `;
    if (rows.length === 0) throw new ForbiddenError(`Requires role: ${role}`);
  };
}
