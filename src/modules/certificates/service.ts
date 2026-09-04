import type { Sql } from "postgres";
import type { CefrLevel } from "../../lib/cefr.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit.js";
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
  const inserted = await repo.insertCertificate(sql, {
    userId,
    level: input.level,
    score: passedAttempt.score,
    courseId: input.courseId,
    courseTitle: input.courseTitle,
    fullName,
  });
  // A concurrent duplicate request (e.g. a double-click) won the race between
  // the findExistingCertificate check above and this insert — read back the
  // certificate it just issued instead of treating this as a failure.
  return inserted ?? (await repo.findExistingCertificate(sql, userId, input.level));
}

/**
 * Admin-initiated issuance (the Currículo/Certificados admin panel's "Emitir
 * certificado" dialog) — bypasses the subscription gate self-issue enforces
 * (an admin deliberately crediting a learner shouldn't be blocked by billing
 * state) but still needs a score from somewhere: either supplied directly by
 * the admin, or read off the learner's own passed exam attempt for that
 * level, same as self-issue. Idempotent on (user_id, level) exactly like
 * issueCertificate above — re-running this for a learner who already has the
 * certificate just returns the existing row instead of erroring.
 */
export async function issueCertificateAdmin(
  sql: Sql,
  adminUserId: string,
  input: { userId: string; level: CefrLevel; score?: number; courseId?: string; courseTitle?: string },
) {
  const existing = await repo.findExistingCertificate(sql, input.userId, input.level);
  if (existing) return existing;

  let score = input.score;
  if (score == null) {
    const passedAttempt = await repo.findPassedExamAttempt(sql, input.userId, input.level);
    if (!passedAttempt) {
      throw new ValidationError(
        `No score given and no passed exam on record for level ${input.level} — provide a score to issue manually.`,
      );
    }
    score = passedAttempt.score;
  }

  const fullName = await repo.getProfileName(sql, input.userId);
  const inserted = await repo.insertCertificate(sql, {
    userId: input.userId,
    level: input.level,
    score,
    courseId: input.courseId,
    courseTitle: input.courseTitle,
    fullName,
  });
  const cert = inserted ?? (await repo.findExistingCertificate(sql, input.userId, input.level));

  if (inserted) {
    await logAdminAction(sql, {
      adminUserId,
      action: "certificate.issue",
      entity: "certificate",
      entityId: inserted.id as string,
      severity: "info",
      metadata: { userId: input.userId, level: input.level, score },
    });
  }
  return cert;
}

export async function listMyCertificates(sql: Sql, userId: string) {
  return repo.listCertificatesForUser(sql, userId);
}

export async function verifyCertificate(sql: Sql, code: string) {
  const cert = await repo.findCertificateByCode(sql, code);
  if (!cert) return null;
  // valid is derived here, never trusted from the row shape a caller might
  // pass around — a revoked certificate must never come back as valid, no
  // matter which query populated `cert`.
  const { revoked_at, revoked_reason, ...rest } = cert as Record<string, unknown>;
  return { ...rest, valid: !revoked_at, revoked: !!revoked_at, revokedReason: revoked_at ? revoked_reason : null };
}

export async function listCertificatesAdmin(sql: Sql, params: { search?: string; limit: number }) {
  const items = await repo.listAllCertificates(sql, params);
  return { items };
}

export async function revokeCertificateAdmin(sql: Sql, id: string, adminUserId: string, reason: string) {
  const result = await repo.revokeCertificate(sql, id, adminUserId, reason);
  if (!result.found) throw new NotFoundError("Certificate not found");
  if (!result.already_revoked) {
    await logAdminAction(sql, {
      adminUserId,
      action: "certificate.revoke",
      entity: "certificate",
      entityId: id,
      severity: "warning",
      metadata: { reason },
    });
  }
  return result;
}
