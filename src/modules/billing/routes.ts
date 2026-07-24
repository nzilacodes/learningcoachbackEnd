import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import { createCheckoutSessionSchema, paymentIdParamsSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function billingRoutes(fastify: FastifyInstance) {
  fastify.get("/plans", async (request) => {
    return service.listPlans(request.server.supabaseAdmin);
  });

  fastify.post("/checkout-sessions", { preHandler: requireAuth }, async (request, reply) => {
    const input = createCheckoutSessionSchema.parse(request.body);
    const userDb = request.server.createUserClient(request.accessToken);
    const session = await service.createCheckoutSession(userDb, input);
    return reply.status(201).send(session);
  });

  fastify.get("/me/payments", { preHandler: requireAuth }, async (request) => {
    const userDb = request.server.createUserClient(request.accessToken);
    return service.listMyPayments(userDb, request.userId);
  });

  fastify.get("/me/subscriptions", { preHandler: requireAuth }, async (request) => {
    const userDb = request.server.createUserClient(request.accessToken);
    return service.listMySubscriptions(userDb, request.userId);
  });

  fastify.post(
    "/payments/:id/simulate",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request) => {
      const { id } = paymentIdParamsSchema.parse(request.params);
      return service.simulatePayment(request.server.supabaseAdmin, id);
    },
  );
}
