
REVOKE EXECUTE ON FUNCTION public.get_max_unlocked_level(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_level(UUID, public.cefr_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_max_unlocked_level(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_level(UUID, public.cefr_level) TO authenticated, service_role;
