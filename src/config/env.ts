import "dotenv/config";
import { z } from "zod";

// A blank `KEY=` line in a real .env file loads as an empty string, not
// undefined — without this, every "optional" field below would reject a
// blank line instead of treating it as unset.
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const optionalNonEmptyString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
const optionalNumber = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional());
const optionalBoolString = z.preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).optional());

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
  // under the same parent domain (app.learningcoach.co.ao / api.learningcoach.co.ao) lets
  // COOKIE_SAMESITE stay "lax"; separate registrable domains need "none" (+ HTTPS).
  COOKIE_DOMAIN: optionalString,
  // Left unset, defaults to true in production and false in development (see below).
  COOKIE_SECURE: optionalBoolString,
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
  OPENAI_API_KEY: optionalNonEmptyString,
  // Override the OpenAI endpoints to point at a local stub server for testing
  // error scenarios (429 quota, 500, a hang for timeout) without touching real
  // OpenAI billing. Unset in normal dev/production — ai-gateway.ts falls back
  // to the real OpenAI URLs.
  AI_CHAT_URL: optionalString,
  AI_TTS_URL: optionalString,
  AI_STT_URL: optionalString,

  // Mailer is optional too — with nothing configured, password-reset emails are
  // logged to the console (fine for dev), a real SMTP transport is used once set.
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalNumber,
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z.string().default("Learning Coach <no-reply@learningcoach.local>"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const data = parsed.data;

  // Without SMTP, sendMail() falls back to console.log-ing the full message —
  // including password-reset links/tokens. Fine for local dev; in production
  // that's the reset token landing in server logs. Loud warning rather than a
  // boot-time crash (process.exit) here — refusing to boot is the more
  // correct long-term posture, but flipping that on unconditionally risks
  // taking prod down if SMTP genuinely isn't set there yet; that's an
  // operational call for whoever controls the deployment, not this commit.
  const smtpConfigured = Boolean(data.SMTP_HOST && data.SMTP_USER && data.SMTP_PASS);
  if (data.NODE_ENV === "production" && !smtpConfigured) {
    console.error("WARNING: SMTP is not configured in production — password-reset tokens will be written to server logs via the console mailer fallback. Set SMTP_HOST/SMTP_USER/SMTP_PASS.");
  }

  return {
    ...data,
    COOKIE_SECURE: data.COOKIE_SECURE === undefined ? data.NODE_ENV === "production" : data.COOKIE_SECURE === "true",
  };
}

export const env = loadEnv();
