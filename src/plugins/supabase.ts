import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

// Ported from learningcoach's src/integrations/supabase/client.server.ts —
// new Supabase API keys are opaque strings, not bearer JWTs, so any stray
// Authorization header matching the key itself must be stripped.
function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

declare module "fastify" {
  interface FastifyInstance {
    supabaseAdmin: SupabaseClient;
    /** Per-request client bound to the caller's own JWT — RLS still applies, used as defense-in-depth. */
    createUserClient(accessToken: string): SupabaseClient;
  }
}

export default fp(async function supabasePlugin(fastify: FastifyInstance) {
  const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { fetch: createSupabaseFetch(env.SUPABASE_SERVICE_ROLE_KEY) },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  fastify.decorate("supabaseAdmin", supabaseAdmin);

  fastify.decorate("createUserClient", (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      global: {
        fetch: createSupabaseFetch(env.SUPABASE_PUBLISHABLE_KEY),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
});
