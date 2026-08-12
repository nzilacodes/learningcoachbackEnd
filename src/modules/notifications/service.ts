import type { Sql } from "postgres";
import * as repo from "./repository.js";
import type { NotificationCategory } from "./repository.js";

/**
 * Fire-and-forget-friendly: callers (e.g. modules/diagnostic/service.ts) can
 * await this or not — a failure to persist a notification should never fail
 * the operation it's reporting on. See routes.ts for the read-side API.
 */
export async function notifyUser(
  sql: Sql,
  userId: string,
  input: { category: NotificationCategory; title: string; description?: string; actionUrl?: string },
) {
  return repo.insertNotification(sql, { userId, ...input });
}

export async function listMyNotifications(
  sql: Sql,
  userId: string,
  filter: { category?: NotificationCategory; unreadOnly: boolean; limit: number },
) {
  const [items, unreadCount] = await Promise.all([
    repo.listNotifications(sql, userId, filter),
    repo.countUnread(sql, userId),
  ]);
  return { items, unreadCount };
}

export async function markNotificationRead(sql: Sql, userId: string, id: string) {
  await repo.markRead(sql, userId, id);
}

export async function markAllNotificationsRead(sql: Sql, userId: string) {
  await repo.markAllRead(sql, userId);
}
