import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import {
  createClassSchema,
  joinClassSchema,
  classIdParamsSchema,
  classMemberParamsSchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function classesRoutes(fastify: FastifyInstance) {
  fastify.post("/classes", { preHandler: requireAuth }, async (request, reply) => {
    const { name } = createClassSchema.parse(request.body);
    const cls = await service.createClass(request.server.sql, request.userId, name);
    return reply.status(201).send(cls);
  });

  fastify.get("/me/classes", { preHandler: requireAuth }, async (request) => {
    return service.listMyClasses(request.server.sql, request.userId);
  });

  fastify.post("/classes/join", { preHandler: requireAuth }, async (request) => {
    const { inviteCode } = joinClassSchema.parse(request.body);
    return service.joinClass(request.server.sql, request.userId, inviteCode);
  });

  fastify.get("/classes/:id/roster", { preHandler: requireAuth }, async (request) => {
    const { id } = classIdParamsSchema.parse(request.params);
    return service.getRoster(request.server.sql, request.userId, id);
  });

  fastify.delete(
    "/classes/:id/members/:studentId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, studentId } = classMemberParamsSchema.parse(request.params);
      await service.removeMember(request.server.sql, request.userId, id, studentId);
      return reply.status(204).send();
    },
  );

  fastify.delete("/classes/:id/leave", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = classIdParamsSchema.parse(request.params);
    await service.leaveClass(request.server.sql, request.userId, id);
    return reply.status(204).send();
  });

  fastify.delete("/classes/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = classIdParamsSchema.parse(request.params);
    await service.deleteClassAsOwner(request.server.sql, request.userId, id);
    return reply.status(204).send();
  });
}
