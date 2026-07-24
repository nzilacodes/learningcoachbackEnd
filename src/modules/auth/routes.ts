import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { setSessionCookies, clearSessionCookies } from "../../lib/cookies.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const tokens = await service.register(request.server.sql, input);
    setSessionCookies(reply, tokens);
    return reply.status(201).send({ ok: true });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);
    const tokens = await service.login(request.server.sql, email, password, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookies(reply, tokens);
    return { ok: true };
  });

  fastify.post("/auth/refresh", async (request, reply) => {
    const tokens = await service.refresh(request.server.sql, request.cookies.refresh_token);
    setSessionCookies(reply, tokens);
    return { ok: true };
  });

  fastify.post("/auth/logout", async (request, reply) => {
    await service.logout(request.server.sql, request.cookies.refresh_token);
    clearSessionCookies(reply);
    return { ok: true };
  });

  fastify.post("/auth/forgot-password", async (request) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    await service.requestPasswordReset(request.server.sql, email);
    return { ok: true };
  });

  fastify.post("/auth/reset-password", async (request) => {
    const { token, newPassword } = resetPasswordSchema.parse(request.body);
    await service.resetPassword(request.server.sql, token, newPassword);
    return { ok: true };
  });

  fastify.post("/auth/change-password", { preHandler: requireAuth }, async (request) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
    await service.changePassword(request.server.sql, request.userId, currentPassword, newPassword);
    return { ok: true };
  });

  fastify.get("/me", { preHandler: requireAuth }, async (request) => {
    return service.getMe(request.server.sql, request.userId);
  });
}
