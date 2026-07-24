import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Sql } from "postgres";
import { sql } from "../db/sql.js";

declare module "fastify" {
  interface FastifyInstance {
    sql: Sql;
  }
}

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  fastify.decorate("sql", sql);
  fastify.addHook("onClose", async () => {
    await sql.end({ timeout: 5 });
  });
});
