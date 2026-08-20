import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import {
  sendMessageSchema,
  reportMessageSchema,
  messageIdParamsSchema,
  userIdParamsSchema,
  listMessagesQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function communityRoutes(fastify: FastifyInstance) {
  fastify.get("/community/messages", { preHandler: requireAuth }, async (request) => {
    const { since } = listMessagesQuerySchema.parse(request.query);
    return service.getMessages(request.server.sql, request.userId, since);
  });

  fastify.post(
    "/community/messages",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { content, kind } = sendMessageSchema.parse(request.body);
      const message = await service.sendMessage(request.server.sql, request.userId, content, kind);
      return reply.status(201).send(message);
    },
  );

  fastify.post(
    "/community/messages/:id/report",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = messageIdParamsSchema.parse(request.params);
      const { reason } = reportMessageSchema.parse(request.body ?? {});
      await service.reportMessage(request.server.sql, request.userId, id, reason);
      return reply.status(204).send();
    },
  );

  fastify.get("/community/blocked", { preHandler: requireAuth }, async (request) => {
    return service.listBlockedUsers(request.server.sql, request.userId);
  });

  fastify.post("/community/users/:id/block", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = userIdParamsSchema.parse(request.params);
    await service.blockUser(request.server.sql, request.userId, id);
    return reply.status(204).send();
  });

  fastify.delete("/community/users/:id/block", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = userIdParamsSchema.parse(request.params);
    await service.unblockUser(request.server.sql, request.userId, id);
    return reply.status(204).send();
  });
}
