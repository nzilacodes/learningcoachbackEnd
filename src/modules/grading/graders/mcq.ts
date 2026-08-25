import type { GradeResult } from "./types.js";

// Mirrors exams/service.ts's submitExam grading (answers[i] === q.a) — same
// "compare an index against the server-held answer key" idea, just scoped to
// one exercise instead of a whole exam.
export function gradeMcq(correctAnswer: unknown, response: unknown): GradeResult {
  const correctIndex = (correctAnswer as { index?: number } | null)?.index;
  const pickedIndex = (response as { index?: number } | null)?.index;
  if (typeof correctIndex !== "number" || typeof pickedIndex !== "number") {
    return { isCorrect: false, score: 0 };
  }
  const isCorrect = pickedIndex === correctIndex;
  return { isCorrect, score: isCorrect ? 100 : 0 };
}
