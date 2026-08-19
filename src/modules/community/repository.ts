import type { Sql } from "postgres";

export type Room = "kids" | "teens" | "adults";

function ageToRoom(age: number | null): Room {
  if (age == null) return "adults";
  if (age < 13) return "kids";
  if (age < 18) return "teens";
  return "adults";
}

export async function getRoomAndNameForUser(sql: Sql, userId: string): Promise<{ room: Room; displayName: string }> {
  const rows = await sql<{ age: number | null; full_name: string | null; email: string }[]>`
    SELECT p.age, p.full_name, u.email
    FROM public.app_users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = ${userId}
  `;
  const row = rows[0];
  const displayName = row?.full_name?.trim() || row?.email?.split("@")[0] || "Learner";
  return { room: ageToRoom(row?.age ?? null), displayName };
}

export async function listMessages(sql: Sql, room: Room, blockedUserIds: string[], limit = 200) {
  return sql`
    SELECT id, user_id, display_name, content, kind, created_at
    FROM public.community_messages
    WHERE room = ${room} AND NOT (user_id = ANY(${blockedUserIds}))
    ORDER BY created_at DESC
    LIMIT ${limit}
  `.then((rows) => rows.reverse());
}

export async function insertMessage(
  sql: Sql,
  params: { userId: string; room: Room; displayName: string; content: string; kind: string },
) {
  const [row] = await sql`
    INSERT INTO public.community_messages (user_id, room, display_name, content, kind)
    VALUES (${params.userId}, ${params.room}, ${params.displayName}, ${params.content}, ${params.kind})
    RETURNING id, user_id, display_name, content, kind, created_at
  `;
  return row;
}

// Scoped to messages in the reporter's own room, same boundary
// listMessages/insertMessage enforce — otherwise a guessed message UUID from
// another age room would leak its existence via this endpoint.
export async function messageExistsInRoom(sql: Sql, messageId: string, room: Room): Promise<boolean> {
  const [row] = await sql`SELECT 1 FROM public.community_messages WHERE id = ${messageId} AND room = ${room}`;
  return !!row;
}

// ON CONFLICT DO NOTHING: re-reporting the same message is a silent no-op,
// not an error — the report already exists, which is what the caller wanted.
export async function reportMessage(
  sql: Sql,
  params: { messageId: string; reporterId: string; reason?: string },
) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO public.community_reports (message_id, reporter_id, reason)
    VALUES (${params.messageId}, ${params.reporterId}, ${params.reason ?? null})
    ON CONFLICT (message_id, reporter_id) DO NOTHING
    RETURNING id
  `;
  return row ?? null;
}

export async function blockUser(sql: Sql, blockerId: string, blockedId: string) {
  await sql`
    INSERT INTO public.community_blocks (blocker_id, blocked_id)
    VALUES (${blockerId}, ${blockedId})
    ON CONFLICT DO NOTHING
  `;
}

export async function unblockUser(sql: Sql, blockerId: string, blockedId: string) {
  await sql`
    DELETE FROM public.community_blocks WHERE blocker_id = ${blockerId} AND blocked_id = ${blockedId}
  `;
}

export async function listBlockedUserIds(sql: Sql, blockerId: string): Promise<string[]> {
  const rows = await sql<{ blocked_id: string }[]>`
    SELECT blocked_id FROM public.community_blocks WHERE blocker_id = ${blockerId}
  `;
  return rows.map((r) => r.blocked_id);
}

export async function listBlockedUsers(sql: Sql, blockerId: string) {
  return sql`
    SELECT b.blocked_id AS id, COALESCE(p.full_name, split_part(u.email, '@', 1)) AS display_name
    FROM public.community_blocks b
    JOIN public.app_users u ON u.id = b.blocked_id
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE b.blocker_id = ${blockerId}
    ORDER BY b.created_at DESC
  `;
}
