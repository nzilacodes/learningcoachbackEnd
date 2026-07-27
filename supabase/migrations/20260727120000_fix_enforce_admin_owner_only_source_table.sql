-- enforce_admin_owner_only still read the owner's email from auth.users, but
-- own_auth_users (20260706000001) moved identity to public.app_users and the
-- app no longer writes to auth.users at all. Every admin-role insert since
-- then hit a NULL lookup and was rejected, including for the real owner
-- account. Point the check at app_users instead.

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
    SELECT lower(email) INTO v_email FROM public.app_users WHERE id = NEW.user_id;
    IF v_email IS DISTINCT FROM 'silvinogomes1992@gmail.com' THEN
      RAISE EXCEPTION 'Only the owner account may hold the admin role.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
