import type { GradeResult } from "./types.js";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// correct_answer shape: { answers: string[] } — a list of acceptable strings
// (synonyms/spelling variants), not just one, since a fill-in-the-blank
// often has more than one valid completion.
export function gradeFillBlank(correctAnswer: unknown, response: unknown): GradeResult {
  const accepted = Array.isArray((correctAnswer as { answers?: unknown } | null)?.answers)
    ? ((correctAnswer as { answers: unknown[] }).answers.filter((a): a is string => typeof a === "string"))
    : [];
  const text = typeof (response as { text?: unknown } | null)?.text === "string" ? (response as { text: string }).text : "";
  if (accepted.length === 0) return { isCorrect: false, score: 0 };
  const isCorrect = accepted.some((a) => normalize(a) === normalize(text));
  return { isCorrect, score: isCorrect ? 100 : 0 };
}
