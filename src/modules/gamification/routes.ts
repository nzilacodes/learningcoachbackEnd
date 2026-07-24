import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { awardActivitySchema } from "./schemas.js";
import * as service from "./service.js";

export default async function gamificationRoutes(fastify: FastifyInstance) {
  fastify.post("/xp/events", { preHandler: requireAuth }, async (request) => {
    const { source, meta } = awardActivitySchema.parse(request.body);
    return service.awardActivity(request.server.sql, request.userId, source, meta);
  });
}
