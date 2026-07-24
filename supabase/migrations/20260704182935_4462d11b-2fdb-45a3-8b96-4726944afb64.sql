
-- Move has_role out of the exposed public API schema so it's not callable via PostgREST,
-- while still usable by RLS policies.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Drop dependent policies (will recreate referencing private.has_role)
DROP POLICY IF EXISTS "own profile select" ON public.profiles;
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
DROP POLICY IF EXISTS "plans admin manage" ON public.subscription_plans;
DROP POLICY IF EXISTS "own sub select" ON public.subscriptions;
DROP POLICY IF EXISTS "admin sub update" ON public.subscriptions;
DROP POLICY IF EXISTS "own pay select" ON public.payments;
DROP POLICY IF EXISTS "admin pay update" ON public.payments;
DROP POLICY IF EXISTS "own stats select" ON public.user_stats;
DROP POLICY IF EXISTS "own prog all" ON public.lesson_progress;
DROP POLICY IF EXISTS "own sessions all" ON public.study_sessions;
DROP POLICY IF EXISTS "room select" ON public.community_messages;
DROP POLICY IF EXISTS "own delete" ON public.community_messages;
DROP POLICY IF EXISTS "admins read all roles" ON public.user_roles;

-- Recreate has_role in private schema
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Recreate policies using private.has_role
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated
  USING ((id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING ((id = auth.uid()) OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK ((id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "plans admin manage" ON public.subscription_plans FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "own sub select" ON public.subscriptions FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin sub update" ON public.subscriptions FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "own pay select" ON public.payments FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin pay update" ON public.payments FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "own stats select" ON public.user_stats FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "own prog all" ON public.lesson_progress FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own sessions all" ON public.study_sessions FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "room select" ON public.community_messages FOR SELECT TO authenticated
  USING ((room = public.current_user_room()) OR private.has_role(auth.uid(), 'admin'));
CREATE POLICY "own delete" ON public.community_messages FOR DELETE TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins read all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- current_user_room is called by the community_messages SELECT policy; ensure authenticated can execute it
GRANT EXECUTE ON FUNCTION public.current_user_room() TO authenticated;
