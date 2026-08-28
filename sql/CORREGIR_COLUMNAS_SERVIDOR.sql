-- ============================================================
-- JJ PAPER — SQL INTEGRAL DE CONTEO MULTI-USUARIO, BITÁCORA Y SERVIDOR (2026)
-- Ejecutar en SQL Editor de Supabase (czzvsqnmxtjzqzioknnn)
-- ============================================================

-- ---------- 1. Bitácora de Conteo (jjp_count_log) y Cola de Códigos Desconocidos ----------
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
  ADD COLUMN IF NOT EXISTS reverts    UUID,
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

-- ---------- 2. Vistas del Conteo y Cruces ----------
DROP VIEW IF EXISTS public.jjp_count_log_view CASCADE;
CREATE VIEW public.jjp_count_log_view
WITH (security_invoker = on) AS
  SELECT l.id, l.session_key, l.variant_id, l.delta, l.counted_after,
         l.source, l.counted_by, l.note, l.reverts, l.reverted_by, l.created_at,
         p.name  AS product_name,
         b.name  AS brand_name,
         v.variant_name, v.sku
  FROM public.jjp_count_log l
  LEFT JOIN public.jjp_product_variants v ON v.id = l.variant_id
  LEFT JOIN public.jjp_products p         ON p.id = v.product_id
  LEFT JOIN public.jjp_brands b           ON b.id = v.brand_id
  WHERE l.owner_id = auth.uid() OR public.jjp_is_admin();

GRANT SELECT ON public.jjp_count_log_view TO authenticated;

DROP VIEW IF EXISTS public.jjp_count_conflicts CASCADE;
CREATE VIEW public.jjp_count_conflicts
WITH (security_invoker = on) AS
  SELECT
    l.session_key,
    l.variant_id,
    p.name  AS product_name,
    v.sku,
    b.name  AS brand_name,
    COUNT(DISTINCT l.counted_by) FILTER (WHERE l.counted_by IS NOT NULL) AS personas,
    STRING_AGG(DISTINCT l.counted_by, ', ') FILTER (WHERE l.counted_by IS NOT NULL) AS quienes,
    SUM(l.delta)      AS total,
    MAX(l.created_at) AS ultimo
  FROM public.jjp_count_log l
  JOIN public.jjp_product_variants v ON v.id = l.variant_id
  JOIN public.jjp_products p         ON p.id = v.product_id
  LEFT JOIN public.jjp_brands b      ON b.id = v.brand_id
  WHERE (l.owner_id = auth.uid() OR public.jjp_is_admin()) AND l.delta > 0 AND l.source <> 'historico'
  GROUP BY l.session_key, l.variant_id, p.name, v.sku, b.name
  HAVING COUNT(DISTINCT l.counted_by) FILTER (WHERE l.counted_by IS NOT NULL) > 1;

GRANT SELECT ON public.jjp_count_conflicts TO authenticated;

DROP VIEW IF EXISTS public.jjp_count_counters CASCADE;
CREATE VIEW public.jjp_count_counters
WITH (security_invoker = on) AS
  SELECT
    session_key,
    COALESCE(counted_by, '(sin nombre)') AS quien,
    COUNT(*)                    FILTER (WHERE delta > 0) AS movimientos,
    COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)     AS unidades,
    COUNT(DISTINCT variant_id)                            AS productos,
    MAX(created_at)                                       AS ultimo
  FROM public.jjp_count_log
  WHERE (owner_id = auth.uid() OR public.jjp_is_admin()) AND source <> 'historico'
  GROUP BY session_key, counted_by;

GRANT SELECT ON public.jjp_count_counters TO authenticated;

-- Vista valorizada con soporte Admin
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
  WHERE t.owner_id = auth.uid() OR public.jjp_is_admin();

GRANT SELECT ON public.jjp_count_valued TO authenticated;

-- ---------- 3. RPCs de Conteo y Escaneo Multi-Persona ----------
DROP FUNCTION IF EXISTS public.jjp_count_scan(TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.jjp_count_scan(
  p_code    TEXT,
  p_session TEXT DEFAULT 'default',
  p_by      TEXT DEFAULT NULL,
  p_source  TEXT DEFAULT 'telefono'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_id    UUID;
  v_name  TEXT;
  v_sku   TEXT;
  v_total INTEGER;
  v_cnt   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM public.jjp_product_variants WHERE barcode = p_code;

  SELECT v.id, p.name, v.sku INTO v_id, v_name, v_sku
    FROM public.jjp_product_variants v
    JOIN public.jjp_products p ON p.id = v.product_id
   WHERE v.barcode = p_code AND v.active IS NOT false
   ORDER BY v.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.jjp_count_unknown (owner_id, session_key, code, device, seen)
    VALUES (auth.uid(), p_session, p_code, p_by, 1)
    ON CONFLICT (owner_id, session_key, code) DO UPDATE
      SET seen        = public.jjp_count_unknown.seen + 1,
          last_at     = now(),
          resolved_at = NULL,
          device      = coalesce(EXCLUDED.device, public.jjp_count_unknown.device);
    RETURN jsonb_build_object('ok', false, 'kind', 'nuevo', 'code', p_code);
  END IF;

  INSERT INTO public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  VALUES (auth.uid(), p_session, v_id, 1)
  ON CONFLICT (owner_id, session_key, variant_id) DO UPDATE
    SET counted = public.jjp_count_tally.counted + 1, updated_at = now()
  RETURNING counted INTO v_total;

  UPDATE public.jjp_product_variants SET stock = v_total WHERE id = v_id;

  INSERT INTO public.jjp_count_log (session_key, variant_id, delta, counted_after, source, counted_by, note)
  VALUES (p_session, v_id, 1, v_total, coalesce(p_source, 'telefono'), p_by,
          CASE WHEN v_cnt > 1 THEN 'código compartido por varios productos' ELSE NULL END);

  RETURN jsonb_build_object('ok', true, 'kind', 'contado', 'name', v_name,
    'sku', v_sku, 'counted', v_total, 'variant_id', v_id, 'dupe', v_cnt > 1);
END $$;

GRANT EXECUTE ON FUNCTION public.jjp_count_scan(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------- 4. Corrección de Tablas de Servidor, Correo y Facturas ----------
DROP TABLE IF EXISTS public.jjp_server_control CASCADE;

CREATE TABLE public.jjp_server_control (
  id           INT PRIMARY KEY DEFAULT 1,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ,
  host         TEXT,
  command      TEXT,
  modules      JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.jjp_server_control (id, started_at, heartbeat_at, host, modules)
VALUES (1, now(), now(), 'server', '{}'::jsonb)
ON CONFLICT (id) DO UPDATE SET heartbeat_at = now();

ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_server_control_all ON public.jjp_server_control;
CREATE POLICY jjp_server_control_all ON public.jjp_server_control FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS html         TEXT,
  ADD COLUMN IF NOT EXISTS body_html    TEXT,
  ADD COLUMN IF NOT EXISTS attach_state TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS attachments  JSONB DEFAULT '[]'::jsonb;

DROP TABLE IF EXISTS public.jjp_invoice_alerts CASCADE;
CREATE TABLE public.jjp_invoice_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID REFERENCES public.jjp_supplier_invoices(id) ON DELETE CASCADE,
  milestone     INT NOT NULL DEFAULT 0,
  alert_date    DATE NOT NULL DEFAULT (now() at time zone 'America/Caracas')::date,
  title         TEXT NOT NULL DEFAULT 'Aviso de Factura',
  body          TEXT NOT NULL DEFAULT '',
  wa_status     TEXT NOT NULL DEFAULT 'pending',
  wa_message_id UUID,
  wa_error      TEXT,
  wa_sent_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jjp_invoice_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jjp_invoice_alerts_all ON public.jjp_invoice_alerts;
CREATE POLICY jjp_invoice_alerts_all ON public.jjp_invoice_alerts FOR ALL USING (true) WITH CHECK (true);

-- Notificar recarga de schema a PostgREST
NOTIFY pgrst, 'reload schema';
