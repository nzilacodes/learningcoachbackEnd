import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import {
  awardActivitySchema,
  missionIdParamsSchema,
  itemIdParamsSchema,
  equipItemSchema,
  addFriendSchema,
  leaderboardQuerySchema,
  daysQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function gamificationRoutes(fastify: FastifyInstance) {
  fastify.post("/xp/events", { preHandler: requireAuth }, async (request) => {
    const { source, meta } = awardActivitySchema.parse(request.body);
    return service.awardActivity(request.server.sql, request.userId, source, meta);
  });

  fastify.get("/me/gamification-stats", { preHandler: requireAuth }, async (request) => {
    return service.getGamificationStats(request.server.sql, request.userId);
  });

  fastify.get("/missions", { preHandler: requireAuth }, async (request) => {
    return service.listActiveMissions(request.server.sql);
  });

  fastify.get("/me/missions", { preHandler: requireAuth }, async (request) => {
    return service.listUserMissions(request.server.sql, request.userId);
  });

  fastify.post("/me/missions/:id/claim", { preHandler: requireAuth }, async (request) => {
    const { id } = missionIdParamsSchema.parse(request.params);
    return service.claimMission(request.server.sql, request.userId, id);
  });

  fastify.get("/shop-items", { preHandler: requireAuth }, async (request) => {
    return service.listShopItems(request.server.sql);
  });

  fastify.get("/me/inventory", { preHandler: requireAuth }, async (request) => {
    return service.listUserInventory(request.server.sql, request.userId);
  });

  fastify.post("/shop-items/:id/purchase", { preHandler: requireAuth }, async (request) => {
    const { id } = itemIdParamsSchema.parse(request.params);
    return service.purchaseItem(request.server.sql, request.userId, id);
  });

  fastify.put("/me/inventory/:id/equip", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = itemIdParamsSchema.parse(request.params);
    const { equipped } = equipItemSchema.parse(request.body);
    await service.setInventoryEquipped(request.server.sql, request.userId, id, equipped);
    return reply.status(204).send();
  });

  fastify.get("/me/achievements", { preHandler: requireAuth }, async (request) => {
    return service.listUserAchievements(request.server.sql, request.userId);
  });

  fastify.get("/leaderboard", { preHandler: requireAuth }, async (request) => {
    const { limit } = leaderboardQuerySchema.parse(request.query);
    return service.getLeaderboard(request.server.sql, limit);
  });

  fastify.get("/me/rank", { preHandler: requireAuth }, async (request) => {
    return service.getMyRank(request.server.sql, request.userId);
  });

  fastify.get("/me/friends", { preHandler: requireAuth }, async (request) => {
    return service.listFriends(request.server.sql, request.userId);
  });

  fastify.post("/me/friends", { preHandler: requireAuth }, async (request, reply) => {
    const { email } = addFriendSchema.parse(request.body);
    await service.addFriendByEmail(request.server.sql, request.userId, email);
    return reply.status(204).send();
  });

  fastify.get("/me/xp-events", { preHandler: requireAuth }, async (request) => {
    const { days } = daysQuerySchema.parse(request.query);
    return service.getXpEvents(request.server.sql, request.userId, days);
  });
}
