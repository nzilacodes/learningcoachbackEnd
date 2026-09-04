-- Correction: the original age_groups bootstrap (20260902130000) tagged
-- every unit with exactly ONE age band, sequentially by its course's CEFR
-- level (A1->3-5 ... C2->18+) — the same rigid 1:1 mapping section 2 of the
-- architecture doc explicitly says NOT to do:
--
--   "6-8 anos + A1, 9-11 anos + A1, 12-14 anos + A1, 18+ + A1 — Todos são
--    A1, mas com experiências pedagógicas completamente diferentes."
--
-- i.e. every age band should be able to reach every CEFR level — a 6-8
-- year old isn't frozen at A2 forever just because that's this catalog's
-- "default" starting point for that age. There's only one authored version
-- of each unit right now (age-adapted content variants are a future,
-- content-authoring effort — section 14 — not a schema change), so the
-- correct current state is: every unit available to every age band, with
-- admins free to narrow that down per unit from here as real age-specific
-- content gets authored.
INSERT INTO public.unit_age_groups (unit_id, age_group_id)
SELECT u.id, ag.id
FROM public.units u
CROSS JOIN public.age_groups ag
ON CONFLICT DO NOTHING;
