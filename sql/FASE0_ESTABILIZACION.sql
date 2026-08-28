-- ============================================================================
-- PLAN GENERACION MOTORA MATRIZ - FASE 0: ESTABILIZACION Y STORAGE
-- JJ Paper - Ejecutar en el SQL Editor de Supabase
-- ============================================================================

-- 1. Asegurar columna channel en plantillas
ALTER TABLE public.jjp_wa_templates
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

-- 2. Asegurar columnas de opt-out y seguimiento en customers
ALTER TABLE public.jjp_customers
  ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;

-- 3. Funcion de limpieza programada de Storage
CREATE OR REPLACE FUNCTION public.jjp_storage_cleanup()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wa     INT := 0;
  v_email  INT := 0;
  v_old    INT := 0;
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = 'jjp-wa-media'
    AND name LIKE '%/campaigns/%'
    AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_wa = ROW_COUNT;

  DELETE FROM storage.objects
  WHERE bucket_id = 'jjp-email-media'
    AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_email = ROW_COUNT;

  DELETE FROM storage.objects
  WHERE bucket_id = 'jjp-receipts'
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_old = ROW_COUNT;

  RETURN format('Limpieza exitosa: wa=%s email=%s recibos=%s', v_wa, v_email, v_old);
END;
$$;

-- 4. Funcion de estadisticas de Storage
CREATE OR REPLACE FUNCTION public.jjp_storage_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(t)) INTO result FROM (
    SELECT
      bucket_id,
      count(*) as files,
      pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) as size_pretty,
      coalesce(sum((metadata->>'size')::bigint), 0) as size_bytes
    FROM storage.objects
    GROUP BY bucket_id
    ORDER BY coalesce(sum((metadata->>'size')::bigint), 0) DESC
  ) t;
  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

-- 5. Parametros de advertencia de storage
INSERT INTO public.jjp_settings (key, value) VALUES
  ('storage_warn_mb', '800'),
  ('storage_crit_mb', '950')
ON CONFLICT (key) DO NOTHING;

-- 6. Recargar cache de PostgREST
NOTIFY pgrst, 'reload schema';
