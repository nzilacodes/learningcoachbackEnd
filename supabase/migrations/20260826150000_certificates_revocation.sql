-- Admin certificate revocation: nullable so existing rows stay "valid" by
-- default; a revoked certificate is never deleted (keeps the audit trail and
-- the /certificates/verify/:code endpoint able to explain *why* a code no
-- longer verifies, instead of just 404ing).
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id);
