import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth, optionalAuth } from "../../plugins/auth.js";
import { ValidationError } from "../../lib/errors.js";
import { mediaIdParamsSchema, updateMediaSchema, listMediaQuerySchema } from "./schemas.js";
import { mediaStorage } from "./storage.js";
import * as service from "./service.js";

const MEDIA_UPLOAD_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

function parseRange(rangeHeader: string | undefined, sizeBytes: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const [startRaw, endRaw] = rangeHeader.slice("bytes=".length).split("-");
  const start = startRaw ? parseInt(startRaw, 10) : 0;
  const end = endRaw ? parseInt(endRaw, 10) : sizeBytes - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= sizeBytes || start < 0) return null;
  return { start, end };
}

/** Serves a stored file with Range/206 support — without this, `<video>`
 * scrubbing is broken or has to re-download the whole file on every seek. */
function sendStoredFile(request: FastifyRequest, reply: FastifyReply, file: { key: string; mimeType: string; sizeBytes: number }) {
  const range = parseRange(request.headers.range, file.sizeBytes);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", "private, max-age=3600");
  reply.type(file.mimeType);
  if (range) {
    reply.status(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
    reply.header("Content-Length", String(range.end - range.start + 1));
    return reply.send(mediaStorage.readStream(file.key, range));
  }
  reply.header("Content-Length", String(file.sizeBytes));
  return reply.send(mediaStorage.readStream(file.key));
}

export default async function mediaRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/media/uploads",
    { preHandler: requireAuth, config: { rateLimit: MEDIA_UPLOAD_RATE_LIMIT } },
    async (request, reply) => {
      const filePart = await request.file({ limits: { fileSize: service.MAX_UPLOAD_BYTES } });
      if (!filePart) throw new ValidationError("No file was uploaded.");
      const asset = await service.uploadMedia(request.server.sql, request.userId, filePart);
      return reply.status(201).send(asset);
    },
  );

  fastify.get("/media/storage-summary", { preHandler: requireAuth }, async (request) => {
    return service.getStorageSummary(request.server.sql, request.userId);
  });

  fastify.get("/media", { preHandler: requireAuth }, async (request) => {
    const query = listMediaQuerySchema.parse(request.query);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    return service.listMedia(request.server.sql, request.userId, isAdmin, query);
  });

  fastify.get("/media/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    return service.getMediaAsset(request.server.sql, request.userId, isAdmin, id);
  });

  fastify.patch("/media/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const patch = updateMediaSchema.parse(request.body);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    return service.updateMedia(request.server.sql, request.userId, isAdmin, id, patch);
  });

  fastify.delete("/media/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    await service.deleteMedia(request.server.sql, request.userId, isAdmin, id);
    return reply.status(204).send();
  });

  fastify.post("/media/:id/restore", { preHandler: requireAuth }, async (request) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    return service.restoreMedia(request.server.sql, request.userId, isAdmin, id);
  });

  fastify.delete("/media/:id/permanent", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = await service.isUserAdmin(request.server.sql, request.userId);
    await service.purgeMedia(request.server.sql, request.userId, isAdmin, id);
    return reply.status(204).send();
  });

  // optionalAuth, not requireAuth: public media should be viewable/embeddable
  // without a session — assertVisible() inside getStreamableFile is the real
  // gate (private/class-only/not-yet-ready assets 404 for anyone but the
  // owner or an admin).
  fastify.get("/media/:id/stream", { preHandler: optionalAuth }, async (request, reply) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = request.userId ? await service.isUserAdmin(request.server.sql, request.userId) : false;
    const file = await service.getStreamableFile(request.server.sql, request.userId, isAdmin, id, "original");
    return sendStoredFile(request, reply, file);
  });

  fastify.get("/media/:id/thumbnail", { preHandler: optionalAuth }, async (request, reply) => {
    const { id } = mediaIdParamsSchema.parse(request.params);
    const isAdmin = request.userId ? await service.isUserAdmin(request.server.sql, request.userId) : false;
    const file = await service.getStreamableFile(request.server.sql, request.userId, isAdmin, id, "thumbnail");
    return sendStoredFile(request, reply, file);
  });
}
