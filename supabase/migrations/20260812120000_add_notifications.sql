-- Persistent, cross-device notification center (bell icon). Producers are
-- app code (e.g. diagnostic evaluation success/failure) calling
-- modules/notifications/service.ts#notifyUser — no DB triggers.
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('system', 'learning', 'assessment', 'account')),
  title TEXT NOT NULL,
  description TEXT,
  action_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A same-named 'notifications' table from an earlier, unrelated feature
-- (subscription-activation pings — see fix_notify_subscription_activated_column)
-- already existed on the live database with a different shape
-- (type/body/is_read instead of category/description/read_at), so the
-- CREATE TABLE above silently no-op'd there and this module's queries would
-- fail on every call. Reconcile onto this migration's shape instead of
-- losing whatever rows it already has — a no-op on any fresh install where
-- the legacy columns never existed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'body'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    UPDATE public.notifications SET description = body WHERE description IS NULL AND body IS NOT NULL;
    UPDATE public.notifications SET read_at = created_at WHERE read_at IS NULL AND is_read IS TRUE;
    -- Legacy rows have no equivalent of the new category taxonomy — 'account'
    -- is the closest fit for what this legacy table only ever recorded
    -- (subscription/billing pings).
    UPDATE public.notifications SET category = 'account' WHERE category IS NULL;

    ALTER TABLE public.notifications ALTER COLUMN category SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_category_check') THEN
      ALTER TABLE public.notifications
        ADD CONSTRAINT notifications_category_check CHECK (category IN ('system', 'learning', 'assessment', 'account'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;
