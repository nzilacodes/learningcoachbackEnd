import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { listNotificationsQuerySchema, notificationIdParamsSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function notificationsRoutes(fastify: FastifyInstance) {
  fastify.get("/me/notifications", { preHandler: requireAuth }, async (request) => {
    const { category, unreadOnly, limit } = listNotificationsQuerySchema.parse(request.query);
    return service.listMyNotifications(request.server.sql, request.userId, { category, unreadOnly, limit });
  });

  fastify.post("/me/notifications/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = notificationIdParamsSchema.parse(request.params);
    await service.markNotificationRead(request.server.sql, request.userId, id);
    return reply.status(204).send();
  });

  fastify.post("/me/notifications/read-all", { preHandler: requireAuth }, async (request, reply) => {
    await service.markAllNotificationsRead(request.server.sql, request.userId);
    return reply.status(204).send();
  });
}
