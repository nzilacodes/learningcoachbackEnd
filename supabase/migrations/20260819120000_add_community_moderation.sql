-- Community safety: message reporting + user blocking. Closes the gap where
-- the community room had server-side word-filter moderation (see
-- modules/community/service.ts moderate()) but no way for a user to flag a
-- specific message or stop seeing someone, and no queue for admins to review
-- reports. No RLS/GRANT statements, matching the rest of the post-rewrite
-- schema (community_messages predates the rewrite and still carries RLS from
-- the Supabase era; new tables here don't).
CREATE TABLE IF NOT EXISTS public.community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.community_messages(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS idx_community_reports_status ON public.community_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_blocks (
  blocker_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
