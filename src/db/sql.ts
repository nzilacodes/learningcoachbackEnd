import postgres from "postgres";
import { env } from "../config/env.js";

// Shared Postgres connection, used by both the Fastify app (via plugins/db.ts)
// and the standalone migration runner (db/migrate.ts). Direct connection —
// no PostgREST, no RLS enforcement from this role; the backend is the sole
// authorization boundary now.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
});
