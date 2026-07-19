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

-- ============================================================
-- CORRECCIÓN (misma fecha): las vistas de arriba se crearon sin
-- security_invoker y con dueño postgres, así que se ejecutaban con los
-- permisos del dueño y salteaban el RLS de las tablas de abajo. Un
-- cliente autenticado podía leer stock y costos por ahí — justo lo que
-- se acababa de sacar de la ficha pública.
--
-- Se recrean con security_invoker (respetan el RLS de quien consulta) y
-- con un filtro de personal adentro de la propia vista, para que
-- devuelvan 0 filas a quien no sea staff. El service_role queda exento
-- porque los scripts de wa-server no tienen auth.uid().
--
-- Verificado: admin ve 284 filas, usuario autenticado sin perfil ve 0.
-- Ver la migración `missing_photos_views_staff_only`.
-- ============================================================

-- ---------- 6. Resolver SKU: versión final ----------
-- El clasificador sanea el nombre de archivo reemplazando lo no
-- alfanumérico por guiones, así que "CEL-T1/2" llega como "cel-t1-2" y
-- la comparación exacta falla (11 SKU llevan barra). Segundo intento sin
-- separadores; verificado 0 colisiones entre los 502 SKU. 'exacto'
-- distingue el acierto literal del recuperado.
drop function if exists public.jjp_variant_by_sku(text);

create function public.jjp_variant_by_sku(p_sku text)
returns table (
  variant_id   uuid,
  product_id   uuid,
  nombre       text,
  tiene_imagen boolean,
  exacto       boolean
)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  with buscado as (
    select upper(trim(p_sku)) as crudo,
           regexp_replace(upper(trim(p_sku)), '[^A-Z0-9]', '', 'g') as plano
  )
  select v.id, p.id, p.name,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> ''),
         (upper(v.sku) = b.crudo)
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  cross  join buscado b
  where  upper(v.sku) = b.crudo
     or  regexp_replace(upper(v.sku), '[^A-Z0-9]', '', 'g') = b.plano
  order  by (upper(v.sku) = b.crudo) desc
  limit  1;
$$;

-- ---------- 7. Vistas: versión final, sólo personal ----------
create or replace view public.jjp_catalog_export
with (security_invoker = true) as
  select v.sku            as codigo,
         p.name           as descripcion,
         coalesce(c.name, '') as categoria,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '') as tiene_imagen
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.sku,'') <> ''
    and  ( auth.role() = 'service_role'
           or exists (select 1 from public.jjp_profiles
                      where id = auth.uid() and active) );

create or replace view public.jjp_missing_photos
with (security_invoker = true) as
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
    and  coalesce(p.image_url,'') = ''
    and  ( auth.role() = 'service_role'
           or exists (select 1 from public.jjp_profiles
                      where id = auth.uid() and active) );

revoke all    on public.jjp_catalog_export from anon;
revoke all    on public.jjp_missing_photos from anon;
grant  select on public.jjp_catalog_export to authenticated;
grant  select on public.jjp_missing_photos to authenticated;
