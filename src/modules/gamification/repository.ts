import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileGameState = {
  xp: number;
  level: number;
  streak: number;
  coins: number;
  last_active_date: string | null;
};

export async function getProfileGameState(db: SupabaseClient, userId: string): Promise<ProfileGameState> {
  const { data, error } = await db
    .from("profiles")
    .select("xp, level, streak, coins, last_active_date")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    xp: data?.xp ?? 0,
    level: data?.level ?? 1,
    streak: data?.streak ?? 0,
    coins: data?.coins ?? 0,
    last_active_date: data?.last_active_date ?? null,
  };
}

export async function updateProfileGameState(
  db: SupabaseClient,
  userId: string,
  patch: { xp: number; level: number; streak: number; coins: number; last_active_date: string },
) {
  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

export async function upsertUserStats(
  db: SupabaseClient,
  params: { userId: string; xp: number; streakDays: number; lastActivityDate: string },
) {
  const { error } = await db.from("user_stats").upsert(
    {
      user_id: params.userId,
      xp: params.xp,
      streak_days: params.streakDays,
      last_activity_date: params.lastActivityDate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function insertXpEvent(
  db: SupabaseClient,
  params: { userId: string; source: string; amount: number; coins: number; meta: Record<string, unknown> },
) {
  const { error } = await db.from("xp_events").insert({
    user_id: params.userId,
    source: params.source,
    amount: params.amount,
    coins: params.coins,
    meta: params.meta,
  });
  if (error) throw error;
}

export async function bumpMissionProgress(db: SupabaseClient, userId: string, actionType: string) {
  const { data: missions, error: mErr } = await db
    .from("missions")
    .select("id, target")
    .eq("action_type", actionType);
  if (mErr) throw mErr;
  if (!missions || missions.length === 0) return;

  for (const mission of missions) {
    const { data: um, error: umErr } = await db
      .from("user_missions")
      .select("id, progress, completed_at")
      .eq("user_id", userId)
      .eq("mission_id", mission.id)
      .is("completed_at", null)
      .maybeSingle();
    if (umErr) throw umErr;
    if (!um) continue;

    const nextProgress = Math.min(mission.target, um.progress + 1);
    const { error: updErr } = await db
      .from("user_missions")
      .update({
        progress: nextProgress,
        completed_at: nextProgress >= mission.target ? new Date().toISOString() : null,
      })
      .eq("id", um.id);
    if (updErr) throw updErr;
  }
}
