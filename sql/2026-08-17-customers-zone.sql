-- ======================================================
-- JJ Paper — Columna `zone` en jjp_customers
-- 17-ago-2026 · ADITIVO e idempotente
--
-- El CRM (admin/clientes.html y vendedor/clientes.html) lee,
-- filtra y escribe `c.zone` (assets/js/admin/aclients.js,
-- assets/js/vendedor/vcustomers.js), pero la columna nunca se
-- creó en la reconstrucción de la base (13-jul). Sin ella:
--   · los filtros por zona no funcionan,
--   · los badges de zona se ven vacíos,
--   · "Nuevo cliente" (admin y vendedor) falla con el error
--     "column jjp_customers.zone does not exist".
--
-- Cómo ejecutar: Supabase Dashboard → SQL Editor → pegar y Run.
-- ======================================================

alter table public.jjp_customers
  add column if not exists zone text;

create index if not exists jjp_customers_zone_idx
  on public.jjp_customers (zone);

-- Backfill desde la carga previa: la zona estaba escrita en notes
-- ("Zona: 008"). Se copia a la columna nueva para no perder datos
-- antes de la recarga limpia.
update public.jjp_customers
   set zone = regexp_replace(notes, '^Zona:\s*', '')
 where zone is null
   and notes ~ '^Zona:\s*[0-9]+$';
