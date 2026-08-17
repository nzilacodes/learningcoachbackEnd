import type { Sql } from "postgres";
import type { CefrLevel } from "../../lib/cefr.js";

export async function findPassedExamAttempt(sql: Sql, userId: string, level: CefrLevel) {
  const rows = await sql<{ score: number }[]>`
    SELECT score FROM public.level_exam_attempts
    WHERE user_id = ${userId} AND level = ${level} AND passed = true
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findExistingCertificate(sql: Sql, userId: string, level: CefrLevel) {
  const rows = await sql`SELECT * FROM public.certificates WHERE user_id = ${userId} AND level = ${level}`;
  return rows[0] ?? null;
}

export async function getProfileName(sql: Sql, userId: string) {
  const rows = await sql<{ full_name: string | null; email: string | null }[]>`
    SELECT full_name, email FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0]?.full_name ?? rows[0]?.email ?? "Learner";
}

// ON CONFLICT DO NOTHING (rather than letting a concurrent duplicate insert
// throw a raw 23505) matches the idempotency pattern already used elsewhere
// for uniquely-constrained inserts (classes/repository.ts, gamification/
// repository.ts, auth/repository.ts). A null return means another request
// won the race for this (user_id, level) — the caller falls back to reading
// that row instead of surfacing an error for a certificate that does exist.
export async function insertCertificate(
  sql: Sql,
  params: { userId: string; level: CefrLevel; score: number; courseId?: string; courseTitle?: string; fullName: string },
) {
  const rows = await sql`
    INSERT INTO public.certificates (user_id, level, score, course_id, course_title, full_name)
    VALUES (${params.userId}, ${params.level}, ${params.score}, ${params.courseId ?? null}, ${params.courseTitle ?? null}, ${params.fullName})
    ON CONFLICT (user_id, level) DO NOTHING
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function listCertificatesForUser(sql: Sql, userId: string) {
  return sql`SELECT * FROM public.certificates WHERE user_id = ${userId} ORDER BY issued_at DESC`;
}

export async function findCertificateByCode(sql: Sql, code: string) {
  const rows = await sql`
    SELECT verification_code, full_name, level, course_title, score, issued_at, signature
    FROM public.certificates WHERE verification_code = ${code}
  `;
  return rows[0] ? { ...rows[0], valid: true } : null;
}
