import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";

type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  traceId: string;
};

export default function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler(function (
    error: FastifyError | ZodError | (Error & { statusCode?: number }),
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const traceId = request.id;

    if (error instanceof ZodError) {
      const problem: ProblemDetails = {
        type: "about:blank",
        title: "Validation failed",
        status: 400,
        detail: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        traceId,
      };
      return reply.status(400).type("application/problem+json").send(problem);
    }

    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error, traceId }, "unhandled error");
    }

    const problem: ProblemDetails = {
      type: "about:blank",
      title: status >= 500 ? "Internal server error" : error.message,
      status,
      detail: status >= 500 ? undefined : error.message,
      traceId,
    };
    return reply.status(status).type("application/problem+json").send(problem);
  });
}
