import type { Sql, TransactionSql, JSONValue } from "postgres";

type SqlClient = Sql | TransactionSql;

export const REGEN_MINUTES = 20;

export type HeartsRow = { hearts: number; max_hearts: number; last_regen_at: Date };

/**
 * Reads the user's hearts, lazily applying regen (1 heart per REGEN_MINUTES,
 * capped at max_hearts) as part of the same read — no cron job needed, same
 * "compute on read" idiom gamification/repository.ts's weekly leaderboard
 * already uses for its own reset. `last_regen_at` advances by exactly
 * heartsToAdd * REGEN_MINUTES (not reset to `now()`), so partial progress
 * toward the *next* heart is never lost.
 */
export async function getOrCreateHearts(sql: SqlClient, userId: string): Promise<HeartsRow> {
  const inserted = await sql<HeartsRow[]>`
    INSERT INTO public.user_hearts (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO NOTHING
    RETURNING hearts, max_hearts, last_regen_at
  `;
  const state =
    inserted[0] ??
    (
      await sql<HeartsRow[]>`
        SELECT hearts, max_hearts, last_regen_at FROM public.user_hearts WHERE user_id = ${userId}
      `
    )[0]!;

  if (state.hearts >= state.max_hearts) return state;

  const minutesElapsed = (Date.now() - new Date(state.last_regen_at).getTime()) / 60_000;
  const heartsToAdd = Math.floor(minutesElapsed / REGEN_MINUTES);
  if (heartsToAdd <= 0) return state;

  const newHearts = Math.min(state.max_hearts, state.hearts + heartsToAdd);
  const newLastRegenAt = new Date(new Date(state.last_regen_at).getTime() + heartsToAdd * REGEN_MINUTES * 60_000);
  const [updated] = await sql<HeartsRow[]>`
    UPDATE public.user_hearts SET hearts = ${newHearts}, last_regen_at = ${newLastRegenAt.toISOString()}
    WHERE user_id = ${userId}
    RETURNING hearts, max_hearts, last_regen_at
  `;
  return updated ?? { ...state, hearts: newHearts, last_regen_at: newLastRegenAt };
}

/** Never goes below 0 — the GREATEST clause makes this safe even if two
 * requests race past the pre-check (closed off by an advisory lock in
 * service.ts, but cheap to make doubly safe here too). */
export async function deductHearts(sql: SqlClient, userId: string, amount: number): Promise<number> {
  if (amount <= 0) {
    const state = await getOrCreateHearts(sql, userId);
    return state.hearts;
  }
  const [row] = await sql<{ hearts: number }[]>`
    UPDATE public.user_hearts SET hearts = GREATEST(0, hearts - ${amount})
    WHERE user_id = ${userId}
    RETURNING hearts
  `;
  return row?.hearts ?? 0;
}

export type InsertLessonAttemptParams = {
  userId: string;
  lessonId: string;
  score: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  heartsLost: number;
  xpAwarded: number;
  answers: unknown;
};

export async function insertLessonAttempt(sql: SqlClient, params: InsertLessonAttemptParams): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO public.lesson_attempts
      (user_id, lesson_id, score, passed, correct_count, total_count, hearts_lost, xp_awarded, answers)
    VALUES (
      ${params.userId}, ${params.lessonId}, ${params.score}, ${params.passed},
      ${params.correctCount}, ${params.totalCount}, ${params.heartsLost}, ${params.xpAwarded},
      ${sql.json(params.answers as JSONValue)}
    )
    RETURNING id
  `;
  return row!.id;
}

/** Backfills xp_awarded once completion/XP has been settled — that happens
 * after the attempt-persistence transaction commits (see service.ts), since
 * awarding XP depends on the free-plan cap check, which reads state the
 * attempt insert doesn't need to wait on. */
export async function updateLessonAttemptXp(sql: SqlClient, attemptId: string, xpAwarded: number): Promise<void> {
  if (xpAwarded <= 0) return;
  await sql`UPDATE public.lesson_attempts SET xp_awarded = ${xpAwarded} WHERE id = ${attemptId}`;
}

export type ExerciseAttemptResultInput = {
  exerciseId: string;
  submittedAnswer: unknown;
  isCorrect: boolean | null;
  score: number | null;
  aiFeedback?: string | null;
};

// Looped rather than a bulk sql() insert: a lesson attempt has at most a
// handful of questions, and postgres.js's bulk-insert helper doesn't cleanly
// support per-row sql.json() wrapping for a jsonb column — a plain loop
// inside the caller's transaction is simpler and just as safe here.
export async function insertExerciseAttemptResults(
  sql: SqlClient,
  attemptId: string,
  results: ExerciseAttemptResultInput[],
): Promise<void> {
  for (const r of results) {
    await sql`
      INSERT INTO public.exercise_attempt_results
        (attempt_id, exercise_id, submitted_answer, is_correct, score, ai_feedback)
      VALUES (
        ${attemptId}, ${r.exerciseId}, ${sql.json(r.submittedAnswer as JSONValue)},
        ${r.isCorrect}, ${r.score}, ${r.aiFeedback ?? null}
      )
    `;
  }
}
