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

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
  });

  registerErrorHandler(app);

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

  app.get("/v1/health", async () => ({ status: "ok" }));

  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(usersRoutes, { prefix: "/v1" });
  await app.register(certificatesRoutes, { prefix: "/v1" });
  await app.register(examsRoutes, { prefix: "/v1" });
  await app.register(diagnosticRoutes, { prefix: "/v1" });
  await app.register(gamificationRoutes, { prefix: "/v1" });
  await app.register(billingRoutes, { prefix: "/v1" });
  await app.register(aiRoutes, { prefix: "/v1" });
  await app.register(learningRoutes, { prefix: "/v1" });

  return app;
}
