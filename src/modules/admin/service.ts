import type { Sql } from "postgres";
import * as repo from "./repository.js";

export const getAnalytics = repo.getAnalytics;
export const getSecuritySummary = repo.getSecuritySummary;
export const listAuditLogs = repo.listAuditLogs;
export const listLoginAttempts = repo.listLoginAttempts;
export const listLockouts = repo.listLockouts;

export async function getUsersReport(sql: Sql, limit: number) {
  return repo.reportUsers(sql, limit);
}
export async function getPaymentsReport(sql: Sql, limit: number) {
  return repo.reportPayments(sql, limit);
}
export async function getDiagnosticsReport(sql: Sql, limit: number) {
  return repo.reportDiagnostics(sql, limit);
}

const round1 = (n: number | null) => (n == null ? null : Math.round(Number(n) * 10) / 10);

export async function listStudentPerformance(
  sql: Sql,
  params: { search?: string; limit: number; offset: number },
) {
  const rows = await repo.listStudentPerformance(sql, params);
  return {
    items: rows.map((r) => ({
      ...r,
      avg_score: round1(r.avg_score),
      pass_rate: round1(r.pass_rate),
    })),
  };
}

export async function getStudentAttempts(sql: Sql, userId: string, limit: number) {
  return repo.getStudentAttempts(sql, userId, limit);
}

export async function getLessonPerformance(sql: Sql) {
  const rows = await repo.getLessonPerformance(sql);
  return rows.map((r) => ({ ...r, avg_score: round1(r.avg_score), pass_rate: round1(r.pass_rate) }));
}
