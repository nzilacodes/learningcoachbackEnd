import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/roles.js";
import {
  issueCertificateSchema,
  issueCertificateAdminSchema,
  verifyCertificateParamsSchema,
  certificateIdParamsSchema,
  listCertificatesQuerySchema,
  revokeCertificateSchema,
} from "./schemas.js";
import * as service from "./service.js";

export default async function certificatesRoutes(fastify: FastifyInstance) {
  const adminOnly = [requireAuth, requireRole("admin")];

  fastify.post("/certificates", { preHandler: requireAuth }, async (request, reply) => {
    const input = issueCertificateSchema.parse(request.body);
    const cert = await service.issueCertificate(request.server.sql, request.userId, input);
    return reply.status(201).send(cert);
  });

  fastify.get("/me/certificates", { preHandler: requireAuth }, async (request) => {
    return service.listMyCertificates(request.server.sql, request.userId);
  });

  fastify.get("/certificates/verify/:code", async (request, reply) => {
    const { code } = verifyCertificateParamsSchema.parse(request.params);
    const cert = await service.verifyCertificate(request.server.sql, code);
    if (!cert) return reply.status(404).send({ title: "Certificate not found", status: 404 });
    return cert;
  });

  fastify.get("/admin/certificates", { preHandler: adminOnly }, async (request) => {
    const params = listCertificatesQuerySchema.parse(request.query);
    return service.listCertificatesAdmin(request.server.sql, params);
  });

  fastify.post("/admin/certificates", { preHandler: adminOnly }, async (request, reply) => {
    const input = issueCertificateAdminSchema.parse(request.body);
    const cert = await service.issueCertificateAdmin(request.server.sql, request.userId, input);
    return reply.status(201).send(cert);
  });

  fastify.post("/admin/certificates/:id/revoke", { preHandler: adminOnly }, async (request) => {
    const { id } = certificateIdParamsSchema.parse(request.params);
    const { reason } = revokeCertificateSchema.parse(request.body);
    return service.revokeCertificateAdmin(request.server.sql, id, request.userId, reason);
  });
}
