-- notify_subscription_activated() inserted into notifications(kind, ...), but
-- the table's actual column is `type` (default 'info') — `kind` never existed.
-- Confirmed live: activating any subscription (admin activate, or the sandbox
-- payment simulate path once enabled) crashed with
-- "column \"kind\" of relation \"notifications\" does not exist" (42703),
-- since this code path had never been exercised before on this fresh project.

CREATE OR REPLACE FUNCTION public.notify_subscription_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (
      NEW.user_id,
      'subscription',
      'Assinatura ativada 🎉',
      'A tua assinatura está ativa até ' || to_char(NEW.expires_at, 'DD/MM/YYYY') || '. Bons estudos!'
    );
  END IF;
  RETURN NEW;
END $$;
