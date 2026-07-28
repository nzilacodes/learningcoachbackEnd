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
