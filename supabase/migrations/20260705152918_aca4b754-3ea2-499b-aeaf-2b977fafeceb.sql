
-- Word data cache
CREATE TABLE public.word_entries (
  word text PRIMARY KEY,
  ipa_uk text,
  ipa_us text,
  part_of_speech text,
  example text,
  translation_pt text,
  synonyms jsonb NOT NULL DEFAULT '[]'::jsonb,
  antonyms jsonb NOT NULL DEFAULT '[]'::jsonb,
  collocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  phrasal_verbs jsonb NOT NULL DEFAULT '[]'::jsonb,
  expressions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.word_entries TO anon, authenticated;
GRANT ALL ON public.word_entries TO service_role;
ALTER TABLE public.word_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Word entries readable by everyone" ON public.word_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Authenticated can upsert word entries" ON public.word_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update word entries" ON public.word_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_word_entries_updated BEFORE UPDATE ON public.word_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend pronunciation_assessments with rich per-attempt metrics
ALTER TABLE public.pronunciation_assessments
  ADD COLUMN IF NOT EXISTS word text,
  ADD COLUMN IF NOT EXISTS intonation numeric(5,2),
  ADD COLUMN IF NOT EXISTS rhythm numeric(5,2),
  ADD COLUMN IF NOT EXISTS clarity numeric(5,2),
  ADD COLUMN IF NOT EXISTS overall numeric(5,2),
  ADD COLUMN IF NOT EXISTS phoneme_issues jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_pron_user_word ON public.pronunciation_assessments (user_id, word, created_at DESC);
