import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { levelParamsSchema, submitExamSchema } from "./schemas.js";
import * as service from "./service.js";
import * as repo from "./repository.js";

export default async function examsRoutes(fastify: FastifyInstance) {
  fastify.get("/me/level-access", { preHandler: requireAuth }, async (request) => {
    const db = request.server.supabaseAdmin;
    const [maxUnlockedLevel, minExamScore] = await Promise.all([
      service.getMaxUnlockedLevel(db, request.userId),
      repo.getMinExamScore(db),
    ]);
    return { maxUnlockedLevel, minExamScore };
  });

  fastify.get("/level-exams/:level", { preHandler: requireAuth }, async (request) => {
    const { level } = levelParamsSchema.parse(request.params);
    return service.getExamForClient(request.server.supabaseAdmin, level);
  });

  fastify.post("/assessments/level-exam/:level", { preHandler: requireAuth }, async (request) => {
    const { level } = levelParamsSchema.parse(request.params);
    const { answers } = submitExamSchema.parse(request.body);
    return service.submitExam(request.server.supabaseAdmin, request.userId, level, answers);
  });
}
