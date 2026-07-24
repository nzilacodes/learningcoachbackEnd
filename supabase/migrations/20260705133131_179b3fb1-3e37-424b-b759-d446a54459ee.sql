
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'paypay',
  ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS idx_pay_provider_tx ON public.payments(provider_transaction_id);

CREATE OR REPLACE FUNCTION public.activate_subscription_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration INT;
  v_tier plan_tier;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT duration_days, tier INTO v_duration, v_tier
    FROM public.subscription_plans WHERE id = NEW.plan_id;

    IF NEW.subscription_id IS NOT NULL THEN
      UPDATE public.subscriptions
        SET status = 'active',
            starts_at = now(),
            expires_at = now() + make_interval(days => COALESCE(v_duration, 30))
        WHERE id = NEW.subscription_id;
    END IF;

    NEW.paid_at = COALESCE(NEW.paid_at, now());

    UPDATE public.profiles
      SET selected_plan = v_tier::text,
          onboarding_status = 'complete'
      WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activate_sub_on_payment ON public.payments;
CREATE TRIGGER trg_activate_sub_on_payment
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.activate_subscription_on_payment();
