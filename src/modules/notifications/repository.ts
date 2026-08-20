import type { Sql } from "postgres";
import type { NOTIFICATION_CATEGORIES } from "./schemas.js";

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export async function getUserEmail(sql: Sql, userId: string): Promise<string | null> {
  const [row] = await sql<{ email: string }[]>`SELECT email FROM public.app_users WHERE id = ${userId}`;
  return row?.email ?? null;
}

export async function insertNotification(
  sql: Sql,
  params: { userId: string; category: NotificationCategory; title: string; description?: string; actionUrl?: string },
): Promise<NotificationRow> {
  const [row] = await sql<NotificationRow[]>`
    INSERT INTO public.notifications (user_id, category, title, description, action_url)
    VALUES (${params.userId}, ${params.category}, ${params.title}, ${params.description ?? null}, ${params.actionUrl ?? null})
    RETURNING id, category, title, description, action_url, read_at, created_at
  `;
  return row!;
}

export async function listNotifications(
  sql: Sql,
  userId: string,
  filter: { category?: NotificationCategory; unreadOnly: boolean; limit: number },
): Promise<NotificationRow[]> {
  return sql<NotificationRow[]>`
    SELECT id, category, title, description, action_url, read_at, created_at
    FROM public.notifications
    WHERE user_id = ${userId}
      AND ${filter.category ? sql`category = ${filter.category}` : sql`true`}
      AND ${filter.unreadOnly ? sql`read_at IS NULL` : sql`true`}
    ORDER BY created_at DESC
    LIMIT ${filter.limit}
  `;
}

export async function countUnread(sql: Sql, userId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text FROM public.notifications WHERE user_id = ${userId} AND read_at IS NULL
  `;
  return Number(row?.count ?? 0);
}

/** Returns whether a row was actually flipped (false if already read / not owned). */
export async function markRead(sql: Sql, userId: string, id: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE public.notifications SET read_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND read_at IS NULL
    RETURNING id
  `;
  return Boolean(row);
}

export async function markAllRead(sql: Sql, userId: string): Promise<void> {
  await sql`UPDATE public.notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`;
}
