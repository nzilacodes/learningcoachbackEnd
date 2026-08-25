import { z } from "zod";
import { callChatCompletion, clampScore } from "../../../lib/ai-gateway.js";
import type { GradeResult } from "./types.js";

// Below this, an AI-graded response counts as "incorrect" for the correctCount
// tally (hearts are never deducted for this — see service.ts) and for
// perQuestionFeedback's isCorrect flag. Configurable in one place.
const AI_CORRECT_THRESHOLD = 60;

const WritingGradeSchema = z.object({
  score: z.number().min(0).max(100).default(0),
  feedback: z.string().default(""),
});

// Same "strict JSON, defensive parse" shape as diagnostic/service.ts's
// SYSTEM_PROMPT — a malformed AI response degrades to a 0 score instead of
// throwing into the student-facing submit path.
export async function gradeWriting(
  prompt: string,
  rubric: string[] | undefined,
  response: unknown,
): Promise<GradeResult> {
  const text = typeof (response as { text?: unknown } | null)?.text === "string" ? (response as { text: string }).text.trim() : "";
  if (!text) return { isCorrect: false, score: 0, feedback: "Resposta vazia." };

  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an ESL writing examiner following CEFR standards. Score the student's short written response 0-100 against the given prompt and rubric criteria (grammar, vocabulary, coherence, task achievement). Give one short paragraph of feedback in Portuguese-PT. Return strict JSON only: { \"score\": number, \"feedback\": string }.",
      },
      { role: "user", content: JSON.stringify({ prompt, rubric: rubric ?? [], student_text: text }) },
    ],
  });

  let parsed: { score?: number; feedback?: string } = {};
  try {
    parsed = WritingGradeSchema.partial().parse(JSON.parse(content));
  } catch {
    parsed = {};
  }
  const score = clampScore(parsed.score ?? 0);
  return { isCorrect: score >= AI_CORRECT_THRESHOLD, score, feedback: parsed.feedback ?? "" };
}
