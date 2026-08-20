import type { Sql } from "postgres";
import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { notifyUser } from "../modules/notifications/service.js";

/**
 * Users whose streak is real (streak >= 1) and who were active yesterday but
 * not yet today — meaning if they don't act today, awardActivity's streak
 * calc resets them to 1 tomorrow. Reads public.profiles directly (not the
 * denormalized user_stats copy) since that's the table awardActivity itself
 * treats as the source of truth for last_active_date.
 *
 * Users holding an unused Streak Freeze are excluded — their streak isn't
 * actually at risk today (see gamification/repository.ts consumeStreakFreeze).
 */
export async function findStreakRiskUsers(sql: Sql): Promise<string[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const rows = await sql<{ id: string }[]>`
    SELECT p.id
    FROM public.profiles p
    WHERE p.streak >= 1
      AND p.last_active_date = ${yesterday}
      AND NOT EXISTS (
        SELECT 1 FROM public.user_inventory ui
        JOIN public.shop_items si ON si.id = ui.item_id
        WHERE ui.user_id = p.id AND si.code = 'streak_freeze'
      )
  `;
  return rows.map((r) => r.id);
}

/** Best-effort per user — one failed notification (e.g. a bad email address)
 * shouldn't stop the rest of the run. */
export async function sendStreakRiskReminders(sql: Sql): Promise<number> {
  const userIds = await findStreakRiskUsers(sql);
  let sent = 0;
  for (const userId of userIds) {
    try {
      await notifyUser(sql, userId, {
        category: "learning",
        title: "A tua sequência está em risco! 🔥",
        description: "Ainda não praticaste hoje — alguns minutos chegam para não perderes a tua sequência.",
        actionUrl: "/dashboard",
      });
      sent++;
    } catch {
      // Swallowed intentionally — notifyUser already reports its own email
      // failures to Sentry; a single bad row here shouldn't abort the loop.
    }
  }
  return sent;
}

/**
 * 19:00 UTC ≈ 20:00 in Angola (UTC+1) — an evening nudge, timed to still
 * leave a couple of hours before the streak actually resets at UTC midnight,
 * rather than a notification that arrives after it's already too late.
 *
 * A single fixed UTC hour for every user is a deliberate simplification —
 * there's no per-user timezone stored anywhere in this codebase today, and
 * the platform's primary audience shares one timezone (Angola, UTC+1).
 */
export function registerStreakReminderJob(sql: Sql, log: FastifyBaseLogger) {
  cron.schedule("0 19 * * *", () => {
    sendStreakRiskReminders(sql)
      .then((sent) => log.info({ sent }, "[streak-reminder] sent"))
      .catch((err) => log.error({ err }, "[streak-reminder] run failed"));
  });
}
