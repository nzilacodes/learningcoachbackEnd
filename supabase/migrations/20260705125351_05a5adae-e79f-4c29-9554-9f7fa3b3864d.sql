
DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard
WITH (security_invoker = true) AS
SELECT
  p.id AS user_id,
  COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.full_name, 'Learner') AS display_name,
  p.avatar_url,
  p.xp,
  p.streak,
  p.cefr_level,
  RANK() OVER (ORDER BY p.xp DESC) AS rank
FROM public.profiles p
WHERE p.xp > 0;
GRANT SELECT ON public.leaderboard TO authenticated;
