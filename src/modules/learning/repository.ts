import type { Sql, JSONValue } from "postgres";

export async function listCourses(sql: Sql) {
  return sql`SELECT * FROM public.courses WHERE is_published = true ORDER BY order_index`;
}

export async function listUnits(sql: Sql) {
  return sql`SELECT * FROM public.units ORDER BY order_index`;
}

export async function listLessons(sql: Sql) {
  return sql`SELECT * FROM public.lessons WHERE is_published = true ORDER BY order_index`;
}

export async function getProgress(sql: Sql, userId: string) {
  return sql`
    SELECT unit_id, lesson_id, progress_pct, completed_at
    FROM public.lesson_progress WHERE user_id = ${userId}
  `;
}

export async function getLessonById(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.lessons WHERE id = ${id} AND is_published = true`;
  return rows[0] ?? null;
}

/** Unlike getLessonById, ignores is_published so admins can edit draft lessons too. */
export async function getLessonByIdAdmin(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.lessons WHERE id = ${id}`;
  return rows[0] ?? null;
}

export type LessonPatch = {
  title?: string;
  summary?: string;
  content?: unknown;
  durationMin?: number;
  xpReward?: number;
  isPublished?: boolean;
  orderIndex?: number;
};

export async function updateLesson(sql: Sql, id: string, patch: LessonPatch) {
  const [row] = await sql`
    UPDATE public.lessons SET
      title = COALESCE(${patch.title ?? null}, title),
      summary = COALESCE(${patch.summary ?? null}, summary),
      content = COALESCE(${patch.content !== undefined ? sql.json(patch.content as JSONValue) : null}, content),
      duration_min = COALESCE(${patch.durationMin ?? null}, duration_min),
      xp_reward = COALESCE(${patch.xpReward ?? null}, xp_reward),
      is_published = COALESCE(${patch.isPublished ?? null}, is_published),
      order_index = COALESCE(${patch.orderIndex ?? null}, order_index)
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export type UnitInput = { courseId: string; title: string; description?: string; orderIndex: number };

export async function insertUnit(sql: Sql, input: UnitInput) {
  const [row] = await sql`
    INSERT INTO public.units (course_id, title, description, order_index)
    VALUES (${input.courseId}, ${input.title}, ${input.description ?? null}, ${input.orderIndex})
    RETURNING *
  `;
  return row!;
}

export type UnitPatch = { title?: string; description?: string; orderIndex?: number };

export async function updateUnit(sql: Sql, id: string, patch: UnitPatch) {
  const [row] = await sql`
    UPDATE public.units SET
      title = COALESCE(${patch.title ?? null}, title),
      description = COALESCE(${patch.description ?? null}, description),
      order_index = COALESCE(${patch.orderIndex ?? null}, order_index)
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export async function getUnitById(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.units WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** units.id -> lessons.unit_id has ON DELETE CASCADE, so this delete alone
 * removes any lessons (and, transitively, their exercises/attempts) in the
 * unit — the lesson-count check belongs in service.ts, before calling this,
 * precisely so that cascade is never silent. */
export async function deleteUnit(sql: Sql, id: string) {
  await sql`DELETE FROM public.units WHERE id = ${id}`;
}

export async function countLessonsInUnit(sql: Sql, unitId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM public.lessons WHERE unit_id = ${unitId}`;
  return Number(row!.count);
}

export type LessonInput = {
  unitId: string;
  title: string;
  lessonType: string;
  summary?: string;
  xpReward: number;
  orderIndex: number;
};

// Derive a URL-safe slug from the title, then disambiguate with a short
// random suffix rather than checking for collisions — same "cheap enough to
// not bother with a retry loop" trust level as classes/service.ts's invite
// codes, and the (unit_id, slug) UNIQUE constraint is the actual backstop.
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "lesson"}-${suffix}`;
}

export async function insertLesson(sql: Sql, input: LessonInput) {
  const [row] = await sql`
    INSERT INTO public.lessons (unit_id, slug, title, summary, xp_reward, order_index, lesson_type, content, is_published)
    VALUES (
      ${input.unitId}, ${slugify(input.title)}, ${input.title}, ${input.summary ?? null},
      ${input.xpReward}, ${input.orderIndex}, ${input.lessonType}::public.lesson_type, '{}'::jsonb, false
    )
    RETURNING *
  `;
  return row!;
}

/** lessons.id -> lesson_attempts.lesson_id has ON DELETE CASCADE — the
 * attempts-exist check belongs in service.ts, before calling this, so a
 * lesson with real student history is never deleted silently. */
export async function deleteLesson(sql: Sql, id: string) {
  await sql`DELETE FROM public.lessons WHERE id = ${id}`;
}

export async function countLessonAttemptsForLesson(sql: Sql, lessonId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM public.lesson_attempts WHERE lesson_id = ${lessonId}`;
  return Number(row!.count);
}

// Only ever serves content_status='published' rows to students — draft/
// in_review rows (including anything the AI content-generation pipeline
// inserts) stay invisible until an admin explicitly publishes them via
// PATCH /admin/exercises/:id.
export type ExerciseRow = {
  id: string;
  type: string;
  prompt: string;
  data: Record<string, unknown> | null;
  correct_answer: unknown;
  xp_reward: number;
  order_index: number;
};

export async function listExercisesForLesson(sql: Sql, lessonId: string) {
  return sql<ExerciseRow[]>`
    SELECT id, type, prompt, data, correct_answer, xp_reward, order_index
    FROM public.exercises
    WHERE lesson_id = ${lessonId} AND content_status = 'published'
    ORDER BY order_index
  `;
}

// Used by completeLesson (learning/service.ts) to decide whether a lesson
// must go through the graded POST /lessons/:id/submit flow instead of the
// legacy no-body POST /lessons/:id/complete — and by grading/service.ts to
// decide whether to fall back to that legacy path itself.
export async function hasPublishedExercises(sql: Sql, lessonId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM public.exercises WHERE lesson_id = ${lessonId} AND content_status = 'published' LIMIT 1
  `;
  return rows.length > 0;
}

/** Any status (draft/in_review/published) — used by the content-generation
 * pipeline's idempotency check, which must never generate a second batch for
 * a lesson that already has exercises pending review. */
export async function hasAnyExercises(sql: Sql, lessonId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM public.exercises WHERE lesson_id = ${lessonId} LIMIT 1`;
  return rows.length > 0;
}

export type LessonForGeneration = {
  id: string;
  title: string;
  summary: string | null;
  content: Record<string, unknown> | null;
  lesson_type: string;
  level: string;
  unit_title: string;
};

/**
 * quiz/final_test lessons with zero exercises of any status yet — the exact
 * set src/jobs/generate-lesson-content.ts needs to backfill. Optional
 * level/unit filters let the CLI run controlled batches instead of all 1,572
 * placeholder lessons at once.
 */
/** Single-lesson variant of listLessonsNeedingExercises, for the admin-triggered
 * "regenerate this lesson" action (POST /admin/lessons/:id/generate-exercises). */
export async function getLessonForGeneration(sql: Sql, lessonId: string): Promise<LessonForGeneration | null> {
  const rows = await sql<LessonForGeneration[]>`
    SELECT l.id, l.title, l.summary, l.content, l.lesson_type, c.level::text AS level, u.title AS unit_title
    FROM public.lessons l
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.courses c ON c.id = u.course_id
    WHERE l.id = ${lessonId}
  `;
  return rows[0] ?? null;
}

export async function listLessonsNeedingExercises(sql: Sql, filter: { level?: string; unitId?: string }) {
  return sql<LessonForGeneration[]>`
    SELECT l.id, l.title, l.summary, l.content, l.lesson_type, c.level::text AS level, u.title AS unit_title
    FROM public.lessons l
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.courses c ON c.id = u.course_id
    WHERE l.lesson_type IN ('quiz', 'final_test')
      AND ${filter.level ? sql`c.level = ${filter.level}::public.cefr_level` : sql`true`}
      AND ${filter.unitId ? sql`u.id = ${filter.unitId}` : sql`true`}
      AND NOT EXISTS (SELECT 1 FROM public.exercises e WHERE e.lesson_id = l.id)
    ORDER BY c.level, u.order_index, l.order_index
  `;
}

export async function listExercisesForLessonAdmin(sql: Sql, lessonId: string, status?: string) {
  return sql`
    SELECT * FROM public.exercises
    WHERE lesson_id = ${lessonId} AND ${status ? sql`content_status = ${status}` : sql`true`}
    ORDER BY order_index
  `;
}

export type ExerciseInput = {
  type: string;
  prompt: string;
  data?: unknown;
  correctAnswer?: unknown;
  xpReward: number;
  orderIndex: number;
  // Only ever set by the AI content-generation pipeline (src/jobs/generate-lesson-content.ts)
  // and its admin-triggered counterpart — the manual admin CRUD form never
  // sets these, so a hand-authored exercise still defaults to 'published'
  // exactly like before this column existed.
  contentStatus?: "draft" | "in_review" | "published";
  generatedBy?: string;
  generationBatchId?: string;
};

// order_index is computed here (max + 1), not taken from the client — the
// admin UI doesn't track a reliable "next" value across concurrent adds.
export async function createExercise(sql: Sql, lessonId: string, input: ExerciseInput) {
  const [row] = await sql`
    INSERT INTO public.exercises
      (lesson_id, type, prompt, data, correct_answer, xp_reward, order_index, content_status, generated_by, generation_batch_id)
    VALUES (
      ${lessonId}, ${input.type}, ${input.prompt},
      ${input.data !== undefined ? sql.json(input.data as JSONValue) : null},
      ${input.correctAnswer !== undefined ? sql.json(input.correctAnswer as JSONValue) : null},
      ${input.xpReward},
      COALESCE((SELECT max(order_index) + 1 FROM public.exercises WHERE lesson_id = ${lessonId}), 0),
      ${input.contentStatus ?? "published"},
      ${input.generatedBy ?? null},
      ${input.generationBatchId ?? null}
    )
    RETURNING *
  `;
  return row;
}

export type ExercisePatch = Partial<ExerciseInput>;

export async function updateExercise(sql: Sql, id: string, patch: ExercisePatch) {
  const [row] = await sql`
    UPDATE public.exercises SET
      type = COALESCE(${patch.type ?? null}, type),
      prompt = COALESCE(${patch.prompt ?? null}, prompt),
      data = COALESCE(${patch.data !== undefined ? sql.json(patch.data as JSONValue) : null}, data),
      correct_answer = COALESCE(${patch.correctAnswer !== undefined ? sql.json(patch.correctAnswer as JSONValue) : null}, correct_answer),
      xp_reward = COALESCE(${patch.xpReward ?? null}, xp_reward),
      order_index = COALESCE(${patch.orderIndex ?? null}, order_index),
      content_status = COALESCE(${patch.contentStatus ?? null}, content_status)
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export async function deleteExercise(sql: Sql, id: string) {
  await sql`DELETE FROM public.exercises WHERE id = ${id}`;
}

export type ExerciseReviewSummaryRow = {
  lesson_id: string;
  draft: number;
  in_review: number;
  published: number;
};

/** One row per lesson that has any exercises, with counts by content_status —
 * powers the admin curriculum screen's review-progress badges so an admin
 * can see where the 1,000+-exercise AI-generated backlog actually is without
 * opening every lesson one by one. */
export async function getExerciseReviewSummary(sql: Sql) {
  return sql<ExerciseReviewSummaryRow[]>`
    SELECT
      lesson_id,
      count(*) FILTER (WHERE content_status = 'draft')::int AS draft,
      count(*) FILTER (WHERE content_status = 'in_review')::int AS in_review,
      count(*) FILTER (WHERE content_status = 'published')::int AS published
    FROM public.exercises
    GROUP BY lesson_id
  `;
}

/** Publishes every non-published exercise in a lesson in one statement —
 * the bulk counterpart to the per-exercise PATCH .../content_status, for
 * reviewing a lesson's whole batch at once instead of one dropdown at a time.
 * Returns how many rows actually flipped. */
export async function publishAllExercisesForLesson(sql: Sql, lessonId: string): Promise<number> {
  const rows = await sql`
    UPDATE public.exercises SET content_status = 'published'
    WHERE lesson_id = ${lessonId} AND content_status != 'published'
    RETURNING id
  `;
  return rows.length;
}

export async function isLessonAlreadyCompleted(sql: Sql, userId: string, lessonId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM public.lesson_progress
    WHERE user_id = ${userId} AND lesson_id = ${lessonId} AND completed_at IS NOT NULL
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Distinct lessons completed since `since` — used for the free plan's weekly cap. */
export async function countLessonsCompletedSince(sql: Sql, userId: string, since: Date) {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text FROM public.lesson_progress
    WHERE user_id = ${userId} AND completed_at >= ${since.toISOString()}
  `;
  return Number(row!.count);
}

/**
 * Upserts progress to 100%/completed and reports whether *this* call was the
 * one that first completed it — in one atomic statement, so two concurrent
 * completion requests can't both read "not completed yet" and both award XP.
 * completed_at only changes on the row's first completion (COALESCE keeps the
 * original), so comparing it to this statement's own timestamp tells us which
 * call won. RETURNING compares against now() rather than EXCLUDED.completed_at
 * — Postgres only allows referencing EXCLUDED inside DO UPDATE's SET/WHERE,
 * never in RETURNING ("invalid reference to FROM-clause entry for table
 * excluded"). now() is equivalent here: it's fixed for the whole statement
 * (it returns the transaction's start time), so it's the same value that was
 * just inserted/compared as EXCLUDED.completed_at above.
 */
export async function completeLessonProgress(sql: Sql, userId: string, unitId: string, lessonId: string) {
  const [row] = await sql<{ just_completed: boolean }[]>`
    INSERT INTO public.lesson_progress (user_id, unit_id, lesson_id, progress_pct, completed_at)
    VALUES (${userId}, ${unitId}, ${lessonId}, 100, now())
    ON CONFLICT (user_id, unit_id, lesson_id) DO UPDATE SET
      progress_pct = 100,
      completed_at = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
      updated_at = now()
    RETURNING (completed_at = now()) AS just_completed
  `;
  return row!.just_completed;
}

export type StudyStats = {
  streak_days: number;
  last_activity_date: string | null;
  xp: number;
  today_xp: number;
};

export async function getStudyStats(sql: Sql, userId: string): Promise<StudyStats> {
  const rows = await sql<StudyStats[]>`
    SELECT
      COALESCE(us.streak_days, 0) AS streak_days,
      us.last_activity_date,
      COALESCE(p.xp, 0) AS xp,
      -- UTC day boundary, matching todayUtc() in gamification/service.ts
      -- (toISOString().slice(0, 10)) — "today" means the same thing here
      -- as it does for the streak calculation.
      COALESCE((
        SELECT SUM(amount) FROM public.xp_events
        WHERE user_id = p.id
          AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      ), 0)::int AS today_xp
    FROM public.profiles p
    LEFT JOIN public.user_stats us ON us.user_id = p.id
    WHERE p.id = ${userId}
  `;
  return rows[0] ?? { streak_days: 0, last_activity_date: null, xp: 0, today_xp: 0 };
}

export async function getStudySessions(sql: Sql, userId: string, sinceDay: string) {
  return sql<{ day: string; seconds: number }[]>`
    SELECT day, seconds FROM public.study_sessions
    WHERE user_id = ${userId} AND day >= ${sinceDay}
    ORDER BY day
  `;
}

export async function addStudyTime(sql: Sql, userId: string, seconds: number) {
  await sql`
    INSERT INTO public.study_sessions (user_id, day, seconds)
    VALUES (${userId}, CURRENT_DATE, ${seconds})
    ON CONFLICT (user_id, day) DO UPDATE
      SET seconds = study_sessions.seconds + EXCLUDED.seconds, updated_at = now()
  `;
}

export type StudyReminder = { interval_minutes: number; enabled: boolean };

export async function getStudyReminder(sql: Sql, userId: string): Promise<StudyReminder | null> {
  const rows = await sql<StudyReminder[]>`
    SELECT interval_minutes, enabled FROM public.study_reminders WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function upsertStudyReminder(
  sql: Sql,
  userId: string,
  params: { intervalMinutes: number; enabled: boolean },
) {
  await sql`
    INSERT INTO public.study_reminders (user_id, interval_minutes, enabled)
    VALUES (${userId}, ${params.intervalMinutes}, ${params.enabled})
    ON CONFLICT (user_id) DO UPDATE
      SET interval_minutes = EXCLUDED.interval_minutes, enabled = EXCLUDED.enabled, updated_at = now()
  `;
}

const VIDEO_HISTORY_COLUMNS = `video_id, video_url, title, channel, lesson_id, position_seconds, duration_seconds, completed, last_watched_at`;

export async function listVideoHistory(sql: Sql, userId: string, limit: number) {
  return sql`
    SELECT ${sql.unsafe(VIDEO_HISTORY_COLUMNS)} FROM public.video_history
    WHERE user_id = ${userId} ORDER BY last_watched_at DESC LIMIT ${limit}
  `;
}

export async function getVideoHistoryItem(sql: Sql, userId: string, videoId: string) {
  const rows = await sql`
    SELECT ${sql.unsafe(VIDEO_HISTORY_COLUMNS)} FROM public.video_history
    WHERE user_id = ${userId} AND video_id = ${videoId}
  `;
  return rows[0] ?? null;
}

export async function upsertVideoHistory(
  sql: Sql,
  userId: string,
  videoId: string,
  params: {
    videoUrl: string;
    positionSeconds: number;
    durationSeconds?: number;
    completed?: boolean;
    title?: string;
    channel?: string;
    lessonId?: string;
  },
) {
  await sql`
    INSERT INTO public.video_history (
      user_id, video_id, video_url, title, channel, lesson_id, position_seconds, duration_seconds, completed, last_watched_at
    ) VALUES (
      ${userId}, ${videoId}, ${params.videoUrl}, ${params.title ?? null}, ${params.channel ?? null},
      ${params.lessonId ?? null}, ${params.positionSeconds}, ${params.durationSeconds ?? null}, ${params.completed ?? false}, now()
    )
    ON CONFLICT (user_id, video_id) DO UPDATE SET
      video_url = EXCLUDED.video_url,
      title = COALESCE(EXCLUDED.title, video_history.title),
      channel = COALESCE(EXCLUDED.channel, video_history.channel),
      lesson_id = COALESCE(EXCLUDED.lesson_id, video_history.lesson_id),
      position_seconds = EXCLUDED.position_seconds,
      duration_seconds = COALESCE(EXCLUDED.duration_seconds, video_history.duration_seconds),
      completed = EXCLUDED.completed,
      last_watched_at = now(),
      updated_at = now()
  `;
}
