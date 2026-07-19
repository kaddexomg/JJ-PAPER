-- ============================================================
-- JJ Paper — Puente de SKU entre productos, variantes e imágenes
--
-- Problema: el SKU vive sólo en jjp_product_variants. Las 502 filas
-- de jjp_products tienen sku vacío. Cualquier import o script que
-- busque un producto por products.sku no encuentra nada y termina
-- creando un producto duplicado — que es exactamente el cruce de
-- inventario que queremos evitar al subir las fotos clasificadas.
--
-- Solución: copiar el SKU de la variante al producto (hoy la relación
-- es 1:1 — verificado: 0 productos con más de una variante) y poner
-- un índice único que impida el duplicado a futuro.
--
-- Aditivo. Idempotente. No toca stock, conteos ni precios.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Copiar SKU de la variante al producto ----------
-- Sólo rellena lo vacío: nunca pisa un SKU ya escrito a mano.
update public.jjp_products p
set    sku = v.sku
from   public.jjp_product_variants v
where  v.product_id = p.id
  and  coalesce(p.sku, '') = ''
  and  coalesce(v.sku, '') <> '';

-- ---------- 2. Índice único, insensible a mayúsculas ----------
-- Parcial: los productos sin SKU (altas rápidas desde el escáner)
-- siguen siendo válidos. 'ko-boa' y 'KO-BOA' cuentan como el mismo.
create unique index if not exists jjp_products_sku_uniq
  on public.jjp_products (upper(sku))
  where coalesce(sku, '') <> '';

create unique index if not exists jjp_product_variants_sku_uniq
  on public.jjp_product_variants (upper(sku))
  where coalesce(sku, '') <> '';

-- ---------- 3. Resolver un SKU a su variante ----------
-- Lo que usa subir_imagenes.py: dado el SKU del nombre de archivo,
-- devuelve a qué variante pertenece y si ya tiene foto. Nunca crea
-- nada — si el SKU no existe devuelve 0 filas y el script aparta la
-- imagen en SIN_MATCH/ para revisión manual.
create or replace function public.jjp_variant_by_sku(p_sku text)
returns table (
  variant_id   uuid,
  product_id   uuid,
  nombre       text,
  tiene_imagen boolean
)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select v.id,
         p.id,
         p.name,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '')
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  where  upper(v.sku) = upper(trim(p_sku))
  limit  1;
$$;

-- ---------- 4. Catálogo vivo para el clasificador ----------
-- Reemplaza al catalogo_full.csv exportado a mano. El clasificador
-- lee de acá, así que un producto dado de alta desde el escáner
-- aparece de inmediato y la IA deja de mandarlo a _revisar_manual.
create or replace view public.jjp_catalog_export as
  select v.sku            as codigo,
         p.name           as descripcion,
         coalesce(c.name, '') as categoria,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '') as tiene_imagen
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.sku,'') <> '';

-- ---------- 5. Cola de fotos priorizada ----------
-- Lo que alimenta la pestaña "Faltan fotos" del admin: los productos
-- sin imagen, ordenados por plata inmovilizada (stock ya contado x
-- precio). Primero lo que está en el estante sin poder venderse.
create or replace view public.jjp_missing_photos as
  select v.id               as variant_id,
         v.sku,
         p.name             as producto,
         coalesce(c.name, 'Sin categoría') as categoria,
         nullif(v.stock, -1) as stock,
         v.price_usd,
         case when coalesce(v.stock,-1) > 0
              then round(v.stock * coalesce(v.price_usd,0), 2)
              else 0 end   as usd_parado
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.image_url,'') = ''
    and  coalesce(p.image_url,'') = '';

grant select on public.jjp_catalog_export  to authenticated;
grant select on public.jjp_missing_photos  to authenticated;
