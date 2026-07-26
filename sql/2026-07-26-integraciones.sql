-- ======================================================================
-- JJ Paper — Interconexión de módulos (26-jul-2026)
--
-- Antes cada sección vivía sola: una venta no sabía de qué cotización
-- venía, una cotización no creaba cliente, y el chat de WhatsApp no
-- sabía nada de los pedidos de esa persona. Esto pone las llaves.
--
-- Arregla además tres cosas que estaban rotas en silencio:
--   1) Convertir una cotización en venta perdía el variant_id, así que
--      jjp_apply_order_stock no descontaba NADA pero igual marcaba el
--      pedido como "stock aplicado". Se vendía y el inventario no bajaba.
--   2) Los contadores del cliente se sumaban DOS veces (un trigger al
--      crear el pedido y otro al pasarlo a pagado), y el segundo comparaba
--      teléfonos con formatos distintos ('0412…' vs '58412…').
--   3) Convertir cotización estaba duplicado en admin y vendedor con
--      reglas distintas de descuento. Ahora es una sola función.
-- ======================================================================

-- ---------------------------------------------------------------- 1. Llaves
alter table public.jjp_orders add column if not exists customer_id uuid
  references public.jjp_customers(id) on delete set null;
alter table public.jjp_orders add column if not exists quote_id uuid
  references public.jjp_quotes(id) on delete set null;
alter table public.jjp_quotes add column if not exists customer_id uuid
  references public.jjp_customers(id) on delete set null;

create index if not exists jjp_orders_customer_idx on public.jjp_orders(customer_id);
create index if not exists jjp_orders_quote_idx    on public.jjp_orders(quote_id);
create index if not exists jjp_quotes_customer_idx on public.jjp_quotes(customer_id);

-- Búsqueda por teléfono (la usa el enlace de cliente y la ficha 360°)
create index if not exists jjp_customers_phone10_idx
  on public.jjp_customers ((right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10)));

-- ------------------------------------------------- 2. Cliente: buscar o crear
-- Una sola puerta para "este documento es de tal cliente". No toca contadores:
-- de eso se encarga el recálculo, que es idempotente.
create or replace function public.jjp_customer_link(
  p_name text, p_phone text, p_email text,
  p_city text default null, p_address text default null,
  p_rif text default null, p_seller uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_id    uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '');
  v_email text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if v_phone is null and v_email is null then return null; end if;

  select id into v_id from public.jjp_customers
   where (v_email is not null and lower(email) = v_email)
      or (v_phone is not null and right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = right(v_phone,10))
   order by created_at
   limit 1;

  if v_id is null then
    insert into public.jjp_customers (name, phone, email, city, address, rif, seller_id,
                                      total_orders, total_usd)
    values (coalesce(nullif(trim(p_name),''), 'Cliente'), nullif(p_phone,''), v_email,
            p_city, p_address, p_rif, p_seller, 0, 0)
    returning id into v_id;
  else
    -- Completa huecos sin pisar lo que ya estaba cargado a mano
    update public.jjp_customers set
      email      = coalesce(email, v_email),
      rif        = coalesce(rif, nullif(p_rif,'')),
      city       = coalesce(city, nullif(p_city,'')),
      address    = coalesce(address, nullif(p_address,'')),
      seller_id  = coalesce(seller_id, p_seller),
      updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end $$;

-- ------------------------------------------- 3. Contadores del cliente (recalc)
-- Recalcular en vez de sumar: pasar un pedido a pagado, devolverlo y volverlo a
-- pagar deja siempre el número correcto. Antes cada ida y vuelta inflaba el total.
create or replace function public.jjp_customer_recalc(p_customer uuid)
returns void
language sql security definer set search_path to 'public', 'pg_temp'
as $$
  update public.jjp_customers c set
    total_orders  = coalesce(s.n, 0),
    total_usd     = coalesce(s.suma, 0),
    last_order_at = s.ultima,
    updated_at    = now()
  from (
    select count(*) n, sum(total_usd) suma, max(created_at) ultima
      from public.jjp_orders
     where customer_id = p_customer
       and status in ('pagado', 'preparando', 'entregado')
  ) s
  where c.id = p_customer;
$$;

-- Al crear el documento: enlazar (y crear si hace falta) el cliente
create or replace function public.jjp_doc_link_customer()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.customer_id is null then
    new.customer_id := public.jjp_customer_link(
      new.client_name, new.phone, new.email, new.city,
      case when tg_table_name = 'jjp_orders' then new.address else null end,
      new.rif, new.seller_id);
  end if;
  return new;
end $$;

-- Tras cambiar el pedido: poner al día los totales del cliente
create or replace function public.jjp_order_touch_customer()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.customer_id is not null then perform public.jjp_customer_recalc(new.customer_id); end if;
  if tg_op = 'UPDATE' and old.customer_id is not null
     and old.customer_id is distinct from new.customer_id then
    perform public.jjp_customer_recalc(old.customer_id);
  end if;
  return null;
end $$;

drop trigger if exists jjp_orders_to_customer     on public.jjp_orders;
drop trigger if exists jjp_orders_customer_stats  on public.jjp_orders;

create trigger jjp_orders_link_customer
  before insert on public.jjp_orders
  for each row execute function public.jjp_doc_link_customer();

create trigger jjp_orders_customer_stats
  after insert or update of status, total_usd, customer_id on public.jjp_orders
  for each row execute function public.jjp_order_touch_customer();

-- Cotizar también alimenta el CRM (antes no lo hacía: cotizabas diez veces
-- a la misma persona y nunca aparecía en la lista de clientes)
drop trigger if exists jjp_quotes_link_customer on public.jjp_quotes;
create trigger jjp_quotes_link_customer
  before insert on public.jjp_quotes
  for each row execute function public.jjp_doc_link_customer();

-- Las funciones viejas quedan sin uso
drop function if exists public.jjp_order_upsert_customer();
drop function if exists public.jjp_sync_customer_stats();

-- --------------------------------------------- 4. Convertir cotización → venta
-- Única puerta. Conserva variant_id (sin él el stock no baja) y respeta la
-- regla de descuentos: el admin aprueba al convertir, el vendedor lo deja
-- pendiente. Antes esto vivía duplicado en dos archivos JS que divergieron.
create or replace function public.jjp_convert_quote(p_quote uuid)
returns public.jjp_orders
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  q          public.jjp_quotes;
  v_order    public.jjp_orders;
  v_items    jsonb;
  v_subtotal numeric := 0;
  v_rate     numeric;
  v_pct      numeric;
  v_admin    boolean := public.jjp_is_admin();
  v_total    numeric;
  v_num      text;
  v_linea    jsonb;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;

  select * into q from public.jjp_quotes where id = p_quote;
  if not found then raise exception 'La cotización no existe'; end if;
  if q.status in ('convertido','convertida','cancelado','rechazado') then
    raise exception 'Esta cotización ya está cerrada (%)', q.status;
  end if;

  -- Todas las líneas necesitan precio; si falta uno, el total sería mentira
  for v_linea in select jsonb_array_elements(coalesce(q.items,'[]'::jsonb)) loop
    if coalesce((v_linea->>'price_usd')::numeric, 0) <= 0 then
      raise exception 'La línea "%" no tiene precio', coalesce(v_linea->>'name','(sin nombre)');
    end if;
    v_subtotal := v_subtotal + (v_linea->>'price_usd')::numeric * coalesce((v_linea->>'qty')::numeric, 0);
  end loop;
  if v_subtotal <= 0 then raise exception 'La cotización está vacía'; end if;

  -- variant_id viaja al pedido (permite descontar del inventario) y sku viaja
  -- como "Código" en la factura.
  -- El alias se llama "linea" y no "it" para no chocar con la variable de arriba.
  select jsonb_agg(jsonb_build_object(
           'id',           coalesce(linea->>'product_id', linea->>'id'),
           'variant_id',   linea->>'variant_id',
           'sku',          linea->>'sku',
           'name',         linea->>'name',
           'brand',        linea->>'brand',
           'qty',          (linea->>'qty')::numeric,
           'unit',         coalesce(linea->>'unit','unid'),
           'price_usd',    (linea->>'price_usd')::numeric,
           'subtotal_usd', round((linea->>'price_usd')::numeric * (linea->>'qty')::numeric, 2)))
    into v_items
    from jsonb_array_elements(q.items) as linea;

  select coalesce(value::numeric, q.exchange_rate, 1) into v_rate
    from public.jjp_settings where key = 'exchange_rate';
  v_rate := coalesce(v_rate, q.exchange_rate, 1);

  v_pct   := coalesce(q.discount_pct, 0);
  v_total := round(v_subtotal * (1 - v_pct/100.0), 2);
  v_num   := 'JJP-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*10000))::text, 4, '0');

  insert into public.jjp_orders (
    order_number, client_name, rif, phone, email, city, address,
    items, subtotal_usd, total_usd, exchange_rate, total_bs,
    discount_pct, discount_status, discount_requested_by,
    payment_method, notes, seller_id, source, status,
    quote_id, customer_id)
  values (
    v_num, q.client_name, q.rif, q.phone, q.email, q.city, q.address,
    v_items, round(v_subtotal,2),
    case when v_pct > 0 and not v_admin then round(v_subtotal,2) else v_total end,
    v_rate,
    round((case when v_pct > 0 and not v_admin then v_subtotal else v_total end) * v_rate, 2),
    v_pct,
    case when v_pct > 0 then (case when v_admin then 'approved' else 'pending' end) else 'none' end,
    case when v_pct > 0 and not v_admin then auth.uid() else null end,
    'efectivo',
    'Generado desde cotización ' || coalesce(q.quote_number,''),
    coalesce(q.seller_id, auth.uid()), 'pos', 'pendiente_pago',
    q.id, q.customer_id)
  returning * into v_order;

  update public.jjp_quotes set status = 'convertido' where id = p_quote;
  return v_order;
end $$;

-- ------------------------------------------------- 5. Stock: dejar de mentir
-- Antes marcaba stock_applied = true aunque ninguna línea tuviera variante:
-- el inventario quedaba mal y no había forma de reintentar. Ahora informa qué
-- líneas no pudo tocar y solo se da por aplicado si bajó todo.
drop function if exists public.jjp_apply_order_stock(uuid);
create function public.jjp_apply_order_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  it        jsonb;
  ya        boolean;
  v_num     text;
  v_ok      int := 0;
  v_faltan  text[] := '{}';
begin
  select stock_applied, order_number into ya, v_num
    from public.jjp_orders where id = p_order_id;
  if ya is null then raise exception 'El pedido no existe'; end if;
  if ya then return jsonb_build_object('ok', true, 'aplicadas', 0, 'faltantes', '[]'::jsonb, 'ya', true); end if;

  perform set_config('jjp.move_reason', 'venta (pedido)', true);
  perform set_config('jjp.move_ref', coalesce(v_num, p_order_id::text), true);

  for it in select jsonb_array_elements(items) from public.jjp_orders where id = p_order_id loop
    if nullif(it->>'variant_id','') is not null then
      update public.jjp_product_variants
         set stock = greatest(stock - (it->>'qty')::int, 0)
       where id = (it->>'variant_id')::uuid and stock <> -1;
      v_ok := v_ok + 1;
    else
      v_faltan := v_faltan || coalesce(it->>'name', 'producto sin nombre');
    end if;
  end loop;

  -- Solo se marca aplicado si no quedó nada suelto: así el admin puede
  -- corregir las líneas y volver a intentarlo.
  if array_length(v_faltan, 1) is null then
    update public.jjp_orders set stock_applied = true where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', array_length(v_faltan,1) is null,
    'aplicadas', v_ok,
    'faltantes', to_jsonb(v_faltan),
    'ya', false);
end $$;

-- ------------------------------------ 6. Abrir chat de WhatsApp con un cliente
-- Hacía falta para "enviar catálogo" a alguien que nunca nos escribió: sin
-- chat no hay dónde encolar el mensaje. Crea el chat vacío del vendedor que
-- llama y lo enlaza al cliente del CRM si existe.
create or replace function public.jjp_wa_ensure_chat(p_phone text, p_name text default null)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_owner  uuid := auth.uid();
  v_d      text;
  v_norm   text;
  v_jid    text;
  v_id     uuid;
  v_cust   uuid;
  v_nombre text;
begin
  if v_owner is null then raise exception 'Sin sesión'; end if;
  if not exists (select 1 from public.jjp_profiles where id = v_owner and active) then
    raise exception 'Perfil inactivo';
  end if;

  -- Misma normalización venezolana que assets/js/wa/wa-common.js y phone.js
  v_d := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  if    length(v_d) = 12 and left(v_d,2) = '58'                     then v_norm := v_d;
  elsif length(v_d) = 11 and left(v_d,1) = '0'                      then v_norm := '58' || substr(v_d,2);
  elsif length(v_d) = 10 and left(v_d,1) in ('2','4')               then v_norm := '58' || v_d;
  else  v_norm := v_d;
  end if;
  if length(v_norm) < 10 then raise exception 'Teléfono inválido: %', coalesce(p_phone,''); end if;

  v_jid := v_norm || '@s.whatsapp.net';

  select id into v_id from public.jjp_wa_chats
   where owner_id = v_owner and jid = v_jid;
  if v_id is not null then return v_id; end if;

  select id, name into v_cust, v_nombre from public.jjp_customers
   where right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = right(v_norm,10)
   order by created_at limit 1;

  insert into public.jjp_wa_chats (owner_id, jid, phone, customer_id, display_name)
  values (v_owner, v_jid, v_norm, v_cust,
          coalesce(nullif(trim(p_name),''), v_nombre, v_norm))
  on conflict (owner_id, jid) do update set updated_at = now()
  returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------- 7. Ficha 360° del cliente
-- Lo que el vendedor necesita ver sin salir del chat o del correo.
create or replace function public.jjp_customer_360(p_customer uuid)
returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'cliente', (select to_jsonb(c) from public.jjp_customers c where c.id = p_customer),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'numero', o.order_number, 'fecha', o.created_at,
               'total_usd', o.total_usd, 'estado', o.status, 'items', jsonb_array_length(coalesce(o.items,'[]'::jsonb)))
             order by o.created_at desc)
        from (select * from public.jjp_orders where customer_id = p_customer
               order by created_at desc limit 10) o), '[]'::jsonb),
    'cotizaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'numero', q.quote_number, 'fecha', q.created_at,
               'total_usd', q.estimated_total_usd, 'estado', q.status)
             order by q.created_at desc)
        from (select * from public.jjp_quotes where customer_id = p_customer
               order by created_at desc limit 10) q), '[]'::jsonb)
  );
$$;

-- --------------------------------------------------------------- 8. Permisos
revoke all on function public.jjp_customer_link(text,text,text,text,text,text,uuid) from public, anon;
revoke all on function public.jjp_customer_recalc(uuid)      from public, anon;
revoke all on function public.jjp_convert_quote(uuid)        from public, anon;
revoke all on function public.jjp_apply_order_stock(uuid)    from public, anon;
revoke all on function public.jjp_wa_ensure_chat(text,text)  from public, anon;
revoke all on function public.jjp_customer_360(uuid)         from public, anon;

grant execute on function public.jjp_convert_quote(uuid)       to authenticated;
grant execute on function public.jjp_apply_order_stock(uuid)   to authenticated;
grant execute on function public.jjp_wa_ensure_chat(text,text) to authenticated;
grant execute on function public.jjp_customer_360(uuid)        to authenticated;

-- ------------------------------------------- 9. Enlazar lo que ya está cargado
update public.jjp_quotes q
   set customer_id = public.jjp_customer_link(q.client_name, q.phone, q.email, q.city, null, q.rif, q.seller_id)
 where q.customer_id is null;

update public.jjp_orders o
   set customer_id = public.jjp_customer_link(o.client_name, o.phone, o.email, o.city, o.address, o.rif, o.seller_id)
 where o.customer_id is null;

-- Pedidos que nacieron de una cotización (se reconocen por la nota)
update public.jjp_orders o
   set quote_id = q.id
  from public.jjp_quotes q
 where o.quote_id is null
   and q.quote_number is not null
   and o.notes = 'Generado desde cotización ' || q.quote_number;

-- Chats de WhatsApp sin cliente enlazado
update public.jjp_wa_chats ch
   set customer_id = c.id
  from public.jjp_customers c
 where ch.customer_id is null
   and right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) = right(coalesce(ch.phone,''),10);

-- Totales al día (corrige el doble conteo que dejaron los triggers viejos)
select public.jjp_customer_recalc(id) from public.jjp_customers;
