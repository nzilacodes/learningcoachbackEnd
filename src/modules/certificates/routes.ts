import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { issueCertificateSchema, verifyCertificateParamsSchema } from "./schemas.js";
import * as service from "./service.js";

export default async function certificatesRoutes(fastify: FastifyInstance) {
  fastify.post("/certificates", { preHandler: requireAuth }, async (request, reply) => {
    const input = issueCertificateSchema.parse(request.body);
    const cert = await service.issueCertificate(request.server.supabaseAdmin, request.userId, input);
    return reply.status(201).send(cert);
  });

  fastify.get("/me/certificates", { preHandler: requireAuth }, async (request) => {
    return service.listMyCertificates(request.server.supabaseAdmin, request.userId);
  });

  fastify.get("/certificates/verify/:code", async (request, reply) => {
    const { code } = verifyCertificateParamsSchema.parse(request.params);
    const cert = await service.verifyCertificate(request.server.supabaseAdmin, code);
    if (!cert) return reply.status(404).send({ title: "Certificate not found", status: 404 });
    return cert;
  });
}
