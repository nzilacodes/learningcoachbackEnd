
-- Add onboarding progress and required profile fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'profile',
  ADD COLUMN IF NOT EXISTS demo_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_plan TEXT;

-- Constrain to known steps
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_onboarding_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_onboarding_status_check
      CHECK (onboarding_status IN ('profile','placement','plan','demo','checkout','complete'));
  END IF;
END $$;
