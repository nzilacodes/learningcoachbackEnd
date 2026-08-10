import type { FastifyInstance } from "fastify";
import { submitContactSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function contactRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/contact",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = submitContactSchema.parse(request.body);
      await service.submitContactMessage(request.server.sql, input);
      return reply.status(204).send();
    },
  );
}
