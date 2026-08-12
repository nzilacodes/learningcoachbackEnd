import type { Sql } from "postgres";
import type { CefrLevel } from "../../lib/cefr.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { ForbiddenError } from "../../lib/errors.js";
import * as repo from "./repository.js";

/**
 * Certificate eligibility is derived exclusively from a passed level_exam_attempts
 * row for the exact requested level. That table is written only by the exams
 * module after server-side grading (see modules/exams), so by the time a
 * certificate is requested it's a trustworthy signal — unlike the old
 * issue_certificate RPC, which took `level`/`score` straight from the caller.
 */
export async function issueCertificate(
  sql: Sql,
  userId: string,
  input: { level: CefrLevel; courseId?: string; courseTitle?: string },
) {
  const existing = await repo.findExistingCertificate(sql, userId, input.level);
  if (existing) return existing;

  // Certificates are a paid-plan feature (see pricing copy) — checked after
  // the "already issued" short-circuit so a lapsed subscription never
  // invalidates a certificate the user already earned.
  if (!(await hasActiveSubscription(sql, userId))) {
    throw new PaymentRequiredError("Certificates require an active subscription. Upgrade to issue one.");
  }

  const passedAttempt = await repo.findPassedExamAttempt(sql, userId, input.level);
  if (!passedAttempt) {
    throw new ForbiddenError(`No passed exam on record for level ${input.level}`);
  }

  const fullName = await repo.getProfileName(sql, userId);
  return repo.insertCertificate(sql, {
    userId,
    level: input.level,
    score: passedAttempt.score,
    courseId: input.courseId,
    courseTitle: input.courseTitle,
    fullName,
  });
}

export async function listMyCertificates(sql: Sql, userId: string) {
  return repo.listCertificatesForUser(sql, userId);
}

export async function verifyCertificate(sql: Sql, code: string) {
  return repo.findCertificateByCode(sql, code);
}
