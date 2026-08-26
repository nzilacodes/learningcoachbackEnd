-- =========================
-- Fix: lesson_attempts.user_id, user_hearts.user_id and exercises.reviewed_by
-- referenced auth.users(id) instead of public.app_users(id).
--
-- The app has its own custom-auth user table (public.app_users, with its own
-- password_hash) that every other user-referencing FK in the schema points
-- to. auth.users (Supabase's built-in auth table) is never populated by this
-- app — 0 rows, always. The 2026-08-24 grading/hearts migration introduced
-- these 3 columns against auth.users by mistake, so every insert that hit
-- them failed unconditionally: lesson submission (POST /v1/lessons/:id/
-- submit, confirmed via Sentry), hearts get-or-create, and admin content-
-- review attribution. This migration (and the retroactive fix to
-- 20260824120000_grading_engine_and_hearts.sql for anyone bootstrapping a
-- fresh database) repoints all three at app_users — no data is touched.
-- =========================

ALTER TABLE public.lesson_attempts DROP CONSTRAINT lesson_attempts_user_id_fkey;
ALTER TABLE public.lesson_attempts
  ADD CONSTRAINT lesson_attempts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.user_hearts DROP CONSTRAINT user_hearts_user_id_fkey;
ALTER TABLE public.user_hearts
  ADD CONSTRAINT user_hearts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.exercises DROP CONSTRAINT exercises_reviewed_by_fkey;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id);
