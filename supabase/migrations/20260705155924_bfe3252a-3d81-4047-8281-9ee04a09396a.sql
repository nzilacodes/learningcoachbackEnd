
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_title text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS signature text;

CREATE UNIQUE INDEX IF NOT EXISTS certificates_verification_code_key
  ON public.certificates(verification_code);

-- Auto-generate a friendly code on insert if not provided
CREATE OR REPLACE FUNCTION public.certificates_set_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_code IS NULL OR NEW.verification_code = '' THEN
    NEW.verification_code := 'LEC-' || NEW.level::text || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  END IF;
  IF NEW.signature IS NULL OR NEW.signature = '' THEN
    NEW.signature := encode(
      digest(NEW.user_id::text || '|' || NEW.level::text || '|' || NEW.verification_code || '|' || COALESCE(NEW.issued_at, now())::text, 'sha256'),
      'hex'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_certificates_set_code ON public.certificates;
CREATE TRIGGER trg_certificates_set_code
  BEFORE INSERT ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.certificates_set_code();

-- Issue certificate (idempotent per user+level+course)
CREATE OR REPLACE FUNCTION public.issue_certificate(
  _level public.cefr_level,
  _course_id uuid DEFAULT NULL,
  _score numeric DEFAULT NULL,
  _course_title text DEFAULT NULL
)
RETURNS public.certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_name text;
  v_row public.certificates;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_row FROM public.certificates
    WHERE user_id = uid AND level = _level
      AND (_course_id IS NULL OR course_id = _course_id)
    ORDER BY issued_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM public.profiles WHERE id = uid;

  INSERT INTO public.certificates(user_id, level, score, course_id, course_title, full_name)
  VALUES (uid, _level, _score, _course_id, _course_title, v_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.issue_certificate(public.cefr_level, uuid, numeric, text) TO authenticated;

-- Public verification (returns safe fields only)
CREATE OR REPLACE FUNCTION public.verify_certificate(_code text)
RETURNS TABLE(
  verification_code text,
  full_name text,
  level public.cefr_level,
  course_title text,
  score numeric,
  issued_at timestamptz,
  signature text,
  valid boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.verification_code, c.full_name, c.level, c.course_title,
         c.score, c.issued_at, c.signature, true AS valid
  FROM public.certificates c
  WHERE c.verification_code = _code
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;
