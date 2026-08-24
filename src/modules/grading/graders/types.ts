// isCorrect is null for exercise types where "correct/incorrect" isn't a
// binary fact (e.g. an AI-graded writing response is scored on a spectrum) —
// callers that need a boolean (hearts deduction) should only ever do so for
// deterministic types, where isCorrect is always true/false, never null.
export type GradeResult = { isCorrect: boolean | null; score: number; feedback?: string };
