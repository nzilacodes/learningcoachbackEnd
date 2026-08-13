-- Media library + Studio recordings: video/audio/image/document assets with
-- lifecycle tracking (uploading -> processing -> ready/failed), soft delete
-- (trash), and optional association to a course/unit/lesson or class. See
-- modules/media/service.ts for the state machine. TEXT + CHECK instead of an
-- enum type, matching public.notifications' category column — easier to
-- extend later than ALTER TYPE.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('video', 'audio', 'image', 'document')),
  mime_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  thumbnail_storage_key TEXT,
  size_bytes BIGINT NOT NULL,
  duration_seconds NUMERIC(10,2),
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  processing_error TEXT,
  title TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'class', 'public')),
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON public.media_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_lesson ON public.media_assets(lesson_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_class ON public.media_assets(class_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_tags ON public.media_assets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_media_stuck_processing ON public.media_assets(status) WHERE status IN ('uploading', 'processing');

-- Links the already-existing (previously unused) audio_url column to a real
-- stored recording, and gives reading_assessments the same capability — see
-- modules/ai/service.ts assessPronunciation/assessReading.
ALTER TABLE public.pronunciation_assessments ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL;
ALTER TABLE public.reading_assessments ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE public.reading_assessments ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL;
