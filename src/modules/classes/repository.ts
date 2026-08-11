import type { Sql } from "postgres";

export async function createClass(sql: Sql, ownerId: string, name: string, inviteCode: string) {
  const [row] = await sql`
    INSERT INTO public.classes (owner_id, name, invite_code)
    VALUES (${ownerId}, ${name}, ${inviteCode})
    RETURNING id, owner_id, name, invite_code, created_at
  `;
  return row;
}

export async function listOwnedClasses(sql: Sql, ownerId: string) {
  return sql`
    SELECT c.id, c.name, c.invite_code, c.created_at,
           (SELECT count(*)::int FROM public.class_members m WHERE m.class_id = c.id) AS member_count
    FROM public.classes c
    WHERE c.owner_id = ${ownerId}
    ORDER BY c.created_at DESC
  `;
}

export async function listJoinedClasses(sql: Sql, studentId: string) {
  return sql`
    SELECT c.id, c.name, c.created_at, c.owner_id,
           COALESCE(p.full_name, 'Coach') AS owner_name
    FROM public.class_members m
    JOIN public.classes c ON c.id = m.class_id
    LEFT JOIN public.profiles p ON p.id = c.owner_id
    WHERE m.student_id = ${studentId}
    ORDER BY c.created_at DESC
  `;
}

export async function getClassById(sql: Sql, id: string) {
  const rows = await sql`SELECT * FROM public.classes WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function getClassByInviteCode(sql: Sql, inviteCode: string) {
  const rows = await sql`SELECT * FROM public.classes WHERE invite_code = ${inviteCode}`;
  return rows[0] ?? null;
}

export async function addMember(sql: Sql, classId: string, studentId: string) {
  await sql`
    INSERT INTO public.class_members (class_id, student_id)
    VALUES (${classId}, ${studentId})
    ON CONFLICT (class_id, student_id) DO NOTHING
  `;
}

export async function removeMember(sql: Sql, classId: string, studentId: string) {
  await sql`DELETE FROM public.class_members WHERE class_id = ${classId} AND student_id = ${studentId}`;
}

export async function deleteClass(sql: Sql, id: string) {
  await sql`DELETE FROM public.classes WHERE id = ${id}`;
}

export async function getRoster(sql: Sql, classId: string) {
  return sql`
    SELECT
      m.student_id,
      p.full_name,
      p.age,
      p.cefr_level,
      COALESCE(us.xp, 0) AS xp,
      COALESCE(us.streak_days, 0) AS streak_days,
      us.last_activity_date,
      (
        SELECT count(*)::int FROM public.lesson_progress lp
        WHERE lp.user_id = m.student_id AND lp.completed_at IS NOT NULL
      ) AS completed_lessons,
      m.created_at AS joined_at
    FROM public.class_members m
    LEFT JOIN public.profiles p ON p.id = m.student_id
    LEFT JOIN public.user_stats us ON us.user_id = m.student_id
    WHERE m.class_id = ${classId}
    ORDER BY p.full_name
  `;
}
