-- ==============================================================================
-- Migración: Vista Materializada jjp_catalog_flat para Acelerar Catálogo Web, POS y Campañas
-- Fecha: 01 de Octubre de 2026
-- Proyecto A (Core)
-- ==============================================================================

DROP MATERIALIZED VIEW IF EXISTS jjp_catalog_flat CASCADE;

CREATE MATERIALIZED VIEW jjp_catalog_flat AS
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
FROM jjp_products p
LEFT JOIN jjp_categories c ON c.id = p.category_id
LEFT JOIN jjp_product_variants v ON v.product_id = p.id AND v.active = true
LEFT JOIN jjp_brands b ON b.id = v.brand_id
WHERE p.active = true
GROUP BY p.id, c.name, c.slug, c.color, c.group_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jjp_catalog_flat_id ON jjp_catalog_flat (id);
CREATE INDEX IF NOT EXISTS idx_jjp_catalog_flat_sort ON jjp_catalog_flat (sort_order);

GRANT SELECT ON jjp_catalog_flat TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION jjp_refresh_catalog_flat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY jjp_catalog_flat;
END;
$$;

GRANT EXECUTE ON FUNCTION jjp_refresh_catalog_flat() TO anon, authenticated, service_role;
