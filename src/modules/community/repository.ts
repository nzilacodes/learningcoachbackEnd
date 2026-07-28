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

export async function listMessages(sql: Sql, room: Room, limit = 200) {
  return sql`
    SELECT id, user_id, display_name, content, kind, created_at
    FROM public.community_messages
    WHERE room = ${room}
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
