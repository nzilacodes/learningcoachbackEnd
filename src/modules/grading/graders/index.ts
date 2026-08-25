import { ValidationError } from "../../../lib/errors.js";
import { gradeMcq } from "./mcq.js";
import { gradeFillBlank } from "./fill_blank.js";
import { gradeOrdering } from "./ordering.js";
import { gradeMatching } from "./matching.js";
import { gradeWriting } from "./writing.js";
import { gradeSpeaking } from "./speaking.js";
import type { GradeResult } from "./types.js";

export type { GradeResult };

// Deterministic types are graded synchronously, instantly, at zero AI cost —
// service.ts grades all of these before any AI-graded ones, so a mid-attempt
// AI outage never affects them.
export const DETERMINISTIC_TYPES = new Set(["mcq", "fill_blank", "ordering", "matching"]);

export type ExerciseForGrading = {
  id: string;
  type: string;
  prompt: string;
  data: Record<string, unknown> | null;
  correct_answer: unknown;
};

export async function gradeExercise(exercise: ExerciseForGrading, response: unknown): Promise<GradeResult> {
  switch (exercise.type) {
    case "mcq":
      return gradeMcq(exercise.correct_answer, response);
    case "fill_blank":
      return gradeFillBlank(exercise.correct_answer, response);
    case "ordering":
      return gradeOrdering(exercise.correct_answer, response);
    case "matching":
      return gradeMatching(exercise.correct_answer, response);
    case "writing": {
      const rubric = Array.isArray(exercise.data?.rubric)
        ? (exercise.data!.rubric as unknown[]).filter((r): r is string => typeof r === "string")
        : undefined;
      return gradeWriting(exercise.prompt, rubric, response);
    }
    case "speaking": {
      const targetText =
        (typeof exercise.data?.targetText === "string" ? (exercise.data!.targetText as string) : "") ||
        exercise.prompt;
      return gradeSpeaking(targetText, response);
    }
    default:
      throw new ValidationError(`Unsupported exercise type for grading: ${exercise.type}`);
  }
}
