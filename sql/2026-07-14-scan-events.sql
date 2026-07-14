-- ============================================================
-- JJ Paper — Puente de escaneo teléfono → PC (inventario)
-- El teléfono/tablet escanea con su cámara e inserta una fila aquí;
-- la PC (admin/inventario.html) la recibe por Realtime y la pasa a
-- scanHandleCode() como si fuera un escaneo local o de lector USB.
-- Aditivo. Idempotente. Aplicar sobre la base nueva (oeiuczltgdexwjjgquyq).
-- ============================================================

-- ---------- 1. Tabla ----------
create table if not exists public.jjp_scan_events (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now()
);

create index if not exists jjp_scan_events_owner_idx
  on public.jjp_scan_events (owner_id, created_at desc);

-- ---------- 2. RLS ----------
alter table public.jjp_scan_events enable row level security;

-- Cada quien inserta SOLO eventos a su propio nombre (el teléfono logueado)
drop policy if exists jjp_scan_ins on public.jjp_scan_events;
create policy jjp_scan_ins on public.jjp_scan_events for insert to authenticated
  with check (owner_id = auth.uid());

-- Leer: los propios (la PC del mismo usuario) o admin (supervisión)
drop policy if exists jjp_scan_sel on public.jjp_scan_events;
create policy jjp_scan_sel on public.jjp_scan_events for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());

-- Borrar los propios (limpieza opcional); admin todos
drop policy if exists jjp_scan_del on public.jjp_scan_events;
create policy jjp_scan_del on public.jjp_scan_events for delete to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 3. Realtime ----------
-- Sólo agrega la tabla si no está ya en la publicación (evita error al re-aplicar)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jjp_scan_events'
  ) then
    alter publication supabase_realtime add table public.jjp_scan_events;
  end if;
end $$;
