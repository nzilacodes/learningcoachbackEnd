DROP POLICY IF EXISTS "room select" ON public.community_messages;
DROP POLICY IF EXISTS "room insert own" ON public.community_messages;
DROP FUNCTION IF EXISTS public.current_user_room();

CREATE OR REPLACE FUNCTION private.current_user_room()
RETURNS public.age_room
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.age_to_room(p.age) FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION private.current_user_room() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_room() TO authenticated, service_role;

CREATE POLICY "room select" ON public.community_messages FOR SELECT TO authenticated
  USING ((room = private.current_user_room()) OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "room insert own" ON public.community_messages FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()) AND (room = private.current_user_room()));
