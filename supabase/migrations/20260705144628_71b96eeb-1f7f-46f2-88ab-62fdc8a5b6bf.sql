
-- Move SECURITY DEFINER logic to `private` schema (not exposed by API)
CREATE OR REPLACE FUNCTION private.get_max_unlocked_level(_user_id UUID)
RETURNS public.cefr_level LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base TEXT;
  v_rank INT;
  v_next public.cefr_level;
BEGIN
  SELECT cefr_level INTO v_base FROM public.profiles WHERE id = _user_id;
  IF v_base IS NULL OR v_base NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RETURN NULL;
  END IF;
  v_rank := public.cefr_rank(v_base::public.cefr_level);
  LOOP
    EXIT WHEN v_rank >= 6;
    v_next := (ARRAY['A1','A2','B1','B2','C1','C2']::public.cefr_level[])[v_rank];
    IF EXISTS (
      SELECT 1 FROM public.level_exam_attempts
      WHERE user_id = _user_id AND level = v_next AND passed = true
    ) THEN
      v_rank := v_rank + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN (ARRAY['A1','A2','B1','B2','C1','C2']::public.cefr_level[])[v_rank];
END;
$$;

CREATE OR REPLACE FUNCTION private.can_access_level(_user_id UUID, _level public.cefr_level)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.cefr_rank(_level) <= public.cefr_rank(private.get_max_unlocked_level(_user_id)), false);
$$;

-- Drop insecure public copies
DROP FUNCTION IF EXISTS public.get_max_unlocked_level(UUID);
DROP FUNCTION IF EXISTS public.can_access_level(UUID, public.cefr_level);

-- Safe SECURITY INVOKER wrappers callable from the client — only for the current user
CREATE OR REPLACE FUNCTION public.my_max_unlocked_level()
RETURNS public.cefr_level LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.get_max_unlocked_level(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_i_access_level(_level public.cefr_level)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.can_access_level(auth.uid(), _level);
$$;

REVOKE EXECUTE ON FUNCTION public.my_max_unlocked_level() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_i_access_level(public.cefr_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_max_unlocked_level() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_i_access_level(public.cefr_level) TO authenticated;
