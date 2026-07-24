import type { Sql } from "postgres";

export type ProfileGameState = {
  xp: number;
  level: number;
  streak: number;
  coins: number;
  last_active_date: string | null;
};

export async function getProfileGameState(sql: Sql, userId: string): Promise<ProfileGameState> {
  const rows = await sql<ProfileGameState[]>`
    SELECT xp, level, streak, coins, last_active_date::text FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0] ?? { xp: 0, level: 1, streak: 0, coins: 0, last_active_date: null };
}

export async function updateProfileGameState(
  sql: Sql,
  userId: string,
  patch: { xp: number; level: number; streak: number; coins: number; last_active_date: string },
) {
  await sql`
    UPDATE public.profiles
    SET xp = ${patch.xp}, level = ${patch.level}, streak = ${patch.streak}, coins = ${patch.coins}, last_active_date = ${patch.last_active_date}
    WHERE id = ${userId}
  `;
}

export async function upsertUserStats(
  sql: Sql,
  params: { userId: string; xp: number; streakDays: number; lastActivityDate: string },
) {
  await sql`
    INSERT INTO public.user_stats (user_id, xp, streak_days, last_activity_date, updated_at)
    VALUES (${params.userId}, ${params.xp}, ${params.streakDays}, ${params.lastActivityDate}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      xp = EXCLUDED.xp, streak_days = EXCLUDED.streak_days,
      last_activity_date = EXCLUDED.last_activity_date, updated_at = now()
  `;
}

export async function insertXpEvent(
  sql: Sql,
  params: { userId: string; source: string; amount: number; coins: number; meta: Record<string, unknown> },
) {
  await sql`
    INSERT INTO public.xp_events (user_id, source, amount, coins, meta)
    VALUES (${params.userId}, ${params.source}, ${params.amount}, ${params.coins}, ${JSON.stringify(params.meta)}::jsonb)
  `;
}

export async function bumpMissionProgress(sql: Sql, userId: string, actionType: string) {
  const missions = await sql<{ id: string; target: number }[]>`
    SELECT id, target FROM public.missions WHERE action_type = ${actionType}
  `;
  if (missions.length === 0) return;

  for (const mission of missions) {
    const rows = await sql<{ id: string; progress: number }[]>`
      SELECT id, progress FROM public.user_missions
      WHERE user_id = ${userId} AND mission_id = ${mission.id} AND completed_at IS NULL
    `;
    const um = rows[0];
    if (!um) continue;

    const nextProgress = Math.min(mission.target, um.progress + 1);
    await sql`
      UPDATE public.user_missions
      SET progress = ${nextProgress},
          completed_at = ${nextProgress >= mission.target ? new Date() : null}
      WHERE id = ${um.id}
    `;
  }
}
