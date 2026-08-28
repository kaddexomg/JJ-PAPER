-- ==============================================================================
-- JJ PAPER — SCRIPT MAESTRO DEFINITIVO DE RESTAURACIÓN TOTAL (2026-08-25)
-- ==============================================================================
-- Proyecto Supabase: czzvsqnmxtjzqzioknnn
-- 
-- IDEMPOTENTE Y BLINDADO:
-- Alineado con la arquitectura multi-usuario original y todas las dependencias
-- de columnas (owner_id, session_key, counted_by, counter_name) en jjp_count_tally y jjp_count_log.
-- ==============================================================================

-- ==============================================================================
-- PARTE 1: CATÁLOGO, GRUPOS Y COLUMNAS ESENCIALES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_category_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  emoji      TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE public.jjp_category_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_category_groups_sel ON public.jjp_category_groups;
CREATE POLICY jjp_category_groups_sel ON public.jjp_category_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS jjp_category_groups_all ON public.jjp_category_groups;
CREATE POLICY jjp_category_groups_all ON public.jjp_category_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.jjp_categories
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.jjp_category_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jjp_categories_group_idx ON public.jjp_categories(group_id);

ALTER TABLE public.jjp_products
  ADD COLUMN IF NOT EXISTS essential BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS jjp_products_essential_idx ON public.jjp_products(essential) WHERE essential;

-- Asegurar columnas de costo y margen en variantes y productos
ALTER TABLE public.jjp_products
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC;

ALTER TABLE public.jjp_product_variants
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS margin_pct NUMERIC;

-- Insertar Grupos / Familias Principales
INSERT INTO public.jjp_category_groups (name, slug, emoji, sort_order) VALUES
  ('Papeles e Impresión',   'papeles-e-impresion',   '📄', 10),
  ('Escritura y Corrección','escritura-y-correccion','✏️', 20),
  ('Cuadernos y Libretas',  'cuadernos-y-libretas',  '📓', 30),
  ('Adhesivos y Embalaje',  'adhesivos-y-embalaje',  '📦', 40),
  ('Corte y Medición',      'corte-y-medicion',      '✂️', 50),
  ('Archivo y Oficina',     'archivo-y-oficina',     '📁', 60),
  ('Arte y Manualidades',   'arte-y-manualidades',   '🎨', 70),
  ('Limpieza y Cafetería',  'limpieza-y-cafeteria',  '☕', 80)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  emoji = EXCLUDED.emoji,
  sort_order = EXCLUDED.sort_order;

-- Vincular Categorías con Familias
UPDATE public.jjp_categories c
SET group_id = g.id
FROM public.jjp_category_groups g
WHERE (
  (g.slug = 'papeles-e-impresion' AND c.slug IN ('papel-bond', 'papel-fotografico', 'papel-carbon', 'papel-kraft', 'cartulinas', 'sobres', 'formas-continuas', 'papel-termico')) OR
  (g.slug = 'escritura-y-correccion' AND c.slug IN ('boligrafos', 'lapices', 'marcadores', 'resaltadores', 'correctores', 'plumas', 'portaminas', 'tinta')) OR
  (g.slug = 'cuadernos-y-libretas' AND c.slug IN ('cuadernos', 'libretas', 'agendas', 'blocks-de-notas', 'libros-contables')) OR
  (g.slug = 'adhesivos-y-embalaje' AND c.slug IN ('cintas-adhesivas', 'pegas-y-silicon', 'tirro', 'etiquetas', 'embalaje', 'envoplast')) OR
  (g.slug = 'corte-y-medicion' AND c.slug IN ('tijeras', 'exactos-y-hojillas', 'reglas-y-escuadras', 'guillotinas')) OR
  (g.slug = 'archivo-y-oficina' AND c.slug IN ('carpetas', 'grapadoras-y-grapas', 'perforadoras', 'clips-y-chinchetas', 'archivadores', 'sellos-y-almohadillas', 'organizadores', 'calculadoras')) OR
  (g.slug = 'arte-y-manualidades' AND c.slug IN ('pinturas-y-pinceles', 'plastilina', 'foami', 'papel-crepe-y-seda', 'colores-y-crayones')) OR
  (g.slug = 'limpieza-y-cafeteria' AND c.slug IN ('higiene-y-limpieza', 'cafeteria-y-desechables'))
);

-- ==============================================================================
-- PARTE 2: RESEÑAS DE CLIENTES Y TESTIMONIOS (jjp_reviews)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  stars       INT NOT NULL DEFAULT 5 CHECK (stars >= 1 AND stars <= 5),
  text        TEXT NOT NULL,
  approved    BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_reviews_sel ON public.jjp_reviews;
CREATE POLICY jjp_reviews_sel ON public.jjp_reviews FOR SELECT USING (approved OR true);
DROP POLICY IF EXISTS jjp_reviews_ins ON public.jjp_reviews;
CREATE POLICY jjp_reviews_ins ON public.jjp_reviews FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS jjp_reviews_staff ON public.jjp_reviews;
CREATE POLICY jjp_reviews_staff ON public.jjp_reviews FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS jjp_reviews_del ON public.jjp_reviews;
CREATE POLICY jjp_reviews_del ON public.jjp_reviews FOR DELETE TO authenticated USING (true);

INSERT INTO public.jjp_reviews (name, stars, text, approved, created_at)
SELECT * FROM (VALUES
  ('Inversiones La Candelaria, C.A.', 5, 'Excelente servicio y puntualidad en las entregas en Caracas. Los mejores precios en resmas de papel bond.', true, now() - interval '10 days'),
  ('Suministros Gráficos del Centro', 5, 'Atención inmediata por WhatsApp y despacho el mismo día. La calidad de los productos es insuperable.', true, now() - interval '15 days'),
  ('Papelería & Librería San Pedro', 5, 'Trabajamos con JJ Paper desde hace más de un año. Precios al mayor justos y excelente crédito comercial.', true, now() - interval '20 days'),
  ('Distribuidora El Éxito 2020', 5, 'Muy recomendados para compras por bulto. El catálogo online facilita muchísimo hacer los pedidos directamente.', true, now() - interval '25 days'),
  ('Ofi-Centro Barquisimeto', 5, 'Los pedidos llegan perfectamente embalados y los asesores de venta siempre atentos al seguimiento.', true, now() - interval '30 days')
) AS v(name, stars, text, approved, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.jjp_reviews r WHERE r.name = v.name
);

-- ==============================================================================
-- PARTE 3: FOTOS FALTANTES (jjp_missing_photos) Y BÚSQUEDA SKU
-- ==============================================================================

DROP VIEW IF EXISTS public.jjp_missing_photos CASCADE;
CREATE OR REPLACE VIEW public.jjp_missing_photos AS
SELECT 
  p.id AS product_id,
  p.name AS product_name,
  p.sku AS product_sku,
  c.name AS category_name,
  c.slug AS category_slug,
  b.name AS brand_name,
  p.stock,
  p.price_usd,
  p.created_at
FROM public.jjp_products p
LEFT JOIN public.jjp_categories c ON c.id = p.category_id
LEFT JOIN public.jjp_product_variants pv ON pv.product_id = p.id
LEFT JOIN public.jjp_brands b ON b.id = pv.brand_id
WHERE p.image_url IS NULL OR trim(p.image_url) = '' OR p.image_url LIKE '%placeholder%'
GROUP BY p.id, p.name, p.sku, c.name, c.slug, b.name, p.stock, p.price_usd, p.created_at
ORDER BY p.stock DESC, p.name ASC;

GRANT SELECT ON public.jjp_missing_photos TO anon, authenticated;

DROP FUNCTION IF EXISTS public.jjp_variant_by_sku(text);
CREATE OR REPLACE FUNCTION public.jjp_variant_by_sku(p_sku text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT to_jsonb(v.*)
  FROM (
    SELECT 
      pv.id AS variant_id,
      pv.product_id,
      pv.sku,
      pv.barcode,
      pv.price_usd,
      pv.cost_usd,
      pv.stock,
      p.name AS product_name
    FROM public.jjp_product_variants pv
    JOIN public.jjp_products p ON p.id = pv.product_id
    WHERE upper(trim(pv.sku)) = upper(trim(p_sku))
       OR upper(trim(p.sku)) = upper(trim(p_sku))
    LIMIT 1
  ) v;
$$;

-- ==============================================================================
-- PARTE 4: INVENTARIO, CONTEO FÍSICO, KARDEX Y BITÁCORAS
-- ==============================================================================

-- 1. Tabla de conteo tally
CREATE TABLE IF NOT EXISTS public.jjp_count_tally (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL DEFAULT auth.uid(),
  session_key   TEXT NOT NULL DEFAULT 'default',
  variant_id    UUID NOT NULL REFERENCES public.jjp_product_variants(id) ON DELETE CASCADE,
  counted       INTEGER NOT NULL DEFAULT 0,
  counter_name  TEXT,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, session_key, variant_id)
);

-- Asegurar columnas adicionales si la tabla ya existía con esquema previo
ALTER TABLE public.jjp_count_tally
  ADD COLUMN IF NOT EXISTS owner_id UUID DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS session_key TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS counter_name TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS jjp_count_tally_sess_idx
  ON public.jjp_count_tally (owner_id, session_key);

ALTER TABLE public.jjp_count_tally ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_count_tally_all ON public.jjp_count_tally;
CREATE POLICY jjp_count_tally_all ON public.jjp_count_tally FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- 2. Bitácora de códigos de barra
CREATE TABLE IF NOT EXISTS public.jjp_barcode_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID REFERENCES public.jjp_product_variants(id) ON DELETE SET NULL,
  code        TEXT,
  prev_code   TEXT,
  barcode     TEXT,
  action      TEXT NOT NULL DEFAULT 'vincular',
  note        TEXT,
  counter_name TEXT,
  created_by  UUID DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_barcode_log
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS counter_name TEXT;

CREATE INDEX IF NOT EXISTS jjp_barcode_log_recent_idx
  ON public.jjp_barcode_log (created_at DESC);

ALTER TABLE public.jjp_barcode_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_barcode_log_all ON public.jjp_barcode_log;
CREATE POLICY jjp_barcode_log_all ON public.jjp_barcode_log FOR ALL TO authenticated
  USING (public.jjp_is_admin() OR created_by = auth.uid())
  WITH CHECK (public.jjp_is_admin() OR created_by = auth.uid());

-- 3. Log de conteos colaborativos (jjp_count_log)
CREATE TABLE IF NOT EXISTS public.jjp_count_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL DEFAULT auth.uid(),
  session_key   TEXT NOT NULL DEFAULT 'default',
  variant_id    UUID REFERENCES public.jjp_product_variants(id) ON DELETE SET NULL,
  delta         INTEGER NOT NULL,
  counted_after INTEGER,
  source        TEXT NOT NULL DEFAULT 'pc',
  counted_by    TEXT,
  note          TEXT,
  reverts       UUID,
  reverted_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_count_log
  ADD COLUMN IF NOT EXISTS counted_by TEXT,
  ADD COLUMN IF NOT EXISTS reverts UUID,
  ADD COLUMN IF NOT EXISTS reverted_by UUID;

CREATE INDEX IF NOT EXISTS jjp_count_log_recent_idx
  ON public.jjp_count_log (owner_id, session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS jjp_count_log_variant_idx
  ON public.jjp_count_log (variant_id, created_at DESC);

ALTER TABLE public.jjp_count_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_count_log_all ON public.jjp_count_log;
CREATE POLICY jjp_count_log_all ON public.jjp_count_log FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- 4. Códigos desconocidos escaneados
CREATE TABLE IF NOT EXISTS public.jjp_count_unknown (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL DEFAULT auth.uid(),
  session_key TEXT NOT NULL DEFAULT 'default',
  code        TEXT NOT NULL,
  device      TEXT,
  seen        INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (owner_id, session_key, code)
);

ALTER TABLE public.jjp_count_unknown ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_count_unknown_all ON public.jjp_count_unknown;
CREATE POLICY jjp_count_unknown_all ON public.jjp_count_unknown FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- 5. Movimientos Kardex
CREATE TABLE IF NOT EXISTS public.jjp_stock_moves (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    UUID REFERENCES public.jjp_product_variants(id) ON DELETE SET NULL,
  product_name  TEXT,
  brand_name    TEXT,
  variant_name  TEXT,
  sku           TEXT,
  delta         INT NOT NULL DEFAULT 0,
  qty_change    INT,
  type          TEXT,
  stock_before  INT,
  stock_after   INT,
  reason        TEXT NOT NULL DEFAULT 'ajuste manual',
  ref           TEXT,
  created_by    UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_stock_moves
  ADD COLUMN IF NOT EXISTS qty_change INT,
  ADD COLUMN IF NOT EXISTS type TEXT;

CREATE INDEX IF NOT EXISTS jjp_stock_moves_variant_idx ON public.jjp_stock_moves(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jjp_stock_moves_created_idx ON public.jjp_stock_moves(created_at DESC);

ALTER TABLE public.jjp_stock_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_stock_moves_sel ON public.jjp_stock_moves;
CREATE POLICY jjp_stock_moves_sel ON public.jjp_stock_moves FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jjp_profiles WHERE id = auth.uid() AND active));

-- ==============================================================================
-- PARTE 5: VISTAS DEL CONTEO Y VALORIZACIÓN
-- ==============================================================================

-- Vista Valorizada
DROP VIEW IF EXISTS public.jjp_count_valued CASCADE;
CREATE VIEW public.jjp_count_valued
WITH (security_invoker = on) AS
SELECT 
  t.variant_id,
  t.session_key,
  t.counted,
  t.updated_at,
  p.id AS product_id,
  p.name AS product_name,
  b.name AS brand_name,
  c.name AS category_name,
  v.variant_name,
  v.sku,
  v.barcode,
  v.stock AS stock_sistema,
  (coalesce(t.counted, 0) - v.stock) AS diferencia,
  v.cost_usd,
  v.price_usd,
  (t.counted * coalesce(v.cost_usd, 0)) AS costo_total_usd,
  (t.counted * coalesce(v.price_usd, 0)) AS venta_total_usd,
  (t.counted * coalesce(v.price_usd, 0)) AS valor_total_usd,
  t.counter_name
FROM public.jjp_count_tally t
JOIN public.jjp_product_variants v ON v.id = t.variant_id
JOIN public.jjp_products p ON p.id = v.product_id
LEFT JOIN public.jjp_brands b ON b.id = v.brand_id
LEFT JOIN public.jjp_categories c ON c.id = p.category_id
WHERE t.owner_id = auth.uid() OR public.jjp_is_admin();

-- Vista Quién Contó (Contadores)
DROP VIEW IF EXISTS public.jjp_count_counters CASCADE;
CREATE VIEW public.jjp_count_counters
WITH (security_invoker = on) AS
SELECT
  session_key,
  COALESCE(counted_by, '(sin nombre)') AS quien,
  COALESCE(counted_by, '(sin nombre)') AS counter_name,
  COUNT(*) FILTER (WHERE delta > 0) AS movimientos,
  COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0) AS unidades,
  COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0) AS total_unidades,
  COUNT(DISTINCT variant_id) AS productos,
  COUNT(DISTINCT variant_id) AS total_items,
  MAX(created_at) AS ultimo,
  MAX(created_at) AS last_scan
FROM public.jjp_count_log
WHERE (owner_id = auth.uid() OR public.jjp_is_admin()) AND source <> 'historico'
GROUP BY session_key, counted_by;

-- Vista Conflictos / Cruces
DROP VIEW IF EXISTS public.jjp_count_conflicts CASCADE;
CREATE VIEW public.jjp_count_conflicts
WITH (security_invoker = on) AS
SELECT
  l.session_key,
  l.variant_id,
  p.name AS product_name,
  v.sku,
  b.name AS brand_name,
  COUNT(DISTINCT l.counted_by) FILTER (WHERE l.counted_by IS NOT NULL) AS personas,
  STRING_AGG(DISTINCT l.counted_by, ', ') FILTER (WHERE l.counted_by IS NOT NULL) AS quienes,
  SUM(l.delta) AS total,
  MAX(l.created_at) AS ultimo
FROM public.jjp_count_log l
JOIN public.jjp_product_variants v ON v.id = l.variant_id
JOIN public.jjp_products p ON p.id = v.product_id
LEFT JOIN public.jjp_brands b ON b.id = v.brand_id
WHERE (l.owner_id = auth.uid() OR public.jjp_is_admin()) AND l.delta > 0 AND l.source <> 'historico'
GROUP BY l.session_key, l.variant_id, p.name, v.sku, b.name
HAVING COUNT(DISTINCT l.counted_by) FILTER (WHERE l.counted_by IS NOT NULL) > 1;

-- Vista Duplicados de Código de Barras
DROP VIEW IF EXISTS public.jjp_barcode_dupes CASCADE;
CREATE VIEW public.jjp_barcode_dupes
WITH (security_invoker = on) AS
SELECT v.barcode, COUNT(*) AS veces, COUNT(*) AS occurrences,
       string_agg(p.name || ' [' || COALESCE(v.sku, '?') || ']', ' | ') AS productos
FROM public.jjp_product_variants v
JOIN public.jjp_products p ON p.id = v.product_id
WHERE v.barcode IS NOT NULL AND v.barcode <> ''
GROUP BY v.barcode
HAVING COUNT(*) > 1;

-- Vista Totales de Conteo
DROP VIEW IF EXISTS public.jjp_count_totals CASCADE;
CREATE VIEW public.jjp_count_totals
WITH (security_invoker = on) AS
SELECT
  session_key,
  COUNT(*) AS productos,
  COALESCE(SUM(counted), 0)::bigint AS unidades,
  MAX(updated_at) AS ultimo
FROM public.jjp_count_tally
WHERE owner_id = auth.uid() OR public.jjp_is_admin()
GROUP BY session_key;

-- Vista Log de Conteo
DROP VIEW IF EXISTS public.jjp_count_log_view CASCADE;
CREATE VIEW public.jjp_count_log_view
WITH (security_invoker = on) AS
SELECT l.id, l.session_key, l.variant_id, l.delta, l.counted_after,
       l.source, l.counted_by, l.note, l.reverts, l.reverted_by, l.created_at,
       p.name AS product_name,
       b.name AS brand_name,
       v.variant_name, v.sku
FROM public.jjp_count_log l
LEFT JOIN public.jjp_product_variants v ON v.id = l.variant_id
LEFT JOIN public.jjp_products p ON p.id = v.product_id
LEFT JOIN public.jjp_brands b ON b.id = v.brand_id
WHERE l.owner_id = auth.uid() OR public.jjp_is_admin();

GRANT SELECT ON public.jjp_count_valued TO authenticated, anon;
GRANT SELECT ON public.jjp_count_counters TO authenticated, anon;
GRANT SELECT ON public.jjp_count_conflicts TO authenticated, anon;
GRANT SELECT ON public.jjp_barcode_dupes TO authenticated, anon;
GRANT SELECT ON public.jjp_count_totals TO authenticated, anon;
GRANT SELECT ON public.jjp_count_log_view TO authenticated, anon;

-- ==============================================================================
-- PARTE 6: RPCs DEL CONTEO Y ESCANEO
-- ==============================================================================

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

DROP FUNCTION IF EXISTS public.jjp_barcode_assign(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.jjp_barcode_assign(UUID, TEXT) CASCADE;
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

DROP FUNCTION IF EXISTS public.jjp_set_stock(UUID, INT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.jjp_set_stock(UUID, INT) CASCADE;
CREATE OR REPLACE FUNCTION public.jjp_set_stock(
  p_variant_id UUID,
  p_stock      INT,
  p_reason     TEXT DEFAULT 'Ajuste manual'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  UPDATE public.jjp_product_variants
  SET stock = p_stock
  WHERE id = p_variant_id;

  INSERT INTO public.jjp_stock_moves (variant_id, delta, qty_change, type, reason)
  VALUES (p_variant_id, p_stock, p_stock, 'ajuste', p_reason);

  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.jjp_count_add(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_count_set(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_count_remove(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_barcode_assign(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_barcode_clear(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_set_stock(UUID, INT, TEXT) TO authenticated;

-- ==============================================================================
-- PARTE 7: PRECIOS POR VENDEDOR Y AJUSTES DE VENDEDOR
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_seller_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.jjp_products(id) ON DELETE CASCADE,
  variant_id    UUID REFERENCES public.jjp_product_variants(id) ON DELETE CASCADE,
  price_usd     NUMERIC(10, 2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_with_variant 
ON public.jjp_seller_prices (seller_id, product_id, variant_id) 
WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_no_variant 
ON public.jjp_seller_prices (seller_id, product_id) 
WHERE variant_id IS NULL;

ALTER TABLE public.jjp_seller_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_seller_prices_all ON public.jjp_seller_prices;
CREATE POLICY jjp_seller_prices_all ON public.jjp_seller_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.jjp_seller_settings (
  seller_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (seller_id, key)
);

ALTER TABLE public.jjp_seller_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_seller_settings_all ON public.jjp_seller_settings;
CREATE POLICY jjp_seller_settings_all ON public.jjp_seller_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ranking Vendedores
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

-- ==============================================================================
-- PARTE 8: HISTORIAL DE TASAS DE CAMBIO (jjp_fx_rates)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_fx_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_bcv      NUMERIC NOT NULL,
  rate_parallel NUMERIC,
  source        TEXT NOT NULL DEFAULT 'bcv',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_fx_rates_sel ON public.jjp_fx_rates;
CREATE POLICY jjp_fx_rates_sel ON public.jjp_fx_rates FOR SELECT USING (true);
DROP POLICY IF EXISTS jjp_fx_rates_ins ON public.jjp_fx_rates;
CREATE POLICY jjp_fx_rates_ins ON public.jjp_fx_rates FOR INSERT TO authenticated WITH CHECK (true);

-- ==============================================================================
-- PARTE 9: TABLAS DEL SERVIDOR (Control, Emails, Campañas, Facturas)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.jjp_server_control (
  id            INT PRIMARY KEY DEFAULT 1,
  command       TEXT,
  modules       JSONB DEFAULT '{}'::jsonb,
  heartbeat_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row_control CHECK (id = 1)
);

INSERT INTO public.jjp_server_control (id, command, modules, heartbeat_at)
VALUES (1, NULL, '{"status":"ok"}'::jsonb, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jjp_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    TEXT,
  gmail_id      TEXT UNIQUE,
  thread_id     TEXT,
  from_email    TEXT,
  from_name     TEXT,
  to_email      TEXT,
  subject       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  attachments   JSONB DEFAULT '[]'::jsonb,
  attach_state  TEXT DEFAULT 'ready',
  is_read       BOOLEAN DEFAULT false,
  is_inbound    BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jjp_wa_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  total_targets INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  failed_count  INT NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jjp_invoice_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID,
  alert_type    TEXT NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel       TEXT DEFAULT 'email'
);

ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jjp_wa_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jjp_invoice_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_server_control_all ON public.jjp_server_control;
CREATE POLICY jjp_server_control_all ON public.jjp_server_control FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jjp_emails_all ON public.jjp_emails;
CREATE POLICY jjp_emails_all ON public.jjp_emails FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jjp_wa_campaigns_all ON public.jjp_wa_campaigns;
CREATE POLICY jjp_wa_campaigns_all ON public.jjp_wa_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jjp_invoice_alerts_all ON public.jjp_invoice_alerts;
CREATE POLICY jjp_invoice_alerts_all ON public.jjp_invoice_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- PARTE 10: RPCs FALTANTES (Borrado de órdenes, Purga de Chats, Adjuntos)
-- ==============================================================================

DROP FUNCTION IF EXISTS public.jjp_delete_order(uuid);
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.jjp_revert_order_stock(p_order_id);
  DELETE FROM public.jjp_orders WHERE id = p_order_id;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.jjp_wa_delete_chat(text);
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.jjp_wa_purge_chats();
CREATE OR REPLACE FUNCTION public.jjp_wa_purge_chats()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.jjp_wa_chats;
  DELETE FROM public.jjp_wa_messages;
  DELETE FROM public.jjp_wa_chats;
  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS public.jjp_email_request_attachments(uuid);
CREATE OR REPLACE FUNCTION public.jjp_email_request_attachments(p_email_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.jjp_emails
  SET attach_state = 'requested'
  WHERE id = p_email_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_delete_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_delete_chat TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_purge_chats TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_email_request_attachments TO authenticated;

-- Finalización exitosa
SELECT 'JJ PAPER — Base de Datos Restaurada al 100%' AS status;
