import type { Sql } from "postgres";

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
};

export async function updateLesson(sql: Sql, id: string, patch: LessonPatch) {
  const [row] = await sql`
    UPDATE public.lessons SET
      title = COALESCE(${patch.title ?? null}, title),
      summary = COALESCE(${patch.summary ?? null}, summary),
      content = COALESCE(${patch.content !== undefined ? sql.json(patch.content as any) : null}, content),
      duration_min = COALESCE(${patch.durationMin ?? null}, duration_min),
      xp_reward = COALESCE(${patch.xpReward ?? null}, xp_reward),
      is_published = COALESCE(${patch.isPublished ?? null}, is_published)
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

// Unlike level-exam questions, lesson quiz answers aren't withheld — these are
// low-stakes practice checks (a few XP, no progression gate), not the graded
// assessments that unlock the next CEFR level.
export async function listExercisesForLesson(sql: Sql, lessonId: string) {
  return sql`
    SELECT id, type, prompt, data, correct_answer, xp_reward, order_index
    FROM public.exercises WHERE lesson_id = ${lessonId} ORDER BY order_index
  `;
}

export async function listExercisesForLessonAdmin(sql: Sql, lessonId: string) {
  return sql`SELECT * FROM public.exercises WHERE lesson_id = ${lessonId} ORDER BY order_index`;
}

export type ExerciseInput = {
  type: string;
  prompt: string;
  data?: unknown;
  correctAnswer?: unknown;
  xpReward: number;
  orderIndex: number;
};

export async function createExercise(sql: Sql, lessonId: string, input: ExerciseInput) {
  const [row] = await sql`
    INSERT INTO public.exercises (lesson_id, type, prompt, data, correct_answer, xp_reward, order_index)
    VALUES (
      ${lessonId}, ${input.type}, ${input.prompt},
      ${input.data !== undefined ? sql.json(input.data as any) : null},
      ${input.correctAnswer !== undefined ? sql.json(input.correctAnswer as any) : null},
      ${input.xpReward}, ${input.orderIndex}
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
      data = COALESCE(${patch.data !== undefined ? sql.json(patch.data as any) : null}, data),
      correct_answer = COALESCE(${patch.correctAnswer !== undefined ? sql.json(patch.correctAnswer as any) : null}, correct_answer),
      xp_reward = COALESCE(${patch.xpReward ?? null}, xp_reward),
      order_index = COALESCE(${patch.orderIndex ?? null}, order_index)
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export async function deleteExercise(sql: Sql, id: string) {
  await sql`DELETE FROM public.exercises WHERE id = ${id}`;
}

export async function getLessonProgressRow(sql: Sql, userId: string, unitId: string, lessonId: string) {
  const rows = await sql<{ completed_at: string | null }[]>`
    SELECT completed_at FROM public.lesson_progress
    WHERE user_id = ${userId} AND unit_id = ${unitId} AND lesson_id = ${lessonId}
  `;
  return rows[0] ?? null;
}

export async function completeLessonProgress(sql: Sql, userId: string, unitId: string, lessonId: string) {
  await sql`
    INSERT INTO public.lesson_progress (user_id, unit_id, lesson_id, progress_pct, completed_at)
    VALUES (${userId}, ${unitId}, ${lessonId}, 100, now())
    ON CONFLICT (user_id, unit_id, lesson_id) DO UPDATE SET
      progress_pct = 100, completed_at = COALESCE(lesson_progress.completed_at, now()), updated_at = now()
  `;
}

export type StudyStats = { streak_days: number; last_activity_date: string | null; xp: number };

export async function getStudyStats(sql: Sql, userId: string): Promise<StudyStats> {
  const rows = await sql<StudyStats[]>`
    SELECT COALESCE(us.streak_days, 0) AS streak_days, us.last_activity_date, COALESCE(p.xp, 0) AS xp
    FROM public.profiles p
    LEFT JOIN public.user_stats us ON us.user_id = p.id
    WHERE p.id = ${userId}
  `;
  return rows[0] ?? { streak_days: 0, last_activity_date: null, xp: 0 };
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
