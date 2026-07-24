ALTER TABLE public.reading_assessments
  ADD COLUMN IF NOT EXISTS pronunciation numeric,
  ADD COLUMN IF NOT EXISTS fluency numeric,
  ADD COLUMN IF NOT EXISTS intonation numeric,
  ADD COLUMN IF NOT EXISTS rhythm numeric,
  ADD COLUMN IF NOT EXISTS clarity numeric,
  ADD COLUMN IF NOT EXISTS pauses numeric,
  ADD COLUMN IF NOT EXISTS overall numeric,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS mispronounced jsonb,
  ADD COLUMN IF NOT EXISTS passage_key text;

ALTER TABLE public.reading_assessments ALTER COLUMN lesson_id DROP NOT NULL;