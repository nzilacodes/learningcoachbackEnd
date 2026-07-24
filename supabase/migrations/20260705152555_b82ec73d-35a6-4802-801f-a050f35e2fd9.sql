
-- Video watch history (resume support)
CREATE TABLE public.video_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id text NOT NULL,
  video_url text NOT NULL,
  title text,
  channel text,
  lesson_id text,
  position_seconds int NOT NULL DEFAULT 0,
  duration_seconds int,
  completed boolean NOT NULL DEFAULT false,
  last_watched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_history TO authenticated;
GRANT ALL ON public.video_history TO service_role;

ALTER TABLE public.video_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own video history"
  ON public.video_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own video history"
  ON public.video_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own video history"
  ON public.video_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own video history"
  ON public.video_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_video_history_updated_at
  BEFORE UPDATE ON public.video_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Shared cache of AI-generated study packs (transcript summary, quiz, activities).
-- Not per-user; safe to read by anyone signed in, written only by service role.
CREATE TABLE public.video_study_packs (
  video_id text PRIMARY KEY,
  video_url text NOT NULL,
  title text,
  channel text,
  topic text,
  level text,
  age_group text,
  pack jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.video_study_packs TO authenticated;
GRANT ALL ON public.video_study_packs TO service_role;

ALTER TABLE public.video_study_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read study packs"
  ON public.video_study_packs FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_video_study_packs_updated_at
  BEFORE UPDATE ON public.video_study_packs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
