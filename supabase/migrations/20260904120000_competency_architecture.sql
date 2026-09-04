-- Separation engine, phase 2 — competency/skill dimension, difficulty,
-- prerequisites, and the PRE-A1 level, per the architecture doc's sections
-- 2, 3, 5, 7, 9, 15. Mirrors the age_groups migration's shape: a small fixed
-- reference table (skills) plus a tagging column on lessons, bootstrapped
-- from data that already exists (lesson_type) so nothing goes dark.

-- PRE-A1: ALTER TYPE ... ADD VALUE cannot run in the same transaction as a
-- statement that uses the new label, so this is deliberately its own
-- statement with nothing after it in this file that references 'PRE-A1'.
ALTER TYPE public.cefr_level ADD VALUE IF NOT EXISTS 'PRE-A1' BEFORE 'A1';

CREATE TABLE IF NOT EXISTS public.skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0
);

INSERT INTO public.skills (code, label, order_index) VALUES
  ('listening',     'Listening',     0),
  ('speaking',       'Speaking',       1),
  ('reading',        'Reading',        2),
  ('writing',        'Writing',        3),
  ('pronunciation',  'Pronunciation',  4),
  ('vocabulary',     'Vocabulary',     5),
  ('grammar',        'Grammar',        6),
  ('interaction',    'Interaction',    7)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS skill_id UUID REFERENCES public.skills(id),
  ADD COLUMN IF NOT EXISTS difficulty SMALLINT NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS learning_objective TEXT;
CREATE INDEX IF NOT EXISTS idx_lessons_skill ON public.lessons(skill_id);

-- Bootstrap skill_id from the existing lesson_type — direct mapping where
-- one exists, sensible fallback for the 4 types with no single-skill
-- equivalent (review/project/quiz/final_test span multiple skills by
-- design; tagged here with the skill their content leans on most).
UPDATE public.lessons l SET skill_id = s.id
FROM public.skills s
WHERE l.skill_id IS NULL AND s.code = CASE l.lesson_type
  WHEN 'vocabulary' THEN 'vocabulary'
  WHEN 'grammar' THEN 'grammar'
  WHEN 'reading' THEN 'reading'
  WHEN 'listening' THEN 'listening'
  WHEN 'writing' THEN 'writing'
  WHEN 'speaking' THEN 'speaking'
  WHEN 'pronunciation' THEN 'pronunciation'
  WHEN 'ipa' THEN 'pronunciation'
  WHEN 'review' THEN 'vocabulary'
  WHEN 'project' THEN 'writing'
  WHEN 'quiz' THEN 'vocabulary'
  WHEN 'final_test' THEN 'vocabulary'
END;

-- Self-referential many-to-many: a lesson can require any number of other
-- lessons to be completed first. Starts empty — no reliable way to infer
-- real pedagogical prerequisites from existing data, unlike age_groups'
-- sequential-by-level bootstrap; admins populate this from here on.
CREATE TABLE IF NOT EXISTS public.content_prerequisites (
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  requires_lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, requires_lesson_id),
  CHECK (lesson_id != requires_lesson_id)
);
