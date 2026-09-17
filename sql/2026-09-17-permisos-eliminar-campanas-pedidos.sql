-- ======================================================================
-- JJ Paper — Fix Permisos de Eliminación de Campañas y Pedidos Cancelados
-- Fecha: 17-09-2026
-- Aplicado en caliente en Proyecto A (Core) y Proyecto B (Comunicación)
-- ======================================================================

-- ----------------------------------------------------------------------
-- 1. PROYECTO B (COMUNICACIÓN): Campañas WhatsApp + Campañas Correo
-- ----------------------------------------------------------------------

-- RPC para eliminar campaña de WhatsApp y sus destinatarios en cascada
CREATE OR REPLACE FUNCTION public.jjp_delete_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  DELETE FROM public.jjp_wa_campaign_targets WHERE campaign_id = p_campaign_id;
  DELETE FROM public.jjp_wa_campaigns WHERE id = p_campaign_id;
  RETURN true;
END;
$$;

-- RPC para eliminar campaña de Correo y sus destinatarios en cascada
CREATE OR REPLACE FUNCTION public.jjp_delete_email_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  DELETE FROM public.jjp_email_campaign_targets WHERE campaign_id = p_campaign_id;
  DELETE FROM public.jjp_email_campaigns WHERE id = p_campaign_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_delete_campaign(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.jjp_delete_email_campaign(uuid) TO authenticated, anon;

-- Políticas de eliminación directa
DROP POLICY IF EXISTS wa_camp_del ON public.jjp_wa_campaigns;
CREATE POLICY wa_camp_del ON public.jjp_wa_campaigns FOR DELETE TO authenticated, anon USING (true);

DROP POLICY IF EXISTS wa_tgt_del ON public.jjp_wa_campaign_targets;
CREATE POLICY wa_tgt_del ON public.jjp_wa_campaign_targets FOR DELETE TO authenticated, anon USING (true);

DROP POLICY IF EXISTS ec_del ON public.jjp_email_campaigns;
CREATE POLICY ec_del ON public.jjp_email_campaigns FOR DELETE TO authenticated, anon USING (true);

DROP POLICY IF EXISTS ect_del ON public.jjp_email_campaign_targets;
CREATE POLICY ect_del ON public.jjp_email_campaign_targets FOR DELETE TO authenticated, anon USING (true);

NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------
-- 2. PROYECTO A (CORE): Eliminación de Pedidos Cancelados / Rechazados
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.jjp_delete_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_status text;
  v_order_num text;
BEGIN
  SELECT status, order_number INTO v_status, v_order_num FROM public.jjp_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Solo permitir eliminar pedidos en estado cancelado, rechazado o de prueba
  IF v_status NOT IN ('cancelado', 'rechazado', 'pendiente_pago') AND NOT public.jjp_is_admin() THEN
    RAISE EXCEPTION 'Solo se pueden eliminar pedidos cancelados o rechazados (estado actual: %)', v_status;
  END IF;

  -- Revertir stock si fue aplicado
  BEGIN
    PERFORM public.jjp_revert_order_stock(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Eliminar el pedido
  DELETE FROM public.jjp_orders WHERE id = p_order_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jjp_delete_order(uuid) TO authenticated, anon;

DROP POLICY IF EXISTS jjp_orders_del ON public.jjp_orders;
CREATE POLICY jjp_orders_del ON public.jjp_orders FOR DELETE TO authenticated, anon
  USING (status IN ('cancelado', 'rechazado', 'pendiente_pago') OR public.jjp_is_admin());

NOTIFY pgrst, 'reload schema';
