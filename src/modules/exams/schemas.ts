import { z } from "zod";
import { cefrLevelSchema } from "../../lib/cefr.js";

export const levelParamsSchema = z.object({ level: cefrLevelSchema });

export const submitExamSchema = z.object({
  // question index -> chosen option index, mirrors the frontend's Record<number, number>
  answers: z.record(z.string(), z.number().int().nonnegative()),
});
