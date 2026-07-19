-- ============================================================
-- JJ Paper — Subida masiva del conteo (modo offline / LAN)
--
-- El servidor local (wa-server) bufferiza los escaneos hechos sin
-- internet y, al reconectar, los empuja TODOS de una con esta función.
-- Aplica cada delta al acumulado compartido, refleja el stock y deja
-- rastro en la bitácora (source='lan', counted_by = quién contó).
--
-- Seguridad: si la llama un usuario normal (no admin), se ignora p_owner
-- y se usa su propio auth.uid() (no puede escribir el conteo de otro).
-- El wa-server la llama con service_role (auth.uid() nulo) y p_owner
-- explícito = la cuenta compartida del inventario.
--
-- Aditivo. Idempotente. Base: oeiuczltgdexwjjgquyq.
-- ============================================================

create or replace function public.jjp_count_apply_batch(
  p_owner   uuid,
  p_session text,
  p_by      text,
  p_items   jsonb          -- [{ "v": "<variant uuid>", "d": <int> }, ...]
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_owner   uuid;
  v_item    jsonb;
  v_id      uuid;
  v_delta   integer;
  v_total   integer;
  v_applied integer := 0;
  v_totals  jsonb := '{}'::jsonb;
begin
  -- Un usuario normal sólo puede tocar su propio conteo
  if auth.uid() is not null and not public.jjp_is_admin() then
    v_owner := auth.uid();
  else
    v_owner := coalesce(p_owner, auth.uid());
  end if;
  if v_owner is null then raise exception 'Falta el dueño del conteo'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id    := (v_item->>'v')::uuid;
    v_delta := coalesce((v_item->>'d')::integer, 0);
    if v_id is null or v_delta = 0 then continue; end if;

    insert into public.jjp_count_tally (owner_id, session_key, variant_id, counted)
    values (v_owner, p_session, v_id, greatest(0, v_delta))
    on conflict (owner_id, session_key, variant_id) do update
      set counted    = greatest(0, public.jjp_count_tally.counted + v_delta),
          updated_at = now()
    returning counted into v_total;

    update public.jjp_product_variants set stock = v_total where id = v_id;

    insert into public.jjp_count_log (owner_id, session_key, variant_id, delta, counted_after, source, counted_by, note)
    values (v_owner, p_session, v_id, v_delta, v_total, 'lan', p_by, 'sincronizado offline');

    v_applied := v_applied + 1;
    v_totals  := v_totals || jsonb_build_object(v_id::text, v_total);
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'totals', v_totals);
end $$;

grant execute on function public.jjp_count_apply_batch(uuid, text, text, jsonb) to authenticated, service_role;

-- Resolver muchos códigos de una (para que el servidor local arme su catálogo
-- de barras -> variante en un solo viaje). Devuelve sólo lo esencial.
create or replace function public.jjp_count_catalog(p_only_active boolean default true)
returns table (
  variant_id uuid, barcode text, sku text, product_name text,
  brand_name text, category_name text, emoji text, image_url text,
  price_usd numeric, counted integer
)
language sql security definer set search_path to 'public','pg_temp' as $$
  select v.id, v.barcode, v.sku, p.name, b.name,
         c.name, coalesce(p.emoji, '📦'), p.image_url, v.price_usd,
         coalesce(t.counted, -1)
  from public.jjp_product_variants v
  join public.jjp_products p        on p.id = v.product_id
  left join public.jjp_brands b     on b.id = v.brand_id
  left join public.jjp_categories c on c.id = p.category_id
  left join public.jjp_count_tally t on t.variant_id = v.id and t.session_key = 'default'
  where (not p_only_active) or (v.active is not false and p.active is not false);
$$;

grant execute on function public.jjp_count_catalog(boolean) to authenticated, service_role;
