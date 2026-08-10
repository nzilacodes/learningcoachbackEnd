import type { FastifyInstance } from "fastify";
import { requireAuth, optionalAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  studyTimeSchema,
  studyReminderSchema,
  videoIdParamsSchema,
  videoHistoryUpsertSchema,
  lessonIdParamsSchema,
  updateLessonSchema,
  exerciseIdParamsSchema,
  createExerciseSchema,
  updateExerciseSchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function learningRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

  fastify.get("/courses", async (request) => {
    return service.getCurriculum(request.server.sql);
  });

  fastify.get("/me/progress", { preHandler: requireAuth }, async (request) => {
    return service.getProgress(request.server.sql, request.userId);
  });

  // Public like /courses — lets the marketing site link to a real lesson as a
  // demo preview. Only completing a lesson (below) requires a session; answer
  // keys are also withheld unless the caller is signed in (see service layer).
  fastify.get("/lessons/:id", { preHandler: optionalAuth }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    return service.getLessonDetail(request.server.sql, id, !!request.userId);
  });

  fastify.post("/lessons/:id/complete", { preHandler: requireAuth }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    return service.completeLesson(request.server.sql, request.userId, id);
  });

  fastify.patch("/admin/lessons/:id", { preHandler: adminOnly }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    const patch = updateLessonSchema.parse(request.body);
    return service.updateLessonAdmin(request.server.sql, id, patch);
  });

  fastify.get("/admin/lessons/:id/exercises", { preHandler: adminOnly }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    return service.listExercisesAdmin(request.server.sql, id);
  });

  fastify.post("/admin/lessons/:id/exercises", { preHandler: adminOnly }, async (request, reply) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    const input = createExerciseSchema.parse(request.body);
    const exercise = await service.createExerciseAdmin(request.server.sql, id, input);
    return reply.status(201).send(exercise);
  });

  fastify.patch("/admin/exercises/:id", { preHandler: adminOnly }, async (request) => {
    const { id } = exerciseIdParamsSchema.parse(request.params);
    const patch = updateExerciseSchema.parse(request.body);
    return service.updateExerciseAdmin(request.server.sql, id, patch);
  });

  fastify.delete("/admin/exercises/:id", { preHandler: adminOnly }, async (request, reply) => {
    const { id } = exerciseIdParamsSchema.parse(request.params);
    await service.deleteExerciseAdmin(request.server.sql, id);
    return reply.status(204).send();
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
