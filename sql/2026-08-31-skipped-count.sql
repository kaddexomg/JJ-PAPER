ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
