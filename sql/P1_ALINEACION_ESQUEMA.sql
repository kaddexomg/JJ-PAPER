-- ==============================================================================
-- JJ Paper — P1_ALINEACION_ESQUEMA.sql
-- Alineación Definitiva de Esquema en VPS Soberano (166.0.112.247)
-- Fecha: 25 de Octubre de 2026
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Vista Materializada jjp_catalog_flat (Elimina errores 404 en Catálogo y POS)
-- ------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.jjp_catalog_flat CASCADE;

CREATE MATERIALIZED VIEW public.jjp_catalog_flat AS
SELECT 
  p.id, 
  p.name, 
  p.description, 
  p.price_usd, 
  p.price_a, 
  p.price_b,
  p.price_c_bs, 
  p.price_d_bs, 
  p.mixnet_status,
  p.unit, 
  p.image_url, 
  p.emoji, 
  p.tag,
  p.featured, 
  p.essential, 
  p.stock, 
  p.min_qty, 
  p.category_id, 
  p.sku,
  p.sort_order,
  jsonb_build_object(
    'name', c.name, 
    'slug', c.slug, 
    'color', c.color, 
    'group_id', c.group_id
  ) AS jjp_categories,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id, 
        'variant_name', v.variant_name, 
        'sku', v.sku, 
        'barcode', v.barcode,
        'price_usd', v.price_usd,
        'price_a', v.price_a, 
        'price_b', v.price_b, 
        'price_c_bs', v.price_c_bs,
        'price_d_bs', v.price_d_bs,
        'active', v.active,
        'stock', v.stock,
        'min_qty', v.min_qty,
        'image_url', v.image_url,
        'sort_order', v.sort_order,
        'jjp_brands', CASE WHEN b.name IS NOT NULL THEN jsonb_build_object('name', b.name, 'logo_url', b.logo_url) ELSE NULL END
      ) ORDER BY v.sort_order NULLS LAST, v.variant_name
    ) FILTER (WHERE v.id IS NOT NULL AND v.active),
    '[]'::jsonb
  ) AS jjp_product_variants
FROM public.jjp_products p
LEFT JOIN public.jjp_categories c ON c.id = p.category_id
LEFT JOIN public.jjp_product_variants v ON v.product_id = p.id AND v.active = true
LEFT JOIN public.jjp_brands b ON b.id = v.brand_id
WHERE p.active = true
GROUP BY p.id, c.name, c.slug, c.color, c.group_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jjp_catalog_flat_id ON public.jjp_catalog_flat (id);
CREATE INDEX IF NOT EXISTS idx_jjp_catalog_flat_sort ON public.jjp_catalog_flat (sort_order);

GRANT SELECT ON public.jjp_catalog_flat TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jjp_refresh_catalog_flat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.jjp_catalog_flat;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_refresh_catalog_flat() TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Columnas Faltantes en Tablas del Servidor y Campañas
-- ------------------------------------------------------------------------------

-- jjp_server_control: columnas de comandos remotos y telemetría
ALTER TABLE public.jjp_server_control
  ADD COLUMN IF NOT EXISTS command TEXT,
  ADD COLUMN IF NOT EXISTS command_res JSONB,
  ADD COLUMN IF NOT EXISTS command_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- jjp_wa_campaigns: columnas de throttling y pausas anti-baneo
ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS pause_until TIMESTAMPTZ;

-- jjp_emails: enlace a cliente
ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL;

-- jjp_customers: estado activo
ALTER TABLE public.jjp_customers
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- ------------------------------------------------------------------------------
-- 3. Funciones RPC Faltantes
-- ------------------------------------------------------------------------------

-- Generador seguro de correlativos para cotizaciones y pedidos
CREATE OR REPLACE FUNCTION public.jjp_next_doc_serial(p_type TEXT DEFAULT 'pedido')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  v_is_cot BOOLEAN;
  v_key TEXT;
  v_from_setting BIGINT := 0;
  v_from_table BIGINT := 0;
  v_next BIGINT;
BEGIN
  v_is_cot := LOWER(COALESCE(p_type, '')) IN ('cotizacion', 'quote', 'cot');
  v_key := CASE WHEN v_is_cot THEN 'mixnet_next_quote_serial' ELSE 'mixnet_next_order_serial' END;

  SELECT COALESCE(NULLIF(REGEXP_REPLACE(value, '[^0-9]', '', 'g'), '')::BIGINT, 0)
    INTO v_from_setting
    FROM public.jjp_settings
   WHERE key = v_key;

  IF v_is_cot THEN
    SELECT COALESCE(MAX(SUBSTRING(quote_number FROM '^[0-9]{5,8}
GRANT EXECUTE ON FUNCTION public.jjp_next_doc_serial(TEXT) TO authenticated, service_role;

-- Eliminación segura de pedidos
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.jjp_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar pedidos';
  END IF;
  DELETE FROM public.jjp_orders WHERE id = p_order_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_order(UUID) TO authenticated, service_role;

-- Eliminación de campañas de email
CREATE OR REPLACE FUNCTION public.jjp_delete_email_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR EXISTS (
    SELECT 1 FROM public.jjp_email_campaigns WHERE id = p_campaign_id AND owner_id = auth.uid()
  )) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar esta campaña';
  END IF;
  DELETE FROM public.jjp_email_campaign_targets WHERE campaign_id = p_campaign_id;
  DELETE FROM public.jjp_email_campaigns WHERE id = p_campaign_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_email_campaign(UUID) TO authenticated, service_role;

-- Eliminación de chats y purga de WhatsApp
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_delete_chat(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jjp_wa_purge_chats(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR auth.uid() = p_owner_id) THEN
    RAISE EXCEPTION 'No tienes permiso para purgar chats de este asesor';
  END IF;
  DELETE FROM public.jjp_wa_messages WHERE chat_id IN (SELECT id FROM public.jjp_wa_chats WHERE owner_id = p_owner_id);
  DELETE FROM public.jjp_wa_chats WHERE owner_id = p_owner_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_purge_chats(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Blindaje de Seguridad en RLS (Evitar Escalada a Administrador)
-- ------------------------------------------------------------------------------

-- Quitar política permisiva que dejaba auto-promoverse a admin
DROP POLICY IF EXISTS jjp_profiles_upd_own ON public.jjp_profiles;

-- Nueva política: el usuario solo puede actualizar su nombre o teléfono, pero NO role ni active
CREATE POLICY jjp_profiles_upd_own ON public.jjp_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (
    public.jjp_is_admin() OR (
      id = auth.uid() AND
      role = (SELECT role FROM public.jjp_profiles WHERE id = auth.uid()) AND
      active = (SELECT active FROM public.jjp_profiles WHERE id = auth.uid())
    )
  );

-- Eliminar cuenta de prueba residual de la auditoría
DELETE FROM public.jjp_profiles WHERE id = 'b46ed4fe-add9-456c-98fd-52280d458ff9';

-- Garantizar que ambos administradores existan y estén activos
INSERT INTO public.jjp_profiles (id, name, role, active, ref_code, permissions)
VALUES 
  ('bddc57dc-5bf9-4a72-9e1c-751d07b03164', 'Keyder Salazar', 'admin', true, 'jose', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'Administrador JJ Paper', 'admin', true, 'admin', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  active = true,
  permissions = '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb;

COMMIT;
)::BIGINT), 53550) + 1
      INTO v_from_table
      FROM public.jjp_quotes;
  ELSE
    SELECT COALESCE(MAX(SUBSTRING(order_number FROM '^[0-9]{5,8}
GRANT EXECUTE ON FUNCTION public.jjp_next_doc_serial(TEXT) TO authenticated, service_role;

-- Eliminación segura de pedidos
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.jjp_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar pedidos';
  END IF;
  DELETE FROM public.jjp_orders WHERE id = p_order_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_order(UUID) TO authenticated, service_role;

-- Eliminación de campañas de email
CREATE OR REPLACE FUNCTION public.jjp_delete_email_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR EXISTS (
    SELECT 1 FROM public.jjp_email_campaigns WHERE id = p_campaign_id AND owner_id = auth.uid()
  )) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar esta campaña';
  END IF;
  DELETE FROM public.jjp_email_campaign_targets WHERE campaign_id = p_campaign_id;
  DELETE FROM public.jjp_email_campaigns WHERE id = p_campaign_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_email_campaign(UUID) TO authenticated, service_role;

-- Eliminación de chats y purga de WhatsApp
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_delete_chat(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jjp_wa_purge_chats(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR auth.uid() = p_owner_id) THEN
    RAISE EXCEPTION 'No tienes permiso para purgar chats de este asesor';
  END IF;
  DELETE FROM public.jjp_wa_messages WHERE chat_id IN (SELECT id FROM public.jjp_wa_chats WHERE owner_id = p_owner_id);
  DELETE FROM public.jjp_wa_chats WHERE owner_id = p_owner_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_purge_chats(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Blindaje de Seguridad en RLS (Evitar Escalada a Administrador)
-- ------------------------------------------------------------------------------

-- Quitar política permisiva que dejaba auto-promoverse a admin
DROP POLICY IF EXISTS jjp_profiles_upd_own ON public.jjp_profiles;

-- Nueva política: el usuario solo puede actualizar su nombre o teléfono, pero NO role ni active
CREATE POLICY jjp_profiles_upd_own ON public.jjp_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (
    public.jjp_is_admin() OR (
      id = auth.uid() AND
      role = (SELECT role FROM public.jjp_profiles WHERE id = auth.uid()) AND
      active = (SELECT active FROM public.jjp_profiles WHERE id = auth.uid())
    )
  );

-- Eliminar cuenta de prueba residual de la auditoría
DELETE FROM public.jjp_profiles WHERE id = 'b46ed4fe-add9-456c-98fd-52280d458ff9';

-- Garantizar que ambos administradores existan y estén activos
INSERT INTO public.jjp_profiles (id, name, role, active, ref_code, permissions)
VALUES 
  ('bddc57dc-5bf9-4a72-9e1c-751d07b03164', 'Keyder Salazar', 'admin', true, 'jose', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'Administrador JJ Paper', 'admin', true, 'admin', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  active = true,
  permissions = '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb;

COMMIT;
)::BIGINT), 112830) + 1
      INTO v_from_table
      FROM public.jjp_orders;
  END IF;

  v_next := GREATEST(COALESCE(v_from_setting, 0), COALESCE(v_from_table, 0));
  INSERT INTO public.jjp_settings (key, value, updated_at)
  VALUES (v_key, (v_next + 1)::TEXT, NOW())
  ON CONFLICT (key) DO UPDATE SET value = (v_next + 1)::TEXT, updated_at = NOW();

  RETURN LPAD(v_next::TEXT, 8, '0');
END;
$;
GRANT EXECUTE ON FUNCTION public.jjp_next_doc_serial(TEXT) TO authenticated, service_role;

-- Eliminación segura de pedidos
CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.jjp_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar pedidos';
  END IF;
  DELETE FROM public.jjp_orders WHERE id = p_order_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_order(UUID) TO authenticated, service_role;

-- Eliminación de campañas de email
CREATE OR REPLACE FUNCTION public.jjp_delete_email_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR EXISTS (
    SELECT 1 FROM public.jjp_email_campaigns WHERE id = p_campaign_id AND owner_id = auth.uid()
  )) THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar esta campaña';
  END IF;
  DELETE FROM public.jjp_email_campaign_targets WHERE campaign_id = p_campaign_id;
  DELETE FROM public.jjp_email_campaigns WHERE id = p_campaign_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_delete_email_campaign(UUID) TO authenticated, service_role;

-- Eliminación de chats y purga de WhatsApp
CREATE OR REPLACE FUNCTION public.jjp_wa_delete_chat(p_chat_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.jjp_wa_messages WHERE chat_id = p_chat_id;
  DELETE FROM public.jjp_wa_chats WHERE id = p_chat_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_delete_chat(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jjp_wa_purge_chats(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (public.jjp_is_admin() OR auth.uid() = p_owner_id) THEN
    RAISE EXCEPTION 'No tienes permiso para purgar chats de este asesor';
  END IF;
  DELETE FROM public.jjp_wa_messages WHERE chat_id IN (SELECT id FROM public.jjp_wa_chats WHERE owner_id = p_owner_id);
  DELETE FROM public.jjp_wa_chats WHERE owner_id = p_owner_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.jjp_wa_purge_chats(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Blindaje de Seguridad en RLS (Evitar Escalada a Administrador)
-- ------------------------------------------------------------------------------

-- Quitar política permisiva que dejaba auto-promoverse a admin
DROP POLICY IF EXISTS jjp_profiles_upd_own ON public.jjp_profiles;

-- Nueva política: el usuario solo puede actualizar su nombre o teléfono, pero NO role ni active
CREATE POLICY jjp_profiles_upd_own ON public.jjp_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (
    public.jjp_is_admin() OR (
      id = auth.uid() AND
      role = (SELECT role FROM public.jjp_profiles WHERE id = auth.uid()) AND
      active = (SELECT active FROM public.jjp_profiles WHERE id = auth.uid())
    )
  );

-- Eliminar cuenta de prueba residual de la auditoría
DELETE FROM public.jjp_profiles WHERE id = 'b46ed4fe-add9-456c-98fd-52280d458ff9';

-- Garantizar que ambos administradores existan y estén activos
INSERT INTO public.jjp_profiles (id, name, role, active, ref_code, permissions)
VALUES 
  ('bddc57dc-5bf9-4a72-9e1c-751d07b03164', 'Keyder Salazar', 'admin', true, 'jose', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'Administrador JJ Paper', 'admin', true, 'admin', '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  active = true,
  permissions = '{"can_view_all_sales":true,"can_edit_prices":true,"can_give_discount":true,"can_manage_clients":true,"can_access_billing":true,"can_access_collections":true,"can_sync_mixnet":true}'::jsonb;

COMMIT;
