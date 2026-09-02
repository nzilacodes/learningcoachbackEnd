-- Admin certificate revocation: nullable so existing rows stay "valid" by
-- default; a revoked certificate is never deleted (keeps the audit trail and
-- the /certificates/verify/:code endpoint able to explain *why* a code no
-- longer verifies, instead of just 404ing).
--
-- revoked_by references public.app_users, NOT auth.users: this app's own
-- identity table (see 20260706000001_own_auth_users.sql) — auth.users is
-- Supabase's built-in table, permanently empty here since this backend rolled
-- its own auth. A FK against it accepts NULL but rejects every real user id,
-- which is exactly the bug 20260826142809_fix_grading_and_hearts_fk_target.sql
-- had to fix for lesson_attempts/user_hearts/exercises — same mistake, so
-- avoided here from the start rather than repeated and fixed later.
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.app_users(id);
