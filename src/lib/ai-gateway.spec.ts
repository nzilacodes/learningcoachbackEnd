import { describe, expect, it } from "vitest";
import { classifyOpenAiFailure } from "./ai-gateway.js";
import { ErrorCode } from "./errors.js";

function mockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("classifyOpenAiFailure", () => {
  // The exact payload from the bug report (raw OpenAI JSON leaking to the UI).
  it("maps credit_balance_exhausted (429) to AI_SERVICE_LIMIT_REACHED", async () => {
    const res = mockResponse(429, {
      error: {
        message: "You have no credits remaining. Add credits to continue using the API.",
        type: "insufficient_quota",
        param: null,
        code: "credit_balance_exhausted",
      },
    });
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.code).toBe(ErrorCode.AI_SERVICE_LIMIT_REACHED);
    expect(err.retryable).toBe(true);
  });

  it("maps insufficient_quota type (429) to AI_SERVICE_LIMIT_REACHED", async () => {
    const res = mockResponse(429, { error: { message: "quota exceeded", type: "insufficient_quota" } });
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.code).toBe(ErrorCode.AI_SERVICE_LIMIT_REACHED);
  });

  it("maps a generic 429 (no quota code) to AI_SERVICE_LIMIT_REACHED as a rate limit", async () => {
    const res = mockResponse(429, { error: { message: "rate limited, slow down" } });
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.code).toBe(ErrorCode.AI_SERVICE_LIMIT_REACHED);
  });

  it("maps 401/403 (bad API key) to AI_SERVICE_UNAVAILABLE — a config problem, not the student's fault", async () => {
    const res401 = mockResponse(401, { error: { message: "Incorrect API key provided" } });
    expect((await classifyOpenAiFailure(res401, "chat")).code).toBe(ErrorCode.AI_SERVICE_UNAVAILABLE);
    const res403 = mockResponse(403, { error: { message: "forbidden" } });
    expect((await classifyOpenAiFailure(res403, "chat")).code).toBe(ErrorCode.AI_SERVICE_UNAVAILABLE);
  });

  it("maps 400 to AI_EVALUATION_FAILED", async () => {
    const res = mockResponse(400, { error: { message: "invalid request" } });
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.code).toBe(ErrorCode.AI_EVALUATION_FAILED);
  });

  it("maps 500/502/503 to AI_SERVICE_UNAVAILABLE", async () => {
    for (const status of [500, 502, 503]) {
      const res = mockResponse(status, "Internal Server Error");
      expect((await classifyOpenAiFailure(res, "chat")).code).toBe(ErrorCode.AI_SERVICE_UNAVAILABLE);
    }
  });

  it("tolerates a non-JSON body (e.g. an upstream proxy's HTML error page)", async () => {
    const res = mockResponse(500, "<html>502 Bad Gateway</html>");
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.code).toBe(ErrorCode.AI_SERVICE_UNAVAILABLE);
  });

  // Regression guard for the actual leak: the raw upstream body must never
  // end up in the part of the error that plugins/error-handler.ts can send
  // to the client — only in internalDetail, which is logged, not shipped.
  it("never leaks the raw response body into the error message", async () => {
    const rawBody = JSON.stringify({
      error: {
        message:
          "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        type: "insufficient_quota",
        param: null,
        code: "credit_balance_exhausted",
      },
    });
    const res = mockResponse(429, rawBody);
    const err = await classifyOpenAiFailure(res, "chat");
    expect(err.message).not.toContain("platform.openai.com");
    expect(err.message).not.toContain("credit_balance_exhausted");
    expect(err.message).not.toContain("insufficient_quota");
    expect(err.internalDetail).toBe(rawBody);
  });
});
