import type { Sql } from "postgres";
import * as learningRepo from "../learning/repository.js";
import { assertLessonCompletionAllowed, completeLesson } from "../learning/service.js";
import { awardActivity } from "../gamification/service.js";
import { hasActiveSubscription } from "../../lib/subscription.js";
import { NotFoundError, HeartsDepletedError } from "../../lib/errors.js";
import * as repo from "./repository.js";
import { gradeExercise, DETERMINISTIC_TYPES, type GradeResult } from "./graders/index.js";

const HEARTS_PER_MISS = 1;

export type SubmittedAnswer = { exerciseId: string; response: unknown };

export type HeartsState = {
  hearts: number | null;
  maxHearts: number | null;
  unlimited: boolean;
  nextRegenAt: string | null;
  regenMinutes: number;
};

export async function getHeartsState(sql: Sql, userId: string): Promise<HeartsState> {
  if (await hasActiveSubscription(sql, userId)) {
    return { hearts: null, maxHearts: null, unlimited: true, nextRegenAt: null, regenMinutes: repo.REGEN_MINUTES };
  }
  const state = await repo.getOrCreateHearts(sql, userId);
  const nextRegenAt =
    state.hearts >= state.max_hearts
      ? null
      : new Date(new Date(state.last_regen_at).getTime() + repo.REGEN_MINUTES * 60_000).toISOString();
  return { hearts: state.hearts, maxHearts: state.max_hearts, unlimited: false, nextRegenAt, regenMinutes: repo.REGEN_MINUTES };
}

type PerQuestionFeedback = { exerciseId: string; isCorrect: boolean | null; score: number; feedback?: string };

export type SubmitLessonAttemptResult = {
  score: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  heartsRemaining: number | null;
  xpAwarded: number;
  alreadyCompleted: boolean;
  levelUp?: boolean;
  level?: number;
  perQuestionFeedback: PerQuestionFeedback[];
};

export async function submitLessonAttempt(
  sql: Sql,
  userId: string,
  lessonId: string,
  answers: SubmittedAnswer[],
): Promise<SubmitLessonAttemptResult> {
  const lesson = await learningRepo.getLessonById(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");

  const exercises = await learningRepo.listExercisesForLesson(sql, lessonId);

  // No published exercises yet for this lesson (the ~1,572 still-placeholder
  // lessons, or a non-quiz lesson type) — fall back to the legacy no-body
  // completion path so nothing that already works today regresses.
  if (exercises.length === 0) {
    const legacy = await completeLesson(sql, userId, lessonId);
    return {
      score: 100,
      passed: true,
      correctCount: 0,
      totalCount: 0,
      heartsRemaining: null,
      xpAwarded: legacy.alreadyCompleted ? 0 : (legacy as { gained?: number }).gained ?? 0,
      alreadyCompleted: legacy.alreadyCompleted,
      level: (legacy as { level?: number }).level,
      levelUp: (legacy as { level_up?: boolean }).level_up,
      perQuestionFeedback: [],
    };
  }

  const isPremium = await hasActiveSubscription(sql, userId);

  // Fail fast, before spending any AI calls, if the student is already out
  // of hearts — never even starts grading.
  if (lesson.hearts_enabled && !isPremium) {
    const state = await repo.getOrCreateHearts(sql, userId);
    if (state.hearts <= 0) {
      throw new HeartsDepletedError("You're out of hearts — wait for them to regenerate or upgrade to Premium.");
    }
  }

  const byId = new Map(exercises.map((ex) => [ex.id, ex]));
  const answered = answers.filter((a) => byId.has(a.exerciseId));

  type Graded = { exerciseId: string; type: string; submittedAnswer: unknown; grade: GradeResult };
  const results: Graded[] = [];

  // Deterministic exercises first — synchronous, zero AI cost/latency/failure
  // risk — so a mid-attempt AI outage below never affects these.
  for (const a of answered) {
    const exercise = byId.get(a.exerciseId)!;
    if (!DETERMINISTIC_TYPES.has(exercise.type)) continue;
    const grade = await gradeExercise(exercise, a.response);
    results.push({ exerciseId: a.exerciseId, type: exercise.type, submittedAnswer: a.response, grade });
  }
  // AI-graded exercises after. If any of these throws (e.g. OpenAI outage —
  // callChatCompletion throws AiServiceError), nothing has been persisted
  // yet and no hearts have been touched, so the whole attempt is simply
  // retryable with no partial state to roll back.
  for (const a of answered) {
    const exercise = byId.get(a.exerciseId)!;
    if (DETERMINISTIC_TYPES.has(exercise.type)) continue;
    const grade = await gradeExercise(exercise, a.response);
    results.push({ exerciseId: a.exerciseId, type: exercise.type, submittedAnswer: a.response, grade });
  }

  const totalCount = exercises.length;
  const correctCount = results.filter((r) => r.grade.isCorrect === true).length;
  const scoreSum = results.reduce((sum, r) => sum + r.grade.score, 0);
  const score = totalCount > 0 ? Math.round(scoreSum / totalCount) : 0;
  const passed = score >= lesson.min_pass_score;

  // Hearts are only ever spent on deterministic misses — a subjective
  // AI-graded writing/speaking score below threshold doesn't cost a life,
  // the same way Duolingo doesn't dock hearts for an open-ended answer.
  const missedDeterministic = results.filter((r) => DETERMINISTIC_TYPES.has(r.type) && r.grade.isCorrect === false).length;
  const heartsToLose = lesson.hearts_enabled && !isPremium ? missedDeterministic * HEARTS_PER_MISS : 0;

  // Hearts deduction + attempt persistence happen atomically in one
  // transaction with an advisory lock scoped to (userId, lessonId) — the
  // unit that must never partially apply. Completion/XP happen afterward,
  // outside this transaction, the same "insert result, then best-effort
  // award" split diagnostic/service.ts already uses for submitDiagnostic.
  const { attemptId, heartsRemaining } = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId + ":lesson_attempt:" + lessonId}))`;

    let heartsRemainingTx: number | null = null;
    if (lesson.hearts_enabled && !isPremium) {
      heartsRemainingTx = await repo.deductHearts(tx, userId, heartsToLose);
    }

    const id = await repo.insertLessonAttempt(tx, {
      userId,
      lessonId,
      score,
      passed,
      correctCount,
      totalCount,
      heartsLost: heartsToLose,
      xpAwarded: 0, // filled in below once completion/XP is settled
      answers,
    });
    await repo.insertExerciseAttemptResults(
      tx,
      id,
      results.map((r) => ({
        exerciseId: r.exerciseId,
        submittedAnswer: r.submittedAnswer,
        isCorrect: r.grade.isCorrect,
        score: r.grade.score,
        aiFeedback: r.grade.feedback ?? null,
      })),
    );

    return { attemptId: id, heartsRemaining: heartsRemainingTx };
  });

  let xpAwarded = 0;
  let alreadyCompleted = false;
  let level: number | undefined;
  let levelUp: boolean | undefined;

  if (passed) {
    // Same free-plan weekly cap as the legacy path — a passing attempt still
    // can't claim a NEW completion beyond the cap. The attempt row above
    // already recorded the pass either way, so a capped user's work isn't lost.
    await assertLessonCompletionAllowed(sql, userId, lessonId);
    const justCompleted = await learningRepo.completeLessonProgress(sql, userId, lesson.unit_id, lessonId);
    alreadyCompleted = !justCompleted;
    if (justCompleted) {
      xpAwarded = Math.round(lesson.xp_reward * (score / 100));
      const reward = await awardActivity(sql, userId, "lesson_complete", { lessonId, score }, xpAwarded);
      level = reward.level;
      levelUp = reward.level_up;
      await repo.updateLessonAttemptXp(sql, attemptId, xpAwarded);
    }
  }

  return {
    score,
    passed,
    correctCount,
    totalCount,
    heartsRemaining,
    xpAwarded,
    alreadyCompleted,
    level,
    levelUp,
    perQuestionFeedback: results.map((r) => ({
      exerciseId: r.exerciseId,
      isCorrect: r.grade.isCorrect,
      score: r.grade.score,
      feedback: r.grade.feedback,
    })),
  };
}
