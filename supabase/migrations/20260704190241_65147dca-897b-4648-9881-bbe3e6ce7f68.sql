
-- Auto-grant admin to owner email on signup / email confirmation
DROP TRIGGER IF EXISTS on_auth_user_created_grant_owner_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_owner_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_owner_email();

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_owner_admin ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_grant_owner_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_for_owner_email();

-- Safety: block any admin role insert for accounts other than the owner email
CREATE OR REPLACE FUNCTION public.enforce_admin_owner_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.role = 'admin' THEN
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.user_id;
    IF v_email IS DISTINCT FROM 'silvinogomes1992@gmail.com' THEN
      RAISE EXCEPTION 'Only the owner account may hold the admin role.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_enforce_admin_owner ON public.user_roles;
CREATE TRIGGER user_roles_enforce_admin_owner
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_owner_only();

-- Remove any stray admin rows that don't match the owner email
DELETE FROM public.user_roles ur
WHERE ur.role = 'admin'
  AND lower((SELECT email FROM auth.users WHERE id = ur.user_id)) IS DISTINCT FROM 'silvinogomes1992@gmail.com';
