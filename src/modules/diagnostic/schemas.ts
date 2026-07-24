import { z } from "zod";

const mcqAnswers = z.array(z.number().int().nonnegative().nullable());

export const submitDiagnosticSchema = z.object({
  grammarAnswers: mcqAnswers.length(6),
  vocabAnswers: mcqAnswers.length(6),
  readingAnswers: mcqAnswers.length(4),
  listeningAnswers: mcqAnswers.length(4),
  writing: z.array(z.string().max(4000)).length(2),
  speaking: z.array(z.string().max(4000)).length(2),
  pronunciation: z.array(z.string().max(1000)).length(3),
  profile: z
    .object({
      age: z.number().int().optional(),
      native_language: z.string().max(100).optional(),
      learning_goal: z.string().max(200).optional(),
      interests: z.array(z.string().max(100)).optional(),
    })
    .default({}),
});
