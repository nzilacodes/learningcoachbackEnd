import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { lessonIdParamsSchema, submitLessonAttemptSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function gradingRoutes(fastify: FastifyInstance) {
  fastify.get("/me/hearts", { preHandler: requireAuth }, async (request) => {
    return service.getHeartsState(request.server.sql, request.userId);
  });

  fastify.post("/lessons/:id/submit", { preHandler: requireAuth }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    const { answers } = submitLessonAttemptSchema.parse(request.body);
    return service.submitLessonAttempt(request.server.sql, request.userId, id, answers);
  });
}
