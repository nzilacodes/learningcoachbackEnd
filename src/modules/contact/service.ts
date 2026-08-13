import type { Sql } from "postgres";
import * as Sentry from "@sentry/node";
import { env } from "../../config/env.js";
import { sendMail } from "../../lib/mailer.js";
import * as repo from "./repository.js";

export async function submitContactMessage(
  sql: Sql,
  input: { name: string; email: string; subject?: string; message: string },
) {
  await repo.insertContactMessage(sql, input);
  try {
    await sendMail({
      to: env.OWNER_EMAIL,
      subject: `[Contacto] ${input.subject || `Mensagem de ${input.name}`}`,
      text: `${input.message}\n\n— ${input.name} (${input.email})`,
    });
  } catch (err) {
    // The message is already saved — a transient SMTP failure shouldn't turn
    // a successful submission into a 500 (and a likely duplicate resubmit).
    // Still worth reporting to Sentry: it's swallowed here on purpose, so
    // this is the only place it would otherwise ever surface.
    console.error("[contact] failed to send notification email", err);
    Sentry.captureException(err);
  }
}
