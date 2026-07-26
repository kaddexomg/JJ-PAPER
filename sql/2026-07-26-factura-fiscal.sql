-- ======================================================================
-- JJ Paper — Factura con formato fiscal (26-jul-2026)
--
-- El documento NO es una factura fiscal y lo sigue diciendo en el pie:
-- lo que cambia es la forma, para que el cliente reciba algo con el
-- aspecto formal al que está acostumbrado.
--
-- Lo único que hace falta en la base es el Nº de Control: el correlativo
-- que en Venezuela distingue a una factura del número interno de pedido.
-- Va aparte, no se salta y no se repite.
-- ======================================================================

create sequence if not exists public.jjp_control_seq start 1;

alter table public.jjp_orders add column if not exists control_number text;
create unique index if not exists jjp_orders_control_idx
  on public.jjp_orders(control_number) where control_number is not null;

-- Serie configurable desde Ajustes (por defecto '00', el formato clásico)
insert into public.jjp_settings (key, value)
values ('doc_control_serie', '00')
on conflict (key) do nothing;

create or replace function public.jjp_order_control_number()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_serie text;
begin
  if new.control_number is not null then return new; end if;
  select coalesce(nullif(value,''), '00') into v_serie
    from public.jjp_settings where key = 'doc_control_serie';
  new.control_number := coalesce(v_serie,'00') || '-' ||
                        lpad(nextval('public.jjp_control_seq')::text, 8, '0');
  return new;
end $$;

drop trigger if exists jjp_orders_control on public.jjp_orders;
create trigger jjp_orders_control
  before insert on public.jjp_orders
  for each row execute function public.jjp_order_control_number();

-- Los pedidos que ya existen reciben su correlativo por orden de creación
do $$
declare r record; v_serie text;
begin
  select coalesce(nullif(value,''), '00') into v_serie from public.jjp_settings where key='doc_control_serie';
  for r in select id from public.jjp_orders where control_number is null order by created_at loop
    update public.jjp_orders
       set control_number = coalesce(v_serie,'00') || '-' || lpad(nextval('public.jjp_control_seq')::text, 8, '0')
     where id = r.id;
  end loop;
end $$;

-- Alícuota general vigente (el ajuste estaba en 5%). Los precios de lista
-- YA incluyen el impuesto: la factura lo desglosa hacia atrás, así que el
-- cliente paga exactamente lo mismo que antes.
update public.jjp_settings set value = '16', updated_at = now() where key = 'iva_pct';
