import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { createCheckoutSessionSchema, paymentIdParamsSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function billingRoutes(fastify: FastifyInstance) {
  fastify.get("/plans", async (request) => {
    return service.listPlans(request.server.sql);
  });

  fastify.post("/checkout-sessions", { preHandler: requireAuth }, async (request, reply) => {
    const input = createCheckoutSessionSchema.parse(request.body);
    const session = await service.createCheckoutSession(request.server.sql, request.userId, input);
    return reply.status(201).send(session);
  });

  fastify.get("/me/payments", { preHandler: requireAuth }, async (request) => {
    return service.listMyPayments(request.server.sql, request.userId);
  });

  fastify.get("/me/subscriptions", { preHandler: requireAuth }, async (request) => {
    return service.listMySubscriptions(request.server.sql, request.userId);
  });

  fastify.post(
    "/payments/:id/simulate",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = paymentIdParamsSchema.parse(request.params);
      return service.simulatePayment(request.server.sql, request.userId, id);
    },
  );
}
