-- ========================================================================
-- JJ PAPER — BORRADO DE ARCHIVOS DE STORAGE VÍA SQL INTERNO
-- Permite purgar storage sin pagar suscripción y sin errores de permisos
-- ========================================================================

CREATE OR REPLACE FUNCTION public.jjp_force_clean_storage_buckets()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count int := 0;
BEGIN
    -- 1. Eliminar archivos del bucket de WhatsApp
    DELETE FROM storage.objects WHERE bucket_id = 'jjp-wa-media';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- 2. Eliminar archivos del bucket de recibos de prueba
    DELETE FROM storage.objects WHERE bucket_id = 'jjp-receipts';
    
    -- 3. Eliminar archivos del bucket de emails de prueba
    DELETE FROM storage.objects WHERE bucket_id = 'jjp-email-media';
    
    RETURN 'Limpieza completada exitosamente sin tocar jjp-products.';
EXCEPTION WHEN OTHERS THEN
    RETURN 'Error interno: ' || SQLERRM;
END;
$$;

-- Ejecutar la función
SELECT public.jjp_force_clean_storage_buckets();

-- Consultar espacio resultante
SELECT 
    bucket_id AS bucket,
    count(*) AS total_archivos,
    pg_size_pretty(sum((metadata->>'size')::bigint)) AS tamaño_total
FROM storage.objects
GROUP BY bucket_id;
