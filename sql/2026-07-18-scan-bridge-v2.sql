-- ============================================================
-- JJ Paper — Puente de escaneo teléfono ⇄ PC  (v2, bidireccional)
--
-- v1 era de una sola vía: el teléfono insertaba el código y quedaba
-- a ciegas (no sabía si la PC lo recibió, ni de qué producto se trataba).
-- v2 agrega la vía de vuelta: la PC procesa el evento, escribe el
-- resultado y el teléfono lo ve en vivo por Realtime.
--
-- Aditivo. Idempotente. Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Columnas de respuesta ----------
alter table public.jjp_scan_events
  add column if not exists handled_at timestamptz,          -- cuándo lo procesó la PC
  add column if not exists result     jsonb,                -- { ok, kind, name, counted, msg }
  add column if not exists device     text;                 -- etiqueta del teléfono (opcional)

-- Pendientes: lo que el teléfono envió y la PC todavía no procesó
-- (permite recuperar escaneos hechos con la PC cerrada o desconectada)
create index if not exists jjp_scan_events_pending_idx
  on public.jjp_scan_events (owner_id, created_at)
  where handled_at is null;

-- ---------- 2. RLS: permitir que la PC responda ----------
drop policy if exists jjp_scan_upd on public.jjp_scan_events;
create policy jjp_scan_upd on public.jjp_scan_events for update to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 3. Realtime en los UPDATE ----------
-- Sin REPLICA IDENTITY FULL, Supabase no emite el filtro owner_id en updates.
alter table public.jjp_scan_events replica identity full;

-- ---------- 4. Limpieza automática ----------
-- Los eventos son efímeros: sólo sirven durante el conteo.
create or replace function public.jjp_purge_scan_events()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare n integer;
begin
  delete from public.jjp_scan_events where created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 5. Progreso del conteo ----------
-- stock = -1 significa "sin control" y, durante un inventario, "aún no contado".
-- Esta vista da el avance sin traerse las 490 filas al teléfono.
create or replace view public.jjp_count_progress
with (security_invoker = on) as
  select
    count(*)                                  as total,
    count(*) filter (where stock >= 0)        as contados,
    count(*) filter (where stock < 0)         as pendientes,
    count(*) filter (where barcode is not null and barcode <> '') as con_codigo
  from public.jjp_product_variants
  where active is not false;

grant select on public.jjp_count_progress to authenticated;
