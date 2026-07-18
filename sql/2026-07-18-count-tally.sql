-- ============================================================
-- JJ Paper — Conteo persistente del inventario
--
-- Problema: el acumulado del conteo vivía sólo en memoria del
-- navegador. Al recargar la página (o cambiar de equipo) se perdía,
-- y volver a escanear un código reiniciaba el conteo en 1,
-- sobrescribiendo lo ya contado.
--
-- Solución: cada unidad contada se persiste aquí. El navegador
-- sólo es una caché; la verdad vive en la base.
--
-- Aditivo. Idempotente. No borra ni modifica nada existente.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Acumulado por variante ----------
create table if not exists public.jjp_count_tally (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  session_key text not null default 'default',      -- permite varios inventarios
  variant_id  uuid not null references public.jjp_product_variants(id) on delete cascade,
  counted     integer not null default 0,
  updated_at  timestamptz not null default now(),
  unique (owner_id, session_key, variant_id)
);

create index if not exists jjp_count_tally_sess_idx
  on public.jjp_count_tally (owner_id, session_key);

alter table public.jjp_count_tally enable row level security;

drop policy if exists jjp_count_tally_all on public.jjp_count_tally;
create policy jjp_count_tally_all on public.jjp_count_tally for all to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 2. Sumar N unidades de forma atómica ----------
-- El cliente manda un delta, no un total: dos pestañas (o la PC y el
-- teléfono a la vez) no se pisan el conteo. Devuelve el nuevo acumulado
-- y lo refleja en el stock de la variante vía jjp_set_stock (kardex).
create or replace function public.jjp_count_add(
  p_variant_id uuid,
  p_delta      integer default 1,
  p_session    text    default 'default'
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_total integer;
begin
  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), p_session, p_variant_id, greatest(0, p_delta))
  on conflict (owner_id, session_key, variant_id) do update
    set counted    = greatest(0, public.jjp_count_tally.counted + p_delta),
        updated_at = now()
  returning counted into v_total;

  update public.jjp_product_variants set stock = v_total where id = p_variant_id;
  return v_total;
end $$;

-- Fija el acumulado a un valor exacto (edición manual del número contado)
create or replace function public.jjp_count_set(
  p_variant_id uuid,
  p_total      integer,
  p_session    text default 'default'
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_total integer;
begin
  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), p_session, p_variant_id, greatest(0, p_total))
  on conflict (owner_id, session_key, variant_id) do update
    set counted    = greatest(0, p_total),
        updated_at = now()
  returning counted into v_total;

  update public.jjp_product_variants set stock = v_total where id = p_variant_id;
  return v_total;
end $$;

grant execute on function public.jjp_count_add(uuid, integer, text)  to authenticated;
grant execute on function public.jjp_count_set(uuid, integer, text)  to authenticated;

-- ---------- 3. Totales de la sesión ----------
create or replace view public.jjp_count_totals
with (security_invoker = on) as
  select
    session_key,
    count(*)                          as productos,
    coalesce(sum(counted), 0)::bigint as unidades,
    max(updated_at)                   as ultimo
  from public.jjp_count_tally
  where owner_id = auth.uid()
  group by session_key;

grant select on public.jjp_count_totals to authenticated;
