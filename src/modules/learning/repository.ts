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

export type StudyStats = { streak_days: number; last_activity_date: string | null };

export async function getStudyStats(sql: Sql, userId: string): Promise<StudyStats> {
  const rows = await sql<StudyStats[]>`
    SELECT streak_days, last_activity_date FROM public.user_stats WHERE user_id = ${userId}
  `;
  return rows[0] ?? { streak_days: 0, last_activity_date: null };
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
