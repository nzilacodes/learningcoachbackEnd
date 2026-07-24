
-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_user ON public.audit_logs (user_id);
CREATE INDEX idx_audit_action ON public.audit_logs (action);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view audit logs" ON public.audit_logs FOR SELECT
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Login attempts
CREATE TABLE public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempts_email_created ON public.login_attempts (email, created_at DESC);
CREATE INDEX idx_attempts_ip_created ON public.login_attempts (ip_address, created_at DESC);
GRANT SELECT ON public.login_attempts TO authenticated;
GRANT ALL ON public.login_attempts TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view login attempts" ON public.login_attempts FOR SELECT
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Lockouts
CREATE TABLE public.account_lockouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT,
  reason TEXT NOT NULL DEFAULT 'brute_force',
  locked_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lockouts_email ON public.account_lockouts (email, locked_until DESC);
GRANT SELECT ON public.account_lockouts TO authenticated;
GRANT ALL ON public.account_lockouts TO service_role;
ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view lockouts" ON public.account_lockouts FOR SELECT
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Log an audit event (callable by any authenticated user, records own activity)
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action TEXT,
  _entity TEXT DEFAULT NULL,
  _entity_id TEXT DEFAULT NULL,
  _severity TEXT DEFAULT 'info',
  _ip TEXT DEFAULT NULL,
  _ua TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.audit_logs(user_id, actor_email, action, entity, entity_id, ip_address, user_agent, severity, metadata)
  VALUES (auth.uid(), v_email, _action, _entity, _entity_id, _ip, _ua, COALESCE(_severity,'info'), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.log_audit_event(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;

-- Record login attempt & auto-lock on 5 failures in 15 minutes
CREATE OR REPLACE FUNCTION public.record_login_attempt(
  _email TEXT,
  _success BOOLEAN,
  _ip TEXT DEFAULT NULL,
  _ua TEXT DEFAULT NULL,
  _reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fails int;
  v_locked boolean := false;
BEGIN
  INSERT INTO public.login_attempts(email, ip_address, user_agent, success, reason)
    VALUES (lower(_email), _ip, _ua, _success, _reason);

  IF NOT _success THEN
    SELECT COUNT(*) INTO v_fails FROM public.login_attempts
      WHERE email = lower(_email) AND success = false
        AND created_at > now() - interval '15 minutes';

    IF v_fails >= 5 THEN
      INSERT INTO public.account_lockouts(email, ip_address, reason, locked_until)
        VALUES (lower(_email), _ip, 'brute_force', now() + interval '15 minutes');
      v_locked := true;
      INSERT INTO public.audit_logs(actor_email, action, entity, severity, ip_address, user_agent, metadata)
        VALUES (lower(_email), 'account_locked', 'auth', 'warning', _ip, _ua,
                jsonb_build_object('failed_attempts', v_fails));
    END IF;
  END IF;

  RETURN jsonb_build_object('locked', v_locked, 'failed_attempts', COALESCE(v_fails,0));
END; $$;
REVOKE ALL ON FUNCTION public.record_login_attempt(TEXT,BOOLEAN,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(TEXT,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated, anon;

-- Check if account is currently locked
CREATE OR REPLACE FUNCTION public.is_account_locked(_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_until timestamptz;
BEGIN
  SELECT MAX(locked_until) INTO v_until FROM public.account_lockouts
    WHERE email = lower(_email) AND locked_until > now();
  RETURN jsonb_build_object(
    'locked', v_until IS NOT NULL,
    'until', v_until
  );
END; $$;
REVOKE ALL ON FUNCTION public.is_account_locked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_locked(TEXT) TO authenticated, anon;

-- Suspicious activity summary for admin panel
CREATE OR REPLACE FUNCTION public.admin_security_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_events_24h', (SELECT COUNT(*) FROM public.audit_logs WHERE created_at > now() - interval '24 hours'),
    'failed_logins_24h', (SELECT COUNT(*) FROM public.login_attempts WHERE success = false AND created_at > now() - interval '24 hours'),
    'active_lockouts', (SELECT COUNT(*) FROM public.account_lockouts WHERE locked_until > now()),
    'critical_events_7d', (SELECT COUNT(*) FROM public.audit_logs WHERE severity IN ('warning','critical') AND created_at > now() - interval '7 days'),
    'suspicious_ips', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT ip_address, COUNT(*)::int AS attempts
        FROM public.login_attempts
        WHERE success = false AND created_at > now() - interval '24 hours'
          AND ip_address IS NOT NULL
        GROUP BY ip_address
        HAVING COUNT(*) >= 3
        ORDER BY attempts DESC
        LIMIT 10
      ) t
    ),
    'recent_lockouts', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT email, ip_address, locked_until, reason, created_at
        FROM public.account_lockouts
        WHERE created_at > now() - interval '7 days'
        ORDER BY created_at DESC LIMIT 20
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.admin_security_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_security_summary() TO authenticated;
