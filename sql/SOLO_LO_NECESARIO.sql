-- ============================================================
-- JJ PAPER — MIGRACIÓN DEFINITIVA Y ESTRUCTURA ORDENADA (2026)
-- Orden estricto: Tablas -> Funciones -> Vistas -> Políticas RLS
-- Limpieza preventiva con DROP IF EXISTS para evitar conflictos de tipo
-- ============================================================

-- ============================================================
-- 1. TABLAS DEL CONTEO FÍSICO E INVENTARIO
-- ============================================================

-- Tabla de conteo acumulado por variante (Tally)
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
  USING (owner_id = auth.uid() or public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() or public.jjp_is_admin());

-- Bitácora de códigos de barra
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

-- Kardex de movimientos de stock
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

-- Precios personalizados por vendedor
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

-- Ajustes por vendedor (tasa, firma, mostrar Bs)
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

-- ============================================================
-- 2. FUNCIONES Y RPCs DEL CONTEO Y KARDEX
-- ============================================================

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

-- Asignación de código de barras
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

-- Ranking de vendedores (Drop previo para permitir cambio de tipos)
DROP FUNCTION IF EXISTS public.jjp_seller_ranking(INT) CASCADE;
DROP FUNCTION IF EXISTS public.jjp_seller_ranking() CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_seller_ranking(p_days INT DEFAULT 30)
RETURNS TABLE (
  seller_id UUID,
  name TEXT,
  ref_code TEXT,
  total_usd NUMERIC,
  orders_count BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT
    p.id AS seller_id,
    p.name,
    p.ref_code,
    COALESCE(SUM(o.total_usd), 0) AS total_usd,
    COUNT(o.id) AS orders_count
  FROM public.jjp_profiles p
  LEFT JOIN public.jjp_orders o
    ON o.seller_id = p.id
    AND o.created_at >= now() - (p_days || ' days')::interval
    AND o.status IN ('pagado', 'preparando', 'entregado')
  WHERE p.active AND p.role = 'vendedor'
  GROUP BY p.id, p.name, p.ref_code
  ORDER BY total_usd DESC;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_seller_ranking(INT) TO authenticated;

-- ============================================================
-- 3. VISTAS SQL (CON DROP PREVIO)
-- ============================================================

-- Vista valorizada del conteo (resuelve el error jjp_count_valued)
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

-- Vista de totales del conteo
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

-- Detector de códigos de barra duplicados
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
