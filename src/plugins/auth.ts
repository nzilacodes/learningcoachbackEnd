import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

class UnauthorizedError extends Error {
  statusCode = 401;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    accessToken: string;
  }
}

// Ported from learningcoach's src/integrations/supabase/auth-middleware.ts —
// same Bearer-JWT verification via supabase.auth.getClaims, just relocated
// into a Fastify preHandler instead of a TanStack server-fn middleware.
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader) throw new UnauthorizedError("No authorization header provided");
  if (!authHeader.startsWith("Bearer ")) throw new UnauthorizedError("Only Bearer tokens are supported");

  const token = authHeader.slice("Bearer ".length);
  if (!token || token.split(".").length !== 3) throw new UnauthorizedError("Invalid token");

  const supabase = request.server.createUserClient(token);
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new UnauthorizedError("Invalid token");

  request.userId = data.claims.sub;
  request.accessToken = token;
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("userId", "");
  fastify.decorateRequest("accessToken", "");
});
