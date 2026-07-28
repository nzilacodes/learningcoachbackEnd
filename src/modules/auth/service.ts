import type { Sql } from "postgres";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { SignJWT } from "jose";
import { env } from "../../config/env.js";
import { sendMail } from "../../lib/mailer.js";
import * as repo from "./repository.js";

class UnauthorizedError extends Error {
  statusCode = 401;
}
class ConflictError extends Error {
  statusCode = 409;
}

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL_SEC = env.ACCESS_TOKEN_TTL_MIN * 60;
const REFRESH_TTL_SEC = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueTokens(sql: Sql, userId: string) {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(jwtSecret);

  const refreshToken = crypto.randomBytes(32).toString("hex");
  await repo.insertRefreshToken(sql, {
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
  });

  return { accessToken, refreshToken, accessTtlSec: ACCESS_TTL_SEC, refreshTtlSec: REFRESH_TTL_SEC };
}

export async function register(
  sql: Sql,
  input: { email: string; password: string; fullName?: string; phone?: string; country?: string },
) {
  const existing = await repo.findUserByEmail(sql, input.email);
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const isOwner = input.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
  const user = await repo.createUser(sql, { ...input, passwordHash, isOwner });
  return issueTokens(sql, user.id);
}

class LockedError extends Error {
  statusCode = 423;
}

export async function login(
  sql: Sql,
  email: string,
  password: string,
  context: { ip?: string; userAgent?: string },
) {
  const lockedUntil = await repo.getActiveLockout(sql, email);
  if (lockedUntil) {
    const mins = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    throw new LockedError(`Account temporarily locked. Try again in ${mins} minute(s).`);
  }

  const user = await repo.findUserByEmail(sql, email);
  let valid = false;
  if (user?.password_hash) {
    valid = await bcrypt.compare(password, user.password_hash);
  } else {
    // Constant-shape timing whether the account exists or not, and whether or
    // not a password_hash has been set yet (see the migration note about
    // accounts carried over from Supabase Auth needing a reset first).
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  }

  const { locked } = await repo.recordLoginAttempt(sql, {
    email,
    success: valid,
    ip: context.ip,
    userAgent: context.userAgent,
    reason: valid ? undefined : "invalid_credentials",
  });

  if (!valid) {
    if (locked) throw new LockedError("Too many failed attempts. Account locked for 15 minutes.");
    throw new UnauthorizedError("Invalid email or password");
  }
  return issueTokens(sql, user!.id);
}

export async function refresh(sql: Sql, refreshToken: string | undefined) {
  if (!refreshToken) throw new UnauthorizedError("No session");
  const tokenHash = hashToken(refreshToken);
  const row = await repo.findRefreshToken(sql, tokenHash);
  if (!row || row.revoked_at || row.expires_at < new Date()) {
    throw new UnauthorizedError("Session expired, please log in again");
  }
  await repo.revokeRefreshToken(sql, row.id);
  return issueTokens(sql, row.user_id);
}

export async function logout(sql: Sql, refreshToken: string | undefined) {
  if (!refreshToken) return;
  const row = await repo.findRefreshToken(sql, hashToken(refreshToken));
  if (row) await repo.revokeRefreshToken(sql, row.id);
}

export async function requestPasswordReset(sql: Sql, email: string) {
  const user = await repo.findUserByEmail(sql, email);
  // Always respond as if it succeeded — don't reveal whether an email is registered.
  if (!user) return;

  const token = crypto.randomBytes(32).toString("hex");
  await repo.insertPasswordResetToken(sql, {
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MIN * 60 * 1000),
  });

  const resetUrl = `${env.CORS_ALLOWED_ORIGINS[0] ?? ""}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your Learning Coach password",
    text: `Use this link to reset your password (expires in ${env.PASSWORD_RESET_TOKEN_TTL_MIN} minutes): ${resetUrl}`,
  });
}

export async function resetPassword(sql: Sql, token: string, newPassword: string) {
  const row = await repo.findValidPasswordResetToken(sql, hashToken(token));
  if (!row) throw new UnauthorizedError("Invalid or expired reset token");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await repo.updatePasswordHash(sql, row.user_id, passwordHash);
  await repo.markPasswordResetTokenUsed(sql, row.id);
  // Force re-login everywhere else — a stolen session shouldn't survive a password reset.
  await repo.revokeAllRefreshTokensForUser(sql, row.user_id);
}

export async function changePassword(sql: Sql, userId: string, currentPassword: string, newPassword: string) {
  const user = await repo.findUserById(sql, userId);
  if (!user?.password_hash) throw new UnauthorizedError("No password set on this account yet — use forgot password");
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new UnauthorizedError("Current password is incorrect");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await repo.updatePasswordHash(sql, userId, passwordHash);
}

export async function getMe(sql: Sql, userId: string) {
  const [user, roles, profile] = await Promise.all([
    repo.findUserById(sql, userId),
    repo.getUserRoles(sql, userId),
    repo.getProfileSummary(sql, userId),
  ]);
  if (!user) throw new UnauthorizedError("User not found");
  return {
    id: user.id,
    email: user.email,
    roles,
    fullName: profile.full_name,
    age: profile.age,
    onboardingStatus: profile.onboarding_status,
    cefrLevel: profile.cefr_level,
    country: profile.country,
    nativeLanguage: profile.native_language,
    learningGoal: profile.learning_goal,
    interests: profile.interests,
    avatarUrl: profile.avatar_url,
    demoCompleted: profile.demo_completed,
    selectedPlan: profile.selected_plan,
  };
}
