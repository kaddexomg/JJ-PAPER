-- ======================================================
-- Kardex de inventario (jjp_stock_moves)
-- Aplicado en Supabase el 2026-07-16 (migración stock_moves_kardex).
-- - Registra TODO cambio de stock con razón y referencia.
-- - jjp_set_stock(variant, stock, razón): ajuste con razón (RLS staff).
-- - jjp_apply/revert_order_stock ahora dejan rastro con el nº de pedido
--   y una venta ya no puede dejar stock en -1 ("sin control").
-- ======================================================
create table if not exists public.jjp_stock_moves (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid references public.jjp_product_variants(id) on delete set null,
  product_name  text,
  brand_name    text,
  variant_name  text,
  sku           text,
  delta         int not null default 0,
  stock_before  int,
  stock_after   int,
  reason        text not null default 'ajuste manual',
  ref           text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists jjp_stock_moves_variant_idx on public.jjp_stock_moves(variant_id, created_at desc);
create index if not exists jjp_stock_moves_created_idx on public.jjp_stock_moves(created_at desc);

alter table public.jjp_stock_moves enable row level security;
-- Solo lectura para staff; los inserts entran únicamente por el trigger (security definer)
create policy jjp_stock_moves_sel on public.jjp_stock_moves for select to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));

-- Trigger: cada cambio de stock queda registrado con razón/referencia
-- (la razón viaja en set_config('jjp.move_reason') dentro de la misma transacción)
create or replace function public.jjp_log_stock_move()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_reason text; v_ref text; v_pname text; v_bname text;
begin
  v_reason := coalesce(nullif(current_setting('jjp.move_reason', true), ''), 'ajuste manual');
  v_ref    := nullif(current_setting('jjp.move_ref', true), '');
  select name into v_pname from public.jjp_products where id = new.product_id;
  select name into v_bname from public.jjp_brands   where id = new.brand_id;
  insert into public.jjp_stock_moves
    (variant_id, product_name, brand_name, variant_name, sku, delta, stock_before, stock_after, reason, ref)
  values
    (new.id, v_pname, v_bname, new.variant_name, new.sku,
     case when old.stock < 0 or new.stock < 0 then 0 else new.stock - old.stock end,
     old.stock, new.stock, v_reason, v_ref);
  return new;
end $$;

drop trigger if exists jjp_variants_stock_log on public.jjp_product_variants;
create trigger jjp_variants_stock_log
  after update on public.jjp_product_variants
  for each row when (old.stock is distinct from new.stock)
  execute function public.jjp_log_stock_move();

-- RPC: fijar stock con razón (respeta RLS del staff — security invoker)
create or replace function public.jjp_set_stock(
  p_variant_id uuid, p_stock int,
  p_reason text default 'ajuste manual', p_ref text default null)
returns int language plpgsql security invoker set search_path to 'public','pg_temp' as $$
begin
  perform set_config('jjp.move_reason', coalesce(p_reason, 'ajuste manual'), true);
  perform set_config('jjp.move_ref', coalesce(p_ref, ''), true);
  update public.jjp_product_variants set stock = p_stock where id = p_variant_id;
  return p_stock;
end $$;

-- Pedidos: descuento/reverso de stock ahora queda en el kardex con el número de pedido.
-- Fix: una venta ya no puede dejar el stock en -1 (que significa "sin control").
create or replace function public.jjp_apply_order_stock(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare it jsonb; already boolean; v_num text;
begin
  select stock_applied, order_number into already, v_num from public.jjp_orders where id = p_order_id;
  if already then return true; end if;
  perform set_config('jjp.move_reason', 'venta (pedido)', true);
  perform set_config('jjp.move_ref', coalesce(v_num, p_order_id::text), true);
  for it in select jsonb_array_elements(items) from public.jjp_orders where id = p_order_id loop
    if (it->>'variant_id') is not null then
      update public.jjp_product_variants
         set stock = greatest(stock - (it->>'qty')::int, 0)
       where id = (it->>'variant_id')::uuid and stock <> -1;
    end if;
  end loop;
  update public.jjp_orders set stock_applied = true where id = p_order_id;
  return true;
end $$;

create or replace function public.jjp_revert_order_stock(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare it jsonb; already boolean; v_num text;
begin
  select stock_applied, order_number into already, v_num from public.jjp_orders where id = p_order_id;
  if not already then return true; end if;
  perform set_config('jjp.move_reason', 'reverso de pedido', true);
  perform set_config('jjp.move_ref', coalesce(v_num, p_order_id::text), true);
  for it in select jsonb_array_elements(items) from public.jjp_orders where id = p_order_id loop
    if (it->>'variant_id') is not null then
      update public.jjp_product_variants
         set stock = stock + (it->>'qty')::int
       where id = (it->>'variant_id')::uuid and stock <> -1;
    end if;
  end loop;
  update public.jjp_orders set stock_applied = false where id = p_order_id;
  return true;
end $$;
