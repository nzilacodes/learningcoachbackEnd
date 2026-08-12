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
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;
