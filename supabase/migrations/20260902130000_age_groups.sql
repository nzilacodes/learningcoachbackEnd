-- Separation engine, phase 1: age band as a dimension independent of CEFR
-- level. `age_groups` is a fixed, admin-un-editable reference table (6 rows,
-- seeded below); `unit_age_groups` is the many-to-many tagging surface admins
-- actually edit — a unit can belong to more than one age band, and an age
-- band can span more than one CEFR level, which a single `courses.level`
-- column could never express.
CREATE TABLE IF NOT EXISTS public.age_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  min_age INT NOT NULL,
  max_age INT,
  order_index INT NOT NULL DEFAULT 0
);

INSERT INTO public.age_groups (code, label, min_age, max_age, order_index) VALUES
  ('early',       '3–5 anos',  3, 5,    0),
  ('children',    '6–8 anos',  6, 8,    1),
  ('pre_teens',   '9–11 anos', 9, 11,   2),
  ('teens',       '12–14 anos', 12, 14, 3),
  ('young_teens', '15–17 anos', 15, 17, 4),
  ('adult',       '18+ anos',  18, NULL, 5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.unit_age_groups (
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES public.age_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (unit_id, age_group_id)
);
CREATE INDEX IF NOT EXISTS idx_unit_age_groups_age_group ON public.unit_age_groups(age_group_id);

-- Bootstrap: every existing unit gets the age band that maps sequentially
-- from its course's CEFR level (A1→3–5 ... C2→18+), matching the reference
-- mockup this feature was built from. This is a starting point, not a
-- pedagogical claim — see the architecture doc's own caveat that age↔CEFR
-- is product segmentation, not an official equivalence. Every tag is
-- editable by an admin from here on (see units_admin.ageGroupIds).
INSERT INTO public.unit_age_groups (unit_id, age_group_id)
SELECT u.id, ag.id
FROM public.units u
JOIN public.courses c ON c.id = u.course_id
JOIN public.age_groups ag ON ag.order_index = CASE c.level
  WHEN 'A1' THEN 0
  WHEN 'A2' THEN 1
  WHEN 'B1' THEN 2
  WHEN 'B2' THEN 3
  WHEN 'C1' THEN 4
  WHEN 'C2' THEN 5
END
ON CONFLICT DO NOTHING;
