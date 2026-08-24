-- =========================
-- Grading engine + hearts + content review workflow
--
-- Purely additive: every new column has a DEFAULT that preserves today's
-- behavior for every existing row (all 1,584 seeded lessons, the 1,572 of
-- them with zero exercises included). Nothing here changes what an existing
-- user sees until an admin explicitly publishes graded exercises for a
-- specific lesson (content_status -> 'published').
-- =========================

-- =========================
-- 1. Exercises: draft/review/publish workflow
-- =========================
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS content_status TEXT NOT NULL DEFAULT 'published'
    CHECK (content_status IN ('draft', 'in_review', 'published')),
  ADD COLUMN IF NOT EXISTS generated_by TEXT,
  ADD COLUMN IF NOT EXISTS generation_batch_id UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_exercises_content_status ON public.exercises(content_status);
CREATE INDEX IF NOT EXISTS idx_exercises_generation_batch ON public.exercises(generation_batch_id);

-- =========================
-- 2. Lessons: pass threshold + hearts opt-out
-- =========================
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS min_pass_score INT NOT NULL DEFAULT 70 CHECK (min_pass_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hearts_enabled BOOLEAN NOT NULL DEFAULT true;

-- =========================
-- 3. lesson_attempts: one row per graded submission
-- =========================
CREATE TABLE IF NOT EXISTS public.lesson_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  passed BOOLEAN NOT NULL,
  correct_count INT NOT NULL DEFAULT 0,
  total_count INT NOT NULL DEFAULT 0,
  hearts_lost INT NOT NULL DEFAULT 0,
  xp_awarded INT NOT NULL DEFAULT 0,
  answers JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.lesson_attempts TO authenticated;
GRANT ALL ON public.lesson_attempts TO service_role;
ALTER TABLE public.lesson_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts select" ON public.lesson_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "own attempts insert" ON public.lesson_attempts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_lesson_attempts_user_lesson ON public.lesson_attempts(user_id, lesson_id, created_at DESC);

-- =========================
-- 4. exercise_attempt_results: one row per question per attempt
-- =========================
CREATE TABLE IF NOT EXISTS public.exercise_attempt_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.lesson_attempts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  submitted_answer JSONB,
  is_correct BOOLEAN,
  score INT,
  ai_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.exercise_attempt_results TO authenticated;
GRANT ALL ON public.exercise_attempt_results TO service_role;
ALTER TABLE public.exercise_attempt_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own results select" ON public.exercise_attempt_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lesson_attempts la WHERE la.id = attempt_id
      AND (la.user_id = auth.uid() OR private.has_role(auth.uid(),'admin'::public.app_role))
  ));
CREATE POLICY "own results insert" ON public.exercise_attempt_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.lesson_attempts la WHERE la.id = attempt_id AND la.user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_exercise_attempt_results_attempt ON public.exercise_attempt_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exercise_attempt_results_exercise ON public.exercise_attempt_results(exercise_id);

-- =========================
-- 5. user_hearts: Duolingo-style lives, lazily regenerated on read
-- =========================
CREATE TABLE IF NOT EXISTS public.user_hearts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hearts INT NOT NULL DEFAULT 5 CHECK (hearts BETWEEN 0 AND 5),
  max_hearts INT NOT NULL DEFAULT 5,
  last_regen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_hearts TO authenticated;
GRANT ALL ON public.user_hearts TO service_role;
ALTER TABLE public.user_hearts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own hearts select" ON public.user_hearts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own hearts insert" ON public.user_hearts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own hearts update" ON public.user_hearts FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER trg_user_hearts_updated BEFORE UPDATE ON public.user_hearts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Note: public.progress (id, user_id, lesson_id, exercise_id, status, score,
-- attempts) already covers similar ground but has zero application code
-- referencing it — lesson_attempts/exercise_attempt_results above replace it
-- for this feature. Left untouched rather than dropped: this is a live
-- production database and DROP TABLE is irreversible for no operational
-- benefit. Safe to remove in a future cleanup migration once confirmed dead.
