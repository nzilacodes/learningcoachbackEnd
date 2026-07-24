import type { Sql } from "postgres";
import { callChatCompletion, clampScore, similarity } from "../../lib/ai-gateway.js";
import * as repo from "./repository.js";
import {
  GRAMMAR,
  VOCABULARY,
  READING,
  LISTENING,
  WRITING_PROMPTS,
  SPEAKING_PROMPTS,
  PRONUNCIATION_PROMPTS,
  scoreMcq,
} from "./bank.js";

type SubmitInput = {
  grammarAnswers: (number | null)[];
  vocabAnswers: (number | null)[];
  readingAnswers: (number | null)[];
  listeningAnswers: (number | null)[];
  writing: string[];
  speaking: string[];
  pronunciation: string[];
  profile: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are an ESL examiner following CEFR standards.
You will:
1. Score each writing and speaking submission on a 0–100 scale (grammar, vocabulary, coherence).
2. Return an overall CEFR level (A1, A2, B1, B2, C1, or C2) based on ALL scores provided.
3. Identify 3 concrete strengths and 3 concrete weaknesses (short bullet phrases in Portuguese-PT).
4. Give one paragraph of feedback (Portuguese-PT, warm and encouraging, 2–4 sentences).
5. Produce a 4-week personalized learning plan tailored to the weaknesses. Each week has: title (PT), focus_skill (one of: grammar, vocabulary, reading, listening, writing, speaking, pronunciation), goals (2–4 short bullet phrases in PT), estimated_minutes (integer between 60 and 240).
Respond with a SINGLE JSON object matching this schema exactly, no extra keys or prose:
{
  "writing_score": number,
  "speaking_score": number,
  "cefr_level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
  "strengths": string[],
  "weaknesses": string[],
  "feedback": string,
  "learning_plan": [{"week": number, "title": string, "focus_skill": string, "goals": string[], "estimated_minutes": number}]
}`;

export async function submitDiagnostic(sql: Sql, userId: string, input: SubmitInput) {
  const grammar = scoreMcq(GRAMMAR, input.grammarAnswers);
  const vocabulary = scoreMcq(VOCABULARY, input.vocabAnswers);
  const reading = scoreMcq(READING, input.readingAnswers);
  const listening = scoreMcq(LISTENING, input.listeningAnswers);

  const pronScores = PRONUNCIATION_PROMPTS.map((p, i) =>
    Math.round(similarity(p.sentence, input.pronunciation[i] ?? "") * 100),
  );
  const pronunciation = pronScores.length ? Math.round(pronScores.reduce((a, b) => a + b, 0) / pronScores.length) : 0;

  const userPrompt = JSON.stringify({
    objective_scores: { grammar, vocabulary, reading, listening, pronunciation },
    writing_submissions: WRITING_PROMPTS.map((w, i) => ({ id: w.id, prompt: w.prompt, text: input.writing[i] })),
    speaking_submissions: SPEAKING_PROMPTS.map((s, i) => ({ id: s.id, prompt: s.prompt, transcript: input.speaking[i] })),
    learner_profile: input.profile,
  });

  const content = await callChatCompletion({
    model: "google/gemini-3-flash-preview",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  let parsed: {
    writing_score?: number;
    speaking_score?: number;
    cefr_level?: string;
    strengths?: string[];
    weaknesses?: string[];
    feedback?: string;
    learning_plan?: unknown[];
  } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const writing = clampScore(parsed.writing_score ?? 0);
  const speaking = clampScore(parsed.speaking_score ?? 0);
  const overall = Math.round((grammar + vocabulary + reading + listening + writing + speaking + pronunciation) / 7);
  const cefrLevel = parsed.cefr_level ?? "A1";

  const scores = { grammar, vocabulary, reading, listening, writing, speaking, pronunciation, overall };
  const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [];
  const weaknesses = Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 5) : [];
  const feedback = parsed.feedback ?? "";
  const learningPlan = Array.isArray(parsed.learning_plan) ? parsed.learning_plan.slice(0, 8) : [];

  await repo.insertDiagnosticResult(sql, {
    userId,
    cefrLevel,
    scores,
    strengths,
    weaknesses,
    feedback,
    learningPlan,
    rawAnswers: {
      grammar: input.grammarAnswers,
      vocabulary: input.vocabAnswers,
      reading: input.readingAnswers,
      listening: input.listeningAnswers,
      writing: input.writing,
      speaking: input.speaking,
      pronunciation: input.pronunciation,
    },
  });

  const onboardingStatus = await repo.getProfileOnboardingStatus(sql, userId);
  await repo.updateProfileAfterDiagnostic(sql, userId, cefrLevel, onboardingStatus === "placement");

  return { scores, cefr_level: cefrLevel, strengths, weaknesses, feedback, learning_plan: learningPlan };
}
