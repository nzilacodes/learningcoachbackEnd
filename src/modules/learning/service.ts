import type { Sql } from "postgres";
import * as repo from "./repository.js";
import { awardActivity } from "../gamification/service.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { NotFoundError, ValidationError, ConflictError } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit.js";

// Matches the "3 aulas / semana" free-plan copy shown at onboarding/checkout.
const FREE_WEEKLY_LESSON_LIMIT = 3;

// A lesson's content type is "quiz"/"final_test" is not what gates grading —
// whether it has published exercises does (see hasPublishedExercises). This
// only matters for the answer-key leak fix in getLessonDetail below.
const GRADED_LESSON_TYPES = new Set(["quiz", "final_test"]);

/**
 * Shared free-plan weekly-completion-cap check, used by both the legacy
 * no-body completeLesson() below and grading/service.ts#submitLessonAttempt
 * — factored out so the two paths can't drift. Returns whether the lesson
 * was already completed before this call (cheap, checked first, so an
 * already-completed lesson never counts against the cap or touches the
 * subscriptions table).
 */
export async function assertLessonCompletionAllowed(sql: Sql, userId: string, lessonId: string): Promise<boolean> {
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
  return alreadyDone;
}

export async function getCurriculum(sql: Sql) {
  const [courses, units, lessons] = await Promise.all([
    repo.listCourses(sql),
    repo.listUnits(sql),
    repo.listLessons(sql),
  ]);
  return { courses, units, lessons };
}

/** Admin curriculum browser's data source — unlike getCurriculum (public,
 * student-facing), includes draft/unpublished courses and lessons so an
 * admin can see and edit content before it goes live. */
export async function getCurriculumAdmin(sql: Sql) {
  const [courses, units, lessons] = await Promise.all([
    repo.listCoursesAdmin(sql),
    repo.listUnits(sql),
    repo.listLessonsAdmin(sql),
  ]);
  return { courses, units, lessons };
}

export const getProgress = repo.getProgress;

export async function getLessonDetail(sql: Sql, id: string, authenticated: boolean) {
  const lesson = await repo.getLessonById(sql, id);
  if (!lesson) throw new NotFoundError("Lesson not found");
  const exercises = await repo.listExercisesForLesson(sql, id);
  // GET /lessons/:id is public (unauthenticated demo preview). Answer keys are
  // withheld from anonymous callers always, and from EVERY caller — signed in
  // or not — for quiz/final_test lessons, since those are now graded
  // server-side via POST /lessons/:id/submit: shipping correct_answer to an
  // authenticated client before they answer would let them read it straight
  // off the network and defeat the grading engine entirely.
  const withholdAnswerKey = !authenticated || GRADED_LESSON_TYPES.has(lesson.lesson_type);
  const safeExercises = withholdAnswerKey
    ? exercises.map(({ correct_answer: _correctAnswer, ...rest }) => rest)
    : exercises;
  return { ...lesson, exercises: safeExercises };
}

export async function updateLessonAdmin(sql: Sql, id: string, patch: repo.LessonPatch) {
  const updated = await repo.updateLesson(sql, id, patch);
  if (!updated) throw new NotFoundError("Lesson not found");
  return updated;
}

export async function createUnitAdmin(sql: Sql, input: repo.UnitInput & { ageGroupIds?: string[] }) {
  const unit = await repo.insertUnit(sql, input);
  // Falls back to the age band mapped from the course's own CEFR level so a
  // unit is never created invisible in the "by age" browser — see
  // getDefaultAgeGroupIdForCourse's own docstring for the mapping rule.
  const ageGroupIds =
    input.ageGroupIds ??
    (await repo.getDefaultAgeGroupIdForCourse(sql, input.courseId).then((id) => (id ? [id] : [])));
  await repo.setUnitAgeGroups(sql, unit.id, ageGroupIds);
  return { ...unit, age_group_ids: ageGroupIds };
}

export async function updateUnitAdmin(sql: Sql, id: string, patch: repo.UnitPatch & { ageGroupIds?: string[] }) {
  const updated = await repo.updateUnit(sql, id, patch);
  if (!updated) throw new NotFoundError("Unit not found");
  if (patch.ageGroupIds) await repo.setUnitAgeGroups(sql, id, patch.ageGroupIds);
  return updated;
}

export const listAgeGroups = repo.listAgeGroups;

export async function duplicateUnitAdmin(sql: Sql, unitId: string) {
  const unit = await repo.duplicateUnit(sql, unitId);
  if (!unit) throw new NotFoundError("Unit not found");
  return unit;
}

/** `force` bypasses the lesson-count guard (the DB's ON DELETE CASCADE from
 * lessons.unit_id still does the actual removal either way) — without it, a
 * unit that already has lessons refuses to delete so the caller has to
 * consciously opt into losing them. */
export async function deleteUnitAdmin(sql: Sql, id: string, force: boolean, adminUserId: string) {
  const unit = await repo.getUnitById(sql, id);
  if (!unit) throw new NotFoundError("Unit not found");
  let lessonCount = 0;
  if (!force) {
    lessonCount = await repo.countLessonsInUnit(sql, id);
    if (lessonCount > 0) {
      throw new ConflictError(
        `Unit has ${lessonCount} lesson(s) — delete them first, or retry with force=true to delete the unit and all its lessons.`,
      );
    }
  }
  await repo.deleteUnit(sql, id);
  await logAdminAction(sql, {
    adminUserId,
    action: "unit.delete",
    entity: "unit",
    entityId: id,
    severity: "warning",
    metadata: { title: unit.title, forced: force, lessonCountAtDeletion: lessonCount },
  });
}

export async function createLessonAdmin(sql: Sql, input: repo.LessonInput) {
  const unit = await repo.getUnitById(sql, input.unitId);
  if (!unit) throw new NotFoundError("Unit not found");
  return repo.insertLesson(sql, input);
}

/** `force` bypasses the attempts-exist guard (real student history) — see
 * deleteUnitAdmin for the same shape of decision one level up. Preferring
 * "unpublish" over "delete" is the guidance surfaced to the caller, not
 * enforced here: an admin who really means to delete can still force it. */
export async function deleteLessonAdmin(sql: Sql, id: string, force: boolean, adminUserId: string) {
  const lesson = await repo.getLessonByIdAdmin(sql, id);
  if (!lesson) throw new NotFoundError("Lesson not found");
  let attemptCount = 0;
  if (!force) {
    attemptCount = await repo.countLessonAttemptsForLesson(sql, id);
    if (attemptCount > 0) {
      throw new ConflictError(
        `Lesson has ${attemptCount} recorded attempt(s) — unpublish it instead, or retry with force=true to delete it and that history.`,
      );
    }
  }
  await repo.deleteLesson(sql, id);
  await logAdminAction(sql, {
    adminUserId,
    action: "lesson.delete",
    entity: "lesson",
    entityId: id,
    severity: "warning",
    metadata: { title: lesson.title, forced: force, attemptCountAtDeletion: attemptCount },
  });
}

export async function listExercisesAdmin(sql: Sql, lessonId: string, status?: string) {
  const lesson = await repo.getLessonByIdAdmin(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");
  return repo.listExercisesForLessonAdmin(sql, lessonId, status);
}

export const getExerciseReviewSummary = repo.getExerciseReviewSummary;

export async function publishAllExercisesAdmin(sql: Sql, lessonId: string) {
  const lesson = await repo.getLessonByIdAdmin(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");
  const published = await repo.publishAllExercisesForLesson(sql, lessonId);
  return { published };
}

/** Admin-triggered single-lesson (re)generation — same underlying pipeline as
 * `npm run generate:exercises`, exposed from the curriculum editor. Always
 * lands as content_status='draft'; never visible to students until reviewed. */
export async function generateExercisesAdmin(sql: Sql, lessonId: string) {
  const lesson = await repo.getLessonForGeneration(sql, lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found");
  const { randomUUID } = await import("node:crypto");
  const { generateExercisesForLesson } = await import("../../jobs/generate-lesson-content.js");
  return generateExercisesForLesson(sql, lesson, randomUUID());
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

  // Once a lesson has real graded exercises published, this no-body endpoint
  // is no longer a valid way to complete it — grading/service.ts's
  // submitLessonAttempt is the only authoritative path from that point on.
  // Lessons with zero published exercises (the ~1,572 still-placeholder ones,
  // plus every non-quiz lesson type) are unaffected and keep working exactly
  // as before this guard was added.
  if (await repo.hasPublishedExercises(sql, lessonId)) {
    throw new ValidationError(
      "This lesson has graded exercises — submit your answers via POST /lessons/:id/submit instead.",
    );
  }

  // Free plan: capped at FREE_WEEKLY_LESSON_LIMIT new completions per rolling
  // week. Re-finishing an already-completed lesson never counts against the
  // cap (checked first, cheaply, before touching the subscription table).
  await assertLessonCompletionAllowed(sql, userId, lessonId);

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
