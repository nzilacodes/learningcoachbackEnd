import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { studyTimeSchema, studyReminderSchema, videoIdParamsSchema, videoHistoryUpsertSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function learningRoutes(fastify: FastifyInstance) {
  fastify.get("/courses", async (request) => {
    return service.getCurriculum(request.server.sql);
  });

  fastify.get("/me/progress", { preHandler: requireAuth }, async (request) => {
    return service.getProgress(request.server.sql, request.userId);
  });

  fastify.get("/me/study-stats", { preHandler: requireAuth }, async (request) => {
    return service.getStudyStats(request.server.sql, request.userId);
  });

  fastify.get("/me/study-sessions", { preHandler: requireAuth }, async (request) => {
    const days = Math.min(Number((request.query as { days?: string }).days ?? 84), 365);
    return service.getWeeklyStudy(request.server.sql, request.userId, days);
  });

  fastify.post("/me/study-time", { preHandler: requireAuth }, async (request, reply) => {
    const { seconds } = studyTimeSchema.parse(request.body);
    await service.addStudyTime(request.server.sql, request.userId, seconds);
    return reply.status(204).send();
  });

  fastify.get("/me/study-reminder", { preHandler: requireAuth }, async (request) => {
    return service.getStudyReminder(request.server.sql, request.userId);
  });

  fastify.put("/me/study-reminder", { preHandler: requireAuth }, async (request) => {
    const patch = studyReminderSchema.parse(request.body);
    await service.setStudyReminder(request.server.sql, request.userId, patch);
    return service.getStudyReminder(request.server.sql, request.userId);
  });

  fastify.get("/me/video-history", { preHandler: requireAuth }, async (request) => {
    return service.listVideoHistory(request.server.sql, request.userId);
  });

  fastify.get("/me/video-history/:videoId", { preHandler: requireAuth }, async (request) => {
    const { videoId } = videoIdParamsSchema.parse(request.params);
    return service.getVideoHistoryItem(request.server.sql, request.userId, videoId);
  });

  fastify.put("/me/video-history/:videoId", { preHandler: requireAuth }, async (request, reply) => {
    const { videoId } = videoIdParamsSchema.parse(request.params);
    const patch = videoHistoryUpsertSchema.parse(request.body);
    await service.setVideoHistory(request.server.sql, request.userId, videoId, patch);
    return reply.status(204).send();
  });
}
