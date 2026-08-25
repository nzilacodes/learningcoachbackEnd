import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";
import { z } from "zod";
import { callChatCompletion } from "../lib/ai-gateway.js";
import * as repo from "../modules/learning/repository.js";

// One entry per generated exercise, discriminated by `type` — mirrors the
// grader input shapes in modules/grading/graders/*.ts exactly, so whatever
// the AI produces here is gradable without any translation layer later.
const GeneratedExerciseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mcq"),
    prompt: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("fill_blank"),
    prompt: z.string().trim().min(1).max(500),
    answers: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
  }),
  z.object({
    type: z.literal("ordering"),
    prompt: z.string().trim().min(1).max(500),
    items: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
    correctOrder: z.array(z.number().int()).min(2).max(8),
  }),
  z.object({
    type: z.literal("matching"),
    prompt: z.string().trim().min(1).max(500),
    leftItems: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    rightItems: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctPairs: z.array(z.object({ left: z.number().int(), right: z.number().int() })).min(2).max(6),
  }),
]);

const GeneratedBatchSchema = z.object({
  exercises: z.array(GeneratedExerciseSchema).min(3).max(8),
});

type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;

const SYSTEM_PROMPT = `You are a CEFR-aligned English curriculum author. Given a lesson's theme and level, produce 3-8 short graded exercises for it, mixing exercise types (prefer at least one mcq, and vary the rest across fill_blank/ordering/matching where they fit the topic naturally). Exercises must be appropriate for the given CEFR level's vocabulary and grammar range and directly related to the lesson's theme/objective/wordlist.

Stay strictly on-topic: every exercise must directly test the lesson's own theme/vocabulary/wordlist below — never introduce unrelated general-knowledge trivia (e.g. capital cities, historical facts) unless it is itself part of the lesson's wordlist/theme.

Strict per-type rules:
- fill_blank: every string in "answers" must be independently, grammatically correct when substituted into the blank as-is — do not include a different verb form/tense/conjugation just to offer "variety" (e.g. for "I ___ in Paris", "lives" is WRONG because it doesn't agree with "I"; only include forms that are all individually correct for that exact sentence).
- ordering: "items" must be presented in SCRAMBLED order, not already in the correct order — "correctOrder" is how to rearrange them back to correct, so it must differ from the identity order [0,1,2,...] whenever there are 3+ items.
- matching: "leftItems" and "rightItems" must each be presented in a different order than their correct pairing (don't let right item i just happen to already match left item i).

Respond with a SINGLE JSON object matching this schema exactly, no extra keys or prose:
{
  "exercises": [
    { "type": "mcq", "prompt": string, "options": string[2..6], "correctIndex": number },
    { "type": "fill_blank", "prompt": string (use ___ for the blank), "answers": string[1..5] (accepted variants, see rule above) },
    { "type": "ordering", "prompt": string, "items": string[2..8] (SCRAMBLED, not in correct order), "correctOrder": number[] (indices of items, in correct order) },
    { "type": "matching", "prompt": string, "leftItems": string[2..6], "rightItems": string[2..6] (not pre-aligned with leftItems), "correctPairs": [{"left": number, "right": number}] (indices) }
  ]
}`;

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Belt-and-suspenders on top of the prompt's "scrambled items" instruction —
// re-derives a fresh random display order server-side so a lazy/inconsistent
// model response (items already in correct order) can never ship an ordering
// exercise with zero actual reordering to do. Retries a few times if the
// random shuffle happens to land back on the identity order by chance (a
// real ~17% risk at n=3) — not needed once there are more than a handful of
// items, where that odds drops fast, but cheap to guard unconditionally.
function shuffleOrdering(items: string[], correctOrder: number[]): { items: string[]; order: number[] } {
  const correctSequence = correctOrder.map((i) => items[i]);
  for (let attempt = 0; attempt < 5; attempt++) {
    const displayItems = shuffleArray(items);
    const used = new Set<number>();
    const order = correctSequence.map((text) => {
      const idx = displayItems.findIndex((v, i) => v === text && !used.has(i));
      used.add(idx);
      return idx;
    });
    const isIdentity = order.every((v, i) => v === i);
    if (!isIdentity || items.length < 2) return { items: displayItems, order };
  }
  // Exhausted retries (only plausible for very small n) — fall back to
  // whatever the last attempt produced rather than looping forever.
  const displayItems = shuffleArray(items);
  const used = new Set<number>();
  const order = correctSequence.map((text) => {
    const idx = displayItems.findIndex((v, i) => v === text && !used.has(i));
    used.add(idx);
    return idx;
  });
  return { items: displayItems, order };
}

// Same idea for matching: re-shuffle rightItems server-side and recompute
// pairs, so a model response that left rightItems pre-aligned with leftItems
// can't ship a "matching" exercise that requires no actual matching. Retries
// away from the fully-identity pairing (every left === right) the same way.
function shuffleMatching(
  leftItems: string[],
  rightItems: string[],
  correctPairs: { left: number; right: number }[],
): { rightItems: string[]; pairs: { left: number; right: number }[] } {
  const rightTextByLeft = new Map(correctPairs.map((p) => [p.left, rightItems[p.right]]));
  const attempt = (): { rightItems: string[]; pairs: { left: number; right: number }[] } => {
    const displayRight = shuffleArray(rightItems);
    const used = new Set<number>();
    const pairs = leftItems
      .map((_, leftIdx) => {
        const text = rightTextByLeft.get(leftIdx);
        if (text === undefined) return null;
        const idx = displayRight.findIndex((v, i) => v === text && !used.has(i));
        if (idx === -1) return null;
        used.add(idx);
        return { left: leftIdx, right: idx };
      })
      .filter((p): p is { left: number; right: number } => p !== null);
    return { rightItems: displayRight, pairs };
  };
  for (let i = 0; i < 5; i++) {
    const result = attempt();
    const isIdentity = result.pairs.every((p) => p.left === p.right);
    if (!isIdentity || leftItems.length < 2) return result;
  }
  return attempt();
}

function toExerciseInput(g: GeneratedExercise, orderIndex: number): repo.ExerciseInput {
  const base = { xpReward: 5, orderIndex };
  switch (g.type) {
    case "mcq":
      return { ...base, type: "mcq", prompt: g.prompt, data: { options: g.options }, correctAnswer: { index: g.correctIndex } };
    case "fill_blank":
      return { ...base, type: "fill_blank", prompt: g.prompt, data: {}, correctAnswer: { answers: g.answers } };
    case "ordering": {
      const shuffled = shuffleOrdering(g.items, g.correctOrder);
      return { ...base, type: "ordering", prompt: g.prompt, data: { items: shuffled.items }, correctAnswer: { order: shuffled.order } };
    }
    case "matching": {
      const shuffled = shuffleMatching(g.leftItems, g.rightItems, g.correctPairs);
      return {
        ...base,
        type: "matching",
        prompt: g.prompt,
        data: { leftItems: g.leftItems, rightItems: shuffled.rightItems },
        correctAnswer: { pairs: shuffled.pairs },
      };
    }
  }
}

export type GenerateResult =
  | { status: "generated"; count: number }
  | { status: "skipped"; reason: "already_has_exercises" }
  | { status: "failed"; reason: string };

/**
 * Generates one lesson's exercise batch as content_status='draft' rows —
 * never visible to students until an admin reviews and publishes them via
 * the existing PATCH /admin/exercises/:id (see learning/routes.ts). Safe to
 * call repeatedly: skips any lesson that already has exercises of any status.
 */
export async function generateExercisesForLesson(
  sql: Sql,
  lesson: repo.LessonForGeneration,
  batchId: string,
): Promise<GenerateResult> {
  if (await repo.hasAnyExercises(sql, lesson.id)) {
    return { status: "skipped", reason: "already_has_exercises" };
  }

  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    max_tokens: 1500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          cefr_level: lesson.level,
          unit_title: lesson.unit_title,
          lesson_title: lesson.title,
          lesson_type: lesson.lesson_type,
          lesson_summary: lesson.summary,
          lesson_content: lesson.content,
        }),
      },
    ],
  });

  let parsed: z.infer<typeof GeneratedBatchSchema>;
  try {
    parsed = GeneratedBatchSchema.parse(JSON.parse(content));
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "invalid_json" };
  }

  // Re-check right before inserting — closes the (small) window between the
  // idempotency check above and now, in case a concurrent run targeted the
  // same lesson (the CLI runs sequentially, but the admin single-lesson
  // endpoint could race with it).
  if (await repo.hasAnyExercises(sql, lesson.id)) {
    return { status: "skipped", reason: "already_has_exercises" };
  }

  let count = 0;
  for (const g of parsed.exercises) {
    await repo.createExercise(sql, lesson.id, {
      ...toExerciseInput(g, count),
      contentStatus: "draft",
      generatedBy: "ai:gpt-4o-mini",
      generationBatchId: batchId,
    });
    count++;
  }
  return { status: "generated", count };
}

export type RunGenerationBatchOptions = {
  level?: string;
  unitId?: string;
  /** Pause between lessons to stay well under OpenAI rate limits — this is a
   * controlled CLI backfill, not a latency-sensitive request path. */
  delayMs?: number;
  onProgress?: (done: number, total: number, lessonTitle: string, result: GenerateResult) => void;
};

export type RunGenerationBatchSummary = {
  batchId: string;
  total: number;
  generated: number;
  skipped: number;
  failed: number;
};

export async function runGenerationBatch(sql: Sql, opts: RunGenerationBatchOptions = {}): Promise<RunGenerationBatchSummary> {
  const lessons = await repo.listLessonsNeedingExercises(sql, { level: opts.level, unitId: opts.unitId });
  const batchId = randomUUID();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i]!;
    let result: GenerateResult;
    try {
      result = await generateExercisesForLesson(sql, lesson, batchId);
    } catch (err) {
      result = { status: "failed", reason: err instanceof Error ? err.message : "unknown_error" };
    }
    if (result.status === "generated") generated++;
    else if (result.status === "skipped") skipped++;
    else failed++;

    opts.onProgress?.(i + 1, lessons.length, lesson.title, result);
    if (opts.delayMs && i < lessons.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
  }

  return { batchId, total: lessons.length, generated, skipped, failed };
}

// ---------- CLI entrypoint: `npm run generate:exercises -- --level=A1 --unit=<id>` ----------
// Only runs when this file is executed directly (tsx src/jobs/generate-lesson-content.ts),
// not when imported by the admin route below — same guard style as db/migrate.ts's
// standalone `main()`, just gated on being the actual entry module.
function parseCliArgs(argv: string[]): { level?: string; unitId?: string; delayMs: number } {
  const out: { level?: string; unitId?: string; delayMs: number } = { delayMs: 1500 };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "level" && value) out.level = value.toUpperCase();
    if (key === "unit" && value) out.unitId = value;
    if (key === "delayMs" && value) out.delayMs = Number(value);
  }
  return out;
}

async function main() {
  const { sql } = await import("../db/sql.js");
  const args = parseCliArgs(process.argv.slice(2));
  console.log(`Generating exercises${args.level ? ` for level ${args.level}` : ""}${args.unitId ? ` unit ${args.unitId}` : ""}...`);
  const summary = await runGenerationBatch(sql, {
    level: args.level,
    unitId: args.unitId,
    delayMs: args.delayMs,
    onProgress: (done, total, title, result) => {
      console.log(`[${done}/${total}] ${title}: ${result.status}${result.status === "generated" ? ` (${result.count} exercises)` : ""}`);
    },
  });
  console.log(`Done. batch=${summary.batchId} total=${summary.total} generated=${summary.generated} skipped=${summary.skipped} failed=${summary.failed}`);
  console.log("All generated exercises are content_status='draft' — review and publish them via the admin curriculum editor before they reach students.");
  await sql.end();
}

// pathToFileURL handles Windows drive-letter paths (C:\...) correctly —
// a hand-built `file://${path}` string is missing the extra leading slash
// Windows file URLs need (file:///C:/... vs file://C:/...) and silently
// never matches import.meta.url, which made main() never run on Windows.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error("generate-lesson-content failed:", err);
    process.exit(1);
  });
}
