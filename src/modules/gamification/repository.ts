import type { Sql, TransactionSql } from "postgres";

// Accepts either the top-level connection or a sql.begin() transaction handle —
// awardActivity() runs its whole read-check-write sequence inside a transaction.
type SqlClient = Sql | TransactionSql;

export type ProfileGameState = {
  xp: number;
  level: number;
  streak: number;
  coins: number;
  last_active_date: string | null;
};

export async function hasRecentGameEvent(sql: SqlClient, userId: string, gameId: string, cooldownSeconds: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM public.xp_events
    WHERE user_id = ${userId} AND source = 'game' AND meta->>'gameId' = ${gameId}
      AND created_at >= now() - make_interval(secs => ${cooldownSeconds})
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getProfileGameState(sql: SqlClient, userId: string): Promise<ProfileGameState> {
  const rows = await sql<ProfileGameState[]>`
    SELECT xp, level, streak, coins, last_active_date::text FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0] ?? { xp: 0, level: 1, streak: 0, coins: 0, last_active_date: null };
}

export async function updateProfileGameState(
  sql: SqlClient,
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
  sql: SqlClient,
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
  sql: SqlClient,
  params: { userId: string; source: string; amount: number; coins: number; meta: Record<string, unknown> },
) {
  await sql`
    INSERT INTO public.xp_events (user_id, source, amount, coins, meta)
    VALUES (${params.userId}, ${params.source}, ${params.amount}, ${params.coins}, ${JSON.stringify(params.meta)}::jsonb)
  `;
}

// ---------- Stats ----------

export type GamificationStats = {
  xp: number;
  level: number;
  coins: number;
  streak: number;
  avatar_url: string | null;
  avatar_config: Record<string, unknown>;
};

export async function getGamificationStats(sql: Sql, userId: string): Promise<GamificationStats> {
  const rows = await sql<GamificationStats[]>`
    SELECT xp, level, coins, streak, avatar_url, avatar_config FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0] ?? { xp: 0, level: 1, coins: 0, streak: 0, avatar_url: null, avatar_config: {} };
}

// ---------- Missions ----------

export async function listActiveMissions(sql: Sql) {
  return sql`SELECT * FROM public.missions WHERE is_active = true ORDER BY scope, created_at`;
}

export async function ensureUserMissions(sql: Sql, userId: string, periodKeys: Record<string, string>) {
  const missions = await sql<{ id: string; scope: string }[]>`SELECT id, scope FROM public.missions WHERE is_active = true`;
  const rows = missions
    .map((m) => ({ user_id: userId, mission_id: m.id, period_key: periodKeys[m.scope] }))
    .filter((r): r is { user_id: string; mission_id: string; period_key: string } => Boolean(r.period_key));
  if (rows.length === 0) return;
  await sql`
    INSERT INTO public.user_missions ${sql(rows, "user_id", "mission_id", "period_key")}
    ON CONFLICT DO NOTHING
  `;
}

export async function listUserMissions(sql: Sql, userId: string, periodKeys: Record<string, string>) {
  const keys = Object.values(periodKeys);
  return sql`
    SELECT m.id, m.code, m.scope, m.title, m.description, m.action_type, m.target, m.xp_reward, m.coin_reward, m.icon,
           um.progress, um.completed_at, um.claimed_at, um.period_key
    FROM public.missions m
    JOIN public.user_missions um ON um.mission_id = m.id AND um.user_id = ${userId}
    WHERE m.is_active = true AND um.period_key = ANY(${keys})
    ORDER BY m.scope, m.created_at
  `;
}

export async function getMissionById(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.missions WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function getUserMission(sql: Sql, userId: string, missionId: string, periodKey: string) {
  const rows = await sql<{ id: string; progress: number; completed_at: Date | null; claimed_at: Date | null }[]>`
    SELECT id, progress, completed_at, claimed_at FROM public.user_missions
    WHERE user_id = ${userId} AND mission_id = ${missionId} AND period_key = ${periodKey}
  `;
  return rows[0] ?? null;
}

export async function claimUserMission(
  sql: Sql,
  userId: string,
  userMissionId: string,
  reward: { xp: number; coins: number; code: string; missionId: string },
) {
  await sql.begin(async (tx) => {
    await tx`UPDATE public.user_missions SET claimed_at = now() WHERE id = ${userMissionId}`;
    const [profile] = await tx<{ xp: number }[]>`SELECT xp FROM public.profiles WHERE id = ${userId}`;
    const newXp = (profile?.xp ?? 0) + reward.xp;
    await tx`
      UPDATE public.profiles SET xp = ${newXp}, coins = coins + ${reward.coins}, level = ${xpToLevelSql(newXp)}
      WHERE id = ${userId}
    `;
    await tx`
      INSERT INTO public.xp_events (user_id, source, amount, coins, meta)
      VALUES (${userId}, ${"mission:" + reward.code}, ${reward.xp}, ${reward.coins}, ${sql.json({ mission_id: reward.missionId })})
    `;
  });
}

function xpToLevelSql(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1);
}

// ---------- Shop / Inventory ----------

export async function listShopItems(sql: Sql) {
  return sql`SELECT * FROM public.shop_items WHERE is_active = true ORDER BY category, cost_coins`;
}

export async function getShopItem(sql: Sql, id: string) {
  const rows = await sql<{ id: string; category: string; cost_coins: number; is_active: boolean }[]>`
    SELECT id, category, cost_coins, is_active FROM public.shop_items WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function listUserInventory(sql: Sql, userId: string) {
  return sql`
    SELECT ui.item_id, ui.equipped, ui.acquired_at, to_jsonb(si.*) AS shop_items
    FROM public.user_inventory ui
    JOIN public.shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ${userId}
    ORDER BY ui.acquired_at DESC
  `;
}

export async function purchaseItem(sql: Sql, userId: string, itemId: string, cost: number) {
  await sql.begin(async (tx) => {
    await tx`UPDATE public.profiles SET coins = coins - ${cost} WHERE id = ${userId}`;
    await tx`
      INSERT INTO public.user_inventory (user_id, item_id) VALUES (${userId}, ${itemId})
      ON CONFLICT DO NOTHING
    `;
  });
}

export async function getInventoryItem(sql: Sql, userId: string, itemId: string) {
  const rows = await sql`SELECT ui.*, si.category FROM public.user_inventory ui JOIN public.shop_items si ON si.id = ui.item_id WHERE ui.user_id = ${userId} AND ui.item_id = ${itemId}`;
  return rows[0] ?? null;
}

export async function setInventoryEquipped(sql: Sql, userId: string, itemId: string, category: string, equipped: boolean) {
  await sql.begin(async (tx) => {
    if (equipped) {
      await tx`
        UPDATE public.user_inventory ui SET equipped = false
        FROM public.shop_items si
        WHERE ui.item_id = si.id AND ui.user_id = ${userId} AND si.category = ${category}
      `;
    }
    await tx`UPDATE public.user_inventory SET equipped = ${equipped} WHERE user_id = ${userId} AND item_id = ${itemId}`;
  });
}

// ---------- Achievements ----------

export async function listUserAchievements(sql: Sql, userId: string) {
  return sql`
    SELECT ua.earned_at, to_jsonb(a.*) AS achievements
    FROM public.user_achievements ua
    JOIN public.achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id = ${userId}
    ORDER BY ua.earned_at DESC
  `;
}

// ---------- Leaderboard / rank ----------

export async function getLeaderboard(sql: Sql, limit: number, country?: string) {
  return sql`
    SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(us.xp, 0) DESC, p.created_at ASC) AS rank,
      p.id AS user_id,
      COALESCE(NULLIF(TRIM(split_part(p.full_name,' ',1)),''), 'Aluno') ||
        CASE WHEN position(' ' in COALESCE(p.full_name,'')) > 0
             THEN ' ' || LEFT(split_part(p.full_name,' ',2), 1) || '.'
             ELSE '' END AS display_name,
      COALESCE(us.xp, 0) AS xp,
      COALESCE(us.streak_days, 0) AS streak,
      p.cefr_level
    FROM public.profiles p
    LEFT JOIN public.user_stats us ON us.user_id = p.id
    WHERE ${country ? sql`p.country = ${country}` : sql`true`}
    ORDER BY xp DESC, p.created_at ASC
    LIMIT ${limit}
  `;
}

export async function getMyRank(sql: Sql, userId: string) {
  const rows = await sql<{ rank: string; total: string; xp: number }[]>`
    WITH ranked AS (
      SELECT p.id,
             COALESCE(us.xp, 0) AS xp,
             ROW_NUMBER() OVER (ORDER BY COALESCE(us.xp,0) DESC, p.created_at ASC) AS rn,
             COUNT(*) OVER () AS total
      FROM public.profiles p
      LEFT JOIN public.user_stats us ON us.user_id = p.id
    )
    SELECT rn::text AS rank, total::text AS total, xp FROM ranked WHERE id = ${userId}
  `;
  const row = rows[0];
  return row ? { rank: Number(row.rank), total: Number(row.total), xp: row.xp } : null;
}

// ---------- Friendships ----------

export async function findAppUserByEmail(sql: Sql, email: string) {
  const rows = await sql<{ id: string }[]>`SELECT id FROM public.app_users WHERE lower(email) = ${email.toLowerCase()}`;
  return rows[0] ?? null;
}

export async function addFriendship(sql: Sql, userId: string, friendId: string) {
  await sql`
    INSERT INTO public.friendships (user_id, friend_id) VALUES (${userId}, ${friendId})
    ON CONFLICT DO NOTHING
  `;
}

export async function listFriends(sql: Sql, userId: string) {
  return sql`
    SELECT p.id, p.full_name, p.avatar_url, p.xp, p.level, p.country
    FROM public.friendships f
    JOIN public.profiles p ON p.id = (CASE WHEN f.user_id = ${userId} THEN f.friend_id ELSE f.user_id END)
    WHERE (f.user_id = ${userId} OR f.friend_id = ${userId}) AND f.status = 'accepted'
    ORDER BY p.xp DESC
  `;
}

// ---------- XP events ----------

export async function getXpEvents(sql: Sql, userId: string, sinceDate: string) {
  return sql`
    SELECT source, amount, coins, created_at FROM public.xp_events
    WHERE user_id = ${userId} AND created_at >= ${sinceDate}
    ORDER BY created_at DESC
  `;
}

/**
 * Global play counts per gameId over the last 7 days, across all users —
 * powers the real "most played this week" figure on /games.
 */
export async function getGamePlayCounts(sql: Sql): Promise<Record<string, number>> {
  const rows = await sql<{ game_id: string; plays: number }[]>`
    SELECT meta->>'gameId' AS game_id, count(*)::int AS plays
    FROM public.xp_events
    WHERE source = 'game' AND meta->>'gameId' IS NOT NULL AND created_at >= now() - interval '7 days'
    GROUP BY meta->>'gameId'
  `;
  return Object.fromEntries(rows.map((r) => [r.game_id, r.plays]));
}

export async function bumpMissionProgress(sql: SqlClient, userId: string, actionType: string) {
  // Single set-based UPDATE instead of a per-mission SELECT+UPDATE loop —
  // this runs on every XP-earning action, inside the awardActivity transaction.
  await sql`
    UPDATE public.user_missions um
    SET progress = LEAST(m.target, um.progress + 1),
        completed_at = CASE WHEN LEAST(m.target, um.progress + 1) >= m.target THEN now() ELSE um.completed_at END
    FROM public.missions m
    WHERE um.mission_id = m.id
      AND um.user_id = ${userId}
      AND m.action_type = ${actionType}
      AND um.completed_at IS NULL
  `;
}
