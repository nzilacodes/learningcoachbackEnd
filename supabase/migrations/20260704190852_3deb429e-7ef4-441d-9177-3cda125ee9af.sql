
CREATE OR REPLACE FUNCTION public.enforce_age_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.age IS DISTINCT FROM OLD.age THEN
    IF OLD.age IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Age cannot be changed once set. Contact support to update your age.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
