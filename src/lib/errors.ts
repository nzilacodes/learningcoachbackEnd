// Internal, provider-independent error vocabulary. Every thrown error in the
// app should end up as an AppError (or a subclass below) with one of these
// codes, so the frontend never has to know which upstream provider or
// internal detail produced it — see plugins/error-handler.ts for how this
// gets serialized, and lib/ai-gateway.ts's classifyOpenAiFailure for how
// OpenAI's own error shapes get mapped onto it.
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  AI_SERVICE_UNAVAILABLE: "AI_SERVICE_UNAVAILABLE",
  AI_SERVICE_TIMEOUT: "AI_SERVICE_TIMEOUT",
  AI_SERVICE_LIMIT_REACHED: "AI_SERVICE_LIMIT_REACHED",
  AI_EVALUATION_FAILED: "AI_EVALUATION_FAILED",
  AUDIO_NO_SPEECH_DETECTED: "AUDIO_NO_SPEECH_DETECTED",
  HEARTS_DEPLETED: "HEARTS_DEPLETED",
  SERVER_ERROR: "SERVER_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

type LogLevel = "info" | "warn" | "error";

type AppErrorOptions = {
  statusCode: number;
  retryable?: boolean;
  logLevel?: LogLevel;
  /** Technical detail (e.g. a raw upstream error body) — logged internally, never sent to the client. */
  internalDetail?: unknown;
};

/**
 * Base class for every error the app throws deliberately. Carries a stable,
 * machine-readable `code` (independent of any upstream provider) plus enough
 * metadata (retryable, logLevel, statusCode) for plugins/error-handler.ts to
 * turn it into a safe client response and a useful log line without either
 * side having to duck-type `error.message`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly logLevel: LogLevel;
  readonly internalDetail?: unknown;

  constructor(code: ErrorCode, message: string, opts: AppErrorOptions) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? false;
    this.logLevel = opts.logLevel ?? (opts.statusCode >= 500 ? "error" : "info");
    this.internalDetail = opts.internalDetail;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input", internalDetail?: unknown) {
    super(ErrorCode.VALIDATION_ERROR, message, { statusCode: 400, retryable: false, logLevel: "info", internalDetail });
  }
}

// Not retryable: an expired/invalid session needs a fresh login, not a retry.
export class UnauthorizedError extends AppError {
  constructor(message = "Session invalid") {
    super(ErrorCode.AUTH_SESSION_EXPIRED, message, { statusCode: 401, retryable: false, logLevel: "info" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(ErrorCode.PERMISSION_DENIED, message, { statusCode: 403, retryable: false, logLevel: "warn" });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(ErrorCode.NOT_FOUND, message, { statusCode: 404, retryable: false, logLevel: "info" });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(ErrorCode.CONFLICT, message, { statusCode: 409, retryable: false, logLevel: "info" });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests") {
    super(ErrorCode.RATE_LIMITED, message, { statusCode: 429, retryable: true, logLevel: "warn" });
  }
}

// Not retryable: the correct action is "upgrade", not "try again".
export class PaymentRequiredError extends AppError {
  constructor(message = "Payment required") {
    super(ErrorCode.PAYMENT_REQUIRED, message, { statusCode: 402, retryable: false, logLevel: "info" });
  }
}

// Account temporarily locked out after repeated failed logins. No dedicated
// ErrorCode — it's a permission-shaped case ("you may not sign in right
// now") with an already-safe, specific message, so PERMISSION_DENIED covers
// it without inventing a code the frontend would need special-cased copy for.
export class LockedError extends AppError {
  constructor(message = "Account temporarily locked") {
    super(ErrorCode.PERMISSION_DENIED, message, { statusCode: 423, retryable: false, logLevel: "warn" });
  }
}

// The audio was received and sent to the STT provider, but no usable speech
// was found in it (silence, noise, or a clip too short/ambiguous to trust) —
// not a provider failure. 422 (not 400): the request itself was well-formed,
// the *content* just didn't contain what was needed. Retryable because the
// fix is simply "record again", which the frontend surfaces as a friendly
// prompt (see learningcoach's ErrorCodeMap) instead of ever showing a
// hallucinated transcript like "you".
export class NoSpeechDetectedError extends AppError {
  constructor(reason: "silence" | "low_confidence", internalDetail?: unknown) {
    super(ErrorCode.AUDIO_NO_SPEECH_DETECTED, `No usable speech detected (${reason})`, {
      statusCode: 422,
      retryable: true,
      logLevel: "info",
      internalDetail,
    });
  }
}

// Out of lives on a graded lesson — the fix is "wait for regen" (or upgrade),
// not "retry now", but the UI still needs to offer a countdown, so this is
// modeled as retryable=true the same way RateLimitedError is: the *request*
// can be retried once the wait is over, even though retrying immediately won't help.
export class HeartsDepletedError extends AppError {
  constructor(message = "Out of hearts") {
    super(ErrorCode.HEARTS_DEPLETED, message, { statusCode: 403, retryable: true, logLevel: "info" });
  }
}

const AI_ERROR_STATUS: Record<string, number> = {
  [ErrorCode.AI_EVALUATION_FAILED]: 502,
  [ErrorCode.AI_SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.AI_SERVICE_TIMEOUT]: 504,
  [ErrorCode.AI_SERVICE_LIMIT_REACHED]: 503,
};

// Covers every OpenAI-call failure (chat, TTS, STT) once classified by
// classifyOpenAiFailure — see lib/ai-gateway.ts. `internalDetail` is where
// the raw upstream response body lives; it is never read by anything that
// serializes a client response.
export class AiServiceError extends AppError {
  constructor(
    code: "AI_SERVICE_UNAVAILABLE" | "AI_SERVICE_TIMEOUT" | "AI_SERVICE_LIMIT_REACHED" | "AI_EVALUATION_FAILED",
    message: string,
    internalDetail?: unknown,
  ) {
    super(code, message, { statusCode: AI_ERROR_STATUS[code]!, retryable: true, logLevel: "error", internalDetail });
  }
}
