import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  analyticsQuerySchema,
  auditLogsQuerySchema,
  loginAttemptsQuerySchema,
  lockoutsQuerySchema,
  reportLimitQuerySchema,
  performanceStudentsQuerySchema,
  studentIdParamsSchema,
  studentAttemptsQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function adminRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

  // Student-facing mirrors of the same mastery/recommendation engine used by
  // the admin performance panel — section 10/17 of the architecture doc
  // ("o que estudar agora"). Deliberately not wired into the live student
  // dashboard yet: that UI has real paying users and no way to verify a
  // change to it in this environment, so it's exposed here, ready, rather
  // than changed blind.
  fastify.get("/me/skill-mastery", { preHandler: requireAuth }, async (request) => {
    return service.getStudentSkillMastery(request.server.sql, request.userId);
  });

  fastify.get("/me/recommendation", { preHandler: requireAuth }, async (request) => {
    return service.getStudentRecommendation(request.server.sql, request.userId);
  });

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

  fastify.get("/admin/performance/students", { preHandler: adminOnly }, async (request) => {
    const params = performanceStudentsQuerySchema.parse(request.query);
    return service.listStudentPerformance(request.server.sql, params);
  });

  fastify.get("/admin/performance/students/:id/attempts", { preHandler: adminOnly }, async (request) => {
    const { id } = studentIdParamsSchema.parse(request.params);
    const { limit } = studentAttemptsQuerySchema.parse(request.query);
    return service.getStudentAttempts(request.server.sql, id, limit);
  });

  // Curriculum-wide, one row per lesson with any attempts — powers the
  // performance badges on the admin curriculum screen (mirrors the
  // review-summary endpoint in learning/routes.ts, same shape of concern).
  fastify.get("/admin/performance/lessons", { preHandler: adminOnly }, async (request) => {
    return service.getLessonPerformance(request.server.sql);
  });

  fastify.get("/admin/performance/students/:id/mastery", { preHandler: adminOnly }, async (request) => {
    const { id } = studentIdParamsSchema.parse(request.params);
    return service.getStudentSkillMastery(request.server.sql, id);
  });

  fastify.get(
    "/admin/performance/students/:id/recommendation",
    { preHandler: adminOnly },
    async (request) => {
      const { id } = studentIdParamsSchema.parse(request.params);
      return service.getStudentRecommendation(request.server.sql, id);
    },
  );
}
