-- ============================================================
-- JJ Paper — Conteo multi-persona, teléfono autónomo y cruces
--
-- Contexto: el conteo funcionaba para UN operador (PC + su propio
-- teléfono, misma cuenta). Con login compartido varias personas ya
-- suman al MISMO acumulado por deltas (atómico, no se pisan). Faltaba:
--   1. Saber QUIÉN contó cada unidad  -> jjp_count_log.counted_by
--   2. Que el teléfono cuente SOLO, sin depender de una PC abierta
--      procesando el puente Realtime  -> jjp_count_scan()
--   3. Registrar los códigos desconocidos sin frenar ni perderlos
--      -> jjp_count_unknown + captura dentro de jjp_count_scan()
--   4. Avisar cuando 2+ personas tocaron la misma variante (posible
--      doble conteo del mismo estante) -> vista jjp_count_conflicts
--   5. Panel de "quién contó cuánto" -> vista jjp_count_counters
--
-- Aditivo. Idempotente. NO borra ni altera el conteo ya acumulado.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Etiqueta de persona en la bitácora ----------
alter table public.jjp_count_log
  add column if not exists counted_by text;   -- nombre/dispositivo del contador

create index if not exists jjp_count_log_by_idx
  on public.jjp_count_log (owner_id, session_key, counted_by);

-- ---------- 2. Cola de códigos desconocidos (sin depender de Realtime) ----------
-- Cuando el teléfono escanea un código que no está en ningún producto,
-- lo registramos aquí para vincularlo/crearlo después desde la PC o el
-- Control del conteo. Cuenta cuántas veces se vio (varias cajas iguales).
create table if not exists public.jjp_count_unknown (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  session_key text not null default 'default',
  code        text not null,
  device      text,
  seen        integer not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  resolved_at timestamptz,
  unique (owner_id, session_key, code)
);

create index if not exists jjp_count_unknown_open_idx
  on public.jjp_count_unknown (owner_id, session_key)
  where resolved_at is null;

alter table public.jjp_count_unknown enable row level security;

drop policy if exists jjp_count_unknown_all on public.jjp_count_unknown;
create policy jjp_count_unknown_all on public.jjp_count_unknown for all to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 3. RPCs de conteo: ahora con etiqueta de persona ----------
-- Se recrean con p_by (default null). Las firmas de 5 args se eliminan
-- para que PostgREST no vea ambigüedad; el front llama con args nombrados
-- así que los defaults llenan lo que falte.
drop function if exists public.jjp_count_add(uuid, integer, text, text, text);
drop function if exists public.jjp_count_set(uuid, integer, text, text, text);

create or replace function public.jjp_count_add(
  p_variant_id uuid,
  p_delta      integer default 1,
  p_session    text    default 'default',
  p_source     text    default 'pc',
  p_note       text    default null,
  p_by         text    default null
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

  insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, counted_by, note)
  values (p_session, p_variant_id, p_delta, v_total, coalesce(p_source, 'pc'), p_by, p_note);

  return v_total;
end $$;

create or replace function public.jjp_count_set(
  p_variant_id uuid,
  p_total      integer,
  p_session    text default 'default',
  p_source     text default 'manual',
  p_note       text default null,
  p_by         text default null
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
    insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, counted_by, note)
    values (p_session, p_variant_id, v_total - v_prev, v_total, coalesce(p_source, 'manual'), p_by, p_note);
  end if;

  return v_total;
end $$;

grant execute on function public.jjp_count_add(uuid, integer, text, text, text, text) to authenticated;
grant execute on function public.jjp_count_set(uuid, integer, text, text, text, text) to authenticated;

-- ---------- 4. Conteo autónomo por código (teléfono directo) ----------
-- El teléfono llama esto por cada código: resuelve barcode -> variante,
-- suma 1 atómico, deja rastro con quién lo contó y devuelve el nombre
-- para mostrarlo al instante. Ya NO necesita una PC abierta procesando.
--   - Código conocido  -> { ok:true, name, counted, dupe }
--   - Código repetido en 2 productos -> dupe:true (cuenta el más reciente y avisa)
--   - Código desconocido -> lo encola en jjp_count_unknown y devuelve kind:'nuevo'
create or replace function public.jjp_count_scan(
  p_code    text,
  p_session text default 'default',
  p_by      text default null,
  p_source  text default 'telefono'
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_id uuid; v_name text; v_sku text; v_total integer; v_cnt integer;
begin
  p_code := trim(coalesce(p_code, ''));
  if p_code = '' then
    return jsonb_build_object('ok', false, 'kind', 'vacio');
  end if;

  select count(*) into v_cnt from public.jjp_product_variants
   where barcode = p_code and active is not false;

  select v.id, p.name, v.sku into v_id, v_name, v_sku
    from public.jjp_product_variants v
    join public.jjp_products p on p.id = v.product_id
   where v.barcode = p_code and v.active is not false
   order by v.updated_at desc nulls last
   limit 1;

  if v_id is null then
    insert into public.jjp_count_unknown (owner_id, session_key, code, device, seen)
    values (auth.uid(), p_session, p_code, p_by, 1)
    on conflict (owner_id, session_key, code) do update
      set seen        = public.jjp_count_unknown.seen + 1,
          last_at     = now(),
          resolved_at = null,
          device      = coalesce(excluded.device, public.jjp_count_unknown.device);
    return jsonb_build_object('ok', false, 'kind', 'nuevo', 'code', p_code);
  end if;

  insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
  values (auth.uid(), p_session, v_id, 1)
  on conflict (owner_id, session_key, variant_id) do update
    set counted = public.jjp_count_tally.counted + 1, updated_at = now()
  returning counted into v_total;

  update public.jjp_product_variants set stock = v_total where id = v_id;

  insert into public.jjp_count_log (session_key, variant_id, delta, counted_after, source, counted_by, note)
  values (p_session, v_id, 1, v_total, coalesce(p_source, 'telefono'), p_by,
          case when v_cnt > 1 then 'código compartido por varios productos' else null end);

  return jsonb_build_object('ok', true, 'kind', 'contado', 'name', v_name,
    'sku', v_sku, 'counted', v_total, 'variant_id', v_id, 'dupe', v_cnt > 1);
end $$;

grant execute on function public.jjp_count_scan(text, text, text, text) to authenticated;

-- Marcar un desconocido como resuelto (al vincularlo o crearlo)
create or replace function public.jjp_count_unknown_resolve(
  p_code    text,
  p_session text default 'default'
) returns boolean
language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  update public.jjp_count_unknown
     set resolved_at = now()
   where owner_id = auth.uid() and session_key = p_session and code = trim(p_code);
  return true;
end $$;

grant execute on function public.jjp_count_unknown_resolve(text, text) to authenticated;

-- ---------- 5. Bitácora legible: agrega quién contó ----------
-- Se dropea antes de recrear: al insertar counted_by cambia el orden de
-- columnas y "create or replace view" no permite reordenar/renombrar.
drop view if exists public.jjp_count_log_view;
create or replace view public.jjp_count_log_view
with (security_invoker = on) as
  select l.id, l.session_key, l.variant_id, l.delta, l.counted_after,
         l.source, l.counted_by, l.note, l.reverts, l.reverted_by, l.created_at,
         p.name  as product_name,
         b.name  as brand_name,
         v.variant_name, v.sku
  from public.jjp_count_log l
  left join public.jjp_product_variants v on v.id = l.variant_id
  left join public.jjp_products p         on p.id = v.product_id
  left join public.jjp_brands b           on b.id = v.brand_id
  where l.owner_id = auth.uid();

grant select on public.jjp_count_log_view to authenticated;

-- ---------- 6. Cruces: misma variante contada por 2+ personas ----------
-- Suma colaborativa: no es un error, pero conviene revisar que no sea el
-- mismo estante contado dos veces. Muestra quiénes y cuánto puso cada uno.
create or replace view public.jjp_count_conflicts
with (security_invoker = on) as
  select
    l.session_key,
    l.variant_id,
    p.name  as product_name,
    v.sku,
    b.name  as brand_name,
    count(distinct l.counted_by) filter (where l.counted_by is not null) as personas,
    string_agg(distinct l.counted_by, ', ') filter (where l.counted_by is not null) as quienes,
    sum(l.delta)      as total,
    max(l.created_at) as ultimo
  from public.jjp_count_log l
  join public.jjp_product_variants v on v.id = l.variant_id
  join public.jjp_products p         on p.id = v.product_id
  left join public.jjp_brands b      on b.id = v.brand_id
  where l.owner_id = auth.uid() and l.delta > 0 and l.source <> 'historico'
  group by l.session_key, l.variant_id, p.name, v.sku, b.name
  having count(distinct l.counted_by) filter (where l.counted_by is not null) > 1;

grant select on public.jjp_count_conflicts to authenticated;

-- ---------- 7. Quién contó cuánto (avance por persona) ----------
create or replace view public.jjp_count_counters
with (security_invoker = on) as
  select
    session_key,
    coalesce(counted_by, '(sin nombre)') as quien,
    count(*)                    filter (where delta > 0) as movimientos,
    coalesce(sum(delta) filter (where delta > 0), 0)     as unidades,
    count(distinct variant_id)                            as productos,
    max(created_at)                                       as ultimo
  from public.jjp_count_log
  where owner_id = auth.uid() and source <> 'historico'
  group by session_key, counted_by;

grant select on public.jjp_count_counters to authenticated;

-- ---------- 8. Feed en vivo para la PC ----------
-- El teléfono ahora cuenta por RPC (no inserta jjp_scan_events), así que
-- la PC ya no recibe el puente. En cambio se suscribe a jjp_count_log:
-- cada INSERT trae variant_id + counted_after + counted_by → la PC refleja
-- el conteo de todos en vivo sin recargar. Idempotente.
do $$
begin
  alter publication supabase_realtime add table public.jjp_count_log;
exception when duplicate_object then null; when others then null;
end $$;

alter table public.jjp_count_log replica identity full;
