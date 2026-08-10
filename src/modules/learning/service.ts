import type { Sql } from "postgres";
import * as repo from "./repository.js";
import { awardActivity } from "../gamification/service.js";

class NotFoundError extends Error {
  statusCode = 404;
}

export async function getCurriculum(sql: Sql) {
  const [courses, units, lessons] = await Promise.all([
    repo.listCourses(sql),
    repo.listUnits(sql),
    repo.listLessons(sql),
  ]);
  return { courses, units, lessons };
}

export const getProgress = repo.getProgress;

export async function getLessonDetail(sql: Sql, id: string) {
  const lesson = await repo.getLessonById(sql, id);
  if (!lesson) throw new NotFoundError("Lesson not found");
  const exercises = await repo.listExercisesForLesson(sql, id);
  return { ...lesson, exercises };
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

  const existing = await repo.getLessonProgressRow(sql, userId, lesson.unit_id, lessonId);
  await repo.completeLessonProgress(sql, userId, lesson.unit_id, lessonId);

  // Already completed before — don't let re-opening a finished lesson farm XP again.
  if (existing?.completed_at) return { alreadyCompleted: true as const };

  const reward = await awardActivity(sql, userId, "lesson_complete", { lessonId });
  return { alreadyCompleted: false as const, ...reward };
}

export async function getStudyStats(sql: Sql, userId: string) {
  const stats = await repo.getStudyStats(sql, userId);
  return { streakDays: stats.streak_days, lastActivityDate: stats.last_activity_date, xp: stats.xp };
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
