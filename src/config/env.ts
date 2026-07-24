import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),

  // Direct Postgres connection — the same database learningcoach already used,
  // just reached without Supabase's client libraries (no PostgREST, no GoTrue,
  // no RLS). Use the project's "connection string" / "session pooler" URI.
  DATABASE_URL: z.string().min(1),

  // Access tokens are short-lived JWTs signed with this secret. Refresh tokens
  // are opaque random strings stored hashed in the refresh_tokens table, not JWTs,
  // so they can be revoked individually (logout, password reset, etc.).
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  // Auto-granted the admin role on registration, matching the app's existing
  // owner-bootstrap behavior (see grant_admin_for_owner_email in the migrations).
  OWNER_EMAIL: z.string().email().default("silvinogomes1992@gmail.com"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(60),

  // Cookie-based sessions. In production, deploying the frontend and backend
  // under the same parent domain (app.example.com / api.example.com) lets
  // COOKIE_SAMESITE stay "lax"; separate registrable domains need "none" (+ HTTPS).
  COOKIE_DOMAIN: z.string().optional(),
  // Left unset, defaults to true in production and false in development (see below).
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  SANDBOX_PAYMENTS_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // AI features (TTS/STT/dictionary/diagnostic grading) are optional — the app
  // boots and everything else works without this; AI-dependent endpoints return
  // a clear "not configured" error instead if it's unset.
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Mailer is optional too — with nothing configured, password-reset emails are
  // logged to the console (fine for dev), a real SMTP transport is used once set.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Learning Coach <no-reply@learningcoach.local>"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const data = parsed.data;
  return {
    ...data,
    COOKIE_SECURE: data.COOKIE_SECURE === undefined ? data.NODE_ENV === "production" : data.COOKIE_SECURE === "true",
  };
}

export const env = loadEnv();
