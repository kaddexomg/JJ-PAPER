-- ========================================================================
-- JJ PAPER — PURGA COMPLETA DE PRUEBAS (SIN TRANSACCIÓN BLOQUEANTE)
-- 
-- REGLAS ESTRICTAS DE PROTECCIÓN:
--   [x] NO TOCA CLIENTES (jjp_customers, jjp_clients)
--   [x] NO TOCA PRODUCTOS, VARIANTES NI CATÁLOGO (jjp_products, jjp_product_variants, etc.)
--   [x] NO TOCA STOCK ACTUAL DEL INVENTARIO
--   [x] NO TOCA FOTOS DE CATÁLOGO
-- ========================================================================

-- ------------------------------------------------------------------------
-- PARTE 1: PURGA DE DATOS DE PRUEBA
-- ------------------------------------------------------------------------

-- 1. Cotizaciones y pedidos de prueba
DELETE FROM public.jjp_quotes;
DELETE FROM public.jjp_orders;

-- 2. Notificaciones de prueba
DELETE FROM public.jjp_notifications;

-- 3. Bitácora de escaneos y logs de conteos de inventario
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_count_log') THEN
    TRUNCATE TABLE public.jjp_count_log CASCADE;
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_barcode_log') THEN
    TRUNCATE TABLE public.jjp_barcode_log CASCADE;
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_scan_events') THEN
    TRUNCATE TABLE public.jjp_scan_events CASCADE;
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_count_unknown') THEN
    TRUNCATE TABLE public.jjp_count_unknown CASCADE;
  END IF;
END $$;

-- 4. Mensajes y difusiones de WhatsApp de prueba
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_wa_messages') THEN
    DELETE FROM public.jjp_wa_messages WHERE status IN ('failed', 'pending');
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jjp_wa_campaign_targets') THEN
    DELETE FROM public.jjp_wa_campaign_targets;
  END IF;
END $$;

-- 5. Diagnóstico final de tamaño por tabla
SELECT 
    schemaname || '.' || tablename AS tabla,
    pg_size_pretty(pg_total_relation_size('"' || schemaname || '"."' || tablename || '"')) AS tamaño_total,
    pg_size_pretty(pg_relation_size('"' || schemaname || '"."' || tablename || '"')) AS tamaño_datos
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('"' || schemaname || '"."' || tablename || '"') DESC;
