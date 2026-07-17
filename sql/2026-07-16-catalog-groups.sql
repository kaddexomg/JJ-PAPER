-- ======================================================
-- JJ Paper — Segmentación del catálogo en familias
--   1. jjp_category_groups: 8 familias que agrupan las 39 categorías
--   2. jjp_categories.group_id → su familia
--   3. jjp_products.essential  → sale en la página 1 del catálogo
-- Idempotente: se puede correr varias veces.
-- ======================================================

-- ---------- 1. Familias ----------
create table if not exists public.jjp_category_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  emoji      text,
  sort_order int not null default 0
);

alter table public.jjp_categories
  add column if not exists group_id uuid references public.jjp_category_groups(id) on delete set null;

create index if not exists jjp_categories_group_idx on public.jjp_categories(group_id);

-- ---------- 2. Esenciales ----------
-- Los marcados salen primero en el catálogo (página 1 de cualquier vista).
alter table public.jjp_products
  add column if not exists essential boolean not null default false;

create index if not exists jjp_products_essential_idx on public.jjp_products(essential) where essential;

-- ---------- 3. RLS (mismo patrón que jjp_categories) ----------
alter table public.jjp_category_groups enable row level security;

drop policy if exists jjp_groups_sel   on public.jjp_category_groups;
drop policy if exists jjp_groups_staff on public.jjp_category_groups;

create policy jjp_groups_sel   on public.jjp_category_groups for select using (true);
create policy jjp_groups_staff on public.jjp_category_groups for all to authenticated
  using      (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));

-- ---------- 4. Seed de las 8 familias ----------
insert into public.jjp_category_groups (slug, name, emoji, sort_order) values
  ('escritura',    'Escritura y corrección',   '🖊️', 1),
  ('papel',        'Papel y cuadernos',        '📄', 2),
  ('escolar_arte', 'Escolar y arte',           '🎨', 3),
  ('corte_pegado', 'Corte y pegado',           '✂️', 4),
  ('archivo',      'Archivo y carpetas',       '🗂️', 5),
  ('administracion','Administración',          '🧾', 6),
  ('sujecion',     'Sujeción y encuadernado',  '📎', 7),
  ('tecnologia',   'Tecnología y otros',       '🧰', 8)
on conflict (slug) do update
  set name = excluded.name, emoji = excluded.emoji, sort_order = excluded.sort_order;

-- ---------- 5. Reparto de las 39 categorías ----------
update public.jjp_categories c
set group_id = g.id
from public.jjp_category_groups g
where g.slug = case c.slug
  when 'boligrafos'          then 'escritura'
  when 'marcadores'          then 'escritura'
  when 'lapices'             then 'escritura'
  when 'creyones'            then 'escritura'
  when 'tajalapices'         then 'escritura'
  when 'correctores'         then 'escritura'

  when 'cuadernos'           then 'papel'
  when 'papel'               then 'papel'
  when 'notas_adhesivas'     then 'papel'

  when 'manualidades'        then 'escolar_arte'
  when 'pinturas'            then 'escolar_arte'
  when 'libros_cuentos'      then 'escolar_arte'
  when 'cartelera'           then 'escolar_arte'
  when 'compases'            then 'escolar_arte'
  when 'tizas'               then 'escolar_arte'
  when 'reglas'              then 'escolar_arte'
  when 'cartucheras'         then 'escolar_arte'
  when 'forros_plastificado' then 'escolar_arte'

  when 'cintas'              then 'corte_pegado'
  when 'pegamentos'          then 'corte_pegado'
  when 'tijeras'             then 'corte_pegado'

  when 'carpetas'            then 'archivo'
  when 'archivadores'        then 'archivo'
  when 'fundas_protectores'  then 'archivo'
  when 'bandejas'            then 'archivo'

  when 'sobres'              then 'administracion'
  when 'tinta_sellos'        then 'administracion'
  when 'libros_contables'    then 'administracion'
  when 'etiquetas'           then 'administracion'
  when 'formularios'         then 'administracion'

  when 'clips_ganchos'       then 'sujecion'
  when 'engrapadoras'        then 'sujecion'
  when 'perforadoras'        then 'sujecion'
  when 'chinches'            then 'sujecion'
  when 'gomas_bandas'        then 'sujecion'

  when 'calculadoras'        then 'tecnologia'
  when 'multimedia'          then 'tecnologia'
  when 'pilas'               then 'tecnologia'
  when 'varios'              then 'tecnologia'
end;

-- Cualquier categoría nueva sin familia cae en "Tecnología y otros"
update public.jjp_categories c
set group_id = (select id from public.jjp_category_groups where slug = 'tecnologia')
where c.group_id is null;

-- ---------- 6. Arranque de esenciales ----------
-- Sin historial de ventas ni productos destacados, se siembran los 3 artículos
-- más económicos de cada tipo de alta rotación (la presentación básica suele ser
-- la más barata). Es sólo un punto de partida: desde admin/productos se ajusta
-- con el check "Esencial" o la acción masiva 🔝.
with pat(rx, etiqueta) as (values
  ('^(CUADERNO|LIBRETA)', 'Cuadernos'),
  ('^BLOCK',              'Blocks'),
  ('^BOLIGRAFO',          'Bolígrafos'),
  ('^LAPIZ',              'Lápices'),
  ('^MARCADOR',           'Marcadores'),
  ('^RESALTADOR',         'Resaltadores'),
  ('^CREYONES',           'Creyones'),
  ('^CORRECTOR',          'Correctores'),
  ('^CARPETA',            'Carpetas'),
  ('^(CINTAS?|TIRRO)',    'Cintas/tirro'),
  ('^PEGA',               'Pegas'),
  ('^(GRAPAS|ENGRAPADORA)','Grapas'),
  ('^CLIPS',              'Clips'),
  ('^TIJERA',             'Tijeras'),
  ('^SACAPUNTA',          'Sacapuntas'),
  ('^SOBRE',              'Sobres'),
  ('^(PAPEL|HOJAS)',      'Papel/hojas')
),
ranked as (
  select pr.id,
         row_number() over (partition by p.etiqueta order by pr.price_usd asc) as rn
  from pat p join public.jjp_products pr on pr.active and pr.name ~ p.rx
)
update public.jjp_products set essential = true
where id in (select id from ranked where rn <= 3);
