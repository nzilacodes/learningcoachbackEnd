import type { GradeResult } from "./types.js";

type Pair = { left: number; right: number };

function toPairs(v: unknown): Pair[] | null {
  const arr = (v as { pairs?: unknown } | null)?.pairs;
  if (!Array.isArray(arr)) return null;
  const pairs = arr
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => p !== null && typeof p.left === "number" && typeof p.right === "number")
    .map((p) => ({ left: p.left as number, right: p.right as number }));
  return pairs.length === arr.length ? pairs : null;
}

// correct_answer shape: { pairs: [{ left, right }] } — left/right index into
// two parallel option lists (exercise.data.leftItems / rightItems).
export function gradeMatching(correctAnswer: unknown, response: unknown): GradeResult {
  const correct = toPairs(correctAnswer);
  const picked = toPairs(response);
  if (!correct || !picked || correct.length === 0) return { isCorrect: false, score: 0 };
  const correctMap = new Map(correct.map((p) => [p.left, p.right]));
  const isCorrect = picked.length === correct.length && picked.every((p) => correctMap.get(p.left) === p.right);
  return { isCorrect, score: isCorrect ? 100 : 0 };
}
