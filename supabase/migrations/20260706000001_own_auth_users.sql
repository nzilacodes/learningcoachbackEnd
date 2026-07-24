-- Replaces Supabase Auth (GoTrue) with backend-owned identity: this app no
-- longer creates sessions via supabase.auth.* or reads/writes auth.users.
-- app_users becomes the new root identity table; every foreign key that used
-- to point at auth.users(id) is repointed here so no data model changes are
-- otherwise needed. Existing auth.users rows (if any — this app is pre-launch)
-- are carried over by id/email so those foreign keys stay valid; their
-- password_hash starts NULL, meaning that account must go through
-- "forgot password" once to set a real password, since GoTrue's password
-- hashes aren't in a format this backend can verify against.

CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_app_users_updated
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_users (id, email, created_at)
SELECT id, email, created_at FROM auth.users
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens(user_id);

CREATE TABLE public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_reset_tokens_user ON public.password_reset_tokens(user_id);

-- Repoint every existing foreign key that references auth.users(id) to
-- app_users(id) instead, preserving each constraint's original ON DELETE
-- behavior. Handles profiles, user_roles, payments (incl. activated_by),
-- subscriptions, progress, certificates, achievements, notifications,
-- ai_conversations/messages, reading/pronunciation assessments,
-- diagnostic_results, level_exam_attempts, video_history, xp_events,
-- user_missions, user_inventory, friendships (both columns), user_stats,
-- lesson_progress, study_sessions/reminders, community_messages,
-- account_lockouts — whatever currently points at auth.users, dynamically,
-- so nothing is missed and nothing needs to be hand-enumerated.
DO $$
DECLARE
  r RECORD;
  del_action TEXT;
BEGIN
  FOR r IN
    SELECT
      con.conname AS constraint_name,
      con.conrelid::regclass::text AS table_name,
      att.attname AS column_name,
      con.confdeltype AS delete_action
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
  LOOP
    del_action := CASE r.delete_action
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'r' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.constraint_name);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.app_users(id) ON DELETE %s',
      r.table_name, r.constraint_name, r.column_name, del_action
    );
  END LOOP;
END $$;
