// Must be imported before any other module (see src/server.ts) — Sentry can
// only auto-instrument things (http, postgres, etc.) that haven't been
// required/imported yet when init() runs.
import * as Sentry from "@sentry/node";
import { env } from "./config/env.js";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
}
