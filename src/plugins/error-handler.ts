import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError, ErrorCode } from "../lib/errors.js";

type ErrorEnvelope = {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    request_id: string;
    fields?: Array<{ path: string; message: string }>;
  };
};

/**
 * The single place an error becomes an HTTP response. Every thrown error —
 * AppError or not — ends up here, gets normalized to a stable internal
 * `code`, logged with full technical detail server-side, and serialized to
 * the client as { success: false, error: { code, message, retryable,
 * request_id } } — never the raw error/stack/upstream body. See lib/errors.ts
 * for the AppError taxonomy this reads.
 */
export default function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler(function (error: Error, request: FastifyRequest, reply: FastifyReply) {
    const requestId = request.id;

    if (error instanceof ZodError) {
      const fields = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      request.log.info({ code: ErrorCode.VALIDATION_ERROR, requestId, route: request.routeOptions?.url, method: request.method, fields }, "validation_error");
      const body: ErrorEnvelope = {
        success: false,
        error: { code: ErrorCode.VALIDATION_ERROR, message: "Dados inválidos.", retryable: false, request_id: requestId, fields },
      };
      return reply.status(400).type("application/json").send(body);
    }

    const appError =
      error instanceof AppError
        ? error
        : new AppError(ErrorCode.SERVER_ERROR, "Internal server error", { statusCode: 500, retryable: true, logLevel: "error" });

    // Every error is logged now, not just >=500 — previously 401/403/429 were
    // never logged at all. Full stack (`err`) only for 5xx, to keep routine
    // 4xx logs (a wrong password, an expired session) lean.
    //
    // For an unclassified exception, `appError` above is a *new* AppError
    // constructed right here — its own stack trace points at this file, not
    // at whatever actually threw. Logging `appError` in that case silently
    // discards the real error (message + stack), making every uncaught 500
    // undiagnosable from the logs. Log the original `error` instead whenever
    // one exists; it's never sent to the client either way (see the safe
    // `message: appError.message` below).
    request.log[appError.logLevel](
      {
        code: appError.code,
        status: appError.statusCode,
        requestId,
        route: request.routeOptions?.url,
        method: request.method,
        userId: request.userId || undefined,
        provider: appError.code.startsWith("AI_") ? "openai" : undefined,
        internalDetail: appError.internalDetail,
        err: appError.statusCode >= 500 ? error : undefined,
      },
      `${appError.code}: ${appError.message}`,
    );

    const body: ErrorEnvelope = {
      success: false,
      error: {
        code: appError.code,
        // appError.message is a safe, already-classified string for <500 (see
        // classifyOpenAiFailure and the AppError subclasses) — the frontend's
        // own ErrorCodeMap is what actually renders to the student; this is
        // just the fallback/log-facing string. Raw internal detail never
        // reaches here — it lives only in `internalDetail`, logged above.
        message: appError.statusCode >= 500 ? "Internal server error" : appError.message,
        retryable: appError.retryable,
        request_id: requestId,
      },
    };
    return reply.status(appError.statusCode).type("application/json").send(body);
  });
}
