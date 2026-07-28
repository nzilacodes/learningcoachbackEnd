import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  analyticsQuerySchema,
  auditLogsQuerySchema,
  loginAttemptsQuerySchema,
  lockoutsQuerySchema,
  reportLimitQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function adminRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

  fastify.get("/admin/analytics", { preHandler: adminOnly }, async (request) => {
    const { days } = analyticsQuerySchema.parse(request.query);
    return service.getAnalytics(request.server.sql, days);
  });

  fastify.get("/admin/security-summary", { preHandler: adminOnly }, async (request) => {
    return service.getSecuritySummary(request.server.sql);
  });

  fastify.get("/admin/audit-logs", { preHandler: adminOnly }, async (request) => {
    const { limit, severity, action } = auditLogsQuerySchema.parse(request.query);
    return service.listAuditLogs(request.server.sql, limit, severity, action);
  });

  fastify.get("/admin/login-attempts", { preHandler: adminOnly }, async (request) => {
    const { limit } = loginAttemptsQuerySchema.parse(request.query);
    return service.listLoginAttempts(request.server.sql, limit);
  });

  fastify.get("/admin/lockouts", { preHandler: adminOnly }, async (request) => {
    const { limit } = lockoutsQuerySchema.parse(request.query);
    return service.listLockouts(request.server.sql, limit);
  });

  fastify.get("/admin/reports/users", { preHandler: adminOnly }, async (request) => {
    const { limit } = reportLimitQuerySchema.parse(request.query);
    return service.getUsersReport(request.server.sql, limit);
  });

  fastify.get("/admin/reports/payments", { preHandler: adminOnly }, async (request) => {
    const { limit } = reportLimitQuerySchema.parse(request.query);
    return service.getPaymentsReport(request.server.sql, limit);
  });

  fastify.get("/admin/reports/diagnostics", { preHandler: adminOnly }, async (request) => {
    const { limit } = reportLimitQuerySchema.parse(request.query);
    return service.getDiagnosticsReport(request.server.sql, limit);
  });
}
