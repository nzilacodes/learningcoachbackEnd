import type { Sql } from "postgres";
import type { CefrLevel } from "../../lib/cefr.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";
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
