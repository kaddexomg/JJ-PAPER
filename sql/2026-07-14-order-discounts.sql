-- ============================================================
-- JJ Paper — Descuentos con aprobación del administrador
-- Regla de negocio: el vendedor PROPONE un descuento en el pedido/factura,
-- pero NO se aplica hasta que un ADMIN lo aprueba. Candado real en la base:
-- un no-admin no puede auto-aprobar ni cobrar con descuento sin aprobación.
-- Aditivo. Idempotente. Aplicar sobre oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Columnas de descuento en jjp_orders ----------
-- (discount_pct ya existe en el schema base)
alter table public.jjp_orders
  add column if not exists discount_status       text not null default 'none',
  add column if not exists discount_note         text,
  add column if not exists discount_requested_by uuid references public.jjp_profiles(id) on delete set null,
  add column if not exists discount_approved_by  uuid references public.jjp_profiles(id) on delete set null,
  add column if not exists discount_decided_at   timestamptz;

-- check del estado (drop+create para ser idempotente ante cambios)
alter table public.jjp_orders drop constraint if exists jjp_orders_discount_status_chk;
alter table public.jjp_orders add constraint jjp_orders_discount_status_chk
  check (discount_status in ('none','pending','approved','rejected'));

-- ---------- 2. Candado (BEFORE): no-admin no aprueba ni pre-descuenta ----------
create or replace function public.jjp_orders_discount_guard()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not public.jjp_is_admin() then
    -- un vendedor no puede marcar un descuento como aprobado
    if NEW.discount_status = 'approved'
       and (TG_OP = 'INSERT' or OLD.discount_status is distinct from 'approved') then
      raise exception 'Solo un administrador puede aprobar descuentos';
    end if;
    -- si pide descuento y no está aprobado, se cobra a precio lleno hasta la aprobación
    if coalesce(NEW.discount_pct, 0) > 0 and NEW.discount_status <> 'approved' then
      NEW.discount_status := 'pending';
      NEW.total_usd := NEW.subtotal_usd;
      NEW.total_bs  := round(coalesce(NEW.subtotal_usd, 0) * coalesce(NEW.exchange_rate, 0), 2);
      if NEW.discount_requested_by is null then
        NEW.discount_requested_by := auth.uid();
      end if;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists jjp_orders_discount_guard_trg on public.jjp_orders;
create trigger jjp_orders_discount_guard_trg
  before insert or update on public.jjp_orders
  for each row execute function public.jjp_orders_discount_guard();

-- ---------- 3. Notificación a admins cuando queda pendiente (AFTER) ----------
create or replace function public.jjp_orders_discount_notify()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if NEW.discount_status = 'pending'
     and (TG_OP = 'INSERT' or OLD.discount_status is distinct from 'pending') then
    insert into public.jjp_notifications (user_id, type, title, body, link)
    values (null, 'discount', 'Descuento por aprobar',
            'Pedido ' || NEW.order_number || ' solicita ' || coalesce(NEW.discount_pct,0)::text || '% de descuento',
            '/admin/pedidos.html');
  end if;
  return NEW;
end $$;

drop trigger if exists jjp_orders_discount_notify_trg on public.jjp_orders;
create trigger jjp_orders_discount_notify_trg
  after insert or update on public.jjp_orders
  for each row execute function public.jjp_orders_discount_notify();

-- ---------- 4. RPC de decisión (SOLO admin) ----------
-- Aprueba: recalcula totales con el descuento. Rechaza: descuento a 0, precio lleno.
create or replace function public.jjp_decide_discount(p_order uuid, p_approve boolean)
returns public.jjp_orders
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_row public.jjp_orders;
begin
  if not public.jjp_is_admin() then
    raise exception 'Solo un administrador puede decidir descuentos';
  end if;

  select * into v_row from public.jjp_orders where id = p_order and discount_status = 'pending';
  if not found then
    raise exception 'El pedido no existe o no tiene un descuento pendiente';
  end if;

  if p_approve then
    update public.jjp_orders set
      discount_status   = 'approved',
      total_usd         = round(subtotal_usd * (1 - discount_pct/100.0), 2),
      total_bs          = round(subtotal_usd * (1 - discount_pct/100.0) * coalesce(exchange_rate,0), 2),
      discount_approved_by = auth.uid(),
      discount_decided_at  = now(),
      updated_at        = now()
    where id = p_order returning * into v_row;
  else
    update public.jjp_orders set
      discount_status   = 'rejected',
      discount_pct      = 0,
      total_usd         = subtotal_usd,
      total_bs          = round(subtotal_usd * coalesce(exchange_rate,0), 2),
      discount_approved_by = auth.uid(),
      discount_decided_at  = now(),
      updated_at        = now()
    where id = p_order returning * into v_row;
  end if;

  -- Avisar al vendedor que pidió el descuento
  if v_row.discount_requested_by is not null then
    insert into public.jjp_notifications (user_id, type, title, body, link)
    values (v_row.discount_requested_by, 'discount',
            case when p_approve then 'Descuento aprobado ✅' else 'Descuento rechazado ✕' end,
            'Pedido ' || v_row.order_number ||
              case when p_approve then ' — ' || v_row.discount_pct::text || '% aplicado' else ' — se cobra a precio lleno' end,
            '/vendedor/pedidos.html');
  end if;

  return v_row;
end $$;

revoke execute on function public.jjp_decide_discount(uuid, boolean) from public, anon;
grant execute on function public.jjp_decide_discount(uuid, boolean) to authenticated;
