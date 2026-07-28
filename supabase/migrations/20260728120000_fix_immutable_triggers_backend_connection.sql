-- enforce_gamified_columns_immutable and enforce_age_immutable both tried to
-- recognize the backend as a trusted writer via auth.role()/auth.uid(), but
-- the backend connects directly via the postgres driver (no PostgREST), so
-- both are always NULL on that connection — confirmed live via
-- `SELECT auth.role()` over the same connection type, which returns NULL.
-- Every backend write to profiles.xp/coins/level/cefr_level has been
-- silently rejected with 42501 since 20260706000000 was applied. Client
-- traffic only ever reaches Postgres through PostgREST as anon/authenticated,
-- never as `postgres` directly, so current_user = 'postgres' is a reliable
-- signal for "this is the backend (or an admin/SQL session), not a client
-- request" — the same trust boundary these functions already had, just
-- keyed off a signal that actually exists on this connection.

CREATE OR REPLACE FUNCTION public.enforce_gamified_columns_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  IF (NEW.xp IS DISTINCT FROM OLD.xp
      OR NEW.coins IS DISTINCT FROM OLD.coins
      OR NEW.level IS DISTINCT FROM OLD.level
      OR NEW.cefr_level IS DISTINCT FROM OLD.cefr_level)
     AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'xp, coins, level and cefr_level can only be changed by the backend service or an admin.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_age_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.age IS DISTINCT FROM OLD.age THEN
    IF current_user = 'postgres' THEN
      RETURN NEW;
    END IF;
    IF OLD.age IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Age cannot be changed once set. Contact support to update your age.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
