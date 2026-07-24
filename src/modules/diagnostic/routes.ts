import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { submitDiagnosticSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function diagnosticRoutes(fastify: FastifyInstance) {
  fastify.post("/assessments/diagnostic", { preHandler: requireAuth }, async (request) => {
    const input = submitDiagnosticSchema.parse(request.body);
    return service.submitDiagnostic(request.server.supabaseAdmin, request.userId, input);
  });
}
