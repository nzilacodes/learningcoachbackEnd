-- Defense-in-depth hardening for the security-critical domains now served by
-- learningcoachbackEnd (certificates, level exams, diagnostic placement, XP/
-- gamification). These paths are exploitable today because RLS/GRANTs let an
-- authenticated client write outcome-determining values directly; once the
-- backend owns these writes via the service-role key (which bypasses RLS
-- entirely), the only remaining purpose of these client-facing grants/policies
-- is to leave the forgery paths open. This migration only removes them and
-- adds one column-protection trigger — no data model changes, nothing the
-- backend's service-role client depends on.
--
-- NOT applied automatically to the live project — review, then apply
-- separately once confirmed (see audit.md P0 items / plan §7).

-- 1) certificates: drop the self-service INSERT policy. The `issue_certificate`
--    RPC's own client EXECUTE grant is revoked below, so both forgery paths
--    close at once; certificates are now issued exclusively by the backend
--    (service role) after it verifies a passed level_exam_attempts row.
DROP POLICY IF EXISTS "Users insert own certificates" ON public.certificates;

-- 2) Revoke client EXECUTE on the two SECURITY DEFINER functions whose logic
--    trusted caller-supplied outcome values (`issue_certificate._score`,
--    `award_activity._xp/._coins`). The backend does not call these RPCs —
--    it performs the equivalent inserts/updates directly via service role,
--    which ignores GRANTs entirely — so revoking them only removes the
--    client-callable path.
REVOKE EXECUTE ON FUNCTION public.issue_certificate(public.cefr_level, uuid, numeric, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.award_activity(text, integer, integer, jsonb) FROM authenticated;

-- 3) level_exam_attempts: results are now graded and inserted by the backend
--    only, never the client.
DROP POLICY IF EXISTS "Users insert own attempts" ON public.level_exam_attempts;

-- 4) diagnostic_results: same reasoning — grading + persistence now happens
--    entirely in the backend's /v1/assessments/diagnostic handler.
DROP POLICY IF EXISTS "own diag insert" ON public.diagnostic_results;
DROP POLICY IF EXISTS "own diag update" ON public.diagnostic_results;

-- 5) user_stats: XP/streak now flow exclusively through the backend's
--    /v1/xp/events handler, which keeps profiles.xp and user_stats.xp in sync.
DROP POLICY IF EXISTS "own stats upsert" ON public.user_stats;
DROP POLICY IF EXISTS "own stats update" ON public.user_stats;

-- 6) xp_events: keep SELECT (own read history is harmless), drop direct
--    client INSERT — the backend logs events itself after computing the
--    server-side reward amount.
DROP POLICY IF EXISTS "own xp events insert" ON public.xp_events;

-- 7) profiles: column-level protection for xp/coins/level/cefr_level, modeled
--    directly on the existing enforce_age_immutable() trigger. RLS is
--    row-level only, so this is the same mechanism already used to protect
--    `age` — extended to the columns the backend now owns.
CREATE OR REPLACE FUNCTION public.enforce_gamified_columns_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The backend connects with the service-role key (no user JWT, so
  -- auth.uid() is NULL) — BYPASSRLS exempts it from RLS policies but NOT
  -- from triggers, so it must be explicitly allowed through here via its
  -- JWT `role` claim, the same signal auth.role() already exposes.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (NEW.xp IS DISTINCT FROM OLD.xp
      OR NEW.coins IS DISTINCT FROM OLD.coins
      OR NEW.level IS DISTINCT FROM OLD.level
      OR NEW.cefr_level IS DISTINCT FROM OLD.cefr_level)
     AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'xp, coins, level and cefr_level can only be changed by the backend service or an admin.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_gamified_columns_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_gamified_columns_immutable_trg ON public.profiles;
CREATE TRIGGER enforce_gamified_columns_immutable_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_gamified_columns_immutable();
