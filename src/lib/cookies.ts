import type { FastifyReply } from "fastify";
import crypto from "node:crypto";
import { env } from "../config/env.js";

const baseOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  domain: env.COOKIE_DOMAIN,
  path: "/",
} as const;

export function setSessionCookies(
  reply: FastifyReply,
  params: { accessToken: string; refreshToken: string; accessTtlSec: number; refreshTtlSec: number },
) {
  reply.setCookie("access_token", params.accessToken, { ...baseOptions, maxAge: params.accessTtlSec });
  reply.setCookie("refresh_token", params.refreshToken, {
    ...baseOptions,
    path: "/v1/auth",
    maxAge: params.refreshTtlSec,
  });
  // Readable by JS on purpose — double-submit CSRF pattern for the cookie-based session.
  const csrfToken = crypto.randomBytes(24).toString("hex");
  reply.setCookie("csrf_token", csrfToken, {
    ...baseOptions,
    httpOnly: false,
    maxAge: params.refreshTtlSec,
  });
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie("access_token", { ...baseOptions });
  reply.clearCookie("refresh_token", { ...baseOptions, path: "/v1/auth" });
  reply.clearCookie("csrf_token", { ...baseOptions, httpOnly: false });
}
