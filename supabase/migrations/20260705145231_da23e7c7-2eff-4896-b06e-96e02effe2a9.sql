
CREATE OR REPLACE FUNCTION private.leaderboard(_limit INT)
RETURNS TABLE(rank BIGINT, user_id UUID, display_name TEXT, xp INT, streak INT, cefr_level TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY COALESCE(us.xp, 0) DESC, p.created_at ASC) AS rank,
    p.id,
    COALESCE(NULLIF(TRIM(split_part(p.full_name,' ',1)),''), 'Aluno') ||
      CASE WHEN position(' ' in COALESCE(p.full_name,'')) > 0
           THEN ' ' || LEFT(split_part(p.full_name,' ',2), 1) || '.'
           ELSE '' END AS display_name,
    COALESCE(us.xp, 0) AS xp,
    COALESCE(us.streak_days, 0) AS streak,
    p.cefr_level
  FROM public.profiles p
  LEFT JOIN public.user_stats us ON us.user_id = p.id
  ORDER BY xp DESC, p.created_at ASC
  LIMIT COALESCE(_limit, 20);
$$;

CREATE OR REPLACE FUNCTION public.leaderboard(_limit INT DEFAULT 10)
RETURNS TABLE(rank BIGINT, user_id UUID, display_name TEXT, xp INT, streak INT, cefr_level TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.leaderboard(_limit);
$$;

CREATE OR REPLACE FUNCTION private.my_rank(_user_id UUID)
RETURNS TABLE(rank BIGINT, total BIGINT, xp INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ranked AS (
    SELECT p.id,
           COALESCE(us.xp, 0) AS xp,
           ROW_NUMBER() OVER (ORDER BY COALESCE(us.xp,0) DESC, p.created_at ASC) AS rn,
           COUNT(*) OVER () AS total
    FROM public.profiles p
    LEFT JOIN public.user_stats us ON us.user_id = p.id
  )
  SELECT rn, total, xp FROM ranked WHERE id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.my_rank()
RETURNS TABLE(rank BIGINT, total BIGINT, xp INT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.my_rank(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.leaderboard(INT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_rank() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_rank() TO authenticated;
