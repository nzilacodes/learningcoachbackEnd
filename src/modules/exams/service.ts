import type { SupabaseClient } from "@supabase/supabase-js";
import { CEFR_LEVELS, cefrRank, type CefrLevel } from "../../lib/cefr.js";
import * as repo from "./repository.js";

class ForbiddenError extends Error {
  statusCode = 403;
}

/**
 * Ports the SQL private.get_max_unlocked_level loop: start at the user's
 * diagnostic base level, and advance one level for every consecutive passed
 * exam attempt at the current level.
 */
export async function getMaxUnlockedLevel(db: SupabaseClient, userId: string): Promise<CefrLevel | null> {
  const base = await repo.getProfileCefrLevel(db, userId);
  if (!base) return null;

  let rank = cefrRank(base);
  while (rank < CEFR_LEVELS.length) {
    const current = CEFR_LEVELS[rank - 1] as CefrLevel;
    const passed = await repo.hasPassedAttempt(db, userId, current);
    if (!passed) break;
    rank += 1;
  }
  return CEFR_LEVELS[rank - 1] as CefrLevel;
}

export async function getExamForClient(db: SupabaseClient, level: CefrLevel) {
  const exam = await repo.getExam(db, level);
  // Never ship the answer key (`a`) to the client — the old direct Supabase
  // read exposed it verbatim, letting anyone read the correct answers over the network.
  return {
    level: exam.level,
    title: exam.title,
    questions: exam.questions.map((q) => ({ q: q.q, opts: q.opts })),
  };
}

export async function submitExam(
  db: SupabaseClient,
  userId: string,
  level: CefrLevel,
  answers: Record<string, number>,
) {
  const unlocked = await getMaxUnlockedLevel(db, userId);
  if (!unlocked || cefrRank(level) !== cefrRank(unlocked)) {
    throw new ForbiddenError("You may only take the exam for your current unlocked level");
  }

  const [exam, minScore] = await Promise.all([repo.getExam(db, level), repo.getMinExamScore(db)]);

  const total = exam.questions.length;
  const correct = exam.questions.reduce((acc, q, i) => acc + (answers[String(i)] === q.a ? 1 : 0), 0);
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const passed = score >= minScore;

  await repo.insertAttempt(db, { userId, level, score, passed, answers });
  return { score, passed, minScore };
}
