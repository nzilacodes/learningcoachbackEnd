import { env } from "../config/env.js";

type MailMessage = { to: string; subject: string; text: string; html?: string };

const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

async function sendViaSmtp(message: MailMessage): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

/**
 * Sends mail via SMTP if configured, otherwise logs it to the console — good
 * enough for local development, and means the app never fails to boot or
 * fails a request just because no mail provider is set up yet.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (smtpConfigured) {
    await sendViaSmtp(message);
    return;
  }
  console.log(`[mailer] SMTP not configured — logging email instead:\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
}
