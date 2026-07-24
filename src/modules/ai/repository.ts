import type { Sql } from "postgres";

type WordRow = {
  word: string;
  ipa_uk: string;
  ipa_us: string;
  part_of_speech: string;
  example: string;
  translation_pt: string;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  phrasal_verbs: string[];
  expressions: string[];
};

export async function getCachedWord(sql: Sql, word: string) {
  const rows = await sql`SELECT * FROM public.word_entries WHERE word = ${word}`;
  return rows[0] ?? null;
}

export async function upsertWord(sql: Sql, row: WordRow) {
  const [saved] = await sql`
    INSERT INTO public.word_entries (
      word, ipa_uk, ipa_us, part_of_speech, example, translation_pt,
      synonyms, antonyms, collocations, phrasal_verbs, expressions
    ) VALUES (
      ${row.word}, ${row.ipa_uk}, ${row.ipa_us}, ${row.part_of_speech}, ${row.example}, ${row.translation_pt},
      ${row.synonyms}, ${row.antonyms}, ${row.collocations}, ${row.phrasal_verbs}, ${row.expressions}
    )
    ON CONFLICT (word) DO UPDATE SET
      ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us, part_of_speech = EXCLUDED.part_of_speech,
      example = EXCLUDED.example, translation_pt = EXCLUDED.translation_pt, synonyms = EXCLUDED.synonyms,
      antonyms = EXCLUDED.antonyms, collocations = EXCLUDED.collocations,
      phrasal_verbs = EXCLUDED.phrasal_verbs, expressions = EXCLUDED.expressions
    RETURNING *
  `;
  return saved;
}
