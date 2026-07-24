import type { Sql } from "postgres";

export type AppUser = { id: string; email: string; password_hash: string | null };

export async function findUserByEmail(sql: Sql, email: string): Promise<AppUser | null> {
  const rows = await sql<AppUser[]>`SELECT id, email, password_hash FROM public.app_users WHERE email = ${email}`;
  return rows[0] ?? null;
}

export async function findUserById(sql: Sql, id: string): Promise<AppUser | null> {
  const rows = await sql<AppUser[]>`SELECT id, email, password_hash FROM public.app_users WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** Creates the identity + profile + default role rows in one transaction, mirroring the old handle_new_user trigger. */
export async function createUser(
  sql: Sql,
  params: { email: string; passwordHash: string; fullName?: string; phone?: string; country?: string; isOwner: boolean },
): Promise<AppUser> {
  return sql.begin(async (tx) => {
    const [user] = await tx<AppUser[]>`
      INSERT INTO public.app_users (email, password_hash)
      VALUES (${params.email}, ${params.passwordHash})
      RETURNING id, email, password_hash
    `;
    await tx`
      INSERT INTO public.profiles (id, full_name, email, phone, country)
      VALUES (${user!.id}, ${params.fullName ?? ""}, ${params.email}, ${params.phone ?? null}, ${params.country ?? null})
    `;
    await tx`INSERT INTO public.user_roles (user_id, role) VALUES (${user!.id}, 'user')`;
    if (params.isOwner) {
      await tx`INSERT INTO public.user_roles (user_id, role) VALUES (${user!.id}, 'admin') ON CONFLICT DO NOTHING`;
    }
    return user!;
  });
}

export async function updatePasswordHash(sql: Sql, userId: string, passwordHash: string) {
  await sql`UPDATE public.app_users SET password_hash = ${passwordHash} WHERE id = ${userId}`;
}

export async function getUserRoles(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ role: string }[]>`SELECT role FROM public.user_roles WHERE user_id = ${userId}`;
  return rows.map((r) => r.role);
}

export async function getProfileSummary(sql: Sql, userId: string) {
  const rows = await sql<{ full_name: string | null; age: number | null; onboarding_status: string | null }[]>`
    SELECT full_name, age, onboarding_status FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0] ?? { full_name: null, age: null, onboarding_status: null };
}

// ---------- Refresh tokens ----------

export async function insertRefreshToken(sql: Sql, params: { userId: string; tokenHash: string; expiresAt: Date }) {
  await sql`
    INSERT INTO public.refresh_tokens (user_id, token_hash, expires_at)
    VALUES (${params.userId}, ${params.tokenHash}, ${params.expiresAt})
  `;
}

export async function findRefreshToken(sql: Sql, tokenHash: string) {
  const rows = await sql<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }[]>`
    SELECT id, user_id, expires_at, revoked_at FROM public.refresh_tokens WHERE token_hash = ${tokenHash}
  `;
  return rows[0] ?? null;
}

export async function revokeRefreshToken(sql: Sql, id: string) {
  await sql`UPDATE public.refresh_tokens SET revoked_at = now() WHERE id = ${id}`;
}

export async function revokeAllRefreshTokensForUser(sql: Sql, userId: string) {
  await sql`UPDATE public.refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
}

// ---------- Password reset tokens ----------

export async function insertPasswordResetToken(sql: Sql, params: { userId: string; tokenHash: string; expiresAt: Date }) {
  await sql`
    INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${params.userId}, ${params.tokenHash}, ${params.expiresAt})
  `;
}

export async function findValidPasswordResetToken(sql: Sql, tokenHash: string) {
  const rows = await sql<{ id: string; user_id: string }[]>`
    SELECT id, user_id FROM public.password_reset_tokens
    WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now()
  `;
  return rows[0] ?? null;
}

export async function markPasswordResetTokenUsed(sql: Sql, id: string) {
  await sql`UPDATE public.password_reset_tokens SET used_at = now() WHERE id = ${id}`;
}

// ---------- Login attempt tracking / lockout ----------
// Reuses the login_attempts/account_lockouts tables from the existing schema;
// same 5-failures-per-15-minutes rule as before, now enforced in application
// code instead of a Postgres RPC (which relied on auth.uid()/PostgREST).

export async function getActiveLockout(sql: Sql, email: string) {
  const rows = await sql<{ locked_until: Date }[]>`
    SELECT MAX(locked_until) AS locked_until FROM public.account_lockouts
    WHERE email = ${email.toLowerCase()} AND locked_until > now()
  `;
  return rows[0]?.locked_until ?? null;
}

export async function recordLoginAttempt(
  sql: Sql,
  params: { email: string; success: boolean; ip?: string; userAgent?: string; reason?: string },
) {
  const email = params.email.toLowerCase();
  await sql`
    INSERT INTO public.login_attempts (email, ip_address, user_agent, success, reason)
    VALUES (${email}, ${params.ip ?? null}, ${params.userAgent ?? null}, ${params.success}, ${params.reason ?? null})
  `;
  if (params.success) return { locked: false };

  const [failsRow] = await sql<{ fails: string }[]>`
    SELECT COUNT(*)::text AS fails FROM public.login_attempts
    WHERE email = ${email} AND success = false AND created_at > now() - interval '15 minutes'
  `;
  if (Number(failsRow!.fails) >= 5) {
    await sql`
      INSERT INTO public.account_lockouts (email, ip_address, reason, locked_until)
      VALUES (${email}, ${params.ip ?? null}, 'brute_force', now() + interval '15 minutes')
    `;
    return { locked: true };
  }
  return { locked: false };
}
