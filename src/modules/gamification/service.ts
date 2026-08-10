import type { Sql } from "postgres";
import * as repo from "./repository.js";
import type { ACTIVITY_SOURCES } from "./schemas.js";

class NotFoundError extends Error {
  statusCode = 404;
}
class ConflictError extends Error {
  statusCode = 409;
}
class ForbiddenError extends Error {
  statusCode = 403;
}
class BadRequestError extends Error {
  statusCode = 400;
}
class RateLimitedError extends Error {
  statusCode = 429;
}

// Shortest a genuine playthrough could plausibly take (the MC/listening games
// run 5 rounds; speaking/writing take at least this long to record+submit).
// Blocks scripted repeat-fire of POST /v1/xp/events for the same game without
// requiring a full play-session/proof-of-play system.
const GAME_COOLDOWN_SECONDS = 15;

// Mirrors the curated catalog in learningcoach's src/lib/age-tracks.ts — the
// client sends a gameId, the server decides the XP, so a request can't just
// claim an arbitrary amount by editing the source's meta payload.
const GAME_REGISTRY: Record<string, number> = {
  "kids-memory-match": 30,
  "kids-drag-animals": 25,
  "kids-color-word": 20,
  "kids-abc-karaoke": 40,
  "kids-find-picture": 25,
  "kids-fruit-puzzle": 30,
  "teens-lyric-challenge": 60,
  "teens-school-escape": 70,
  "teens-slang-duel": 55,
  "teens-chat-simulator": 45,
  "teens-speed-quiz": 80,
  "teens-caption-reel": 50,
  "adults-interview-simulator": 100,
  "adults-contract-negotiation": 90,
  "adults-60s-pitch": 80,
  "adults-professional-email": 60,
  "adults-global-meeting": 85,
  "adults-ielts-speaking": 95,
};

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
  // Unused — resolveReward() intercepts "game" and looks up GAME_REGISTRY instead,
  // since each game has its own XP value rather than one flat per-source reward.
  game: { xp: 0, coins: 0 },
};

function xpToLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveReward(source: ActivitySource, meta: Record<string, unknown>): { xp: number; coins: number } {
  if (source !== "game") return DEFAULT_REWARDS[source];

  const gameId = typeof meta.gameId === "string" ? meta.gameId : "";
  const xp = GAME_REGISTRY[gameId];
  if (!xp) throw new BadRequestError(`Unknown gameId: ${gameId || "(missing)"}`);
  return { xp, coins: Math.round(xp / 3) };
}

export async function awardActivity(sql: Sql, userId: string, source: ActivitySource, meta: Record<string, unknown>) {
  const reward = resolveReward(source, meta);

  if (source === "game") {
    const gameId = String(meta.gameId);
    if (await repo.hasRecentGameEvent(sql, userId, gameId, GAME_COOLDOWN_SECONDS)) {
      throw new RateLimitedError("You just played this game — wait a bit before playing it again.");
    }
  }

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

// ---------- Period keys (daily/weekly/monthly mission buckets) ----------

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function currentPeriodKeys(): Record<string, string> {
  const now = new Date();
  return {
    daily: now.toISOString().slice(0, 10),
    weekly: isoWeekKey(now),
    monthly: now.toISOString().slice(0, 7),
  };
}

// ---------- Stats ----------

export const getGamificationStats = repo.getGamificationStats;

// ---------- Missions ----------

export const listActiveMissions = repo.listActiveMissions;

export async function listUserMissions(sql: Sql, userId: string) {
  const keys = currentPeriodKeys();
  await repo.ensureUserMissions(sql, userId, keys);
  return repo.listUserMissions(sql, userId, keys);
}

export async function claimMission(sql: Sql, userId: string, missionId: string) {
  const mission = await repo.getMissionById(sql, missionId);
  if (!mission) throw new NotFoundError("Mission not found");

  const keys = currentPeriodKeys();
  const periodKey = keys[mission.scope];
  const userMission = periodKey ? await repo.getUserMission(sql, userId, missionId, periodKey) : null;
  if (!userMission || !userMission.completed_at) throw new ForbiddenError("Mission not completed yet");
  if (userMission.claimed_at) throw new ConflictError("Mission already claimed");

  await repo.claimUserMission(sql, userId, userMission.id, {
    xp: mission.xp_reward,
    coins: mission.coin_reward,
    code: mission.code,
    missionId: mission.id,
  });
  return { xp: mission.xp_reward, coins: mission.coin_reward };
}

// ---------- Shop / Inventory ----------

export const listShopItems = repo.listShopItems;
export const listUserInventory = repo.listUserInventory;

export async function purchaseItem(sql: Sql, userId: string, itemId: string) {
  const item = await repo.getShopItem(sql, itemId);
  if (!item || !item.is_active) throw new NotFoundError("Item not available");
  const stats = await repo.getGamificationStats(sql, userId);
  if (stats.coins < item.cost_coins) throw new ForbiddenError("Insufficient coins");
  await repo.purchaseItem(sql, userId, itemId, item.cost_coins);
  return { remainingCoins: stats.coins - item.cost_coins };
}

export async function setInventoryEquipped(sql: Sql, userId: string, itemId: string, equipped: boolean) {
  const owned = await repo.getInventoryItem(sql, userId, itemId);
  if (!owned) throw new NotFoundError("Item not owned");
  await repo.setInventoryEquipped(sql, userId, itemId, owned.category, equipped);
}

// ---------- Achievements ----------

export const listUserAchievements = repo.listUserAchievements;

// ---------- Leaderboard / rank ----------

export const getLeaderboard = repo.getLeaderboard;

export async function getMyRank(sql: Sql, userId: string) {
  return repo.getMyRank(sql, userId);
}

// ---------- Friendships ----------

export async function addFriendByEmail(sql: Sql, userId: string, email: string) {
  const target = await repo.findAppUserByEmail(sql, email);
  // Same anti-enumeration shape as password reset: don't reveal whether the email exists.
  if (!target || target.id === userId) return;
  await repo.addFriendship(sql, userId, target.id);
}

export const listFriends = repo.listFriends;

// ---------- XP events ----------

export async function getXpEvents(sql: Sql, userId: string, days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return repo.getXpEvents(sql, userId, since.toISOString());
}

// ---------- Game play counts ----------

export const getGamePlays = repo.getGamePlayCounts;
