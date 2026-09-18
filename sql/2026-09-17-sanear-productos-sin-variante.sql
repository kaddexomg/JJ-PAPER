-- ============================================================
-- SANEAMIENTO: Crear variantes para productos importados de MixNet
-- que no tienen ninguna fila en jjp_product_variants.
-- 
-- EJECUTAR en: SQL Editor de Supabase > Proyecto A (Core)
-- Fecha: 17-09-2026
-- Motivo: sweepMixnetProducts() importaba productos sin variante,
--   dejándolos invisibles en POS/buscador y sin soporte para
--   descontar stock (jjp_apply_order_stock usa variant_id).
-- ============================================================

-- 1. Ver cuántos productos sin variante existen antes de sanear
SELECT COUNT(*) AS productos_sin_variante
FROM public.jjp_products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.jjp_product_variants v WHERE v.product_id = p.id
);

-- 2. Crear variante 'Unidad' para cada producto sin variante
--    copiando todos los precios, stock y SKU del producto padre.
INSERT INTO public.jjp_product_variants (
  product_id,
  variant_name,
  sku,
  price_usd,
  price_a,
  price_b,
  price_c_bs,
  price_d_bs,
  cost_usd,
  stock,
  active,
  mixnet_status,
  base_price_usd
)
SELECT
  p.id                                              AS product_id,
  'Unidad'                                          AS variant_name,
  p.sku                                             AS sku,
  COALESCE(p.price_usd, p.price_b, 0)              AS price_usd,
  COALESCE(p.price_a, 0)                            AS price_a,
  COALESCE(p.price_b, p.price_usd, 0)              AS price_b,
  COALESCE(p.price_c_bs, 0)                        AS price_c_bs,
  COALESCE(p.price_d_bs, 0)                        AS price_d_bs,
  COALESCE(p.cost_usd, 0)                          AS cost_usd,
  COALESCE(p.stock, 0)                             AS stock,
  p.active                                          AS active,
  COALESCE(p.mixnet_status, 'sincronizado')        AS mixnet_status,
  COALESCE(p.price_usd, p.price_b, 0)              AS base_price_usd
FROM public.jjp_products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.jjp_product_variants v WHERE v.product_id = p.id
)
  AND p.sku IS NOT NULL
  AND p.sku <> ''
ON CONFLICT DO NOTHING;

-- 3. Verificar resultado
SELECT COUNT(*) AS variantes_creadas_total
FROM public.jjp_product_variants;

SELECT COUNT(*) AS productos_sin_variante_restantes
FROM public.jjp_products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.jjp_product_variants v WHERE v.product_id = p.id
);
