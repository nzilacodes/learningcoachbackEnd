import { z } from "zod";
import { callChatCompletion, clampScore } from "../../../lib/ai-gateway.js";
import type { GradeResult } from "./types.js";

const AI_CORRECT_THRESHOLD = 60;

const SpeakingGradeSchema = z.object({
  score: z.number().min(0).max(100).default(0),
  feedback: z.string().default(""),
});

// Same idea as ai/service.ts's assessPronunciation/assessReading, scoped to
// grading one lesson exercise's transcript against its target sentence.
export async function gradeSpeaking(targetText: string, response: unknown): Promise<GradeResult> {
  const transcript =
    typeof (response as { transcript?: unknown } | null)?.transcript === "string"
      ? (response as { transcript: string }).transcript.trim()
      : "";
  if (!transcript) return { isCorrect: false, score: 0, feedback: "Nenhuma fala detetada." };

  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an English speaking coach. Compare the learner's spoken transcript against the target sentence/phrase and grade it 0-100 on pronunciation accuracy, fluency and content match. Give one short paragraph of feedback in Portuguese-PT. Return strict JSON only: { \"score\": number, \"feedback\": string }.",
      },
      { role: "user", content: JSON.stringify({ target: targetText, transcript }) },
    ],
  });

  let parsed: { score?: number; feedback?: string } = {};
  try {
    parsed = SpeakingGradeSchema.partial().parse(JSON.parse(content));
  } catch {
    parsed = {};
  }
  const score = clampScore(parsed.score ?? 0);
  return { isCorrect: score >= AI_CORRECT_THRESHOLD, score, feedback: parsed.feedback ?? "" };
}
