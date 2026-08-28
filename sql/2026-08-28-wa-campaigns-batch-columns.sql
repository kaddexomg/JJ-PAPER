-- ══════════════════════════════════════════════════════════════════════════════
-- 2026-08-28 · BLINDAJE COMPLETO: jjp_wa_campaigns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS owner_id        UUID,
  ADD COLUMN IF NOT EXISTS created_by      UUID,
  ADD COLUMN IF NOT EXISTS name            TEXT,
  ADD COLUMN IF NOT EXISTS body            TEXT,
  ADD COLUMN IF NOT EXISTS message         TEXT,
  ADD COLUMN IF NOT EXISTS template_id     UUID,
  ADD COLUMN IF NOT EXISTS total           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_min_s     INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS delay_max_s     INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS batch_size      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_pause_m   INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS media_path      TEXT,
  ADD COLUMN IF NOT EXISTS media_type      TEXT,
  ADD COLUMN IF NOT EXISTS media_mime      TEXT,
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS media_size      INTEGER,
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ;

ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;

-- Migrar title→name solo si la columna title existe (SQL dinámico para evitar error de compilación)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jjp_wa_campaigns'
      AND column_name = 'title'
  ) THEN
    EXECUTE 'UPDATE public.jjp_wa_campaigns SET name = title WHERE name IS NULL AND title IS NOT NULL';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
