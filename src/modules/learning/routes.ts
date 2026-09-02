import type { FastifyInstance } from "fastify";
import { requireAuth, optionalAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  studyTimeSchema,
  studyReminderSchema,
  studySessionsQuerySchema,
  videoIdParamsSchema,
  videoHistoryUpsertSchema,
  lessonIdParamsSchema,
  updateLessonSchema,
  exerciseIdParamsSchema,
  createExerciseSchema,
  updateExerciseSchema,
  listExercisesAdminQuerySchema,
  unitIdParamsSchema,
  createUnitSchema,
  updateUnitSchema,
  createLessonSchema,
  deleteWithForceQuerySchema,
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

  fastify.post("/admin/units", { preHandler: adminOnly }, async (request, reply) => {
    const input = createUnitSchema.parse(request.body);
    const unit = await service.createUnitAdmin(request.server.sql, input);
    return reply.status(201).send(unit);
  });

  fastify.patch("/admin/units/:id", { preHandler: adminOnly }, async (request) => {
    const { id } = unitIdParamsSchema.parse(request.params);
    const patch = updateUnitSchema.parse(request.body);
    return service.updateUnitAdmin(request.server.sql, id, patch);
  });

  fastify.delete("/admin/units/:id", { preHandler: adminOnly }, async (request, reply) => {
    const { id } = unitIdParamsSchema.parse(request.params);
    const { force } = deleteWithForceQuerySchema.parse(request.query);
    await service.deleteUnitAdmin(request.server.sql, id, force, request.userId);
    return reply.status(204).send();
  });

  fastify.post("/admin/lessons", { preHandler: adminOnly }, async (request, reply) => {
    const input = createLessonSchema.parse(request.body);
    const lesson = await service.createLessonAdmin(request.server.sql, input);
    return reply.status(201).send(lesson);
  });

  fastify.delete("/admin/lessons/:id", { preHandler: adminOnly }, async (request, reply) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    const { force } = deleteWithForceQuerySchema.parse(request.query);
    await service.deleteLessonAdmin(request.server.sql, id, force, request.userId);
    return reply.status(204).send();
  });

  // Curriculum-wide, one row per lesson with any exercises — powers the
  // admin curriculum screen's review-progress badges (draft/in_review/
  // published counts) without fetching all ~1,450 exercise rows client-side.
  fastify.get("/admin/exercises/review-summary", { preHandler: adminOnly }, async (request) => {
    return service.getExerciseReviewSummary(request.server.sql);
  });

  fastify.get("/admin/lessons/:id/exercises", { preHandler: adminOnly }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    const { status } = listExercisesAdminQuerySchema.parse(request.query);
    return service.listExercisesAdmin(request.server.sql, id, status);
  });

  // Publishes every non-published exercise in a lesson in one click — the
  // bulk counterpart to flipping each exercise's status dropdown one at a
  // time, needed at the scale the AI content pipeline produces.
  fastify.post("/admin/lessons/:id/exercises/publish-all", { preHandler: adminOnly }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    return service.publishAllExercisesAdmin(request.server.sql, id);
  });

  // Triggers the same AI content-generation pipeline as `npm run
  // generate:exercises`, scoped to one lesson — always lands as
  // content_status='draft', invisible to students until reviewed via the
  // exercise editor below.
  fastify.post("/admin/lessons/:id/generate-exercises", { preHandler: adminOnly }, async (request) => {
    const { id } = lessonIdParamsSchema.parse(request.params);
    return service.generateExercisesAdmin(request.server.sql, id);
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
    const { days } = studySessionsQuerySchema.parse(request.query);
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
