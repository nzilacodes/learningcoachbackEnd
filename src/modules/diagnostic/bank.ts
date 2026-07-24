// Canonical answer key for the placement diagnostic, ported from
// learningcoach/src/lib/diagnostic-bank.ts. This must live server-side only —
// the old flow shipped this bank (including correct answers) to the browser
// and then trusted client-computed scores.
import type { CefrLevel } from "../../lib/cefr.js";

export interface McqItem {
  id: string;
  options: string[];
  correct: number;
  level: CefrLevel;
}

export const GRAMMAR: McqItem[] = [
  { id: "g1", level: "A1", options: ["am", "is", "are", "be"], correct: 1 },
  { id: "g2", level: "A2", options: ["go", "goes", "went", "gone"], correct: 2 },
  { id: "g3", level: "B1", options: ["will", "would", "would have", "are"], correct: 0 },
  { id: "g4", level: "B2", options: ["finished", "have finished", "had finished", "were finishing"], correct: 2 },
  { id: "g5", level: "C1", options: ["I have heard", "have I heard", "I heard", "did I heard"], correct: 1 },
  { id: "g6", level: "C2", options: ["by", "for", "of", "with"], correct: 1 },
];

export const VOCABULARY: McqItem[] = [
  { id: "v1", level: "A1", options: ["small", "tall", "fat", "long"], correct: 0 },
  { id: "v2", level: "A2", options: ["window", "key", "spoon", "book"], correct: 1 },
  { id: "v3", level: "B1", options: ["ignore", "trust", "avoid", "fear"], correct: 1 },
  { id: "v4", level: "B2", options: ["cancel it", "attend it", "delay it", "shorten it"], correct: 2 },
  { id: "v5", level: "C1", options: ["careless", "detail-oriented", "friendly", "hesitant"], correct: 1 },
  { id: "v6", level: "C2", options: ["solve it", "reduce it", "worsen it", "ignore it"], correct: 2 },
];

// Flattened reading questions (2 passages x 2 questions), matches placement.tsx's readingQs.
export const READING: McqItem[] = [
  { id: "r1q1", level: "A2", options: ["By car", "By bus", "By bike", "On foot"], correct: 2 },
  { id: "r1q2", level: "A2", options: ["Cooks dinner", "Reads the news", "Watches a movie", "Rides with her sister"], correct: 1 },
  { id: "r2q1", level: "B2", options: ["higher costs", "isolation", "longer commutes", "less flexibility"], correct: 1 },
  { id: "r2q2", level: "B2", options: ["office focus and home meetings", "collaboration and focus", "shorter days and lower pay", "isolation and productivity"], correct: 1 },
];

export const LISTENING: McqItem[] = [
  { id: "l1", level: "A1", options: ["Eight", "Ten", "Eleven", "Twelve"], correct: 1 },
  { id: "l2", level: "A2", options: ["3:00", "3:15", "3:30", "3:45"], correct: 2 },
  {
    id: "l3",
    level: "B1",
    options: [
      "return the item after fourteen days",
      "keep the receipt and return it within fourteen days",
      "call customer service",
      "email the store",
    ],
    correct: 1,
  },
  {
    id: "l4",
    level: "B2",
    options: ["The team gave up", "The findings were disproved", "The team replicated the results", "The setbacks continued"],
    correct: 2,
  },
];

export const WRITING_PROMPTS = [
  { id: "w1", prompt: "Describe your typical day in 3–5 sentences. Use the present simple tense." },
  {
    id: "w2",
    prompt: "In one short paragraph, argue whether people should learn a second language and why. Give at least two reasons.",
  },
];

export const SPEAKING_PROMPTS = [
  { id: "s1", prompt: "Introduce yourself. Say your name, where you are from, and one hobby you enjoy." },
  {
    id: "s2",
    prompt: "Talk for 30–60 seconds about the last book, film, or trip you enjoyed and explain why you liked it.",
  },
];

// Canonical sentences — never trust a client-supplied "expected" string here.
export const PRONUNCIATION_PROMPTS = [
  { id: "p1", sentence: "The weather is beautiful today." },
  { id: "p2", sentence: "She thoroughly enjoyed the challenging thriller." },
  { id: "p3", sentence: "Entrepreneurs often navigate unpredictable circumstances." },
];

export const CEFR_WEIGHT: Record<CefrLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export function scoreMcq(items: McqItem[], answers: (number | null)[]): number {
  const totalWeight = items.reduce((s, it) => s + CEFR_WEIGHT[it.level], 0);
  const earned = items.reduce((s, it, i) => (answers[i] === it.correct ? s + CEFR_WEIGHT[it.level] : s), 0);
  return totalWeight ? Math.round((earned / totalWeight) * 100) : 0;
}
