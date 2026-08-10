import type { Sql } from "postgres";
import { env } from "../../config/env.js";
import { sendMail } from "../../lib/mailer.js";
import * as repo from "./repository.js";

export async function submitContactMessage(
  sql: Sql,
  input: { name: string; email: string; subject?: string; message: string },
) {
  await repo.insertContactMessage(sql, input);
  await sendMail({
    to: env.OWNER_EMAIL,
    subject: `[Contacto] ${input.subject || `Mensagem de ${input.name}`}`,
    text: `${input.message}\n\n— ${input.name} (${input.email})`,
  });
}
