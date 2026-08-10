import type { Sql } from "postgres";

export async function insertContactMessage(
  sql: Sql,
  input: { name: string; email: string; subject?: string; message: string },
) {
  await sql`
    INSERT INTO public.contact_messages (name, email, subject, message)
    VALUES (${input.name}, ${input.email}, ${input.subject ?? null}, ${input.message})
  `;
}
