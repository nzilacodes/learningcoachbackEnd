import type { Sql } from "postgres";
import { CEFR_LEVELS, cefrRank, type CefrLevel } from "../../lib/cefr.js";
import * as repo from "./repository.js";
import { ForbiddenError } from "../../lib/errors.js";

/**
 * Ports the SQL private.get_max_unlocked_level loop: start at the user's
 * diagnostic base level, and advance one level for every consecutive passed
 * exam attempt at the current level.
 */
export async function getMaxUnlockedLevel(sql: Sql, userId: string): Promise<CefrLevel | null> {
  const base = await repo.getProfileCefrLevel(sql, userId);
  if (!base) return null;

  // One query for every passed level instead of one round trip per level in
  // a loop (up to 5 sequential queries for a user near C2).
  const passedLevels = await repo.getPassedLevels(sql, userId);
  let rank = cefrRank(base);
  while (rank < CEFR_LEVELS.length) {
    const current = CEFR_LEVELS[rank - 1] as CefrLevel;
    if (!passedLevels.has(current)) break;
    rank += 1;
  }
  return CEFR_LEVELS[rank - 1] as CefrLevel;
}

export async function getExamForClient(sql: Sql, level: CefrLevel) {
  const exam = await repo.getExam(sql, level);
  // Never ship the answer key (`a`) to the client — the old direct Supabase
  // read exposed it verbatim, letting anyone read the correct answers over the network.
  return {
    level: exam.level,
    title: exam.title,
    questions: exam.questions.map((q) => ({ q: q.q, opts: q.opts })),
  };
}

export const listAttempts = repo.listAttempts;

export async function submitExam(sql: Sql, userId: string, level: CefrLevel, answers: Record<string, number>) {
  const unlocked = await getMaxUnlockedLevel(sql, userId);
  if (!unlocked || cefrRank(level) !== cefrRank(unlocked)) {
    throw new ForbiddenError("You may only take the exam for your current unlocked level");
  }

  const [exam, minScore] = await Promise.all([repo.getExam(sql, level), repo.getMinExamScore(sql)]);

  const total = exam.questions.length;
  const correct = exam.questions.reduce((acc, q, i) => acc + (answers[String(i)] === q.a ? 1 : 0), 0);
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const passed = score >= minScore;

  await repo.insertAttempt(sql, { userId, level, score, passed, answers });
  return { score, passed, minScore };
}
