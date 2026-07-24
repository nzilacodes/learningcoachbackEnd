import type { SupabaseClient } from "@supabase/supabase-js";

export async function getProfileOnboardingStatus(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("profiles").select("onboarding_status").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.onboarding_status as string | null | undefined;
}

export async function insertDiagnosticResult(
  db: SupabaseClient,
  params: {
    userId: string;
    cefrLevel: string;
    scores: {
      grammar: number;
      vocabulary: number;
      reading: number;
      listening: number;
      writing: number;
      speaking: number;
      pronunciation: number;
      overall: number;
    };
    strengths: string[];
    weaknesses: string[];
    feedback: string;
    learningPlan: unknown;
    rawAnswers: unknown;
  },
) {
  const { error } = await db.from("diagnostic_results").insert({
    user_id: params.userId,
    cefr_level: params.cefrLevel,
    overall_score: params.scores.overall,
    grammar_score: params.scores.grammar,
    vocabulary_score: params.scores.vocabulary,
    reading_score: params.scores.reading,
    listening_score: params.scores.listening,
    writing_score: params.scores.writing,
    speaking_score: params.scores.speaking,
    pronunciation_score: params.scores.pronunciation,
    strengths: params.strengths,
    weaknesses: params.weaknesses,
    feedback: params.feedback,
    learning_plan: params.learningPlan,
    raw_answers: params.rawAnswers,
  });
  if (error) throw error;
}

export async function updateProfileAfterDiagnostic(db: SupabaseClient, userId: string, cefrLevel: string, advanceOnboarding: boolean) {
  const patch: { cefr_level: string; onboarding_status?: string } = { cefr_level: cefrLevel };
  if (advanceOnboarding) patch.onboarding_status = "plan";
  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}
