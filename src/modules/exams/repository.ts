import type { SupabaseClient } from "@supabase/supabase-js";
import type { CefrLevel } from "../../lib/cefr.js";

export type ExamQuestion = { q: string; opts: string[]; a: number };

export async function getExam(db: SupabaseClient, level: CefrLevel) {
  const { data, error } = await db.from("level_exams").select("level, title, questions").eq("level", level).single();
  if (error) throw error;
  return data as { level: CefrLevel; title: string; questions: ExamQuestion[] };
}

export async function getMinExamScore(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("app_settings").select("min_exam_score").eq("id", true).single();
  if (error) throw error;
  return data.min_exam_score as number;
}

export async function getProfileCefrLevel(db: SupabaseClient, userId: string): Promise<CefrLevel | null> {
  const { data, error } = await db.from("profiles").select("cefr_level").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.cefr_level as CefrLevel | null) ?? null;
}

export async function hasPassedAttempt(db: SupabaseClient, userId: string, level: CefrLevel): Promise<boolean> {
  const { data, error } = await db
    .from("level_exam_attempts")
    .select("id")
    .eq("user_id", userId)
    .eq("level", level)
    .eq("passed", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function insertAttempt(
  db: SupabaseClient,
  params: { userId: string; level: CefrLevel; score: number; passed: boolean; answers: Record<string, number> },
) {
  const { error } = await db.from("level_exam_attempts").insert({
    user_id: params.userId,
    level: params.level,
    score: params.score,
    passed: params.passed,
    answers: params.answers,
  });
  if (error) throw error;
}
