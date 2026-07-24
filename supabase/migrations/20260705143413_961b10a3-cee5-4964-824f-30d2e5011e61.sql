
CREATE TABLE IF NOT EXISTS public.diagnostic_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cefr_level TEXT NOT NULL,
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  grammar_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  vocabulary_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  reading_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  listening_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  writing_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  speaking_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  pronunciation_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback TEXT,
  learning_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diag_user ON public.diagnostic_results(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.diagnostic_results TO authenticated;
GRANT ALL ON public.diagnostic_results TO service_role;

ALTER TABLE public.diagnostic_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own diag select" ON public.diagnostic_results
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "own diag insert" ON public.diagnostic_results
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own diag update" ON public.diagnostic_results
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_diag_updated
  BEFORE UPDATE ON public.diagnostic_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
