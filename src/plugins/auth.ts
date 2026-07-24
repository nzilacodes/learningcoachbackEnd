import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { jwtVerify } from "jose";
import { env } from "../config/env.js";

class UnauthorizedError extends Error {
  statusCode = 401;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const token = request.cookies.access_token;
  if (!token) throw new UnauthorizedError("No session");

  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string") throw new UnauthorizedError("Invalid session");
    request.userId = payload.sub;
  } catch {
    throw new UnauthorizedError("Invalid or expired session");
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("userId", "");
});
