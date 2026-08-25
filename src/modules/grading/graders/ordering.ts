import type { GradeResult } from "./types.js";

// correct_answer shape: { order: number[] } — the correct permutation of the
// item indices shown to the student (exercise.data.items[i]).
export function gradeOrdering(correctAnswer: unknown, response: unknown): GradeResult {
  const correct = Array.isArray((correctAnswer as { order?: unknown } | null)?.order)
    ? ((correctAnswer as { order: unknown[] }).order.filter((n): n is number => typeof n === "number"))
    : null;
  const picked = Array.isArray((response as { order?: unknown } | null)?.order)
    ? ((response as { order: unknown[] }).order.filter((n): n is number => typeof n === "number"))
    : null;
  const isCorrect =
    !!correct &&
    !!picked &&
    correct.length > 0 &&
    correct.length === picked.length &&
    correct.every((v, i) => v === picked[i]);
  return { isCorrect, score: isCorrect ? 100 : 0 };
}
