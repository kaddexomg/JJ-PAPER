-- ============================================================================
-- 🔧 REPARACIÓN TOTAL — JJ PAPER (2026-08-27)
-- ============================================================================
-- EJECUTAR COMPLETO en Supabase SQL Editor.
-- Este script es IDEMPOTENTE y SEGURO: no borra datos existentes.
--
-- Resuelve:
--   ✅ Error "Could not find jjp_wa_ensure_chat in schema cache"
--   ✅ Campañas de WhatsApp no se pueden crear (columnas faltantes + CHECKs)
--   ✅ Campañas de correo (tablas inexistentes)
--   ✅ Discrepancia de columnas en jjp_emails
--   ✅ Todas las funciones RPC del frontend
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- 0. EXTENSIONES REQUERIDAS
-- ══════════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ASEGURAR COLUMNAS EN TABLAS PRINCIPALES (jjp_orders, jjp_quotes, jjp_customers)
-- ══════════════════════════════════════════════════════════════════════════════
-- Evita el error "column customer_id does not exist" al compilar las funciones RPC.

ALTER TABLE public.jjp_orders
  ADD COLUMN IF NOT EXISTS customer_id           UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_id              UUID,
  ADD COLUMN IF NOT EXISTS discount_status       TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_requested_by UUID;

ALTER TABLE public.jjp_quotes
  ADD COLUMN IF NOT EXISTS customer_id           UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_pct          NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS jjp_orders_customer_idx ON public.jjp_orders(customer_id);
CREATE INDEX IF NOT EXISTS jjp_quotes_customer_idx ON public.jjp_quotes(customer_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. HELPER: jjp_is_admin
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.jjp_is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.jjp_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. FUNCIÓN jjp_wa_ensure_chat (la que da el error)
-- ══════════════════════════════════════════════════════════════════════════════
-- Usada por send-hub.js para enviar catálogo, facturas y comprobantes.
-- El error "Could not find the function public.jjp_wa_ensure_chat" ocurre
-- porque la función no existe en la BD o PostgREST no la tiene en cache.

DROP FUNCTION IF EXISTS public.jjp_wa_ensure_chat(text, text);
CREATE OR REPLACE FUNCTION public.jjp_wa_ensure_chat(p_phone text, p_name text default null)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path to 'public', 'pg_temp'
AS $$
DECLARE
  v_owner  uuid := auth.uid();
  v_d      text;
  v_norm   text;
  v_jid    text;
  v_id     uuid;
  v_cust   uuid;
  v_nombre text;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin sesión'; END IF;

  -- Normalización telefónica venezolana
  v_d := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  IF    length(v_d) = 12 AND left(v_d,2) = '58'       THEN v_norm := v_d;
  ELSIF length(v_d) = 11 AND left(v_d,1) = '0'        THEN v_norm := '58' || substr(v_d,2);
  ELSIF length(v_d) = 10 AND left(v_d,1) IN ('2','4') THEN v_norm := '58' || v_d;
  ELSE  v_norm := v_d;
  END IF;
  IF length(v_norm) < 10 THEN RAISE EXCEPTION 'Teléfono inválido: %', coalesce(p_phone,''); END IF;

  v_jid := v_norm || '@s.whatsapp.net';

  SELECT id INTO v_id FROM public.jjp_wa_chats
   WHERE owner_id = v_owner AND jid = v_jid;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id, name INTO v_cust, v_nombre FROM public.jjp_customers
   WHERE right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = right(v_norm,10)
   ORDER BY created_at LIMIT 1;

  INSERT INTO public.jjp_wa_chats (owner_id, jid, phone, customer_id, display_name)
  VALUES (v_owner, v_jid, v_norm, v_cust,
          coalesce(nullif(trim(p_name),''), v_nombre, v_norm))
  ON CONFLICT (owner_id, jid) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. OTRAS FUNCIONES RPC DEL FRONTEND
-- ══════════════════════════════════════════════════════════════════════════════

-- jjp_wa_delete_chat
DROP FUNCTION IF EXISTS public.jjp_wa_delete_chat(text);
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id::uuid;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id::uuid;
  RETURN true;
END;
$$;

-- jjp_wa_purge_chats
DROP FUNCTION IF EXISTS public.jjp_wa_purge_chats(uuid);
CREATE OR REPLACE FUNCTION public.jjp_wa_purge_chats(p_owner uuid default null)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner uuid := coalesce(p_owner, auth.uid());
  v_count int;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin sesión'; END IF;
  SELECT count(*) INTO v_count FROM public.jjp_wa_chats WHERE owner_id = v_owner;
  DELETE FROM public.jjp_wa_messages WHERE owner_id = v_owner;
  DELETE FROM public.jjp_wa_chats WHERE owner_id = v_owner;
  RETURN v_count;
END;
$$;

-- jjp_wa_import_contacts
DROP FUNCTION IF EXISTS public.jjp_wa_import_contacts(jsonb);
CREATE OR REPLACE FUNCTION public.jjp_wa_import_contacts(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path to 'public','pg_temp'
AS $$
DECLARE
  r jsonb; v_name text; v_phone text; v_tags text[];
  v_ins int := 0; v_upd int := 0; v_bad int := 0;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Formato inválido o más de 500 filas';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_name  := nullif(trim(r->>'name'), '');
    v_phone := regexp_replace(coalesce(r->>'phone',''), '\D', '', 'g');
    IF v_phone ~ '^58\d{10}$' THEN v_phone := '0' || substr(v_phone, 3); END IF;
    IF v_phone ~ '^[24]\d{9}$' THEN v_phone := '0' || v_phone; END IF;
    v_tags  := coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(r->'tags','[]'::jsonb)) t), '{}');

    IF v_name IS NULL OR v_phone !~ '^0\d{10}$' THEN
      v_bad := v_bad + 1; CONTINUE;
    END IF;

    SELECT id INTO v_id FROM public.jjp_customers WHERE phone = v_phone;
    IF v_id IS NULL THEN
      INSERT INTO public.jjp_customers (name, phone, city, notes, tags, seller_id)
      VALUES (v_name, v_phone, nullif(trim(r->>'city'),''), nullif(trim(r->>'notes'),''), v_tags, auth.uid());
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.jjp_customers SET
        city       = coalesce(city, nullif(trim(r->>'city'),'')),
        notes      = coalesce(notes, nullif(trim(r->>'notes'),'')),
        tags       = (SELECT array_agg(distinct t) FROM unnest(tags || v_tags) t),
        seller_id  = coalesce(seller_id, auth.uid()),
        updated_at = now()
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_bad);
END;
$$;

-- jjp_customer_360
DROP FUNCTION IF EXISTS public.jjp_customer_360(uuid);
CREATE OR REPLACE FUNCTION public.jjp_customer_360(p_customer uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path to 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'cliente', (SELECT to_jsonb(c) FROM public.jjp_customers c WHERE c.id = p_customer),
    'pedidos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id, 'numero', o.order_number, 'fecha', o.created_at,
               'total_usd', o.total_usd, 'estado', o.status, 'items', jsonb_array_length(coalesce(o.items,'[]'::jsonb)))
             ORDER BY o.created_at DESC)
        FROM (SELECT * FROM public.jjp_orders WHERE customer_id = p_customer
               ORDER BY created_at DESC LIMIT 10) o), '[]'::jsonb),
    'cotizaciones', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id, 'numero', q.quote_number, 'fecha', q.created_at,
               'total_usd', q.estimated_total_usd, 'estado', q.status)
             ORDER BY q.created_at DESC)
        FROM (SELECT * FROM public.jjp_quotes WHERE customer_id = p_customer
               ORDER BY created_at DESC LIMIT 10) q), '[]'::jsonb)
  );
$$;

-- jjp_email_request_attachments
DROP FUNCTION IF EXISTS public.jjp_email_request_attachments(uuid);
CREATE OR REPLACE FUNCTION public.jjp_email_request_attachments(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.jjp_emails
     SET attach_state = 'requested'
   WHERE id = p_id;
  RETURN true;
END;
$$;

-- jjp_convert_quote
DROP FUNCTION IF EXISTS public.jjp_convert_quote(uuid);
CREATE OR REPLACE FUNCTION public.jjp_convert_quote(p_quote uuid)
RETURNS public.jjp_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path to 'public', 'pg_temp'
AS $$
DECLARE
  q          public.jjp_quotes;
  v_order    public.jjp_orders;
  v_items    jsonb;
  v_subtotal numeric := 0;
  v_rate     numeric;
  v_pct      numeric;
  v_admin    boolean := public.jjp_is_admin();
  v_total    numeric;
  v_num      text;
  v_linea    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sin sesión'; END IF;

  SELECT * INTO q FROM public.jjp_quotes WHERE id = p_quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'La cotización no existe'; END IF;
  IF q.status IN ('convertido','convertida','cancelado','rechazado') THEN
    RAISE EXCEPTION 'Esta cotización ya está cerrada (%)', q.status;
  END IF;

  FOR v_linea IN SELECT jsonb_array_elements(coalesce(q.items,'[]'::jsonb)) LOOP
    IF coalesce((v_linea->>'price_usd')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'La línea "%" no tiene precio', coalesce(v_linea->>'name','(sin nombre)');
    END IF;
    v_subtotal := v_subtotal + (v_linea->>'price_usd')::numeric * coalesce((v_linea->>'qty')::numeric, 0);
  END LOOP;
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'La cotización está vacía'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id',           coalesce(linea->>'product_id', linea->>'id'),
           'variant_id',   linea->>'variant_id',
           'sku',          linea->>'sku',
           'name',         linea->>'name',
           'brand',        linea->>'brand',
           'qty',          (linea->>'qty')::numeric,
           'unit',         coalesce(linea->>'unit','unid'),
           'price_usd',    (linea->>'price_usd')::numeric,
           'subtotal_usd', round((linea->>'price_usd')::numeric * (linea->>'qty')::numeric, 2)))
    INTO v_items
    FROM jsonb_array_elements(q.items) AS linea;

  SELECT coalesce(value::numeric, q.exchange_rate, 1) INTO v_rate
    FROM public.jjp_settings WHERE key = 'exchange_rate';
  v_rate := coalesce(v_rate, q.exchange_rate, 1);

  v_pct   := coalesce(q.discount_pct, 0);
  v_total := round(v_subtotal * (1 - v_pct/100.0), 2);
  v_num   := 'JJP-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*10000))::text, 4, '0');

  INSERT INTO public.jjp_orders (
    order_number, client_name, rif, phone, email, city, address,
    items, subtotal_usd, total_usd, exchange_rate, total_bs,
    discount_pct, discount_status, discount_requested_by,
    payment_method, notes, seller_id, source, status,
    quote_id, customer_id)
  VALUES (
    v_num, q.client_name, q.rif, q.phone, q.email, q.city, q.address,
    v_items, round(v_subtotal,2),
    case when v_pct > 0 and not v_admin then round(v_subtotal,2) else v_total end,
    v_rate,
    round((case when v_pct > 0 and not v_admin then v_subtotal else v_total end) * v_rate, 2),
    v_pct,
    case when v_pct > 0 then (case when v_admin then 'approved' else 'pending' end) else 'none' end,
    case when v_pct > 0 and not v_admin then auth.uid() else null end,
    'efectivo',
    'Generado desde cotización ' || coalesce(q.quote_number,''),
    coalesce(q.seller_id, auth.uid()), 'pos', 'pendiente_pago',
    q.id, q.customer_id)
  RETURNING * INTO v_order;

  UPDATE public.jjp_quotes SET status = 'convertido' WHERE id = p_quote;
  RETURN v_order;
END;
$$;

-- jjp_apply_order_stock
DROP FUNCTION IF EXISTS public.jjp_apply_order_stock(uuid);
CREATE OR REPLACE FUNCTION public.jjp_apply_order_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path to 'public', 'pg_temp'
AS $$
DECLARE
  it        jsonb;
  ya        boolean;
  v_num     text;
  v_ok      int := 0;
  v_faltan  text[] := '{}';
BEGIN
  SELECT stock_applied, order_number INTO ya, v_num
    FROM public.jjp_orders WHERE id = p_order_id;
  IF ya IS NULL THEN RAISE EXCEPTION 'El pedido no existe'; END IF;
  IF ya THEN RETURN jsonb_build_object('ok', true, 'aplicadas', 0, 'faltantes', '[]'::jsonb, 'ya', true); END IF;

  FOR it IN SELECT jsonb_array_elements(items) FROM public.jjp_orders WHERE id = p_order_id LOOP
    IF nullif(it->>'variant_id','') IS NOT NULL THEN
      UPDATE public.jjp_product_variants
         SET stock = greatest(stock - (it->>'qty')::int, 0)
       WHERE id = (it->>'variant_id')::uuid AND stock <> -1;
      v_ok := v_ok + 1;
    ELSE
      v_faltan := v_faltan || coalesce(it->>'name', 'producto sin nombre');
    END IF;
  END LOOP;

  IF array_length(v_faltan, 1) IS NULL THEN
    UPDATE public.jjp_orders SET stock_applied = true WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', array_length(v_faltan,1) IS NULL,
    'aplicadas', v_ok,
    'faltantes', to_jsonb(v_faltan),
    'ya', false);
END;
$$;

-- jjp_revert_order_stock
DROP FUNCTION IF EXISTS public.jjp_revert_order_stock(uuid);
CREATE OR REPLACE FUNCTION public.jjp_revert_order_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path to 'public', 'pg_temp'
AS $$
DECLARE
  it  jsonb;
  ya  boolean;
  v_ok int := 0;
BEGIN
  SELECT stock_applied INTO ya FROM public.jjp_orders WHERE id = p_order_id;
  IF ya IS NULL OR NOT ya THEN
    RETURN jsonb_build_object('ok', true, 'revertidas', 0, 'motivo', 'no tenia stock aplicado');
  END IF;

  FOR it IN SELECT jsonb_array_elements(items) FROM public.jjp_orders WHERE id = p_order_id LOOP
    IF nullif(it->>'variant_id','') IS NOT NULL THEN
      UPDATE public.jjp_product_variants
         SET stock = stock + (it->>'qty')::int
       WHERE id = (it->>'variant_id')::uuid AND stock <> -1;
      v_ok := v_ok + 1;
    END IF;
  END LOOP;

  UPDATE public.jjp_orders SET stock_applied = false WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'revertidas', v_ok);
END;
$$;

-- jjp_delete_order
DROP FUNCTION IF EXISTS public.jjp_delete_order(uuid);
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.jjp_revert_order_stock(p_order);
  DELETE FROM public.jjp_orders WHERE id = p_order;
  RETURN true;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. ELIMINAR CHECK CONSTRAINTS RESTRICTIVOS (campañas y correos)
-- ══════════════════════════════════════════════════════════════════════════════
-- El backend y frontend usan valores de status (pending, sending, sent, enviado,
-- en_cola, received, etc.) que los CHECKs originales no permiten.

ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;

ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;

ALTER TABLE public.jjp_wa_campaign_targets
  DROP CONSTRAINT IF EXISTS jjp_wa_campaign_targets_status_check;

ALTER TABLE public.jjp_emails
  DROP CONSTRAINT IF EXISTS jjp_emails_status_check;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. AGREGAR COLUMNAS FALTANTES A jjp_wa_campaigns
-- ══════════════════════════════════════════════════════════════════════════════
-- vdifusion.js envía created_by, message y columnas de media que no existían.

ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS created_by      UUID,
  ADD COLUMN IF NOT EXISTS message         TEXT,
  ADD COLUMN IF NOT EXISTS media_path      TEXT,
  ADD COLUMN IF NOT EXISTS media_type      TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_mime      TEXT,
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS media_size      INTEGER;

-- RLS para jjp_wa_campaigns y jjp_wa_campaign_targets (permitir crear a cualquier vendedor/admin autenticado)
ALTER TABLE public.jjp_wa_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_camp_all ON public.jjp_wa_campaigns;
DROP POLICY IF EXISTS jjp_wa_campaigns_policy ON public.jjp_wa_campaigns;
CREATE POLICY wa_camp_all ON public.jjp_wa_campaigns FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.jjp_is_admin());

ALTER TABLE public.jjp_wa_campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_target_all ON public.jjp_wa_campaign_targets;
CREATE POLICY wa_target_all ON public.jjp_wa_campaign_targets FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. CREAR TABLAS DE CAMPAÑAS DE CORREO ELECTRÓNICO
-- ══════════════════════════════════════════════════════════════════════════════
-- email-campaigns.js las consulta pero nunca fueron creadas.

CREATE TABLE IF NOT EXISTS public.jjp_email_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  html          TEXT,
  attachments   JSONB DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
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
  status        TEXT NOT NULL DEFAULT 'pending',
  email_id      UUID,
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS para email campaigns
ALTER TABLE public.jjp_email_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'jjp_email_campaigns' AND policyname = 'ec_all'
  ) THEN
    CREATE POLICY ec_all ON public.jjp_email_campaigns FOR ALL TO authenticated
      USING (owner_id = auth.uid() OR public.jjp_is_admin())
      WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());
  END IF;
END $$;

ALTER TABLE public.jjp_email_campaign_targets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'jjp_email_campaign_targets' AND policyname = 'ect_all'
  ) THEN
    CREATE POLICY ect_all ON public.jjp_email_campaign_targets FOR ALL TO authenticated
      USING (owner_id = auth.uid() OR public.jjp_is_admin())
      WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jjp_ec_status ON public.jjp_email_campaigns (status);
CREATE INDEX IF NOT EXISTS jjp_ect_camp  ON public.jjp_email_campaign_targets (campaign_id, status);

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. ALINEAR jjp_emails CON LO QUE ESPERA email.js
-- ══════════════════════════════════════════════════════════════════════════════
-- El backend usa owner_id, to_addr, from_addr, body, html, gmail_id, etc.
-- pero la tabla se creó con profile_id, to_email, from_email, body_text, body_html.

ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS owner_id      UUID REFERENCES public.jjp_profiles(id),
  ADD COLUMN IF NOT EXISTS to_addr       TEXT,
  ADD COLUMN IF NOT EXISTS from_addr     TEXT,
  ADD COLUMN IF NOT EXISTS body          TEXT,
  ADD COLUMN IF NOT EXISTS html          TEXT,
  ADD COLUMN IF NOT EXISTS gmail_id      TEXT,
  ADD COLUMN IF NOT EXISTS thread_id     TEXT,
  ADD COLUMN IF NOT EXISTS snippet       TEXT,
  ADD COLUMN IF NOT EXISTS retry_count   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_id    TEXT,
  ADD COLUMN IF NOT EXISTS attach_state  TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS campaign_id   UUID;

-- Si la tabla se creó originalmente con columnas con NOT NULL (from_email, to_email), remover NOT NULL:
DO $$ BEGIN
  ALTER TABLE public.jjp_emails ALTER COLUMN from_email DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.jjp_emails ALTER COLUMN to_email DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Migrar datos existentes de columnas viejas a las nuevas
DO $$ BEGIN
  UPDATE public.jjp_emails SET owner_id  = profile_id  WHERE owner_id  IS NULL AND profile_id  IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.jjp_emails SET to_addr   = to_email    WHERE to_addr   IS NULL AND to_email    IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.jjp_emails SET from_addr = from_email  WHERE from_addr IS NULL AND from_email  IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.jjp_emails SET body      = body_text   WHERE body      IS NULL AND body_text   IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.jjp_emails SET html      = body_html   WHERE html      IS NULL AND body_html   IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS jjp_emails_owner_dir ON public.jjp_emails (owner_id, direction);
CREATE INDEX IF NOT EXISTS jjp_emails_gmail_id  ON public.jjp_emails (gmail_id) WHERE gmail_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jjp_emails_campaign  ON public.jjp_emails (campaign_id) WHERE campaign_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. PERMISOS DE EJECUCIÓN PARA TODAS LAS FUNCIONES RPC
-- ══════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.jjp_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_ensure_chat(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_delete_chat(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_purge_chats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_wa_import_contacts(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_customer_360(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_email_request_attachments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_convert_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_apply_order_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_revert_order_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jjp_delete_order(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. REALTIME PARA TABLAS NUEVAS
-- ══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaigns;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaign_targets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. RECARGAR SCHEMA CACHE DE PostgREST (CRÍTICO)
-- ══════════════════════════════════════════════════════════════════════════════
-- Sin esto, PostgREST no ve las funciones nuevas y da:
-- "Could not find the function public.jjp_wa_ensure_chat in the schema cache"
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- ✅ REPARACIÓN COMPLETADA
-- 
-- Verificación rápida (ejecutar después por separado):
--
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--     AND routine_name LIKE 'jjp_%'
--   ORDER BY routine_name;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'jjp_wa_campaigns'
--   ORDER BY ordinal_position;
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('jjp_email_campaigns','jjp_email_campaign_targets');
-- ============================================================================
