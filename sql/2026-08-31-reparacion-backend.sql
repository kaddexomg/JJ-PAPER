-- Fase 1 — SQL de reparación definitiva

-- 1.1 y 1.2: Eliminar CHECKs restrictivos de campaigns y targets, y agregar columnas faltantes
ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER;

ALTER TABLE public.jjp_wa_campaigns 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
ALTER TABLE public.jjp_wa_campaigns 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;
ALTER TABLE public.jjp_wa_campaign_targets 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaign_targets_status_check;

-- 1.3: Crear tablas jjp_email_campaigns + jjp_email_campaign_targets
CREATE TABLE IF NOT EXISTS public.jjp_email_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  html          TEXT,
  attachments   JSONB DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','paused','done','cancelled')),
  delay_min_s   INT NOT NULL DEFAULT 5 CHECK (delay_min_s >= 1),
  delay_max_s   INT NOT NULL DEFAULT 15 CHECK (delay_max_s >= delay_min_s),
  total         INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  failed_count  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jjp_email_campaign_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES public.jjp_email_campaigns(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  customer_id   UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  to_addr       TEXT NOT NULL,
  name          TEXT,
  vars          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sending','sent','failed','skipped')),
  email_id      UUID,
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.jjp_email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY ec_all ON public.jjp_email_campaigns FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

ALTER TABLE public.jjp_email_campaign_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ect_all ON public.jjp_email_campaign_targets FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- Índices
CREATE INDEX IF NOT EXISTS jjp_ec_status ON public.jjp_email_campaigns (status);
CREATE INDEX IF NOT EXISTS jjp_ect_camp ON public.jjp_email_campaign_targets (campaign_id, status);

-- 1.4: Alinear jjp_emails (agregar owner_id, to_addr, etc.)
ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS owner_id    UUID REFERENCES public.jjp_profiles(id),
  ADD COLUMN IF NOT EXISTS to_addr     TEXT,
  ADD COLUMN IF NOT EXISTS from_addr   TEXT,
  ADD COLUMN IF NOT EXISTS body        TEXT,
  ADD COLUMN IF NOT EXISTS html        TEXT,
  ADD COLUMN IF NOT EXISTS gmail_id    TEXT,
  ADD COLUMN IF NOT EXISTS thread_id   TEXT,
  ADD COLUMN IF NOT EXISTS snippet     TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_id  TEXT,
  ADD COLUMN IF NOT EXISTS attach_state TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS campaign_id UUID;

-- Migrar datos de columnas viejas si existían
UPDATE public.jjp_emails SET owner_id = profile_id WHERE owner_id IS NULL AND profile_id IS NOT NULL;
UPDATE public.jjp_emails SET to_addr = to_email WHERE to_addr IS NULL AND to_email IS NOT NULL;
UPDATE public.jjp_emails SET from_addr = from_email WHERE from_addr IS NULL AND from_email IS NOT NULL;
UPDATE public.jjp_emails SET body = body_text WHERE body IS NULL AND body_text IS NOT NULL;
UPDATE public.jjp_emails SET html = body_html WHERE html IS NULL AND body_html IS NOT NULL;

CREATE INDEX IF NOT EXISTS jjp_emails_owner_dir ON public.jjp_emails (owner_id, direction);
CREATE INDEX IF NOT EXISTS jjp_emails_gmail_id ON public.jjp_emails (gmail_id) WHERE gmail_id IS NOT NULL;

-- 1.5: Agregar al Realtime las tablas nuevas
ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaigns;

-- 1.6: Notificar a postgrest para recargar esquema
NOTIFY pgrst, 'reload schema';
