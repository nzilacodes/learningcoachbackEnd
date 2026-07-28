import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { cefrLevelSchema } from "../../lib/cefr.js";
import { levelParamsSchema, submitExamSchema } from "./schemas.js";
import * as service from "./service.js";
import * as repo from "./repository.js";

export default async function examsRoutes(fastify: FastifyInstance) {
  fastify.get("/me/level-exam-attempts", { preHandler: requireAuth }, async (request) => {
    const level = cefrLevelSchema.optional().parse((request.query as { level?: string }).level);
    return service.listAttempts(request.server.sql, request.userId, level);
  });

  fastify.get("/me/level-access", { preHandler: requireAuth }, async (request) => {
    const sql = request.server.sql;
    const [maxUnlockedLevel, minExamScore] = await Promise.all([
      service.getMaxUnlockedLevel(sql, request.userId),
      repo.getMinExamScore(sql),
    ]);
    return { maxUnlockedLevel, minExamScore };
  });

  fastify.get("/level-exams/:level", { preHandler: requireAuth }, async (request) => {
    const { level } = levelParamsSchema.parse(request.params);
    return service.getExamForClient(request.server.sql, level);
  });

  fastify.post("/assessments/level-exam/:level", { preHandler: requireAuth }, async (request) => {
    const { level } = levelParamsSchema.parse(request.params);
    const { answers } = submitExamSchema.parse(request.body);
    return service.submitExam(request.server.sql, request.userId, level, answers);
  });
}
