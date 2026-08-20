import type { Sql } from "postgres";
import * as Sentry from "@sentry/node";
import { env } from "../../config/env.js";
import { sendMail } from "../../lib/mailer.js";
import * as repo from "./repository.js";
import type { NotificationCategory } from "./repository.js";

/**
 * Fire-and-forget-friendly: callers (e.g. modules/diagnostic/service.ts) can
 * await this or not — a failure to persist a notification should never fail
 * the operation it's reporting on. See routes.ts for the read-side API.
 *
 * Also mails the notification, same "in-app is the source of truth, email is
 * a best-effort courtesy copy" idea as password-reset — the email send is
 * intentionally not awaited so a slow/failing SMTP provider can't add
 * latency to (or fail) whatever operation triggered the notification.
 */
export async function notifyUser(
  sql: Sql,
  userId: string,
  input: { category: NotificationCategory; title: string; description?: string; actionUrl?: string },
) {
  const notification = await repo.insertNotification(sql, { userId, ...input });
  void emailNotification(sql, userId, input).catch((err) => {
    console.error("[notifications] failed to send notification email", err);
    Sentry.captureException(err);
  });
  return notification;
}

async function emailNotification(
  sql: Sql,
  userId: string,
  input: { title: string; description?: string; actionUrl?: string },
) {
  const email = await repo.getUserEmail(sql, userId);
  if (!email) return;
  const base = env.CORS_ALLOWED_ORIGINS[0] ?? "";
  const link = input.actionUrl ? `${base}${input.actionUrl}` : null;
  await sendMail({
    to: email,
    subject: input.title,
    text: [input.description, link].filter(Boolean).join("\n\n"),
  });
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
