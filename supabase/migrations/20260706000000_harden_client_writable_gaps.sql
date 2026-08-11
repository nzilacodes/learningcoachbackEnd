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
-- UPDATE 2026-08-11: the certificates/level_exam_attempts/diagnostic_results/
-- user_stats/xp_events policy drops below were already applied live by some
-- earlier, undocumented action (verified against the live project — those
-- policies no longer exist). The two REVOKEs below, plus the trigger, were
-- NOT live. Separately, a live security-advisor scan found 13 MORE
-- SECURITY DEFINER functions still EXECUTE-able by `anon`/`authenticated`
-- (and, critically, by the implicit `PUBLIC` grant Postgres attaches to
-- every function at CREATE time unless explicitly revoked — a REVOKE ...
-- FROM anon, authenticated alone does NOT close that PUBLIC grant) —
-- including `confirm_payment` (mark any payment paid, unauthenticated) and
-- `issue_certificate` (mint a certificate with an arbitrary score,
-- unauthenticated). All 15 functions below (this migration's original 2 plus
-- 13 more) have now been hardened live via direct REVOKE, verified with
-- has_function_privilege() to leave only `service_role`.
--
-- Also found live and closed in the same pass: "own pay insert" and
-- "own sub insert" (payments/subscriptions self-service INSERT — not
-- originally covered by this migration) let any authenticated client create
-- a self-marked-paid payment or active subscription directly, bypassing
-- checkout entirely. And the profiles trigger below was rewritten from its
-- original `auth.role() = 'service_role'` check (which never matches this
-- backend's plain `postgres`-role Postgres connection — see comment in the
-- function body) to a `current_user`-based check, then applied live and
-- verified with a rolled-back test UPDATE from the `postgres` role.
--
-- This migration file is updated to match live state so a from-scratch
-- rebuild reproduces the same hardened state.

-- 1) certificates: drop the self-service INSERT policy. The `issue_certificate`
--    RPC's own client EXECUTE grant is revoked below, so both forgery paths
--    close at once; certificates are now issued exclusively by the backend
--    (service role) after it verifies a passed level_exam_attempts row.
DROP POLICY IF EXISTS "Users insert own certificates" ON public.certificates;

-- 2) Revoke client EXECUTE on every SECURITY DEFINER function in the exposed
--    PostgREST API schema that the backend does not itself call via RPC (it
--    performs the equivalent inserts/updates directly over its own Postgres
--    connection, which ignores GRANTs entirely — so revoking here only
--    removes the client-callable path). Must revoke FROM PUBLIC too, not
--    just anon/authenticated: Postgres auto-grants EXECUTE to PUBLIC on
--    every function at CREATE time, and that grant is independent of any
--    per-role grant/revoke — anon/authenticated still execute via the
--    PUBLIC grant unless it is revoked explicitly.
REVOKE EXECUTE ON FUNCTION public.issue_certificate(public.cefr_level, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_activity(text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_security_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.buy_shop_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_mission(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_subscription_order(uuid, public.payment_method, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_user_missions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_account_locked(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_subscription_activated() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_login_attempt(text, boolean, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_certificate(text) FROM PUBLIC, anon, authenticated;

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

-- 7) payments/subscriptions: drop the self-service INSERT policies. A client
--    with any valid `authenticated` session could otherwise INSERT a row
--    with status='paid'/'active' directly, bypassing checkout entirely. The
--    backend creates these rows itself (createSubscriptionOrder) over its
--    own Postgres connection, which does not go through these policies.
DROP POLICY IF EXISTS "own pay insert" ON public.payments;
DROP POLICY IF EXISTS "own sub insert" ON public.subscriptions;

-- 8) profiles: column-level protection for xp/coins/level/cefr_level, modeled
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
  -- Only the two PostgREST-mediated client roles are restricted here. The
  -- backend connects directly to Postgres as role "postgres" (see
  -- DATABASE_URL) — verified live to have rolbypassrls=true, but BYPASSRLS
  -- does not exempt triggers, so this check must be role-based rather than
  -- relying on Supabase JWT claims (auth.role()/auth.uid()), which are only
  -- set by PostgREST and are NULL on the backend's raw connection.
  IF current_user NOT IN ('anon', 'authenticated') THEN
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
