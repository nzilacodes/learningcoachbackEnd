import type { Sql } from "postgres";
import * as repo from "./repository.js";
import { awardActivity } from "../gamification/service.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { NotFoundError } from "../../lib/errors.js";

// Matches the "3 aulas / semana" free-plan copy shown at onboarding/checkout.
const FREE_WEEKLY_LESSON_LIMIT = 3;

export async function getCurriculum(sql: Sql) {
  const [courses, units, lessons] = await Promise.all([
    repo.listCourses(sql),
    repo.listUnits(sql),
    repo.listLessons(sql),
  ]);
  return { courses, units, lessons };
}

export const getProgress = repo.getProgress;

export async function getLessonDetail(sql: Sql, id: string, authenticated: boolean) {
  const lesson = await repo.getLessonById(sql, id);
  if (!lesson) throw new NotFoundError("Lesson not found");
  const exercises = await repo.listExercisesForLesson(sql, id);
  // GET /lessons/:id is public (unauthenticated demo preview), but answer keys
  // stay for signed-in callers only — an anonymous request shouldn't be able
  // to scrape every quiz/final_test answer in the curriculum for free.
  const safeExercises = authenticated
    ? exercises
    : exercises.map(({ correct_answer: _correctAnswer, ...rest }) => rest);
  return { ...lesson, exercises: safeExercises };
}

export async function updateLessonAdmin(sql: Sql, id: string, patch: repo.LessonPatch) {
  const updated = await repo.updateLesson(sql, id, patch);
  if (!updated) throw new NotFoundError("Lesson not found");
  return updated;
}

export async function listExercisesAdmin(sql: Sql, lessonId: string) {
  const lesson = await repo.getLessonByIdAdmin(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");
  return repo.listExercisesForLessonAdmin(sql, lessonId);
}

export async function createExerciseAdmin(sql: Sql, lessonId: string, input: repo.ExerciseInput) {
  const lesson = await repo.getLessonByIdAdmin(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");
  return repo.createExercise(sql, lessonId, input);
}

export async function updateExerciseAdmin(sql: Sql, id: string, patch: repo.ExercisePatch) {
  const updated = await repo.updateExercise(sql, id, patch);
  if (!updated) throw new NotFoundError("Exercise not found");
  return updated;
}

export async function deleteExerciseAdmin(sql: Sql, id: string) {
  await repo.deleteExercise(sql, id);
}

export async function completeLesson(sql: Sql, userId: string, lessonId: string) {
  const lesson = await repo.getLessonById(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");

  // Free plan: capped at FREE_WEEKLY_LESSON_LIMIT new completions per rolling
  // week. Re-finishing an already-completed lesson never counts against the
  // cap (checked first, cheaply, before touching the subscription table).
  const alreadyDone = await repo.isLessonAlreadyCompleted(sql, userId, lessonId);
  if (!alreadyDone && !(await hasActiveSubscription(sql, userId))) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const completedThisWeek = await repo.countLessonsCompletedSince(sql, userId, since);
    if (completedThisWeek >= FREE_WEEKLY_LESSON_LIMIT) {
      throw new PaymentRequiredError(
        `Free plan limit reached (${FREE_WEEKLY_LESSON_LIMIT} lessons/week). Upgrade to keep learning.`,
      );
    }
  }

  const justCompleted = await repo.completeLessonProgress(sql, userId, lesson.unit_id, lessonId);

  // Already completed before — don't let re-opening a finished lesson (or a
  // duplicate/concurrent request) farm XP again.
  if (!justCompleted) return { alreadyCompleted: true as const };

  // Award the lesson's own configured xp_reward (shown to the student as
  // "+{lesson.xp_reward} XP" before they finish it — see lesson.$lessonId.tsx)
  // instead of the flat DEFAULT_REWARDS.lesson_complete amount, which ignored
  // it entirely and could under/over-pay relative to what the UI promised.
  const reward = await awardActivity(sql, userId, "lesson_complete", { lessonId }, lesson.xp_reward);
  return { alreadyCompleted: false as const, ...reward };
}

export async function getStudyStats(sql: Sql, userId: string) {
  const stats = await repo.getStudyStats(sql, userId);
  return {
    streakDays: stats.streak_days,
    lastActivityDate: stats.last_activity_date,
    xp: stats.xp,
    todayXp: stats.today_xp,
  };
}

export async function getWeeklyStudy(sql: Sql, userId: string, days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await repo.getStudySessions(sql, userId, since.toISOString().slice(0, 10));
  return rows.map((r) => ({ day: r.day, seconds: r.seconds }));
}

export const addStudyTime = repo.addStudyTime;

export async function getStudyReminder(sql: Sql, userId: string) {
  const reminder = await repo.getStudyReminder(sql, userId);
  return reminder
    ? { intervalMinutes: reminder.interval_minutes, enabled: reminder.enabled }
    : { intervalMinutes: 60, enabled: false };
}

export const setStudyReminder = repo.upsertStudyReminder;

export async function listVideoHistory(sql: Sql, userId: string, limit = 8) {
  return repo.listVideoHistory(sql, userId, limit);
}

export const getVideoHistoryItem = repo.getVideoHistoryItem;
export const setVideoHistory = repo.upsertVideoHistory;
