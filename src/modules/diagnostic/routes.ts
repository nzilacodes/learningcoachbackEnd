import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { AppError, ErrorCode } from "../../lib/errors.js";
import { notifyUser } from "../notifications/service.js";
import { submitDiagnosticSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function diagnosticRoutes(fastify: FastifyInstance) {
  fastify.post("/assessments/diagnostic", { preHandler: requireAuth }, async (request) => {
    const input = submitDiagnosticSchema.parse(request.body);
    try {
      return await service.submitDiagnostic(request.server.sql, request.userId, input);
    } catch (err) {
      // Surface the service-limit case to the notification center too (the
      // spec's own example), then rethrow unchanged — the response the
      // client sees still goes through the normal error-handler flow.
      if (err instanceof AppError && err.code === ErrorCode.AI_SERVICE_LIMIT_REACHED) {
        await notifyUser(request.server.sql, request.userId, {
          category: "system",
          title: "Serviço temporariamente indisponível",
          description: "A avaliação automática não pôde ser concluída.",
        }).catch(() => {});
      }
      throw err;
    }
  });

  fastify.get("/me/diagnostic-result", { preHandler: requireAuth }, async (request) => {
    return service.getLatestResult(request.server.sql, request.userId);
  });
}
