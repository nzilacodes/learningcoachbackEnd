
-- 1) Prevent self-editing of age after it is set (only admins can change it)
CREATE OR REPLACE FUNCTION public.enforce_age_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.age IS DISTINCT FROM OLD.age THEN
    IF OLD.age IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Age cannot be changed once set. Contact support to update your age.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_age_immutable_trg ON public.profiles;
CREATE TRIGGER enforce_age_immutable_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_age_immutable();

-- 2) Revoke EXECUTE on SECURITY DEFINER functions that signed-in users shouldn't call directly.
--    Keep has_role executable (used by RLS + client rpc). Keep age_to_room (SECURITY INVOKER, harmless).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_subscriptions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_for_owner_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_room() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_age_immutable() FROM PUBLIC, anon, authenticated;
