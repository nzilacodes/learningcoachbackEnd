import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

class ForbiddenError extends Error {
  statusCode = 403;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Double-submit CSRF check for the cookie-based session. Cookies alone are
 * automatically attached by the browser cross-site, so a mutating request
 * also has to echo back the csrf_token cookie's value in a header — something
 * a third-party page triggering a cross-site request can't read or forge.
 * Only enforced when a session cookie is actually present; login/register
 * (no session yet) are naturally exempt.
 */
export default fp(async function csrfPlugin(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const hasSessionCookie = Boolean(request.cookies.access_token || request.cookies.refresh_token);
    if (!hasSessionCookie) return;

    const header = request.headers["x-csrf-token"];
    const cookieValue = request.cookies.csrf_token;
    if (!cookieValue || !header || header !== cookieValue) {
      throw new ForbiddenError("Invalid or missing CSRF token");
    }
  });
});
