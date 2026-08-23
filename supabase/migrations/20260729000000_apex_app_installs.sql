-- Migration: apex_app_installs
-- Lightweight user-confirmed APEX app connection state.
-- Written by client on "Done" after user confirms OmniPort connection.
-- Does NOT store tokens or credentials — only the user's intent.
-- status CHECK values:
--   'user_confirmed'  — user clicked Done and confirmed the connection worked
--   'pending'         — launched OmniPort, awaiting user confirmation
-- RLS: each row is owned by the authenticated user who inserted it.
-- APEX-TASK3 / PRCC remediation 2026-07-28.

CREATE TABLE IF NOT EXISTS public.apex_app_installs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- additive-allow: ON_DELETE_CASCADE cascading cleanup on user deletion
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id        TEXT        NOT NULL,
  app_label     TEXT        NOT NULL,
  app_url       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'user_confirmed')),
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, app_id)
);

ALTER TABLE public.apex_app_installs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'apex_app_installs'
      AND policyname = 'apex_app_installs_owner'
  ) THEN
    CREATE POLICY "apex_app_installs_owner"
      ON public.apex_app_installs
      FOR ALL
      TO authenticated
      USING     (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Keep updated_at current on status changes (user_confirmed transition)
CREATE OR REPLACE FUNCTION public.set_apex_app_installs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- additive-allow: DROP_TRIGGER idempotent trigger initialization on new table
DROP TRIGGER IF EXISTS apex_app_installs_updated_at
  ON public.apex_app_installs;

CREATE TRIGGER apex_app_installs_updated_at
  BEFORE UPDATE ON public.apex_app_installs
  FOR EACH ROW EXECUTE FUNCTION public.set_apex_app_installs_updated_at();
