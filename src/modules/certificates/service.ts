import type { SupabaseClient } from "@supabase/supabase-js";
import type { CefrLevel } from "../../lib/cefr.js";
import * as repo from "./repository.js";

class NotEligibleError extends Error {
  statusCode = 403;
}

/**
 * Certificate eligibility is derived exclusively from a passed level_exam_attempts
 * row for the exact requested level. That table is written only by the exams
 * module after server-side grading (see modules/exams), so by the time a
 * certificate is requested it's a trustworthy signal — unlike the old
 * issue_certificate RPC, which took `level`/`score` straight from the caller.
 */
export async function issueCertificate(
  db: SupabaseClient,
  userId: string,
  input: { level: CefrLevel; courseId?: string; courseTitle?: string },
) {
  const existing = await repo.findExistingCertificate(db, userId, input.level);
  if (existing) return existing;

  const passedAttempt = await repo.findPassedExamAttempt(db, userId, input.level);
  if (!passedAttempt) {
    throw new NotEligibleError(`No passed exam on record for level ${input.level}`);
  }

  const fullName = await repo.getProfileName(db, userId);
  return repo.insertCertificate(db, {
    userId,
    level: input.level,
    score: passedAttempt.score,
    courseId: input.courseId,
    courseTitle: input.courseTitle,
    fullName,
  });
}

export async function listMyCertificates(db: SupabaseClient, userId: string) {
  return repo.listCertificatesForUser(db, userId);
}

export async function verifyCertificate(db: SupabaseClient, code: string) {
  return repo.findCertificateByCode(db, code);
}
