
-- Enum for payment method (guard if exists)
DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('card','reference','transfer','mobile_money');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS method public.payment_method,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS payments_invoice_number_key ON public.payments(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_key ON public.payments(reference) WHERE reference IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.create_subscription_order(
  _plan_id uuid,
  _method public.payment_method,
  _phone text DEFAULT NULL,
  _provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_plan public.subscription_plans;
  v_sub_id uuid;
  v_pay_id uuid;
  v_ref text;
  v_invoice text;
  v_entity text := '11333'; -- placeholder Multicaixa entity for Angola gateways
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = _plan_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not available'; END IF;

  v_ref := lpad(((floor(random()*900000000))::bigint + 100000000)::text, 9, '0');
  v_invoice := 'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');

  INSERT INTO public.subscriptions(user_id, plan_id, status)
  VALUES (uid, _plan_id, 'pending')
  RETURNING id INTO v_sub_id;

  INSERT INTO public.payments(
    user_id, subscription_id, plan_id, amount_kz, status,
    method, reference, entity, phone, provider, invoice_number, metadata
  )
  VALUES (
    uid, v_sub_id, _plan_id, v_plan.price_kz, 'pending',
    _method, v_ref, v_entity, _phone, _provider, v_invoice, '{}'::jsonb
  )
  RETURNING id INTO v_pay_id;

  RETURN jsonb_build_object(
    'subscription_id', v_sub_id,
    'payment_id', v_pay_id,
    'reference', v_ref,
    'entity', v_entity,
    'invoice_number', v_invoice,
    'amount_kz', v_plan.price_kz
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_subscription_order(uuid, public.payment_method, text, text) TO authenticated;

-- Manual confirmation (admin) helper — trigger handles activation
CREATE OR REPLACE FUNCTION public.confirm_payment(_payment_id uuid, _provider_tx text DEFAULT NULL)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payments;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.payments
     SET status = 'paid',
         provider_transaction_id = COALESCE(_provider_tx, provider_transaction_id),
         activated_by = auth.uid()
   WHERE id = _payment_id
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.confirm_payment(uuid, text) TO authenticated;

-- Notify user on activation
CREATE OR REPLACE FUNCTION public.notify_subscription_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    INSERT INTO public.notifications(user_id, kind, title, body)
    VALUES (
      NEW.user_id,
      'subscription',
      'Assinatura ativada 🎉',
      'A tua assinatura está ativa até ' || to_char(NEW.expires_at, 'DD/MM/YYYY') || '. Bons estudos!'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_subscription_activated ON public.subscriptions;
CREATE TRIGGER trg_notify_subscription_activated
  AFTER UPDATE OF status ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.notify_subscription_activated();

-- Trigger for activate_subscription_on_payment (exists as function but not attached — check)
DROP TRIGGER IF EXISTS trg_activate_subscription_on_payment ON public.payments;
CREATE TRIGGER trg_activate_subscription_on_payment
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.activate_subscription_on_payment();
