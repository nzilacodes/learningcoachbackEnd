import { z } from "zod";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];
export const cefrLevelSchema = z.enum(CEFR_LEVELS);

export function cefrRank(level: CefrLevel): number {
  const rank = CEFR_LEVELS.indexOf(level) + 1;
  if (rank <= 0) {
    // Defense in depth: `level` is typed CefrLevel, but values that reach here
    // from the database (no CHECK constraint) or older rows can still be
    // outside CEFR_LEVELS. Treat unrecognized input as A1 instead of letting
    // callers index CEFR_LEVELS[-1] === undefined further downstream.
    console.warn(`[cefr] invalid CEFR level "${level}" encountered; treating as A1`);
    return 1;
  }
  return rank;
}
