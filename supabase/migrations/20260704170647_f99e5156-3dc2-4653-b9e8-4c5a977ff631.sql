
-- Age room enum
DO $$ BEGIN
  CREATE TYPE public.age_room AS ENUM ('kids','teens','adults');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: derive room from an age
CREATE OR REPLACE FUNCTION public.age_to_room(_age int)
RETURNS public.age_room LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _age IS NULL THEN 'adults'::public.age_room
    WHEN _age < 13 THEN 'kids'::public.age_room
    WHEN _age < 18 THEN 'teens'::public.age_room
    ELSE 'adults'::public.age_room
  END;
$$;

-- Helper: current user's room (from profile), for RLS
CREATE OR REPLACE FUNCTION public.current_user_room()
RETURNS public.age_room LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.age_to_room(p.age) FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_room() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_room() TO authenticated;

-- Add CEFR level column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cefr_level TEXT;

-- 1) user_stats
CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp INT NOT NULL DEFAULT 0,
  streak_days INT NOT NULL DEFAULT 0,
  last_activity_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_stats TO authenticated;
GRANT ALL ON public.user_stats TO service_role;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own stats select" ON public.user_stats FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own stats upsert" ON public.user_stats FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own stats update" ON public.user_stats FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_user_stats_updated BEFORE UPDATE ON public.user_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) lesson_progress
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  lesson_id TEXT,
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, unit_id, lesson_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_progress TO authenticated;
GRANT ALL ON public.lesson_progress TO service_role;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prog all" ON public.lesson_progress FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_lesson_progress_updated BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) study_sessions (one row per day per user)
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  seconds INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_sessions TO authenticated;
GRANT ALL ON public.study_sessions TO service_role;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sessions all" ON public.study_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_study_sessions_updated BEFORE UPDATE ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) study_reminders
CREATE TABLE IF NOT EXISTS public.study_reminders (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  interval_minutes INT NOT NULL DEFAULT 30 CHECK (interval_minutes BETWEEN 5 AND 480),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_reminders TO authenticated;
GRANT ALL ON public.study_reminders TO service_role;
ALTER TABLE public.study_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reminders all" ON public.study_reminders FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_study_reminders_updated BEFORE UPDATE ON public.study_reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) community_messages
CREATE TABLE IF NOT EXISTS public.community_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room public.age_room NOT NULL,
  display_name TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_room_created ON public.community_messages(room, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.community_messages TO authenticated;
GRANT ALL ON public.community_messages TO service_role;
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room select" ON public.community_messages FOR SELECT TO authenticated
  USING (room = public.current_user_room() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "room insert own" ON public.community_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND room = public.current_user_room());
CREATE POLICY "own delete" ON public.community_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
