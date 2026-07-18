-- ============================================================
-- JJ Paper — Bitácora total del conteo (movimiento por movimiento)
--
-- Hasta ahora sólo se auditaban los cambios de código de barras.
-- Los movimientos de cantidad (cada escaneo, cada ajuste) no dejaban
-- rastro: si el puente teléfono⇄PC contaba en el producto equivocado,
-- no había forma de saberlo ni de deshacerlo.
--
-- Ahora TODO cambio de cantidad pasa por los RPC y queda en
-- jjp_count_log con su origen (pc, teléfono, manual…). Sobre eso:
--   - jjp_count_revert:   deshace un movimiento puntual.
--   - jjp_count_transfer: mueve N unidades de un producto a otro
--                         (el arreglo directo de un conteo cruzado).
--
-- Aditivo e idempotente. NO borra ni altera el conteo acumulado.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Bitácora de movimientos ----------
create table if not exists public.jjp_count_log (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid(),
  session_key   text not null default 'default',
  variant_id    uuid references public.jjp_product_variants(id) on delete set null,
  delta         integer not null,          -- +1 escaneo, -3 ajuste, etc.
  counted_after integer,                   -- acumulado tras aplicar
  source        text not null default 'pc',-- pc | telefono | manual | busqueda | transferencia | reverso | historico
  note          text,
  reverts       uuid,                      -- si este movimiento deshace a otro
  reverted_by   uuid,                      -- si este movimiento fue deshecho
  created_at    timestamptz not null default now()
);

create index if not exists jjp_count_log_recent_idx
  on public.jjp_count_log (owner_id, session_key, created_at desc);
create index if not exists jjp_count_log_variant_idx
  on public.jjp_count_log (variant_id, created_at desc);

alter table public.jjp_count_log enable row level security;

drop policy if exists jjp_count_log_all on public.jjp_count_log;
create policy jjp_count_log_all on public.jjp_count_log for all to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 2. RPCs de conteo, ahora con bitácora ----------
-- Se recrean con parámetros nuevos (source/note con default): las
-- versiones viejas se eliminan para que PostgREST no vea ambigüedad.
drop function if exists public.jjp_count_add(uuid, integer, text);
drop function if exists public.jjp_count_set(uuid, integer, text);
drop function if exists public.jjp_count_remove(uuid, text);

create or replace function public.jjp_count_add(
  p_variant_id uuid,
  p_delta      integer default 1,
  p_session    text    default 'default',
  p_source     text    default 'pc',
  p_note       text    default null
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

  insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, note)
  values (p_session, p_variant_id, p_delta, v_total, coalesce(p_source, 'pc'), p_note);

  return v_total;
end $$;

create or replace function public.jjp_count_set(
  p_variant_id uuid,
  p_total      integer,
  p_session    text default 'default',
  p_source     text default 'manual',
  p_note       text default null
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_prev integer; v_total integer;
begin
  select counted into v_prev from public.jjp_count_tally
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_variant_id;
  v_prev := coalesce(v_prev, 0);

  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), p_session, p_variant_id, greatest(0, p_total))
  on conflict (owner_id, session_key, variant_id) do update
    set counted    = greatest(0, p_total),
        updated_at = now()
  returning counted into v_total;

  update public.jjp_product_variants set stock = v_total where id = p_variant_id;

  if v_total <> v_prev then
    insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, note)
    values (p_session, p_variant_id, v_total - v_prev, v_total, coalesce(p_source, 'manual'), p_note);
  end if;

  return v_total;
end $$;

create or replace function public.jjp_count_remove(
  p_variant_id uuid,
  p_session    text default 'default'
) returns boolean
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_prev integer;
begin
  select counted into v_prev from public.jjp_count_tally
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_variant_id;

  delete from public.jjp_count_tally
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_variant_id;
  update public.jjp_product_variants set stock = -1 where id = p_variant_id;

  if v_prev is not null then
    insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, note)
    values (p_session, p_variant_id, -v_prev, null, 'manual', 'quitado del conteo');
  end if;
  return true;
end $$;

grant execute on function public.jjp_count_add(uuid, integer, text, text, text)  to authenticated;
grant execute on function public.jjp_count_set(uuid, integer, text, text, text)  to authenticated;
grant execute on function public.jjp_count_remove(uuid, text)                    to authenticated;

-- ---------- 3. Deshacer un movimiento puntual ----------
create or replace function public.jjp_count_revert(p_log_id uuid)
returns integer
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare l record; v_total integer; v_rev uuid;
begin
  select * into l from public.jjp_count_log
   where id = p_log_id and owner_id = auth.uid();
  if l is null then raise exception 'Movimiento no encontrado'; end if;
  if l.reverted_by is not null then raise exception 'Ese movimiento ya fue deshecho'; end if;
  if l.delta = 0 then raise exception 'Nada que deshacer'; end if;

  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), l.session_key, l.variant_id, greatest(0, -l.delta))
  on conflict (owner_id, session_key, variant_id) do update
    set counted    = greatest(0, public.jjp_count_tally.counted - l.delta),
        updated_at = now()
  returning counted into v_total;

  update public.jjp_product_variants set stock = v_total where id = l.variant_id;

  insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, note, reverts)
  values (l.session_key, l.variant_id, -l.delta, v_total, 'reverso',
          'deshace movimiento de ' || l.delta || ' (' || l.source || ')', l.id)
  returning id into v_rev;

  update public.jjp_count_log set reverted_by = v_rev where id = l.id;
  return v_total;
end $$;

grant execute on function public.jjp_count_revert(uuid) to authenticated;

-- ---------- 4. Transferir unidades (conteo cruzado) ----------
-- "Escaneé/conté en el producto que no era": mueve N unidades del
-- equivocado al correcto, en una sola operación atómica y auditada.
create or replace function public.jjp_count_transfer(
  p_from    uuid,
  p_to      uuid,
  p_qty     integer,
  p_session text default 'default'
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_have integer; v_from_total integer; v_to_total integer;
  v_from_name text; v_to_name text;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
  if p_from = p_to then raise exception 'Elige dos productos distintos'; end if;

  select counted into v_have from public.jjp_count_tally
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_from;
  if coalesce(v_have, 0) < p_qty then
    raise exception 'Sólo hay % contadas en el producto de origen', coalesce(v_have, 0);
  end if;

  select p.name into v_from_name from public.jjp_product_variants v
    join public.jjp_products p on p.id = v.product_id where v.id = p_from;
  select p.name into v_to_name from public.jjp_product_variants v
    join public.jjp_products p on p.id = v.product_id where v.id = p_to;

  update public.jjp_count_tally
     set counted = counted - p_qty, updated_at = now()
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_from
  returning counted into v_from_total;
  update public.jjp_product_variants set stock = v_from_total where id = p_from;

  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), p_session, p_to, p_qty)
  on conflict (owner_id, session_key, variant_id) do update
    set counted = public.jjp_count_tally.counted + p_qty, updated_at = now()
  returning counted into v_to_total;
  update public.jjp_product_variants set stock = v_to_total where id = p_to;

  insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, note)
  values (p_session, p_from, -p_qty, v_from_total, 'transferencia', 'movidas a: ' || coalesce(v_to_name, '?')),
         (p_session, p_to,    p_qty, v_to_total,  'transferencia', 'recibidas de: ' || coalesce(v_from_name, '?'));

  return jsonb_build_object('ok', true, 'from_total', v_from_total, 'to_total', v_to_total);
end $$;

grant execute on function public.jjp_count_transfer(uuid, uuid, integer, text) to authenticated;

-- ---------- 5. Punto de partida ----------
-- El acumulado previo a esta bitácora entra como un movimiento
-- "historico" por producto, para que la suma de la bitácora siempre
-- cuadre con el acumulado. Idempotente: sólo si la bitácora está vacía.
insert into public.jjp_count_log (owner_id, session_key, variant_id, delta, counted_after, source, note)
select t.owner_id, t.session_key, t.variant_id, t.counted, t.counted, 'historico',
       'acumulado previo a la bitácora'
from public.jjp_count_tally t
where t.counted > 0
  and not exists (select 1 from public.jjp_count_log l where l.owner_id = t.owner_id);

-- ---------- 6. Bitácora legible ----------
create or replace view public.jjp_count_log_view
with (security_invoker = on) as
  select l.id, l.session_key, l.variant_id, l.delta, l.counted_after,
         l.source, l.note, l.reverts, l.reverted_by, l.created_at,
         p.name  as product_name,
         b.name  as brand_name,
         v.variant_name, v.sku
  from public.jjp_count_log l
  left join public.jjp_product_variants v on v.id = l.variant_id
  left join public.jjp_products p         on p.id = v.product_id
  left join public.jjp_brands b           on b.id = v.brand_id
  where l.owner_id = auth.uid();

grant select on public.jjp_count_log_view to authenticated;
