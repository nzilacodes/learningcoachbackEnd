import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import { env } from "./config/env.js";
import dbPlugin from "./plugins/db.js";
import authPlugin from "./plugins/auth.js";
import csrfPlugin from "./plugins/csrf.js";
import registerErrorHandler from "./plugins/error-handler.js";
import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import certificatesRoutes from "./modules/certificates/routes.js";
import examsRoutes from "./modules/exams/routes.js";
import diagnosticRoutes from "./modules/diagnostic/routes.js";
import gamificationRoutes from "./modules/gamification/routes.js";
import billingRoutes from "./modules/billing/routes.js";
import aiRoutes from "./modules/ai/routes.js";
import learningRoutes from "./modules/learning/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import communityRoutes from "./modules/community/routes.js";
import contactRoutes from "./modules/contact/routes.js";
import classesRoutes from "./modules/classes/routes.js";
import notificationsRoutes from "./modules/notifications/routes.js";
import mediaRoutes from "./modules/media/routes.js";
import { reconcileStuckProcessing } from "./modules/media/repository.js";
import { registerStreakReminderJob } from "./jobs/streak-reminder.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
    // UUID per request instead of Fastify's default non-unique incrementing
    // counter — this is what makes `request_id` in error responses (see
    // plugins/error-handler.ts) actually useful as a support/log reference.
    genReqId: () => randomUUID(),
  });

  registerErrorHandler(app);

  // Echo the request id on every response (success or error) so it's
  // traceable from the client/support conversation back to server logs.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
  });

  await app.register(cookie, { secret: env.JWT_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    // Runs after auth's preHandler so request.userId is available for the key,
    // falling back to IP for unauthenticated routes (health, plan list, verify).
    hook: "preHandler",
    keyGenerator: (request) => request.userId || request.ip,
  });

  await app.register(dbPlugin);
  await app.register(authPlugin);
  await app.register(csrfPlugin);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Media assets left mid-'processing' mean the process restarted or crashed
  // before processAsset() finished — there's no job queue to retry them, so
  // reconcile once at boot instead of leaving them stuck forever.
  reconcileStuckProcessing(app.sql).catch((err) => app.log.error({ err }, "media: reconcileStuckProcessing failed"));

  registerStreakReminderJob(app.sql, app.log);

  app.get("/v1/health", async () => ({ status: "ok" }));
  app.get("/v1/config", async () => ({ sandboxPaymentsEnabled: env.SANDBOX_PAYMENTS_ENABLED }));

  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(usersRoutes, { prefix: "/v1" });
  await app.register(certificatesRoutes, { prefix: "/v1" });
  await app.register(examsRoutes, { prefix: "/v1" });
  await app.register(diagnosticRoutes, { prefix: "/v1" });
  await app.register(gamificationRoutes, { prefix: "/v1" });
  await app.register(billingRoutes, { prefix: "/v1" });
  await app.register(aiRoutes, { prefix: "/v1" });
  await app.register(learningRoutes, { prefix: "/v1" });
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(communityRoutes, { prefix: "/v1" });
  await app.register(contactRoutes, { prefix: "/v1" });
  await app.register(classesRoutes, { prefix: "/v1" });
  await app.register(notificationsRoutes, { prefix: "/v1" });
  await app.register(mediaRoutes, { prefix: "/v1" });

  return app;
}
