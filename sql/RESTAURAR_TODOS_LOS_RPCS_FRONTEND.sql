-- ==============================================================================
-- JJ PAPER — RESTAURACIÓN EXACTA DE FUNCIONES RPC Y COMPATIBILIDAD INTEGRAL
-- Este script es 100% SEGURO e IDEMPOTENTE: no borra datos, no altera tablas
-- existentes y solo instala las funciones que el frontend espera encontrar.
-- ==============================================================================

-- 1. EXTENSIÓN Y HELPER ADMIN
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

-- ------------------------------------------------------------------------------
-- 2. CRM WHATSAPP: APERTURA Y GESTIÓN DE CHATS
-- ------------------------------------------------------------------------------

-- Función: jjp_wa_ensure_chat (usada por send-hub.js para enviar catálogo, facturas y comprobantes)
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

-- Función: jjp_wa_delete_chat (elimina un chat individual y sus mensajes)
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id::uuid;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id::uuid;
  RETURN true;
END;
$$;

-- Función: jjp_wa_purge_chats (elimina todos los chats del usuario)
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

-- ------------------------------------------------------------------------------
-- 3. DIFUSIÓN: IMPORTACIÓN MASIVA DE CONTACTOS
-- ------------------------------------------------------------------------------

-- Función: jjp_wa_import_contacts (usada en vendedor/difusion.html para cargar CSV)
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

-- ------------------------------------------------------------------------------
-- 4. CRM CLIENTE 360° Y CORREO
-- ------------------------------------------------------------------------------

-- Función: jjp_customer_360 (ficha integral del cliente para WhatsApp y Correo)
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

-- Función: jjp_email_request_attachments (solicita descarga on-demand de adjuntos)
CREATE OR REPLACE FUNCTION public.jjp_email_request_attachments(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.jjp_emails
     SET attach_state = 'requested'
   WHERE id = p_id;
  RETURN true;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. COTIZACIONES, VENTAS Y CONTROL DE STOCK
-- ------------------------------------------------------------------------------

-- Función: jjp_convert_quote (convierte cotización en pedido sin perder presentaciones)
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

-- Función: jjp_apply_order_stock (descuenta stock físico al procesar orden)
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

-- Función: jjp_revert_order_stock (restituye inventario si se cancela pedido)
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

-- Función: jjp_delete_order (elimina pedido y revierte stock de forma limpia)
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.jjp_revert_order_stock(p_order_id);
  DELETE FROM public.jjp_orders WHERE id = p_order_id;
  RETURN true;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. PERMISOS DE EJECUCIÓN
-- ------------------------------------------------------------------------------
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

-- Notificar recarga de schema cache
NOTIFY pgrst, 'reload schema';
