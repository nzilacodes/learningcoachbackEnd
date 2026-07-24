import type { Sql } from "postgres";

export async function getProfileOnboardingStatus(sql: Sql, userId: string) {
  const rows = await sql<{ onboarding_status: string | null }[]>`
    SELECT onboarding_status FROM public.profiles WHERE id = ${userId}
  `;
  return rows[0]?.onboarding_status ?? null;
}

export async function insertDiagnosticResult(
  sql: Sql,
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
  await sql`
    INSERT INTO public.diagnostic_results (
      user_id, cefr_level, overall_score, grammar_score, vocabulary_score,
      reading_score, listening_score, writing_score, speaking_score, pronunciation_score,
      strengths, weaknesses, feedback, learning_plan, raw_answers
    ) VALUES (
      ${params.userId}, ${params.cefrLevel}, ${params.scores.overall}, ${params.scores.grammar}, ${params.scores.vocabulary},
      ${params.scores.reading}, ${params.scores.listening}, ${params.scores.writing}, ${params.scores.speaking}, ${params.scores.pronunciation},
      ${sql.json(params.strengths)}, ${sql.json(params.weaknesses)}, ${params.feedback},
      ${JSON.stringify(params.learningPlan)}::jsonb, ${JSON.stringify(params.rawAnswers)}::jsonb
    )
  `;
}

export async function updateProfileAfterDiagnostic(sql: Sql, userId: string, cefrLevel: string, advanceOnboarding: boolean) {
  if (advanceOnboarding) {
    await sql`UPDATE public.profiles SET cefr_level = ${cefrLevel}, onboarding_status = 'plan' WHERE id = ${userId}`;
  } else {
    await sql`UPDATE public.profiles SET cefr_level = ${cefrLevel} WHERE id = ${userId}`;
  }
}
