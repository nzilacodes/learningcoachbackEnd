import type { Sql } from "postgres";
import * as repo from "./repository.js";
import type { ACTIVITY_SOURCES } from "./schemas.js";

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

// Ported verbatim from learningcoach's src/lib/gamification.ts:22-30 — this was
// already the intended reward table; the old flow just let the client override
// it via `overrides.xp/coins` straight into the award_activity RPC. Here it's
// the only source, full stop.
const DEFAULT_REWARDS: Record<ActivitySource, { xp: number; coins: number }> = {
  watch_video: { xp: 20, coins: 5 },
  lesson_complete: { xp: 50, coins: 20 },
  exercise: { xp: 15, coins: 5 },
  reading: { xp: 40, coins: 15 },
  speaking: { xp: 30, coins: 10 },
  listening: { xp: 25, coins: 8 },
  daily_study: { xp: 10, coins: 5 },
  // Flat reward for completing the placement diagnostic, ported from the old
  // useAwardXp(150) call in learningcoach's placement.tsx.
  diagnostic_complete: { xp: 150, coins: 0 },
};

function xpToLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function awardActivity(sql: Sql, userId: string, source: ActivitySource, meta: Record<string, unknown>) {
  const reward = DEFAULT_REWARDS[source];
  const state = await repo.getProfileGameState(sql, userId);

  const today = todayUtc();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let streak: number;
  if (!state.last_active_date || state.last_active_date < yesterday) {
    streak = 1;
  } else if (state.last_active_date === yesterday) {
    streak = state.streak + 1;
  } else {
    streak = Math.max(state.streak, 1);
  }

  const newXp = state.xp + reward.xp;
  const newLevel = xpToLevel(newXp);
  const newCoins = state.coins + reward.coins;

  await repo.insertXpEvent(sql, { userId, source, amount: reward.xp, coins: reward.coins, meta });
  await repo.updateProfileGameState(sql, userId, { xp: newXp, level: newLevel, streak, coins: newCoins, last_active_date: today });
  await repo.upsertUserStats(sql, { userId, xp: newXp, streakDays: streak, lastActivityDate: today });
  await repo.bumpMissionProgress(sql, userId, source);

  return {
    xp: newXp,
    gained: reward.xp,
    level: newLevel,
    level_up: newLevel > state.level,
    streak,
    coins_gained: reward.coins,
  };
}
