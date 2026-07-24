import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import { listUsersQuerySchema, userIdParamsSchema, updateUserSchema, updateMeSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function usersRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

  fastify.get("/admin/users", { preHandler: adminOnly }, async (request) => {
    const { limit, offset } = listUsersQuerySchema.parse(request.query);
    const { items, total } = await service.listUsers(request.server.sql, limit, offset);
    return { items, total, limit, offset };
  });

  fastify.get("/admin/users/:id", { preHandler: adminOnly }, async (request) => {
    const { id } = userIdParamsSchema.parse(request.params);
    return service.getUser(request.server.sql, id);
  });

  fastify.patch("/admin/users/:id", { preHandler: adminOnly }, async (request) => {
    const { id } = userIdParamsSchema.parse(request.params);
    const patch = updateUserSchema.parse(request.body);
    return service.updateUser(request.server.sql, id, patch);
  });

  fastify.delete("/admin/users/:id", { preHandler: adminOnly }, async (request, reply) => {
    const { id } = userIdParamsSchema.parse(request.params);
    await service.deleteUser(request.server.sql, id);
    return reply.status(204).send();
  });

  fastify.patch("/me", { preHandler: requireAuth }, async (request) => {
    const patch = updateMeSchema.parse(request.body);
    return service.updateMe(request.server.sql, request.userId, patch);
  });
}
