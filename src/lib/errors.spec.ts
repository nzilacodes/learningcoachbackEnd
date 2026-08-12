import { describe, expect, it } from "vitest";
import { AppError, ErrorCode, UnauthorizedError, PaymentRequiredError, AiServiceError } from "./errors.js";

describe("AppError", () => {
  it("defaults retryable to false and logLevel by statusCode", () => {
    const err = new AppError(ErrorCode.SERVER_ERROR, "boom", { statusCode: 500 });
    expect(err.retryable).toBe(false);
    expect(err.logLevel).toBe("error");
  });

  it("keeps internalDetail out of the public message", () => {
    const err = new AppError(ErrorCode.AI_SERVICE_LIMIT_REACHED, "safe message", {
      statusCode: 503,
      internalDetail: "raw upstream body with secret stuff",
    });
    expect(err.message).toBe("safe message");
    expect(err.message).not.toContain("secret stuff");
    expect(err.internalDetail).toBe("raw upstream body with secret stuff");
  });
});

describe("AiServiceError", () => {
  it("maps each AI error code to the expected status code", () => {
    expect(new AiServiceError(ErrorCode.AI_SERVICE_LIMIT_REACHED, "x").statusCode).toBe(503);
    expect(new AiServiceError(ErrorCode.AI_SERVICE_TIMEOUT, "x").statusCode).toBe(504);
    expect(new AiServiceError(ErrorCode.AI_SERVICE_UNAVAILABLE, "x").statusCode).toBe(503);
    expect(new AiServiceError(ErrorCode.AI_EVALUATION_FAILED, "x").statusCode).toBe(502);
  });

  it("is always retryable", () => {
    expect(new AiServiceError(ErrorCode.AI_SERVICE_LIMIT_REACHED, "x").retryable).toBe(true);
  });
});

describe("errors where retry is the wrong suggestion", () => {
  it("session-expired and payment-required are not retryable", () => {
    // Retrying an expired session or a paywall does nothing useful — the
    // correct actions are re-login and upgrade, respectively.
    expect(new UnauthorizedError().retryable).toBe(false);
    expect(new PaymentRequiredError().retryable).toBe(false);
  });
});
