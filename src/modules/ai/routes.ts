import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { speechSchema, dictionaryParamsSchema } from "./schemas.js";
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
      if (!upload) return reply.status(400).send({ title: "Missing audio file", status: 400 });
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
      return service.getWordData(request.server.supabaseAdmin, word);
    },
  );
}
