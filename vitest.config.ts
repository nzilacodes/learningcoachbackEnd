import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Fastify's first app.inject() in a process can have highly variable
    // cold-start latency on a loaded machine — seen ranging from ~100ms to
    // several seconds in this suite. The default 5s timeout is too tight.
    testTimeout: 20000,
  },
});
