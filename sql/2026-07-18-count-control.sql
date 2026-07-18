-- ============================================================
-- JJ Paper — Control del conteo: auditoría de códigos + valorización
--
-- Durante el inventario se cruzan códigos: se escanea el código del
-- producto A y se vincula al producto B. Hasta ahora eso no dejaba
-- rastro, así que no había forma de saber qué se vinculó ni deshacerlo.
--
-- Aditivo. Idempotente. No borra ni modifica datos existentes.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Bitácora de códigos de barras ----------
create table if not exists public.jjp_barcode_log (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid references public.jjp_product_variants(id) on delete set null,
  code        text,
  prev_code   text,                                   -- lo que tenía antes (para deshacer)
  action      text not null default 'vincular',       -- vincular | desvincular | mover
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists jjp_barcode_log_recent_idx
  on public.jjp_barcode_log (created_at desc);

alter table public.jjp_barcode_log enable row level security;

drop policy if exists jjp_barcode_log_all on public.jjp_barcode_log;
create policy jjp_barcode_log_all on public.jjp_barcode_log for all to authenticated
  using (public.jjp_is_admin() or created_by = auth.uid())
  with check (public.jjp_is_admin() or created_by = auth.uid());

-- ---------- 2. Asignar un código dejando rastro ----------
-- Si el código ya estaba en otra variante, se lo quita a la anterior
-- (un código de barras sólo puede apuntar a un producto) y lo registra.
create or replace function public.jjp_barcode_assign(
  p_variant_id uuid,
  p_code       text,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_prev   text;
  v_stolen uuid;
begin
  select barcode into v_prev from public.jjp_product_variants where id = p_variant_id;

  -- ¿Alguien más tiene este código? Se lo quitamos y queda registrado.
  select id into v_stolen from public.jjp_product_variants
   where barcode = p_code and id <> p_variant_id limit 1;

  if v_stolen is not null then
    update public.jjp_product_variants set barcode = null where id = v_stolen;
    insert into public.jjp_barcode_log (variant_id, code, prev_code, action, note)
    values (v_stolen, null, p_code, 'desvincular', 'reasignado a otro producto');
  end if;

  update public.jjp_product_variants set barcode = p_code where id = p_variant_id;

  insert into public.jjp_barcode_log (variant_id, code, prev_code, action, note)
  values (p_variant_id, p_code, v_prev, 'vincular', p_note);

  return jsonb_build_object('ok', true, 'prev', v_prev, 'stolen_from', v_stolen);
end $$;

-- Quitar el código de una variante (dejando rastro para deshacer)
create or replace function public.jjp_barcode_clear(p_variant_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_prev text;
begin
  select barcode into v_prev from public.jjp_product_variants where id = p_variant_id;
  update public.jjp_product_variants set barcode = null where id = p_variant_id;
  insert into public.jjp_barcode_log (variant_id, code, prev_code, action)
  values (p_variant_id, null, v_prev, 'desvincular');
  return jsonb_build_object('ok', true, 'prev', v_prev);
end $$;

grant execute on function public.jjp_barcode_assign(uuid, text, text) to authenticated;
grant execute on function public.jjp_barcode_clear(uuid)              to authenticated;

-- ---------- 3. Quitar un producto del conteo ----------
-- Distinto de poner 0: "0 contadas" es un dato (no hay existencias),
-- mientras que quitarlo del conteo lo devuelve a "sin contar" (stock -1).
create or replace function public.jjp_count_remove(
  p_variant_id uuid,
  p_session    text default 'default'
) returns boolean
language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  delete from public.jjp_count_tally
   where owner_id = auth.uid() and session_key = p_session and variant_id = p_variant_id;
  update public.jjp_product_variants set stock = -1 where id = p_variant_id;
  return true;
end $$;

grant execute on function public.jjp_count_remove(uuid, text) to authenticated;

-- ---------- 4. Vista valorizada del conteo ----------
-- Todo lo contado con su costo y su precio de venta. Los importes en Bs
-- los calcula el front con la tasa BCV viva; aquí sólo van los USD.
create or replace view public.jjp_count_valued
with (security_invoker = on) as
  select
    t.variant_id,
    t.session_key,
    t.counted,
    t.updated_at,
    p.name                                   as product_name,
    b.name                                   as brand_name,
    v.variant_name,
    v.sku,
    v.barcode,
    v.cost_usd,
    v.price_usd,
    (t.counted * coalesce(v.cost_usd, 0))    as costo_total_usd,
    (t.counted * v.price_usd)                as venta_total_usd
  from public.jjp_count_tally t
  join public.jjp_product_variants v on v.id = t.variant_id
  join public.jjp_products p         on p.id = v.product_id
  left join public.jjp_brands b      on b.id = v.brand_id
  where t.owner_id = auth.uid();

grant select on public.jjp_count_valued to authenticated;

-- ---------- 5. Detector de cruces ----------
-- Códigos repartidos en más de un producto: un escaneo cuenta el que no es.
create or replace view public.jjp_barcode_dupes
with (security_invoker = on) as
  select v.barcode, count(*) as veces,
         string_agg(p.name || ' [' || coalesce(v.sku, '?') || ']', ' | ') as productos
  from public.jjp_product_variants v
  join public.jjp_products p on p.id = v.product_id
  where v.barcode is not null and v.barcode <> ''
  group by v.barcode
  having count(*) > 1;

grant select on public.jjp_barcode_dupes to authenticated;
