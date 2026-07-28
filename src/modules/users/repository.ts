import type { Sql } from "postgres";

export type UserListItem = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: Date;
  roles: string[];
};

export async function listUsers(sql: Sql, limit: number, offset: number): Promise<{ items: UserListItem[]; total: number }> {
  const items = await sql<UserListItem[]>`
    SELECT u.id, u.email, p.full_name, u.created_at,
           COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM public.app_users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    GROUP BY u.id, u.email, p.full_name, u.created_at
    ORDER BY u.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [countRow] = await sql<{ count: string }[]>`SELECT count(*)::text FROM public.app_users`;
  return { items, total: Number(countRow!.count) };
}

export async function getUserDetail(sql: Sql, id: string) {
  const rows = await sql<
    { id: string; email: string; full_name: string | null; phone: string | null; country: string | null; created_at: Date; roles: string[] }[]
  >`
    SELECT u.id, u.email, p.full_name, p.phone, p.country, u.created_at,
           COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM public.app_users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    WHERE u.id = ${id}
    GROUP BY u.id, u.email, p.full_name, p.phone, p.country, u.created_at
  `;
  return rows[0] ?? null;
}

export type ProfilePatch = {
  fullName?: string;
  phone?: string;
  country?: string;
  age?: number;
  nativeLanguage?: string;
  learningGoal?: string;
  interests?: string[];
  avatarUrl?: string;
  demoCompleted?: boolean;
  selectedPlan?: string;
  onboardingStatus?: string;
};

const PROFILE_COLUMN_MAP: Record<keyof ProfilePatch, string> = {
  fullName: "full_name",
  phone: "phone",
  country: "country",
  age: "age",
  nativeLanguage: "native_language",
  learningGoal: "learning_goal",
  interests: "interests",
  avatarUrl: "avatar_url",
  demoCompleted: "demo_completed",
  selectedPlan: "selected_plan",
  onboardingStatus: "onboarding_status",
};

export async function updateProfile(sql: Sql, id: string, patch: ProfilePatch) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return;
  await sql`
    UPDATE public.profiles SET ${sql(
      Object.fromEntries(fields.map(([k, v]) => [PROFILE_COLUMN_MAP[k as keyof ProfilePatch], v])),
    )}
    WHERE id = ${id}
  `;
}

export async function replaceRoles(sql: Sql, id: string, roles: string[]) {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM public.user_roles WHERE user_id = ${id}`;
    for (const role of roles) {
      await tx`INSERT INTO public.user_roles (user_id, role) VALUES (${id}, ${role})`;
    }
  });
}

export async function deleteUser(sql: Sql, id: string) {
  await sql`DELETE FROM public.app_users WHERE id = ${id}`;
}
