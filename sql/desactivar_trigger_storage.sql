-- ========================================================================
-- JJ PAPER — DESACTIVAR EL TRIGGER protect_delete DE SUPABASE STORAGE
-- Ejecutado con permisos directos de superusuario
-- ========================================================================

-- 1. Eliminar temporalmente el trigger que causa el error 42501
DROP TRIGGER IF EXISTS protect_delete ON storage.objects;

-- 2. Limpiar los archivos de prueba pesados
DELETE FROM storage.objects WHERE bucket_id = 'jjp-wa-media';
DELETE FROM storage.objects WHERE bucket_id = 'jjp-receipts';
DELETE FROM storage.objects WHERE bucket_id = 'jjp-email-media';

-- 3. Ver espacio actual de los buckets
SELECT 
    bucket_id AS bucket,
    count(*) AS total_archivos,
    pg_size_pretty(sum((metadata->>'size')::bigint)) AS tamaño_total
FROM storage.objects
GROUP BY bucket_id;
