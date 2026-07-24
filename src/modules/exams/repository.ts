import type { Sql } from "postgres";
import type { CefrLevel } from "../../lib/cefr.js";

export type ExamQuestion = { q: string; opts: string[]; a: number };

export async function getExam(sql: Sql, level: CefrLevel) {
  const rows = await sql<{ level: CefrLevel; title: string; questions: ExamQuestion[] }[]>`
    SELECT level, title, questions FROM public.level_exams WHERE level = ${level}
  `;
  if (!rows[0]) throw new Error(`No exam configured for level ${level}`);
  return rows[0];
}

export async function getMinExamScore(sql: Sql): Promise<number> {
  const rows = await sql<{ min_exam_score: number }[]>`SELECT min_exam_score FROM public.app_settings WHERE id = true`;
  return rows[0]?.min_exam_score ?? 70;
}

export async function getProfileCefrLevel(sql: Sql, userId: string): Promise<CefrLevel | null> {
  const rows = await sql<{ cefr_level: CefrLevel | null }[]>`SELECT cefr_level FROM public.profiles WHERE id = ${userId}`;
  return rows[0]?.cefr_level ?? null;
}

export async function hasPassedAttempt(sql: Sql, userId: string, level: CefrLevel): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM public.level_exam_attempts
    WHERE user_id = ${userId} AND level = ${level} AND passed = true LIMIT 1
  `;
  return rows.length > 0;
}

export async function insertAttempt(
  sql: Sql,
  params: { userId: string; level: CefrLevel; score: number; passed: boolean; answers: Record<string, number> },
) {
  await sql`
    INSERT INTO public.level_exam_attempts (user_id, level, score, passed, answers)
    VALUES (${params.userId}, ${params.level}, ${params.score}, ${params.passed}, ${sql.json(params.answers)})
  `;
}
