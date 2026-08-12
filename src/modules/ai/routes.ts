import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { ValidationError } from "../../lib/errors.js";
import {
  speechSchema,
  dictionaryParamsSchema,
  readingAssessSchema,
  readingHistoryQuerySchema,
  pronunciationAssessSchema,
  videoIdParamsSchema,
  videoStudyPackQuerySchema,
  createConversationSchema,
  conversationIdParamsSchema,
  sendCoachMessageSchema,
  retryMessageParamsSchema,
} from "./schemas.js";
import * as service from "./service.js";

const AI_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

export default async function aiRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/audio/speech",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request, reply) => {
      const input = speechSchema.parse(request.body);
      const audio = await service.synthesizeSpeech(input);
      return reply.type("audio/mpeg").send(audio);
    },
  );

  fastify.post(
    "/audio/transcriptions",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request, reply) => {
      const upload = await request.file();
      if (!upload) throw new ValidationError("Missing audio file");
      const buffer = await upload.toBuffer();
      const result = await service.transcribeAudio({
        buffer,
        filename: upload.filename,
        mimetype: upload.mimetype,
      });
      return result;
    },
  );

  fastify.get(
    "/dictionary/:word",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request) => {
      const { word } = dictionaryParamsSchema.parse(request.params);
      return service.getWordData(request.server.sql, word);
    },
  );

  fastify.post(
    "/reading/assess",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request) => {
      const input = readingAssessSchema.parse(request.body);
      return service.assessReading(request.server.sql, request.userId, input);
    },
  );

  fastify.get("/me/reading-history", { preHandler: requireAuth }, async (request) => {
    const { passageKey } = readingHistoryQuerySchema.parse(request.query);
    return service.getReadingHistory(request.server.sql, request.userId, passageKey);
  });

  fastify.post(
    "/pronunciation/assess",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request) => {
      const input = pronunciationAssessSchema.parse(request.body);
      return service.assessPronunciation(request.server.sql, request.userId, input);
    },
  );

  fastify.get("/me/pronunciation-history", { preHandler: requireAuth }, async (request) => {
    return service.getPronunciationHistory(request.server.sql, request.userId);
  });

  fastify.get(
    "/videos/:videoId/study-pack",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request) => {
      const { videoId } = videoIdParamsSchema.parse(request.params);
      const input = videoStudyPackQuerySchema.parse(request.query);
      return service.getVideoStudyPack(request.server.sql, videoId, input);
    },
  );

  fastify.get("/ai/conversations", { preHandler: requireAuth }, async (request) => {
    return service.listConversations(request.server.sql, request.userId);
  });

  fastify.post(
    "/ai/conversations",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request, reply) => {
      const { title } = createConversationSchema.parse(request.body ?? {});
      const conversation = await service.createConversation(request.server.sql, request.userId, title);
      return reply.status(201).send(conversation);
    },
  );

  fastify.get("/ai/conversations/:id/messages", { preHandler: requireAuth }, async (request) => {
    const { id } = conversationIdParamsSchema.parse(request.params);
    return service.listMessages(request.server.sql, request.userId, id);
  });

  fastify.post(
    "/ai/conversations/:id/messages",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request, reply) => {
      const { id } = conversationIdParamsSchema.parse(request.params);
      const { content } = sendCoachMessageSchema.parse(request.body);
      const result = await service.sendCoachMessage(request.server.sql, request.userId, id, content);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    "/ai/conversations/:id/messages/:messageId/retry",
    { preHandler: requireAuth, config: { rateLimit: AI_RATE_LIMIT } },
    async (request, reply) => {
      const { id, messageId } = retryMessageParamsSchema.parse(request.params);
      const result = await service.retryCoachMessage(request.server.sql, request.userId, id, messageId);
      return reply.status(201).send(result);
    },
  );
}
