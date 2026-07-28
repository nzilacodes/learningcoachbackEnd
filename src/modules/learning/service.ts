import type { Sql } from "postgres";
import * as repo from "./repository.js";

export async function getCurriculum(sql: Sql) {
  const [courses, units, lessons] = await Promise.all([
    repo.listCourses(sql),
    repo.listUnits(sql),
    repo.listLessons(sql),
  ]);
  return { courses, units, lessons };
}

export const getProgress = repo.getProgress;

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
