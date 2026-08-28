-- ============================================================================
-- JJ PAPER — REPARACIÓN TOTAL DEFINITIVA (100% SEGURO Y TOLERANTE A COLUMNAS PREVIAS)
-- Ejecutar este script COMPLETO en el SQL Editor de Supabase (czzvsqnmxtjzqzioknnn)
-- ============================================================================

-- 1. EXTENSIONES Y FUNCIONES BASE
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.jjp_is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.jjp_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.jjp_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. COSTOS, PRECIOS, VARIANTES Y GRUPOS DE CATEGORÍAS
-- ============================================================================

ALTER TABLE public.jjp_product_variants
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_price_usd NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stock NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.jjp_category_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_category_groups
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS emoji TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

ALTER TABLE public.jjp_category_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_category_groups_sel ON public.jjp_category_groups;
CREATE POLICY jjp_category_groups_sel ON public.jjp_category_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS jjp_category_groups_all ON public.jjp_category_groups;
CREATE POLICY jjp_category_groups_all ON public.jjp_category_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.jjp_categories
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.jjp_category_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

INSERT INTO public.jjp_category_groups (name, slug, emoji, sort_order) VALUES
  ('Papelería y Oficina', 'papeleria-oficina', '📄', 1),
  ('Escolar y Manualidades', 'escolar-manualidades', '🎒', 2),
  ('Arte y Dibujo', 'arte-dibujo', '🎨', 3),
  ('Embalaje y Envíos', 'embalaje-envios', '📦', 4),
  ('Tecnología y Accesorios', 'tecnologia', '💻', 5),
  ('Higiene y Limpieza', 'higiene-limpieza', '🧹', 6),
  ('Servicios e Impresión', 'servicios-impresion', '🖨️', 7),
  ('Otros Rubros', 'otros', '🏷️', 8)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  emoji = EXCLUDED.emoji,
  sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 3. FEED DE PROMOCIONES Y COMBOS (jjp_promos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'promo',
  badge TEXT,
  description TEXT,
  emoji TEXT,
  image_url TEXT,
  price_usd NUMERIC(12,2),
  old_price_usd NUMERIC(12,2),
  cta_label TEXT,
  cta_url TEXT,
  wa_message TEXT,
  theme TEXT NOT NULL DEFAULT 'green',
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_promos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'promo',
  ADD COLUMN IF NOT EXISTS badge TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS emoji TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS price_usd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS old_price_usd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cta_label TEXT,
  ADD COLUMN IF NOT EXISTS cta_url TEXT,
  ADD COLUMN IF NOT EXISTS wa_message TEXT,
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'green',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

ALTER TABLE public.jjp_promos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_promos_sel ON public.jjp_promos;
CREATE POLICY jjp_promos_sel ON public.jjp_promos FOR SELECT USING (true);
DROP POLICY IF EXISTS jjp_promos_staff ON public.jjp_promos;
CREATE POLICY jjp_promos_staff ON public.jjp_promos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. WHATSAPP CRM Y DIFUSIÓN (jjp_wa_chats, jjp_wa_messages, templates, campaigns)
-- ============================================================================

-- Eliminar check constraints restrictivos de versiones anteriores
ALTER TABLE public.jjp_wa_templates DROP CONSTRAINT IF EXISTS jjp_wa_templates_kind_check;
ALTER TABLE public.jjp_wa_campaigns DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;
ALTER TABLE public.jjp_wa_campaigns DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
ALTER TABLE public.jjp_wa_campaign_targets DROP CONSTRAINT IF EXISTS jjp_wa_campaign_targets_status_check;

-- Columnas en chats (anclados, etiquetas, etc.)
ALTER TABLE public.jjp_wa_chats
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS label_color TEXT,
  ADD COLUMN IF NOT EXISTS unread_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
  ADD COLUMN IF NOT EXISTS last_message_from TEXT,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

-- Columnas en mensajes
ALTER TABLE public.jjp_wa_messages
  ADD COLUMN IF NOT EXISTS quoted_id UUID,
  ADD COLUMN IF NOT EXISTS quoted_body TEXT,
  ADD COLUMN IF NOT EXISTS quoted_sender TEXT,
  ADD COLUMN IF NOT EXISTS quoted_type TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_size INT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT;

CREATE TABLE IF NOT EXISTS public.jjp_wa_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_wa_templates
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

ALTER TABLE public.jjp_wa_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_tpl_all ON public.jjp_wa_templates;
CREATE POLICY wa_tpl_all ON public.jjp_wa_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.jjp_wa_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  template_id UUID REFERENCES public.jjp_wa_templates(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  delay_min_s INTEGER NOT NULL DEFAULT 12,
  delay_max_s INTEGER NOT NULL DEFAULT 28,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.jjp_wa_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_min_s INTEGER DEFAULT 12,
  ADD COLUMN IF NOT EXISTS delay_max_s INTEGER DEFAULT 28,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER;

ALTER TABLE public.jjp_wa_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_camp_all ON public.jjp_wa_campaigns;
CREATE POLICY wa_camp_all ON public.jjp_wa_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.jjp_wa_campaign_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.jjp_wa_campaigns(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  name TEXT,
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id UUID,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_wa_campaign_targets
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.jjp_wa_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS vars JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE public.jjp_wa_campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_tgt_all ON public.jjp_wa_campaign_targets;
CREATE POLICY wa_tgt_all ON public.jjp_wa_campaign_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 5. MÓDULO DE CORREO (jjp_email_accounts, jjp_email_company, jjp_emails)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_email_accounts (
  profile_id    UUID PRIMARY KEY REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  from_name     TEXT,
  provider      TEXT DEFAULT 'google',
  oauth_refresh TEXT,
  app_pass      TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  verified      BOOLEAN NOT NULL DEFAULT false,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_email_accounts
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS from_name TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS oauth_refresh TEXT,
  ADD COLUMN IF NOT EXISTS app_pass TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.jjp_email_accounts DROP COLUMN IF EXISTS has_cred;
ALTER TABLE public.jjp_email_accounts ADD COLUMN has_cred BOOLEAN GENERATED ALWAYS AS (
  (oauth_refresh IS NOT NULL AND oauth_refresh <> '') OR
  (app_pass IS NOT NULL AND app_pass <> '')
) STORED;

ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_email_accounts_policy ON public.jjp_email_accounts;
CREATE POLICY jjp_email_accounts_policy ON public.jjp_email_accounts FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (profile_id = auth.uid() OR public.jjp_is_admin());

CREATE TABLE IF NOT EXISTS public.jjp_email_company (
  id            INT PRIMARY KEY DEFAULT 1,
  email         TEXT,
  from_name     TEXT,
  app_pass      TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  verified      BOOLEAN NOT NULL DEFAULT false,
  last_error    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_email_company
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS from_name TEXT,
  ADD COLUMN IF NOT EXISTS app_pass TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.jjp_email_company DROP COLUMN IF EXISTS has_cred;
ALTER TABLE public.jjp_email_company ADD COLUMN has_cred BOOLEAN GENERATED ALWAYS AS (
  app_pass IS NOT NULL AND app_pass <> ''
) STORED;

ALTER TABLE public.jjp_email_company ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_email_company_policy ON public.jjp_email_company;
CREATE POLICY jjp_email_company_policy ON public.jjp_email_company FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.jjp_email_company (id, enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jjp_emails (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  customer_id    UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  direction      TEXT NOT NULL DEFAULT 'out',
  to_email       TEXT NOT NULL,
  from_email     TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body_text      TEXT,
  body_html      TEXT,
  attachments    JSONB DEFAULT '[]'::jsonb,
  status         TEXT NOT NULL DEFAULT 'pending',
  is_read        BOOLEAN NOT NULL DEFAULT false,
  last_error     TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'out',
  ADD COLUMN IF NOT EXISTS to_email TEXT,
  ADD COLUMN IF NOT EXISTS from_email TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_emails_policy ON public.jjp_emails;
CREATE POLICY jjp_emails_policy ON public.jjp_emails FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. CONTROL DEL SERVIDOR (jjp_server_control)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_server_control (
  id INT PRIMARY KEY DEFAULT 1,
  command TEXT,
  command_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ DEFAULT now(),
  host TEXT,
  modules JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.jjp_server_control
  ADD COLUMN IF NOT EXISTS command TEXT,
  ADD COLUMN IF NOT EXISTS command_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS host TEXT,
  ADD COLUMN IF NOT EXISTS modules JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_server_control_policy ON public.jjp_server_control;
CREATE POLICY jjp_server_control_policy ON public.jjp_server_control FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.jjp_server_control (id, command, heartbeat_at) VALUES (1, null, now())
ON CONFLICT (id) DO UPDATE SET heartbeat_at = now();

-- ============================================================================
-- 7. NOTIFICACIONES Y REALTIME
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_notifications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS link TEXT,
  ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;

ALTER TABLE public.jjp_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_notifications_policy ON public.jjp_notifications;
CREATE POLICY jjp_notifications_policy ON public.jjp_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Publicación Realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_campaigns;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_emails;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_server_control;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

-- Recargar caché del schema en Supabase
NOTIFY pgrst, 'reload schema';
