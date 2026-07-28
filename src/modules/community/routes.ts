import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { sendMessageSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function communityRoutes(fastify: FastifyInstance) {
  fastify.get("/community/messages", { preHandler: requireAuth }, async (request) => {
    return service.getMessages(request.server.sql, request.userId);
  });

  fastify.post("/community/messages", { preHandler: requireAuth }, async (request, reply) => {
    const { content, kind } = sendMessageSchema.parse(request.body);
    const message = await service.sendMessage(request.server.sql, request.userId, content, kind);
    return reply.status(201).send(message);
  });
}
