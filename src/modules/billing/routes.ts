import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  createCheckoutSessionSchema,
  paymentIdParamsSchema,
  subscriptionIdParamsSchema,
  activatePaymentSchema,
  listQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function billingRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

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

  fastify.get("/admin/stats", { preHandler: adminOnly }, async (request) => {
    return service.getAdminStats(request.server.sql);
  });

  fastify.get("/admin/payments", { preHandler: adminOnly }, async (request) => {
    const { limit, offset } = listQuerySchema.parse(request.query);
    const { items, total } = await service.listPaymentsAdmin(request.server.sql, limit, offset);
    return { items, total, limit, offset };
  });

  fastify.post("/admin/payments/:id/activate", { preHandler: adminOnly }, async (request) => {
    const { id } = paymentIdParamsSchema.parse(request.params);
    const { providerTransactionId } = activatePaymentSchema.parse(request.body ?? {});
    return service.activatePayment(request.server.sql, id, providerTransactionId);
  });

  fastify.post("/admin/payments/:id/cancel", { preHandler: adminOnly }, async (request) => {
    const { id } = paymentIdParamsSchema.parse(request.params);
    return service.cancelPaymentAdmin(request.server.sql, id);
  });

  fastify.get("/admin/subscriptions", { preHandler: adminOnly }, async (request) => {
    const { limit, offset } = listQuerySchema.parse(request.query);
    const { items, total } = await service.listSubscriptionsAdmin(request.server.sql, limit, offset);
    return { items, total, limit, offset };
  });

  fastify.post("/admin/subscriptions/:id/cancel", { preHandler: adminOnly }, async (request) => {
    const { id } = subscriptionIdParamsSchema.parse(request.params);
    return service.cancelSubscriptionAdmin(request.server.sql, id);
  });
}
