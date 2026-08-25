import { z } from "zod";

export const lessonIdParamsSchema = z.object({ id: z.string().uuid() });

// Discriminated by the exercise's own `type` server-side (never trusted from
// the client) — this union just needs to cover every shape a legitimate
// client could plausibly submit for any exercise type.
const exerciseResponseSchema = z.union([
  z.object({ index: z.number().int().nonnegative() }), // mcq
  z.object({ text: z.string().max(2000) }), // fill_blank / writing
  z.object({ order: z.array(z.number().int()).max(50) }), // ordering
  z.object({ pairs: z.array(z.object({ left: z.number().int(), right: z.number().int() })).max(50) }), // matching
  z.object({ transcript: z.string().max(2000) }), // speaking
]);

export const exerciseAnswerSchema = z.object({
  exerciseId: z.string().uuid(),
  response: exerciseResponseSchema,
});

export const submitLessonAttemptSchema = z.object({
  answers: z.array(exerciseAnswerSchema).max(50),
});
