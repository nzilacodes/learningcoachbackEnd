import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { z } from "zod";
import registerErrorHandler from "./error-handler.js";
import { AiServiceError, ErrorCode } from "../lib/errors.js";

function buildTestApp() {
  const app = Fastify();
  registerErrorHandler(app);

  const rawOpenAiBody = JSON.stringify({
    error: {
      message: "You have no credits remaining. Add credits to continue using the API.",
      type: "insufficient_quota",
      param: null,
      code: "credit_balance_exhausted",
    },
  });

  app.get("/throw-ai-error", async () => {
    throw new AiServiceError(ErrorCode.AI_SERVICE_LIMIT_REACHED, "chat: provider quota exhausted", rawOpenAiBody);
  });
  app.get("/throw-zod", async () => {
    z.object({ name: z.string() }).parse({});
  });
  app.get("/throw-unknown", async () => {
    throw new Error("some unexpected internal failure, includes a file path and a stack trace");
  });

  return app;
}

describe("registerErrorHandler", () => {
  it("never leaks internalDetail (raw OpenAI body) into the response", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/throw-ai-error" });
    const body = res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCode.AI_SERVICE_LIMIT_REACHED);
    expect(body.error.retryable).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("credit_balance_exhausted");
    expect(raw).not.toContain("insufficient_quota");
  });

  it("shapes ZodError as VALIDATION_ERROR with field-level detail, not a joined string", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/throw-zod" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.fields)).toBe(true);
    expect(body.error.fields.length).toBeGreaterThan(0);
  });

  it("hides unknown/unexpected error messages and stack traces behind a generic string", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/throw-unknown" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.message).not.toContain("stack trace");
  });

  it("always includes a request_id", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/throw-ai-error" });
    expect(res.json().error.request_id).toBeTruthy();
  });
});
