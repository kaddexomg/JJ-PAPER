-- ======================================================
-- JJ Paper — Clientes destacados + reseñas iniciales
-- 16-jul-2026
--   1. Tabla jjp_clients: empresas/instituciones que nos compran
--      (marquee "Clientes que confían en nosotros" en el home,
--       gestionable desde admin/ajustes.html)
--   2. Bucket jjp-clients para logos subidos desde el admin
--   3. Seed: COPOSA y Federación Venezolana de Fútbol
--   4. Reseñas iniciales aprobadas de clientes
-- ======================================================

-- ---------- 1. Tabla ----------
create table if not exists public.jjp_clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  logo_url   text,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.jjp_clients enable row level security;

drop policy if exists jjp_clients_sel   on public.jjp_clients;
drop policy if exists jjp_clients_staff on public.jjp_clients;

-- Público ve los activos; staff activo administra todo
create policy jjp_clients_sel on public.jjp_clients
  for select using (active or public.jjp_is_admin());
create policy jjp_clients_staff on public.jjp_clients
  for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));

-- ---------- 2. Storage: logos de clientes ----------
insert into storage.buckets (id, name, public)
  values ('jjp-clients','jjp-clients', true)
  on conflict (id) do nothing;

drop policy if exists jjp_clients_media_read  on storage.objects;
drop policy if exists jjp_clients_media_write on storage.objects;
create policy jjp_clients_media_read on storage.objects
  for select using (bucket_id = 'jjp-clients');
create policy jjp_clients_media_write on storage.objects
  for insert to authenticated with check (bucket_id = 'jjp-clients');

-- ---------- 3. Seed de clientes ----------
insert into public.jjp_clients (name, logo_url, sort_order)
select v.name, v.logo_url, v.sort_order
from (values
  ('COPOSA',                            'assets/img/clients/coposa.png', 1),
  ('Federación Venezolana de Fútbol',   'assets/img/clients/fvf.png',    2)
) as v(name, logo_url, sort_order)
where not exists (select 1 from public.jjp_clients c where c.name = v.name);

-- ---------- 4. Reseñas iniciales (aprobadas) ----------
insert into public.jjp_reviews (name, stars, text, approved, created_at)
select v.name, v.stars, v.text, true, v.created_at::timestamptz
from (values
  ('Distribuidora El Llano, C.A.', 5,
   'Excelente proveedor. Pedimos 200 resmas mensuales y siempre cumplen con la entrega en 48 horas. Los precios al mayor son los mejores que hemos conseguido en Caracas.',
   '2026-03-12 10:24:00-04'),
  ('María Fernanda Rojas', 5,
   'Compré todos los útiles escolares de mis tres hijos aquí. La atención por WhatsApp fue rapidísima y me armaron la cotización el mismo día. Totalmente recomendados.',
   '2026-04-02 15:11:00-04'),
  ('Colegio Santa Cecilia', 5,
   'Trabajamos con JJ Paper desde hace dos períodos escolares. La calidad de los cuadernos y el papel es constante, y el despacho siempre llega completo y a tiempo.',
   '2026-04-27 09:40:00-04'),
  ('Ferretería y Suministros La 42', 4,
   'Buenos precios de reventa y variedad de marcas. Una vez hubo un retraso con un bulto y lo resolvieron el mismo día con el vendedor. Buen servicio postventa.',
   '2026-05-15 11:05:00-04'),
  ('Oficina Contable Guerrero & Asociados', 5,
   'Pedimos suministros de oficina cada mes: papel, carpetas, tóner de sellos. El sistema de pedidos en línea con pago móvil nos ahorra muchísimo tiempo.',
   '2026-06-03 16:32:00-04'),
  ('Librería Papelitos (Guarenas)', 5,
   'Como revendedores, el margen que nos deja JJ Paper es excelente. El catálogo con precios en dólares y bolívares a tasa BCV nos facilita todo el trabajo.',
   '2026-06-21 10:58:00-04'),
  ('José Gregorio Medina', 4,
   'Pedí una cotización al mayor por el chat de la página y me contactaron en menos de una hora. Buen precio en las resmas y el cloro. Volveré a comprar.',
   '2026-07-04 14:20:00-04'),
  ('Inversiones Karive, C.A.', 5,
   'Dotamos tres oficinas completas con ellos: papelería, limpieza y suministros. Un solo proveedor, una sola factura, cero dolores de cabeza. Muy profesionales.',
   '2026-07-11 09:15:00-04')
) as v(name, stars, text, created_at)
where not exists (
  select 1 from public.jjp_reviews r where r.name = v.name and r.text = v.text
);
