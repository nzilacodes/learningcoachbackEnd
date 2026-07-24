
-- 1) age_to_room: fail closed on NULL age
CREATE OR REPLACE FUNCTION public.age_to_room(_age integer)
RETURNS age_room
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _age IS NULL THEN NULL::public.age_room
    WHEN _age < 13 THEN 'kids'::public.age_room
    WHEN _age < 18 THEN 'teens'::public.age_room
    ELSE 'adults'::public.age_room
  END;
$$;

-- 2) user_roles: remove self-read; admins only
DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Lock down SECURITY DEFINER function EXECUTE privileges
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_admin_for_owner_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_room() TO authenticated;
