-- ======================================================
-- JJ Paper — Eliminación real de campañas de WhatsApp (31-ago-2026)
-- Solo el dueño o el admin pueden borrar. Con ON DELETE CASCADE en
-- jjp_wa_campaign_targets, eliminar la campaña limpia sus destinatarios.
-- ======================================================

CREATE OR REPLACE FUNCTION public.jjp_delete_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Solo dueño o admin
  IF NOT EXISTS (
    SELECT 1 FROM public.jjp_wa_campaigns c
    WHERE c.id = p_campaign_id
      AND (c.owner_id = auth.uid() OR c.created_by = auth.uid() OR public.jjp_is_admin())
  ) THEN
    RETURN false;
  END IF;

  -- Borra la campaña; los targets caen por CASCADE
  DELETE FROM public.jjp_wa_campaigns WHERE id = p_campaign_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.jjp_delete_campaign(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jjp_delete_campaign(uuid) TO authenticated;

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
