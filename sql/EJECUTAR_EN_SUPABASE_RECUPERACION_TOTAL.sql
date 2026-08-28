-- ============================================================
-- JJ PAPER — SQL MAESTRO DE RECUPERACION Y ESTABILIZACION (2026)
-- APLICAR ESTE SCRIPT COMPLETO EN EL SQL EDITOR DE SUPABASE (czzvsqnmxtjzqzioknnn)
-- Contiene:
--   1. Fase 1: Familias, Grupos de Catálogo y Esenciales
--   2. Fase 2: Conteo Físico, Kardex, Bitácora y Búsqueda SKU
--   3. Fase 4: Tablas del Servidor (jjp_server_control, jjp_emails, jjp_wa_campaigns, jjp_invoice_alerts, jjp_fx_rates)
-- ============================================================

-- ============================================================
-- PARTE 1: FAMILIAS Y GRUPOS DEL CATÁLOGO (FASE 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.jjp_category_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  emoji      TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE public.jjp_categories
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.jjp_category_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jjp_categories_group_idx ON public.jjp_categories(group_id);

ALTER TABLE public.jjp_products
  ADD COLUMN IF NOT EXISTS essential BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS jjp_products_essential_idx ON public.jjp_products(essential) WHERE essential;

ALTER TABLE public.jjp_category_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_groups_sel   ON public.jjp_category_groups;
DROP POLICY IF EXISTS jjp_groups_staff ON public.jjp_category_groups;

CREATE POLICY jjp_groups_sel   ON public.jjp_category_groups FOR SELECT USING (true);
CREATE POLICY jjp_groups_staff ON public.jjp_category_groups FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.jjp_profiles WHERE id = auth.uid() AND active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jjp_profiles WHERE id = auth.uid() AND active));

INSERT INTO public.jjp_category_groups (slug, name, emoji, sort_order) VALUES
  ('escritura',     'Escritura y corrección',   '🖊️', 1),
  ('papel',         'Papel y cuadernos',        '📄', 2),
  ('escolar_arte',  'Escolar y arte',           '🎨', 3),
  ('corte_pegado',  'Corte y pegado',           '✂️', 4),
  ('archivo',       'Archivo y carpetas',       '🗂️', 5),
  ('administracion','Administración',          '🧾', 6),
  ('sujecion',      'Sujeción y encuadernado',  '📎', 7),
  ('tecnologia',    'Tecnología y otros',       '🧰', 8)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, sort_order = EXCLUDED.sort_order;

UPDATE public.jjp_categories c
SET group_id = g.id
FROM public.jjp_category_groups g
WHERE g.slug = CASE c.slug
  WHEN 'boligrafos'          THEN 'escritura'
  WHEN 'marcadores'          THEN 'escritura'
  WHEN 'lapices'             THEN 'escritura'
  WHEN 'creyones'            THEN 'escritura'
  WHEN 'tajalapices'         THEN 'escritura'
  WHEN 'correctores'         THEN 'escritura'
  WHEN 'cuadernos'           THEN 'papel'
  WHEN 'papel'               THEN 'papel'
  WHEN 'notas_adhesivas'     THEN 'papel'
  WHEN 'manualidades'        THEN 'escolar_arte'
  WHEN 'pinturas'            THEN 'escolar_arte'
  WHEN 'libros_cuentos'      THEN 'escolar_arte'
  WHEN 'cartelera'           THEN 'escolar_arte'
  WHEN 'compases'            THEN 'escolar_arte'
  WHEN 'tizas'               THEN 'escolar_arte'
  WHEN 'reglas'              THEN 'escolar_arte'
  WHEN 'cartucheras'         THEN 'escolar_arte'
  WHEN 'forros_plastificado' THEN 'escolar_arte'
  WHEN 'cintas'              THEN 'corte_pegado'
  WHEN 'pegamentos'          THEN 'corte_pegado'
  WHEN 'tijeras'             THEN 'corte_pegado'
  WHEN 'carpetas'            THEN 'archivo'
  WHEN 'archivadores'        THEN 'archivo'
  WHEN 'fundas_protectores'  THEN 'archivo'
  WHEN 'bandejas'            THEN 'archivo'
  WHEN 'sobres'              THEN 'administracion'
  WHEN 'tinta_sellos'        THEN 'administracion'
  WHEN 'libros_contables'    THEN 'administracion'
  WHEN 'etiquetas'           THEN 'administracion'
  WHEN 'formularios'         THEN 'administracion'
  WHEN 'clips_ganchos'       THEN 'sujecion'
  WHEN 'engrapadoras'        THEN 'sujecion'
  WHEN 'perforadoras'        THEN 'sujecion'
  WHEN 'chinches'            THEN 'sujecion'
  WHEN 'gomas_bandas'        THEN 'sujecion'
  WHEN 'calculadoras'        THEN 'tecnologia'
  WHEN 'multimedia'          THEN 'tecnologia'
  WHEN 'pilas'               THEN 'tecnologia'
  WHEN 'varios'              THEN 'tecnologia'
END;

UPDATE public.jjp_categories c
SET group_id = (SELECT id FROM public.jjp_category_groups WHERE slug = 'tecnologia')
WHERE c.group_id IS NULL;


-- ============================================================
-- PARTE 2: CONTEO FÍSICO, KARDEX Y PRECIOS VENDEDOR (FASE 2)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.jjp_count_tally (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL DEFAULT auth.uid(),
  session_key TEXT NOT NULL DEFAULT 'default',
  variant_id  UUID NOT NULL REFERENCES public.jjp_product_variants(id) ON DELETE CASCADE,
  counted     INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, session_key, variant_id)
);

CREATE INDEX IF NOT EXISTS jjp_count_tally_sess_idx
  ON public.jjp_count_tally (owner_id, session_key);

ALTER TABLE public.jjp_count_tally ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_count_tally_all ON public.jjp_count_tally;
CREATE POLICY jjp_count_tally_all ON public.jjp_count_tally FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

CREATE TABLE IF NOT EXISTS public.jjp_barcode_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID REFERENCES public.jjp_product_variants(id) ON DELETE SET NULL,
  code        TEXT,
  prev_code   TEXT,
  action      TEXT NOT NULL DEFAULT 'vincular',
  note        TEXT,
  created_by  UUID DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jjp_barcode_log_recent_idx
  ON public.jjp_barcode_log (created_at DESC);

ALTER TABLE public.jjp_barcode_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_barcode_log_all ON public.jjp_barcode_log;
CREATE POLICY jjp_barcode_log_all ON public.jjp_barcode_log FOR ALL TO authenticated
  USING (public.jjp_is_admin() OR created_by = auth.uid())
  WITH CHECK (public.jjp_is_admin() OR created_by = auth.uid());

CREATE TABLE IF NOT EXISTS public.jjp_stock_moves (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    UUID REFERENCES public.jjp_product_variants(id) ON DELETE SET NULL,
  product_name  TEXT,
  brand_name    TEXT,
  variant_name  TEXT,
  sku           TEXT,
  delta         INT NOT NULL DEFAULT 0,
  stock_before  INT,
  stock_after   INT,
  reason        TEXT NOT NULL DEFAULT 'ajuste manual',
  ref           TEXT,
  created_by    UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jjp_stock_moves_variant_idx ON public.jjp_stock_moves(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jjp_stock_moves_created_idx ON public.jjp_stock_moves(created_at DESC);

ALTER TABLE public.jjp_stock_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_stock_moves_sel ON public.jjp_stock_moves;
CREATE POLICY jjp_stock_moves_sel ON public.jjp_stock_moves FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jjp_profiles WHERE id = auth.uid() AND active));

CREATE TABLE IF NOT EXISTS public.jjp_seller_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.jjp_products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES public.jjp_product_variants(id) ON DELETE CASCADE,
    price_usd NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_with_variant 
ON public.jjp_seller_prices (seller_id, product_id, variant_id) 
WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_no_variant 
ON public.jjp_seller_prices (seller_id, product_id) 
WHERE variant_id IS NULL;

ALTER TABLE public.jjp_seller_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cualquiera puede leer precios personalizados" ON public.jjp_seller_prices;
CREATE POLICY "Cualquiera puede leer precios personalizados" 
ON public.jjp_seller_prices FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Vendedores pueden gestionar sus propios precios" ON public.jjp_seller_prices;
CREATE POLICY "Vendedores pueden gestionar sus propios precios" 
ON public.jjp_seller_prices FOR ALL 
USING (auth.uid() = seller_id);

CREATE TABLE IF NOT EXISTS public.jjp_seller_settings (
  seller_id  UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, key)
);

ALTER TABLE public.jjp_seller_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_seller_settings_sel_own ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_sel_own ON public.jjp_seller_settings FOR SELECT TO authenticated USING (seller_id = auth.uid());

DROP POLICY IF EXISTS jjp_seller_settings_ins_own ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_ins_own ON public.jjp_seller_settings FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS jjp_seller_settings_upd_own ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_upd_own ON public.jjp_seller_settings FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS jjp_seller_settings_del_own ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_del_own ON public.jjp_seller_settings FOR DELETE TO authenticated USING (seller_id = auth.uid());

DROP POLICY IF EXISTS jjp_seller_settings_sel_admin ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_sel_admin ON public.jjp_seller_settings FOR SELECT TO authenticated USING (public.jjp_is_admin());

-- RPCs
DROP FUNCTION IF EXISTS public.jjp_count_add(UUID, INTEGER, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_count_add(
  p_variant_id UUID,
  p_delta      INTEGER DEFAULT 1,
  p_session    TEXT    DEFAULT 'default'
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_total INTEGER;
BEGIN
  INSERT INTO public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  VALUES (auth.uid(), p_session, p_variant_id, greatest(0, p_delta))
  ON CONFLICT (owner_id, session_key, variant_id) DO UPDATE
    SET counted    = greatest(0, public.jjp_count_tally.counted + p_delta),
        updated_at = now()
  RETURNING counted INTO v_total;

  UPDATE public.jjp_product_variants SET stock = v_total WHERE id = p_variant_id;
  RETURN v_total;
END $$;

DROP FUNCTION IF EXISTS public.jjp_count_set(UUID, INTEGER, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_count_set(
  p_variant_id UUID,
  p_total      INTEGER,
  p_session    TEXT DEFAULT 'default'
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_total INTEGER;
BEGIN
  INSERT INTO public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  VALUES (auth.uid(), p_session, p_variant_id, greatest(0, p_total))
  ON CONFLICT (owner_id, session_key, variant_id) DO UPDATE
    SET counted    = greatest(0, p_total),
        updated_at = now()
  RETURNING counted INTO v_total;

  UPDATE public.jjp_product_variants SET stock = v_total WHERE id = p_variant_id;
  RETURN v_total;
END $$;

DROP FUNCTION IF EXISTS public.jjp_count_remove(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_count_remove(
  p_variant_id UUID,
  p_session    TEXT DEFAULT 'default'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  DELETE FROM public.jjp_count_tally
   WHERE owner_id = auth.uid() AND session_key = p_session AND variant_id = p_variant_id;
  UPDATE public.jjp_product_variants SET stock = -1 WHERE id = p_variant_id;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.jjp_count_add(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_count_set(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_count_remove(UUID, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.jjp_barcode_assign(UUID, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_barcode_assign(
  p_variant_id UUID,
  p_code       TEXT,
  p_note       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_prev   TEXT;
  v_stolen UUID;
BEGIN
  SELECT barcode INTO v_prev FROM public.jjp_product_variants WHERE id = p_variant_id;

  SELECT id INTO v_stolen FROM public.jjp_product_variants
   WHERE barcode = p_code AND id <> p_variant_id LIMIT 1;

  IF v_stolen IS NOT NULL THEN
    UPDATE public.jjp_product_variants SET barcode = NULL WHERE id = v_stolen;
    INSERT INTO public.jjp_barcode_log (variant_id, code, prev_code, action, note)
    VALUES (v_stolen, NULL, p_code, 'desvincular', 'reasignado a otro producto');
  END IF;

  UPDATE public.jjp_product_variants SET barcode = p_code WHERE id = p_variant_id;

  INSERT INTO public.jjp_barcode_log (variant_id, code, prev_code, action, note)
  VALUES (p_variant_id, p_code, v_prev, 'vincular', p_note);

  RETURN jsonb_build_object('ok', true, 'prev', v_prev, 'stolen_from', v_stolen);
END $$;

DROP FUNCTION IF EXISTS public.jjp_barcode_clear(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_barcode_clear(p_variant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_prev TEXT;
BEGIN
  SELECT barcode INTO v_prev FROM public.jjp_product_variants WHERE id = p_variant_id;
  UPDATE public.jjp_product_variants SET barcode = NULL WHERE id = p_variant_id;
  INSERT INTO public.jjp_barcode_log (variant_id, code, prev_code, action)
  VALUES (p_variant_id, NULL, v_prev, 'desvincular');
  RETURN jsonb_build_object('ok', true, 'prev', v_prev);
END $$;

GRANT EXECUTE ON FUNCTION public.jjp_barcode_assign(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_barcode_clear(UUID)              TO authenticated;

-- Vistas
DROP VIEW IF EXISTS public.jjp_count_valued CASCADE;
CREATE VIEW public.jjp_count_valued
WITH (security_invoker = on) AS
  SELECT
    t.variant_id,
    t.session_key,
    t.counted,
    t.updated_at,
    p.name                                   AS product_name,
    b.name                                   AS brand_name,
    v.variant_name,
    v.sku,
    v.barcode,
    v.cost_usd,
    v.price_usd,
    (t.counted * coalesce(v.cost_usd, 0))    AS costo_total_usd,
    (t.counted * v.price_usd)                AS venta_total_usd
  FROM public.jjp_count_tally t
  JOIN public.jjp_product_variants v ON v.id = t.variant_id
  JOIN public.jjp_products p         ON p.id = v.product_id
  LEFT JOIN public.jjp_brands b      ON b.id = v.brand_id
  WHERE t.owner_id = auth.uid();

GRANT SELECT ON public.jjp_count_valued TO authenticated;

DROP VIEW IF EXISTS public.jjp_count_totals CASCADE;
CREATE VIEW public.jjp_count_totals
WITH (security_invoker = on) AS
  SELECT
    session_key,
    COUNT(*)                          AS productos,
    COALESCE(SUM(counted), 0)::bigint AS unidades,
    MAX(updated_at)                   AS ultimo
  FROM public.jjp_count_tally
  WHERE owner_id = auth.uid()
  GROUP BY session_key;

GRANT SELECT ON public.jjp_count_totals TO authenticated;

DROP VIEW IF EXISTS public.jjp_barcode_dupes CASCADE;
CREATE VIEW public.jjp_barcode_dupes
WITH (security_invoker = on) AS
  SELECT v.barcode, COUNT(*) AS veces,
         string_agg(p.name || ' [' || COALESCE(v.sku, '?') || ']', ' | ') AS productos
  FROM public.jjp_product_variants v
  JOIN public.jjp_products p ON p.id = v.product_id
  WHERE v.barcode IS NOT NULL AND v.barcode <> ''
  GROUP BY v.barcode
  HAVING COUNT(*) > 1;

GRANT SELECT ON public.jjp_barcode_dupes TO authenticated;

-- Puente SKU
CREATE OR REPLACE FUNCTION public.jjp_variant_by_sku(p_sku TEXT)
RETURNS TABLE (
  variant_id UUID,
  product_id UUID,
  product_name TEXT,
  variant_name TEXT,
  sku TEXT,
  barcode TEXT,
  price_usd NUMERIC,
  stock INT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name,
         v.variant_name, v.sku, v.barcode, v.price_usd, v.stock
    FROM public.jjp_product_variants v
    JOIN public.jjp_products p ON p.id = v.product_id
   WHERE lower(v.sku) = lower(p_sku)
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_variant_by_sku(TEXT) TO authenticated, anon;


-- ============================================================
-- PARTE 3: TABLAS DEL SERVIDOR, EMAILS, CONTROL Y ALERTAS (FASE 4)
-- ============================================================

-- jjp_server_control (Heartbeat y control del servidor)
CREATE TABLE IF NOT EXISTS public.jjp_server_control (
  id          TEXT PRIMARY KEY DEFAULT 'main',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'running',
  info        JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_server_control_all ON public.jjp_server_control;
CREATE POLICY jjp_server_control_all ON public.jjp_server_control FOR ALL USING (true) WITH CHECK (true);

-- jjp_emails y jjp_email_accounts
CREATE TABLE IF NOT EXISTS public.jjp_email_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  oauth_refresh TEXT,
  app_pass      TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_email_accounts_policy ON public.jjp_email_accounts;
CREATE POLICY jjp_email_accounts_policy ON public.jjp_email_accounts FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

CREATE TABLE IF NOT EXISTS public.jjp_emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  customer_id  UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  direction    TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('in', 'out')),
  from_email   TEXT NOT NULL,
  to_email     TEXT NOT NULL,
  subject      TEXT,
  snippet      TEXT,
  body_text    TEXT,
  body_html    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  error_msg    TEXT,
  gmail_id     TEXT,
  attachments  JSONB DEFAULT '[]'::jsonb,
  attach_state TEXT DEFAULT 'none',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jjp_emails_status_idx ON public.jjp_emails(status);
CREATE INDEX IF NOT EXISTS jjp_emails_customer_idx ON public.jjp_emails(customer_id);

ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_emails_policy ON public.jjp_emails;
CREATE POLICY jjp_emails_policy ON public.jjp_emails FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- jjp_wa_campaigns
CREATE TABLE IF NOT EXISTS public.jjp_wa_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  message     TEXT NOT NULL,
  media_url   TEXT,
  target_zone TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'paused', 'cancelled')),
  total_count INT NOT NULL DEFAULT 0,
  sent_count  INT NOT NULL DEFAULT 0,
  fail_count  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_wa_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_wa_campaigns_policy ON public.jjp_wa_campaigns;
CREATE POLICY jjp_wa_campaigns_policy ON public.jjp_wa_campaigns FOR ALL TO authenticated
  USING (created_by = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (created_by = auth.uid() OR public.jjp_is_admin());

-- jjp_invoice_alerts
CREATE TABLE IF NOT EXISTS public.jjp_invoice_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES public.jjp_orders(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL,
  note        TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_invoice_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_invoice_alerts_policy ON public.jjp_invoice_alerts;
CREATE POLICY jjp_invoice_alerts_policy ON public.jjp_invoice_alerts FOR ALL TO authenticated
  USING (public.jjp_is_admin())
  WITH CHECK (public.jjp_is_admin());

-- jjp_fx_rates
CREATE TABLE IF NOT EXISTS public.jjp_fx_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bcv        NUMERIC NOT NULL,
  binance    NUMERIC,
  monitor    NUMERIC,
  eur        NUMERIC,
  gap_pct    NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_fx_rates_sel ON public.jjp_fx_rates;
CREATE POLICY jjp_fx_rates_sel ON public.jjp_fx_rates FOR SELECT USING (true);
DROP POLICY IF EXISTS jjp_fx_rates_ins ON public.jjp_fx_rates;
CREATE POLICY jjp_fx_rates_ins ON public.jjp_fx_rates FOR INSERT TO authenticated WITH CHECK (true);
