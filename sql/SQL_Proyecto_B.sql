

-- =========================================
-- FILE: 2026-07-13-rebuild-base-schema.sql
-- =========================================
-- ======================================================
-- JJ Paper — RECONSTRUCCION COMPLETA DE BASE DE DATOS (13-jul-2026)
-- Motivo: proyecto original (drojfbytyhjgivdddxkw) quedó atascado en
-- estado PAUSING por bug conocido de OrioleDB, soporte gratuito sin
-- respuesta 24h+. Reconstruido 100% por ingeniería inversa del código
-- frontend (assets/js/**, wa-server/src/**) — no es copia de datos,
-- es la MISMA ESTRUCTURA recreada desde cero en proyecto nuevo.
-- Aplicar en orden: este archivo -> 2026-07-automations.sql ->
-- 2026-07-whatsapp-crm.sql (ambos ya eran aditivos y siguen sirviendo tal cual).
-- ======================================================

-- ---------- Helpers ----------
create or replace function public.jjp_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- 1. Settings (key/value) ----------
create table public.jjp_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ---------- 2. Catálogo: categorías, marcas, unidades ----------
create table public.jjp_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  emoji      text,
  color      text,
  sort_order int not null default 0
);

create table public.jjp_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  logo_url   text,
  country    text,
  active     boolean not null default true,
  sort_order int not null default 0
);

create table public.jjp_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  abbr        text,
  description text,
  sort_order  int not null default 0
);

-- ---------- 3. Perfiles de staff (admin / vendedor) ----------
create table public.jjp_profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text,
  phone            text,
  role             text not null default 'vendedor' check (role in ('admin','vendedor')),
  active           boolean not null default false,
  ref_code         text unique,
  commission_pct   numeric not null default 0,
  max_discount_pct numeric not null default 0,
  monthly_goal_usd numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger jjp_profiles_updated before update on public.jjp_profiles
  for each row execute function public.jjp_set_updated_at();

create or replace function public.jjp_is_admin()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
  select exists (select 1 from public.jjp_profiles where id = auth.uid() and role = 'admin' and active);
$$;

-- Auto-crea perfil inactivo al registrar un usuario (admin lo completa/activa)
create or replace function public.jjp_handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  insert into public.jjp_profiles (id, name, role, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'name',''),
          coalesce(new.raw_user_meta_data->>'role','vendedor'), false)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger jjp_on_auth_user_created after insert on auth.users
  for each row execute function public.jjp_handle_new_user();

-- Límite de 4 admins activos + anti-lockout (siempre queda >=1 admin activo)
create or replace function public.jjp_admin_limit()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare admin_count int;
begin
  if (tg_op = 'UPDATE' or tg_op = 'INSERT') and new.role = 'admin' and new.active then
    select count(*) into admin_count from public.jjp_profiles
      where role = 'admin' and active and id <> new.id;
    if admin_count >= 4 then
      raise exception 'Máximo 4 administradores activos permitidos';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active) then
    select count(*) into admin_count from public.jjp_profiles
      where role = 'admin' and active and id <> old.id;
    if admin_count = 0 then
      raise exception 'Debe quedar al menos un administrador activo';
    end if;
  end if;
  return new;
end $$;

create trigger jjp_profiles_admin_limit before insert or update on public.jjp_profiles
  for each row execute function public.jjp_admin_limit();

-- ---------- 4. Productos + variantes por marca ----------
create table public.jjp_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price_usd   numeric not null default 0,
  cost_usd    numeric,
  unit        text,
  unit_id     uuid ,
  emoji       text,
  image_url   text,
  tag         text,
  active      boolean not null default true,
  featured    boolean not null default false,
  stock       int not null default -1,
  min_qty     int not null default 1,
  category_id uuid ,
  brand_id    uuid ,
  sku         text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.jjp_product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null ,
  brand_id     uuid ,
  variant_name text,
  sku          text,
  barcode      text,
  cost_usd     numeric,
  price_usd    numeric not null default 0,
  margin_pct   numeric,
  stock        int not null default -1,
  min_qty      int not null default 1,
  active       boolean not null default true,
  sort_order   int not null default 0,
  image_url    text,
  created_at   timestamptz not null default now()
);

create unique index jjp_variants_dedup on public.jjp_product_variants
  (product_id, coalesce(brand_id,'00000000-0000-0000-0000-000000000000'::uuid), coalesce(variant_name,''));

-- Resumen en el producto padre (stock/price_usd) recalculado desde variantes activas
create or replace function public.jjp_sync_product_summary()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  pid uuid := coalesce(new.product_id, old.product_id);
  v_stock int; v_price numeric;
begin
  select case when bool_or(stock = -1) then -1 else coalesce(sum(stock),0) end,
         min(price_usd)
    into v_stock, v_price
    from public.jjp_product_variants where product_id = pid and active;
  update public.jjp_products
     set stock = coalesce(v_stock,-1), price_usd = coalesce(v_price, price_usd)
   where id = pid;
  return null;
end $$;

create trigger jjp_variants_sync after insert or update or delete on public.jjp_product_variants
  for each row execute function public.jjp_sync_product_summary();

revoke select (cost_usd) on public.jjp_products from anon;
revoke select (cost_usd, margin_pct) on public.jjp_product_variants from anon;

-- ---------- 5. Clientes (CRM) ----------
create table public.jjp_customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text unique,
  rif           text,
  city          text,
  email         text,
  address       text,
  notes         text,
  seller_id     uuid ,
  total_orders  int not null default 0,
  total_usd     numeric not null default 0,
  last_order_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger jjp_customers_updated before update on public.jjp_customers
  for each row execute function public.jjp_set_updated_at();

-- ---------- 6. Pedidos ----------
create table public.jjp_orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text unique not null,
  client_name     text not null,
  rif             text,
  phone           text,
  email           text,
  city            text,
  address         text,
  items           jsonb not null default '[]',
  subtotal_usd    numeric not null default 0,
  total_usd       numeric not null default 0,
  exchange_rate   numeric,
  total_bs        numeric,
  payment_method  text check (payment_method in ('pago_movil','transferencia','efectivo')),
  payment_ref     text,
  notes           text,
  receipt_url     text,
  status          text not null default 'pendiente_pago'
                  check (status in ('pendiente_pago','verificando','pagado','preparando','entregado','rechazado','cancelado')),
  seller_id       uuid ,
  source          text not null default 'web' check (source in ('web','pos','ref')),
  discount_pct    numeric,
  stock_applied   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger jjp_orders_updated before update on public.jjp_orders
  for each row execute function public.jjp_set_updated_at();

-- Mantiene agregados de jjp_customers al confirmar pedidos
create or replace function public.jjp_sync_customer_stats()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if new.status = 'pagado' and (tg_op = 'INSERT' or old.status <> 'pagado') and new.phone is not null then
    update public.jjp_customers
       set total_orders = total_orders + 1,
           total_usd     = total_usd + coalesce(new.total_usd,0),
           last_order_at = now()
     where phone = new.phone;
  end if;
  return new;
end $$;

create trigger jjp_orders_customer_stats after insert or update on public.jjp_orders
  for each row execute function public.jjp_sync_customer_stats();

-- ---------- 7. Cotizaciones ----------
create table public.jjp_quotes (
  id                  uuid primary key default gen_random_uuid(),
  quote_number        text unique not null,
  client_name         text not null,
  rif                 text,
  phone               text,
  email               text,
  city                text,
  address             text,
  items               jsonb not null default '[]',
  estimated_total_usd numeric,
  exchange_rate       numeric,
  notes               text,
  status              text not null default 'pendiente'
                      check (status in ('pendiente','contactado','confirmado','convertido','convertida',
                                        'cerrado','cerrada','rechazado','cancelado')),
  source              text not null default 'web' check (source in ('web','chat','vendedor')),
  seller_id           uuid ,
  created_at          timestamptz not null default now()
);

-- ---------- 8. Reseñas ----------
create table public.jjp_reviews (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  stars      int not null check (stars between 1 and 5),
  text       text,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 9. Promociones ----------
create table public.jjp_promos (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null default 'promo' check (kind in ('promo','combo','anuncio')),
  badge         text,
  description   text,
  emoji         text,
  image_url     text,
  price_usd     numeric,
  old_price_usd numeric,
  cta_label     text,
  cta_url       text,
  wa_message    text,
  theme         text not null default 'green' check (theme in ('green','gold','red','blue','dark')),
  featured      boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger jjp_promos_updated before update on public.jjp_promos
  for each row execute function public.jjp_set_updated_at();

-- ---------- 10. Notificaciones in-app ----------
create table public.jjp_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid ,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ======================================================
-- RLS
-- ======================================================
alter table public.jjp_settings          enable row level security;
alter table public.jjp_categories        enable row level security;
alter table public.jjp_brands            enable row level security;
alter table public.jjp_units             enable row level security;
alter table public.jjp_profiles          enable row level security;
alter table public.jjp_products          enable row level security;
alter table public.jjp_product_variants  enable row level security;
alter table public.jjp_customers         enable row level security;
alter table public.jjp_orders            enable row level security;
alter table public.jjp_quotes            enable row level security;
alter table public.jjp_reviews           enable row level security;
alter table public.jjp_promos            enable row level security;
alter table public.jjp_notifications     enable row level security;

-- Catálogo público de lectura
create policy jjp_settings_sel   on public.jjp_settings   for select using (true);
create policy jjp_categories_sel on public.jjp_categories for select using (true);
create policy jjp_brands_sel     on public.jjp_brands     for select using (true);
create policy jjp_units_sel      on public.jjp_units      for select using (true);
create policy jjp_products_sel   on public.jjp_products   for select using (active or public.jjp_is_admin());
create policy jjp_variants_sel   on public.jjp_product_variants for select using (
  active or exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_reviews_sel    on public.jjp_reviews    for select using (approved or public.jjp_is_admin());
create policy jjp_promos_sel     on public.jjp_promos     for select using (active or public.jjp_is_admin());
create policy jjp_reviews_ins    on public.jjp_reviews    for insert with check (approved = false);

-- Staff (authenticated + activo) puede escribir catálogo
create policy jjp_settings_staff   on public.jjp_settings   for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_categories_staff on public.jjp_categories for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_brands_staff     on public.jjp_brands     for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_units_staff      on public.jjp_units      for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_products_staff   on public.jjp_products   for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_variants_staff   on public.jjp_product_variants for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_promos_staff     on public.jjp_promos     for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_reviews_staff    on public.jjp_reviews    for update to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());
create policy jjp_reviews_del      on public.jjp_reviews    for delete to authenticated
  using (public.jjp_is_admin());

-- Perfiles: cada quien el suyo; admin todos
create policy jjp_profiles_sel_own on public.jjp_profiles for select to authenticated
  using (id = auth.uid() or public.jjp_is_admin());
create policy jjp_profiles_upd_own on public.jjp_profiles for update to authenticated
  using (id = auth.uid() or public.jjp_is_admin())
  with check (id = auth.uid() or public.jjp_is_admin());
create policy jjp_profiles_admin_ins on public.jjp_profiles for insert to authenticated
  with check (public.jjp_is_admin());
create policy jjp_profiles_admin_del on public.jjp_profiles for delete to authenticated
  using (public.jjp_is_admin());

-- Clientes: vendedor ve los suyos + sin asignar; admin todos
create policy jjp_customers_sel on public.jjp_customers for select to authenticated
  using (seller_id = auth.uid() or seller_id is null or public.jjp_is_admin());
create policy jjp_customers_ins on public.jjp_customers for insert to authenticated
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_customers_upd on public.jjp_customers for update to authenticated
  using (seller_id = auth.uid() or seller_id is null or public.jjp_is_admin())
  with check (seller_id = auth.uid() or seller_id is null or public.jjp_is_admin());

-- Pedidos: público inserta (checkout web); vendedor ve/edita los suyos; admin todos
create policy jjp_orders_ins_public on public.jjp_orders for insert to anon, authenticated
  with check (status = 'pendiente_pago' or exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_orders_sel on public.jjp_orders for select to authenticated
  using (seller_id = auth.uid() or public.jjp_is_admin());
create policy jjp_orders_upd on public.jjp_orders for update to authenticated
  using (seller_id = auth.uid() or public.jjp_is_admin())
  with check (seller_id = auth.uid() or public.jjp_is_admin());

-- Cotizaciones: vendedor inserta/ve las suyas; admin todas; público usa RPC (security definer)
create policy jjp_quotes_sel on public.jjp_quotes for select to authenticated
  using (seller_id = auth.uid() or public.jjp_is_admin());
create policy jjp_quotes_ins on public.jjp_quotes for insert to authenticated
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));
create policy jjp_quotes_upd on public.jjp_quotes for update to authenticated
  using (seller_id = auth.uid() or public.jjp_is_admin())
  with check (seller_id = auth.uid() or public.jjp_is_admin());

-- Notificaciones: broadcast (user_id null) o propias
create policy jjp_notif_sel on public.jjp_notifications for select to authenticated
  using (user_id = auth.uid() or user_id is null);
create policy jjp_notif_upd on public.jjp_notifications for update to authenticated
  using (user_id = auth.uid() or user_id is null);

-- ======================================================
-- RPCs
-- ======================================================
create or replace function public.jjp_apply_order_stock(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare it jsonb; already boolean;
begin
  select stock_applied into already from public.jjp_orders where id = p_order_id;
  if already then return true; end if;
  for it in select jsonb_array_elements(items) from public.jjp_orders where id = p_order_id loop
    if (it->>'variant_id') is not null then
      update public.jjp_product_variants
         set stock = stock - (it->>'qty')::int
       where id = (it->>'variant_id')::uuid and stock <> -1;
    end if;
  end loop;
  update public.jjp_orders set stock_applied = true where id = p_order_id;
  return true;
end $$;

create or replace function public.jjp_revert_order_stock(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare it jsonb; already boolean;
begin
  select stock_applied into already from public.jjp_orders where id = p_order_id;
  if not already then return true; end if;
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

create or replace function public.jjp_seller_ranking(p_days int default 30)
returns table(seller_id uuid, name text, total_orders bigint, total_usd numeric)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select p.id, p.name, count(o.id), coalesce(sum(o.total_usd),0)
    from public.jjp_profiles p
    left join public.jjp_orders o on o.seller_id = p.id and o.status = 'pagado'
      and o.created_at > now() - (p_days || ' days')::interval
   where p.role = 'vendedor'
   group by p.id, p.name
   order by coalesce(sum(o.total_usd),0) desc;
$$;

create or replace function public.jjp_best_sellers(p_days int default 30, p_limit int default 10)
returns table(product_id text, name text, qty numeric)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select (it->>'id'), (it->>'name'), sum((it->>'qty')::numeric)
    from public.jjp_orders o, jsonb_array_elements(o.items) it
   where o.status = 'pagado' and o.created_at > now() - (p_days || ' days')::interval
   group by (it->>'id'), (it->>'name')
   order by sum((it->>'qty')::numeric) desc
   limit p_limit;
$$;

create or replace function public.jjp_seller_by_ref(p_code text)
returns uuid language sql stable security definer set search_path to 'public','pg_temp' as $$
  select id from public.jjp_profiles where ref_code = p_code and active and role = 'vendedor';
$$;

create or replace function public.jjp_capture_lead(p_name text, p_phone text, p_source text default 'chat', p_ref text default null)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_id uuid; v_seller uuid;
begin
  if p_ref is not null then v_seller := public.jjp_seller_by_ref(p_ref); end if;
  insert into public.jjp_customers (name, phone, seller_id, notes)
  values (p_name, p_phone, v_seller, 'origen: ' || coalesce(p_source,'chat'))
  on conflict (phone) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.jjp_create_quote(
  p_client_name text, p_phone text, p_items jsonb,
  p_rif text default null, p_city text default null, p_email text default null,
  p_notes text default null, p_source text default 'web', p_estimated_total_usd numeric default null
) returns table(quote_number text)
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_num text;
begin
  v_num := 'JJP-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*10000))::text,4,'0');
  insert into public.jjp_quotes (quote_number, client_name, phone, rif, city, email, items, notes, source, estimated_total_usd)
  values (v_num, p_client_name, p_phone, p_rif, p_city, p_email, p_items, p_notes, p_source, p_estimated_total_usd);
  return query select v_num;
end $$;

create or replace function public.jjp_track_order(p_order_number text, p_phone text)
returns setof public.jjp_orders
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select * from public.jjp_orders where order_number = p_order_number and phone = p_phone;
$$;

create or replace function public.jjp_track_quote(p_quote_number text, p_phone text)
returns setof public.jjp_quotes
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select * from public.jjp_quotes where quote_number = p_quote_number and phone = p_phone;
$$;

-- ======================================================
-- Storage buckets públicos (imágenes de producto, comprobantes de pago)
-- ======================================================
insert into storage.buckets (id, name, public) values ('jjp-products','jjp-products', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('jjp-receipts','jjp-receipts', true) on conflict (id) do nothing;

create policy jjp_products_media_read on storage.objects for select using (bucket_id = 'jjp-products');
create policy jjp_products_media_write on storage.objects for insert to authenticated with check (bucket_id = 'jjp-products');
create policy jjp_receipts_read  on storage.objects for select using (bucket_id = 'jjp-receipts');
create policy jjp_receipts_write on storage.objects for insert to anon, authenticated with check (bucket_id = 'jjp-receipts');

-- ======================================================
-- Semilla mínima para no arrancar con catálogo totalmente vacío
-- ======================================================
insert into public.jjp_settings (key, value) values
  ('exchange_rate','0'), ('usdt_rate','0'), ('default_margin_pct','30'),
  ('site_name','JJ Paper'), ('site_tagline','Distribuidora de papelería al mayor'),
  ('order_min_usd','0'), ('quote_followup_days','3'), ('reengage_days','45'), ('rate_spike_pct','5')
on conflict (key) do nothing;


-- =========================================
-- FILE: 2026-07-automations.sql
-- =========================================
-- ======================================================
-- JJ Paper — Automatizaciones nuevas (jul 2026) · ADITIVO
-- NO modifica funciones ni crons existentes (otro agente
-- trabaja en paralelo). Solo AGREGA:
--   jjp_automations_daily()   cotizaciones s/seguimiento, reseñas por aprobar,
--                             clientes inactivos (cadencia semanal por dedup 7d)
--   jjp_rate_spike_check()    alerta si BCV salta >= umbral (compara vs rate_last_seen)
--   crons: jjp-automations-daily, jjp-rate-spike-check
--   setting: rate_last_seen (semilla = exchange_rate actual)
-- Umbrales configurables: quote_followup_days=3, reengage_days=45, rate_spike_pct=5
-- ======================================================

-- ---------- 1. Cotizaciones + reseñas + clientes inactivos ----------
create or replace function public.jjp_automations_daily()
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  q_n int; q_nums text; r_n int; c_n int;
  q_days     int := coalesce((select value::int from public.jjp_settings where key='quote_followup_days'),3);
  inact_days int := coalesce((select value::int from public.jjp_settings where key='reengage_days'),45);
begin
  -- cotizaciones abiertas sin seguimiento
  select count(*), string_agg(quote_number, ', ' order by created_at) into q_n, q_nums
  from public.jjp_quotes
  where coalesce(status,'') not in
        ('confirmado','convertido','convertida','descartado','descartada',
         'cerrado','cerrada','rechazado','cancelado')
    and created_at < now() - (q_days || ' days')::interval
    and created_at > now() - interval '30 days';
  if q_n > 0 and not exists (select 1 from public.jjp_notifications
       where type='cotizacion_seguimiento' and created_at::date=current_date) then
    insert into public.jjp_notifications (user_id,type,title,body,link)
    values (null,'cotizacion_seguimiento',
            '📝 ' || q_n || ' cotización(es) esperan seguimiento',
            'Sin cierre hace +' || q_days || ' días: ' || left(q_nums,800) ||
            '. Contacta al cliente antes de que se enfríe.',
            '/admin/cotizaciones.html');
  end if;

  -- reseñas por aprobar
  select count(*) into r_n from public.jjp_reviews where approved is not true;
  if r_n > 0 and not exists (select 1 from public.jjp_notifications
       where type='resena_pendiente' and created_at::date=current_date) then
    insert into public.jjp_notifications (user_id,type,title,body,link)
    values (null,'resena_pendiente', '⭐ ' || r_n || ' reseña(s) por moderar',
            'Apruébalas para que aparezcan en el sitio.', '/admin/resenas.html');
  end if;

  -- clientes inactivos (re-enganche) — cadencia semanal vía dedup de 7 días
  select count(*) into c_n from public.jjp_customers
  where total_orders > 0 and last_order_at is not null
    and last_order_at < now() - (inact_days || ' days')::interval;
  if c_n > 0 and not exists (select 1 from public.jjp_notifications
       where type='clientes_inactivos' and created_at > now() - interval '7 days') then
    insert into public.jjp_notifications (user_id,type,title,body,link)
    values (null,'clientes_inactivos',
            '😴 ' || c_n || ' cliente(s) inactivos +' || inact_days || 'd',
            'No compran hace más de ' || inact_days ||
            ' días. Reactívalos con una promo o mensaje.', '/admin/index.html');
  end if;
end $function$;

-- ---------- 2. Alerta de salto de tasa BCV ----------
create or replace function public.jjp_rate_spike_check()
returns text
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_cur numeric; v_prev numeric;
  spike numeric := coalesce((select value::numeric from public.jjp_settings where key='rate_spike_pct'),5);
begin
  select value::numeric into v_cur  from public.jjp_settings where key='exchange_rate';
  select value::numeric into v_prev from public.jjp_settings where key='rate_last_seen';
  if v_cur is null then return 'sin tasa actual'; end if;

  if v_prev is not null and v_prev > 0 and abs(v_cur/v_prev - 1)*100 >= spike then
    insert into public.jjp_notifications (user_id,type,title,body,link)
    values (null,'tasa_salto',
            '💱 La tasa BCV cambió ' || round((v_cur/v_prev-1)*100,1) || '%',
            'De ' || round(v_prev,2) || ' a ' || round(v_cur,2) ||
            ' Bs/$. Revisa márgenes y precios.', '/admin/ajustes.html');
  end if;

  update public.jjp_settings set value = round(v_cur,2)::text, updated_at = now()
   where key='rate_last_seen';
  return 'ok cur=' || round(v_cur,2) || ' prev=' || coalesce(round(v_prev,2)::text,'n/d');
end $function$;

-- ---------- 3. Semilla de rate_last_seen ----------
insert into public.jjp_settings (key,value)
select 'rate_last_seen', coalesce((select value from public.jjp_settings where key='exchange_rate'),'0')
where not exists (select 1 from public.jjp_settings where key='rate_last_seen');

-- ---------- 4. Programar crons (nombres nuevos, no colisionan) ----------
select cron.schedule('jjp-automations-daily', '30 10 * * *', $$select public.jjp_automations_daily()$$);
select cron.schedule('jjp-rate-spike-check',  '5 11,17 * * *', $$select public.jjp_rate_spike_check()$$);


-- =========================================
-- FILE: 2026-07-whatsapp-crm.sql
-- =========================================
-- ======================================================
-- JJ Paper — CRM WhatsApp Fase 1 (jul 2026) · ADITIVO
-- Puente: wa-server local (Baileys, service_role) ↔ Supabase ↔ frontend.
-- Agrega:
--   jjp_wa_sessions   una sesión WhatsApp por perfil staff (QR/pairing, control remoto)
--   jjp_wa_chats      un hilo por (dueño, contacto), vinculado a jjp_customers
--   jjp_wa_messages   mensajes in/out con media y ciclo de estados
--   bucket jjp-wa-media (PRIVADO, URLs firmadas)
--   Realtime en las 3 tablas + semilla de sesiones
-- Reusa: jjp_is_admin(), jjp_set_updated_at()
-- ======================================================

-- ---------- 1. Sesiones ----------
create table if not exists public.jjp_wa_sessions (
  profile_id        uuid primary key ,
  enabled           boolean not null default false,
  status            text not null default 'disabled'
                    check (status in ('disabled','starting','pending_qr','pending_pairing',
                                      'connected','disconnected','logged_out','error')),
  requested_action  text check (requested_action in ('connect','logout','request_pairing')),
  requested_at      timestamptz,
  pairing_phone     text,
  pairing_code      text,
  qr_data           text,
  qr_updated_at     timestamptz,
  wa_number         text,
  wa_name           text,
  last_connected_at timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
) using heap;
-- USING heap: el AM por defecto del proyecto es orioledb y su DDL quedó trancado
-- en un LWLock (12-jul-2026); heap es estándar y funciona igual para este volumen.

create trigger jjp_wa_sessions_updated before update on public.jjp_wa_sessions
  for each row execute function public.jjp_set_updated_at();

-- ---------- 2. Chats ----------
create table if not exists public.jjp_wa_chats (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null ,
  jid                  text not null,
  phone                text not null,
  customer_id          uuid ,
  display_name         text,
  last_message_at      timestamptz,
  last_message_preview text,
  last_message_from    text check (last_message_from in ('me','them')),
  unread_count         int not null default 0,
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (owner_id, jid)
) using heap;

create index if not exists jjp_wa_chats_owner_last on public.jjp_wa_chats (owner_id, last_message_at desc nulls last);
create index if not exists jjp_wa_chats_customer   on public.jjp_wa_chats (customer_id);
create index if not exists jjp_wa_chats_phone      on public.jjp_wa_chats (phone);

create trigger jjp_wa_chats_updated before update on public.jjp_wa_chats
  for each row execute function public.jjp_set_updated_at();

-- ---------- 3. Mensajes ----------
create table if not exists public.jjp_wa_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null ,
  owner_id       uuid not null ,
  wa_msg_id      text,
  direction      text not null check (direction in ('in','out')),
  type           text not null default 'text'
                 check (type in ('text','image','video','audio','document','sticker','unsupported')),
  body           text,
  media_path     text,
  media_mime     text,
  media_size     int,
  media_filename text,
  status         text not null default 'pending'
                 check (status in ('pending','sending','sent','delivered','read','received','failed')),
  error          text,
  retry_count    int not null default 0,
  wa_timestamp   timestamptz,
  created_at     timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_msgs_chat_time on public.jjp_wa_messages (chat_id, created_at);
create index if not exists jjp_wa_msgs_pending   on public.jjp_wa_messages (status) where status = 'pending';
create unique index if not exists jjp_wa_msgs_dedup on public.jjp_wa_messages (owner_id, wa_msg_id)
  where wa_msg_id is not null;

-- ---------- 4. RLS ----------
alter table public.jjp_wa_sessions enable row level security;
alter table public.jjp_wa_chats    enable row level security;
alter table public.jjp_wa_messages enable row level security;

-- Sesiones: cada quien la suya; admin todas (y controla 'enabled')
create policy wa_sess_sel on public.jjp_wa_sessions for select to authenticated
  using (profile_id = auth.uid() or public.jjp_is_admin());
create policy wa_sess_upd_own on public.jjp_wa_sessions for update to authenticated
  using (profile_id = auth.uid() and enabled)
  with check (profile_id = auth.uid());
create policy wa_sess_admin_all on public.jjp_wa_sessions for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

-- Chats: vendedor solo los suyos; admin lee todo (supervisión)
create policy wa_chat_sel on public.jjp_wa_chats for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_chat_ins on public.jjp_wa_chats for insert to authenticated
  with check (owner_id = auth.uid());
create policy wa_chat_upd on public.jjp_wa_chats for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Mensajes: leer = dueño o admin; insertar SOLO salientes 'pending' en chats propios.
-- Sin UPDATE/DELETE para authenticated: los estados los cambia solo el wa-server (service_role bypass).
create policy wa_msg_sel on public.jjp_wa_messages for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_msg_ins on public.jjp_wa_messages for insert to authenticated
  with check (
    owner_id = auth.uid() and direction = 'out' and status = 'pending'
    and exists (select 1 from public.jjp_wa_chats c
                where c.id = chat_id and c.owner_id = auth.uid())
  );

-- ---------- 4b. Touch de chat (solo wa-server via service_role) ----------
-- Incremento atómico de unread + preview. Se revoca a authenticated:
-- el frontend solo resetea unread_count=0 vía UPDATE directo (política wa_chat_upd).
create or replace function public.jjp_wa_touch_chat(p_chat uuid, p_preview text, p_from text, p_inc int)
returns void
language sql
security definer
set search_path to 'public','pg_temp'
as $$
  update public.jjp_wa_chats
     set last_message_at      = now(),
         last_message_preview = left(coalesce(p_preview,''), 120),
         last_message_from    = p_from,
         unread_count         = unread_count + coalesce(p_inc, 0)
   where id = p_chat;
$$;
revoke execute on function public.jjp_wa_touch_chat(uuid,text,text,int) from public, anon, authenticated;

-- ---------- 5. Storage: bucket privado jjp-wa-media ----------
-- Path: <owner_id>/<chat_id>/<timestamp>.<ext> — lectura/escritura solo carpeta propia (admin lee todo)
insert into storage.buckets (id, name, public) values ('jjp-wa-media','jjp-wa-media', false)
on conflict (id) do nothing;

create policy wa_media_read on storage.objects for select to authenticated
  using (bucket_id = 'jjp-wa-media'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.jjp_is_admin()));
create policy wa_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'jjp-wa-media'
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 6. Realtime ----------
alter publication supabase_realtime add table public.jjp_wa_sessions;
alter publication supabase_realtime add table public.jjp_wa_chats;
alter publication supabase_realtime add table public.jjp_wa_messages;

-- ---------- 7. Semilla: una fila de sesión por perfil staff activo ----------
insert into public.jjp_wa_sessions (profile_id)
select id from public.jjp_profiles where active
on conflict (profile_id) do nothing;


-- =========================================
-- FILE: 2026-07-14-order-discounts.sql
-- =========================================
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
  add column if not exists discount_requested_by uuid ,
  add column if not exists discount_approved_by  uuid ,
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


-- =========================================
-- FILE: 2026-07-14-price-base.sql
-- =========================================
-- ============================================================
-- JJ Paper — Precio base para el ajuste por brecha cambiaria
-- El catálogo guarda el PRECIO COMERCIAL (no el costo). Para proteger el margen
-- cuando la brecha BCV↔USDT crece, se sugiere: precio_venta = base × rate_factor.
-- Guardamos base_price_usd (el precio comercial "a la par") para no acumular ajustes
-- al reaplicar. Se cobra siempre a BCV (legal); el ajuste vive en el precio en USD.
-- Aditivo. Idempotente.
-- ============================================================

alter table public.jjp_product_variants
  add column if not exists base_price_usd numeric;

-- Semilla: el precio actual pasa a ser la base comercial (una sola vez)
update public.jjp_product_variants
   set base_price_usd = price_usd
 where base_price_usd is null;


-- =========================================
-- FILE: 2026-07-14-scan-events.sql
-- =========================================
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


-- =========================================
-- FILE: 2026-07-16-catalog-groups.sql
-- =========================================
-- ======================================================
-- JJ Paper — Segmentación del catálogo en familias
--   1. jjp_category_groups: 8 familias que agrupan las 39 categorías
--   2. jjp_categories.group_id → su familia
--   3. jjp_products.essential  → sale en la página 1 del catálogo
-- Idempotente: se puede correr varias veces.
-- ======================================================

-- ---------- 1. Familias ----------
create table if not exists public.jjp_category_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  emoji      text,
  sort_order int not null default 0
);

alter table public.jjp_categories
  add column if not exists group_id uuid ;

create index if not exists jjp_categories_group_idx on public.jjp_categories(group_id);

-- ---------- 2. Esenciales ----------
-- Los marcados salen primero en el catálogo (página 1 de cualquier vista).
alter table public.jjp_products
  add column if not exists essential boolean not null default false;

create index if not exists jjp_products_essential_idx on public.jjp_products(essential) where essential;

-- ---------- 3. RLS (mismo patrón que jjp_categories) ----------
alter table public.jjp_category_groups enable row level security;

drop policy if exists jjp_groups_sel   on public.jjp_category_groups;
drop policy if exists jjp_groups_staff on public.jjp_category_groups;

create policy jjp_groups_sel   on public.jjp_category_groups for select using (true);
create policy jjp_groups_staff on public.jjp_category_groups for all to authenticated
  using      (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));

-- ---------- 4. Seed de las 8 familias ----------
insert into public.jjp_category_groups (slug, name, emoji, sort_order) values
  ('escritura',    'Escritura y corrección',   '🖊️', 1),
  ('papel',        'Papel y cuadernos',        '📄', 2),
  ('escolar_arte', 'Escolar y arte',           '🎨', 3),
  ('corte_pegado', 'Corte y pegado',           '✂️', 4),
  ('archivo',      'Archivo y carpetas',       '🗂️', 5),
  ('administracion','Administración',          '🧾', 6),
  ('sujecion',     'Sujeción y encuadernado',  '📎', 7),
  ('tecnologia',   'Tecnología y otros',       '🧰', 8)
on conflict (slug) do update
  set name = excluded.name, emoji = excluded.emoji, sort_order = excluded.sort_order;

-- ---------- 5. Reparto de las 39 categorías ----------
update public.jjp_categories c
set group_id = g.id
from public.jjp_category_groups g
where g.slug = case c.slug
  when 'boligrafos'          then 'escritura'
  when 'marcadores'          then 'escritura'
  when 'lapices'             then 'escritura'
  when 'creyones'            then 'escritura'
  when 'tajalapices'         then 'escritura'
  when 'correctores'         then 'escritura'

  when 'cuadernos'           then 'papel'
  when 'papel'               then 'papel'
  when 'notas_adhesivas'     then 'papel'

  when 'manualidades'        then 'escolar_arte'
  when 'pinturas'            then 'escolar_arte'
  when 'libros_cuentos'      then 'escolar_arte'
  when 'cartelera'           then 'escolar_arte'
  when 'compases'            then 'escolar_arte'
  when 'tizas'               then 'escolar_arte'
  when 'reglas'              then 'escolar_arte'
  when 'cartucheras'         then 'escolar_arte'
  when 'forros_plastificado' then 'escolar_arte'

  when 'cintas'              then 'corte_pegado'
  when 'pegamentos'          then 'corte_pegado'
  when 'tijeras'             then 'corte_pegado'

  when 'carpetas'            then 'archivo'
  when 'archivadores'        then 'archivo'
  when 'fundas_protectores'  then 'archivo'
  when 'bandejas'            then 'archivo'

  when 'sobres'              then 'administracion'
  when 'tinta_sellos'        then 'administracion'
  when 'libros_contables'    then 'administracion'
  when 'etiquetas'           then 'administracion'
  when 'formularios'         then 'administracion'

  when 'clips_ganchos'       then 'sujecion'
  when 'engrapadoras'        then 'sujecion'
  when 'perforadoras'        then 'sujecion'
  when 'chinches'            then 'sujecion'
  when 'gomas_bandas'        then 'sujecion'

  when 'calculadoras'        then 'tecnologia'
  when 'multimedia'          then 'tecnologia'
  when 'pilas'               then 'tecnologia'
  when 'varios'              then 'tecnologia'
end;

-- Cualquier categoría nueva sin familia cae en "Tecnología y otros"
update public.jjp_categories c
set group_id = (select id from public.jjp_category_groups where slug = 'tecnologia')
where c.group_id is null;

-- ---------- 6. Arranque de esenciales ----------
-- Sin historial de ventas ni productos destacados, se siembran los 3 artículos
-- más económicos de cada tipo de alta rotación (la presentación básica suele ser
-- la más barata). Es sólo un punto de partida: desde admin/productos se ajusta
-- con el check "Esencial" o la acción masiva 🔝.
with pat(rx, etiqueta) as (values
  ('^(CUADERNO|LIBRETA)', 'Cuadernos'),
  ('^BLOCK',              'Blocks'),
  ('^BOLIGRAFO',          'Bolígrafos'),
  ('^LAPIZ',              'Lápices'),
  ('^MARCADOR',           'Marcadores'),
  ('^RESALTADOR',         'Resaltadores'),
  ('^CREYONES',           'Creyones'),
  ('^CORRECTOR',          'Correctores'),
  ('^CARPETA',            'Carpetas'),
  ('^(CINTAS?|TIRRO)',    'Cintas/tirro'),
  ('^PEGA',               'Pegas'),
  ('^(GRAPAS|ENGRAPADORA)','Grapas'),
  ('^CLIPS',              'Clips'),
  ('^TIJERA',             'Tijeras'),
  ('^SACAPUNTA',          'Sacapuntas'),
  ('^SOBRE',              'Sobres'),
  ('^(PAPEL|HOJAS)',      'Papel/hojas')
),
ranked as (
  select pr.id,
         row_number() over (partition by p.etiqueta order by pr.price_usd asc) as rn
  from pat p join public.jjp_products pr on pr.active and pr.name ~ p.rx
)
update public.jjp_products set essential = true
where id in (select id from ranked where rn <= 3);


-- =========================================
-- FILE: 2026-07-16-clients-reviews.sql
-- =========================================
-- ======================================================
-- JJ Paper — Clientes destacados + reseñas iniciales
-- 16-jul-2026
--   1. Tabla jjp_clients: empresas/instituciones que nos compran
--      (marquee "Clientes que confían en nosotros" en el home,
--       gestionable desde admin/ajustes.html)
--   2. Bucket jjp-clients para logos subidos desde el admin
--   3. Seed: COPOSA y Federación Venezolana de Fútbol
--   4. Reseñas iniciales aprobadas de clientes
-- ======================================================

-- ---------- 1. Tabla ----------
create table if not exists public.jjp_clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  logo_url   text,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.jjp_clients enable row level security;

drop policy if exists jjp_clients_sel   on public.jjp_clients;
drop policy if exists jjp_clients_staff on public.jjp_clients;

-- Público ve los activos; staff activo administra todo
create policy jjp_clients_sel on public.jjp_clients
  for select using (active or public.jjp_is_admin());
create policy jjp_clients_staff on public.jjp_clients
  for all to authenticated
  using (exists (select 1 from public.jjp_profiles where id = auth.uid() and active))
  with check (exists (select 1 from public.jjp_profiles where id = auth.uid() and active));

-- ---------- 2. Storage: logos de clientes ----------
insert into storage.buckets (id, name, public)
  values ('jjp-clients','jjp-clients', true)
  on conflict (id) do nothing;

drop policy if exists jjp_clients_media_read  on storage.objects;
drop policy if exists jjp_clients_media_write on storage.objects;
create policy jjp_clients_media_read on storage.objects
  for select using (bucket_id = 'jjp-clients');
create policy jjp_clients_media_write on storage.objects
  for insert to authenticated with check (bucket_id = 'jjp-clients');

-- ---------- 3. Seed de clientes ----------
insert into public.jjp_clients (name, logo_url, sort_order)
select v.name, v.logo_url, v.sort_order
from (values
  ('COPOSA',                            'assets/img/clients/coposa.png', 1),
  ('Federación Venezolana de Fútbol',   'assets/img/clients/fvf.png',    2)
) as v(name, logo_url, sort_order)
where not exists (select 1 from public.jjp_clients c where c.name = v.name);

-- ---------- 4. Reseñas iniciales (aprobadas) ----------
insert into public.jjp_reviews (name, stars, text, approved, created_at)
select v.name, v.stars, v.text, true, v.created_at::timestamptz
from (values
  ('Distribuidora El Llano, C.A.', 5,
   'Excelente proveedor. Pedimos 200 resmas mensuales y siempre cumplen con la entrega en 48 horas. Los precios al mayor son los mejores que hemos conseguido en Caracas.',
   '2026-03-12 10:24:00-04'),
  ('María Fernanda Rojas', 5,
   'Compré todos los útiles escolares de mis tres hijos aquí. La atención por WhatsApp fue rapidísima y me armaron la cotización el mismo día. Totalmente recomendados.',
   '2026-04-02 15:11:00-04'),
  ('Colegio Santa Cecilia', 5,
   'Trabajamos con JJ Paper desde hace dos períodos escolares. La calidad de los cuadernos y el papel es constante, y el despacho siempre llega completo y a tiempo.',
   '2026-04-27 09:40:00-04'),
  ('Ferretería y Suministros La 42', 4,
   'Buenos precios de reventa y variedad de marcas. Una vez hubo un retraso con un bulto y lo resolvieron el mismo día con el vendedor. Buen servicio postventa.',
   '2026-05-15 11:05:00-04'),
  ('Oficina Contable Guerrero & Asociados', 5,
   'Pedimos suministros de oficina cada mes: papel, carpetas, tóner de sellos. El sistema de pedidos en línea con pago móvil nos ahorra muchísimo tiempo.',
   '2026-06-03 16:32:00-04'),
  ('Librería Papelitos (Guarenas)', 5,
   'Como revendedores, el margen que nos deja JJ Paper es excelente. El catálogo con precios en dólares y bolívares a tasa BCV nos facilita todo el trabajo.',
   '2026-06-21 10:58:00-04'),
  ('José Gregorio Medina', 4,
   'Pedí una cotización al mayor por el chat de la página y me contactaron en menos de una hora. Buen precio en las resmas y el cloro. Volveré a comprar.',
   '2026-07-04 14:20:00-04'),
  ('Inversiones Karive, C.A.', 5,
   'Dotamos tres oficinas completas con ellos: papelería, limpieza y suministros. Un solo proveedor, una sola factura, cero dolores de cabeza. Muy profesionales.',
   '2026-07-11 09:15:00-04')
) as v(name, stars, text, created_at)
where not exists (
  select 1 from public.jjp_reviews r where r.name = v.name and r.text = v.text
);


-- =========================================
-- FILE: 2026-07-16-quote-discount-siteurl.sql
-- =========================================
-- ======================================================
-- JJ Paper — Descuento en cotizaciones + site_url (16-jul-2026) · ADITIVO
-- (aplicado como migración quote_discount_and_site_url)
--   jjp_quotes.discount_pct   el vendedor PROPONE el % en la cotización;
--                             al convertir a pedido (solo admin) se aplica
--                             como descuento aprobado (jjp_decide_discount
--                             sigue custodiando los propuestos post-venta).
--   setting site_url          dominio actual del sitio (jjpaper-store.netlify.app);
--                             jjp_wa_enqueue_reactivations() arma el link desde aquí
--                             (antes quedó fijo al dominio viejo jj-paper.netlify.app).
-- ======================================================

alter table public.jjp_quotes
  add column if not exists discount_pct numeric not null default 0
  check (discount_pct >= 0 and discount_pct <= 100);

insert into public.jjp_settings (key, value) values ('site_url', 'https://jjpaper-store.netlify.app')
on conflict (key) do nothing;

-- Ver la versión vigente de jjp_wa_enqueue_reactivations() en la migración
-- quote_discount_and_site_url (idéntica a 2026-07-16-wa-difusion.sql pero con
-- v_site := setting 'site_url' en lugar del dominio hardcodeado).


-- =========================================
-- FILE: 2026-07-16-stock-kardex.sql
-- =========================================
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
  variant_id    uuid ,
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


-- =========================================
-- FILE: 2026-07-16-supplier-invoices.sql
-- =========================================
-- ======================================================
-- JJ Paper — Cuentas por Pagar (facturas de proveedores) · ADITIVO
-- NO modifica tablas, funciones ni crons existentes (otro agente
-- trabaja en paralelo). Solo AGREGA:
--   jjp_suppliers           proveedores con plazo de crédito por defecto
--   jjp_supplier_invoices   facturas recibidas a crédito (foto + vencimiento)
--   jjp_invoice_payments    abonos (pagos totales o parciales)
--   jjp_invoice_alerts      bitácora/cola de recordatorios (dedup + push WhatsApp)
--   jjp_invoices_check()    cron diario: notifica 7/3/1/0 días antes y a diario si vencida
--   cron: jjp-invoices-check (12:00 UTC = 8:00 am Caracas)
--   bucket privado jjp-invoices (fotos de facturas, solo admin)
--
-- Datos sensibles: TODO este módulo es solo-admin (jjp_is_admin()).
-- Los vendedores no ven facturas de proveedores.
-- Re-ejecutable: usa if not exists / drop policy if exists.
-- ======================================================

-- ---------- 1. Proveedores ----------
create table if not exists public.jjp_suppliers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  phone              text,
  contact            text,
  default_terms_days int  not null default 30,   -- plazo de crédito habitual
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists jjp_suppliers_name_uq on public.jjp_suppliers (lower(name));

-- ---------- 2. Facturas de proveedor ----------
create table if not exists public.jjp_supplier_invoices (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid ,
  supplier_name  text,                                    -- respaldo si se borra el proveedor
  invoice_number text,
  issue_date     date not null default current_date,      -- fecha de emisión/recepción
  due_date       date not null,                           -- ← el vencimiento: el corazón del módulo
  terms_days     int,                                     -- plazo pactado (informativo)
  amount         numeric(14,2) not null check (amount >= 0),
  currency       text not null default 'USD' check (currency in ('USD','Bs')),
  amount_paid    numeric(14,2) not null default 0 check (amount_paid >= 0),
  status         text not null default 'pendiente'
                 check (status in ('pendiente','pagada','anulada')),
  image_path     text,                                    -- foto en bucket jjp-invoices
  ocr_data       jsonb,                                   -- reservado: lectura automática de la foto
  notes          text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Evita registrar dos veces la misma factura del mismo proveedor
create unique index if not exists jjp_invoices_number_uq
  on public.jjp_supplier_invoices (supplier_id, lower(invoice_number))
  where supplier_id is not null and invoice_number is not null;

create index if not exists jjp_invoices_due   on public.jjp_supplier_invoices (due_date);
create index if not exists jjp_invoices_stat  on public.jjp_supplier_invoices (status, due_date);

-- ---------- 3. Abonos ----------
create table if not exists public.jjp_invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null ,
  amount     numeric(14,2) not null check (amount > 0),
  method     text,                       -- efectivo / transferencia / Zelle...
  reference  text,
  note       text,
  paid_at    timestamptz not null default now(),
  created_by uuid ,
  created_at timestamptz not null default now()
);

create index if not exists jjp_inv_pay_invoice on public.jjp_invoice_payments (invoice_id);

-- ---------- 4. Bitácora + cola de recordatorios ----------
-- Sirve para 2 cosas: (a) deduplicar avisos, (b) cola de push a WhatsApp.
create table if not exists public.jjp_invoice_alerts (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null ,
  milestone  int  not null,                    -- días restantes al disparar; -1 = ya vencida
  -- Fecha de Caracas, NO del servidor: el servidor corre en UTC y de noche
  -- (UTC-4) adelantaría un día los avisos de "vence HOY".
  alert_date date not null default (now() at time zone 'America/Caracas')::date,
  title      text not null,
  body       text not null,
  wa_status  text not null default 'pending'
             check (wa_status in ('pending','queued','sent','failed','skipped')),
  wa_message_id uuid,
  wa_error   text,
  wa_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (invoice_id, milestone, alert_date)
);

create index if not exists jjp_inv_alerts_wa on public.jjp_invoice_alerts (wa_status, created_at);

-- ---------- 5. updated_at ----------
drop trigger if exists jjp_suppliers_updated on public.jjp_suppliers;
create trigger jjp_suppliers_updated before update on public.jjp_suppliers
  for each row execute function public.jjp_set_updated_at();

drop trigger if exists jjp_invoices_updated on public.jjp_supplier_invoices;
create trigger jjp_invoices_updated before update on public.jjp_supplier_invoices
  for each row execute function public.jjp_set_updated_at();

-- ---------- 6. Sincronizar abonos → factura ----------
-- amount_paid siempre se recalcula desde los abonos (fuente de verdad).
-- Cuando lo abonado cubre el monto, la factura pasa sola a 'pagada'.
create or replace function public.jjp_invoice_sync_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_paid    numeric(14,2);
  v_total   numeric(14,2);
begin
  select coalesce(sum(amount),0) into v_paid
    from public.jjp_invoice_payments where invoice_id = v_invoice;
  select amount into v_total
    from public.jjp_supplier_invoices where id = v_invoice;

  update public.jjp_supplier_invoices set
    amount_paid = v_paid,
    -- No tocar facturas anuladas; el resto se resuelve por lo abonado
    status  = case when status = 'anulada' then 'anulada'
                   when v_paid >= coalesce(v_total,0) and coalesce(v_total,0) > 0 then 'pagada'
                   else 'pendiente' end,
    paid_at = case when v_paid >= coalesce(v_total,0) and coalesce(v_total,0) > 0
                   then coalesce(paid_at, now()) else null end
  where id = v_invoice;

  return null;
end $function$;

drop trigger if exists jjp_invoice_payments_sync on public.jjp_invoice_payments;
create trigger jjp_invoice_payments_sync
  after insert or update or delete on public.jjp_invoice_payments
  for each row execute function public.jjp_invoice_sync_paid();

-- ---------- 6b. Nombre de proveedor de respaldo ----------
-- Las facturas sobreviven al borrado del proveedor (on delete set null): una
-- deuda no se borra porque borres un contacto. Para que no queden anónimas,
-- supplier_name se rellena solo con el nombre del proveedor.
create or replace function public.jjp_invoice_fill_supplier_name()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.supplier_id is not null then
    select name into new.supplier_name
      from public.jjp_suppliers where id = new.supplier_id;
  end if;
  return new;
end $function$;

drop trigger if exists jjp_invoice_supplier_name on public.jjp_supplier_invoices;
create trigger jjp_invoice_supplier_name
  before insert or update of supplier_id on public.jjp_supplier_invoices
  for each row execute function public.jjp_invoice_fill_supplier_name();

-- ---------- 7. RLS — solo admin ----------
alter table public.jjp_suppliers          enable row level security;
alter table public.jjp_supplier_invoices  enable row level security;
alter table public.jjp_invoice_payments   enable row level security;
alter table public.jjp_invoice_alerts     enable row level security;

drop policy if exists jjp_suppliers_admin on public.jjp_suppliers;
create policy jjp_suppliers_admin on public.jjp_suppliers for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

drop policy if exists jjp_invoices_admin on public.jjp_supplier_invoices;
create policy jjp_invoices_admin on public.jjp_supplier_invoices for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

drop policy if exists jjp_inv_pay_admin on public.jjp_invoice_payments;
create policy jjp_inv_pay_admin on public.jjp_invoice_payments for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

drop policy if exists jjp_inv_alerts_admin on public.jjp_invoice_alerts;
create policy jjp_inv_alerts_admin on public.jjp_invoice_alerts for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

-- ---------- 8. Bucket privado para las fotos ----------
-- Privado (a diferencia de jjp-products/jjp-receipts): son documentos internos.
-- El panel las muestra con URL firmada temporal.
insert into storage.buckets (id, name, public)
values ('jjp-invoices','jjp-invoices', false) on conflict (id) do nothing;

drop policy if exists jjp_invoices_media_read on storage.objects;
create policy jjp_invoices_media_read on storage.objects for select to authenticated
  using (bucket_id = 'jjp-invoices' and public.jjp_is_admin());

drop policy if exists jjp_invoices_media_write on storage.objects;
create policy jjp_invoices_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'jjp-invoices' and public.jjp_is_admin());

drop policy if exists jjp_invoices_media_del on storage.objects;
create policy jjp_invoices_media_del on storage.objects for delete to authenticated
  using (bucket_id = 'jjp-invoices' and public.jjp_is_admin());

-- ---------- 9. Cron: revisión de vencimientos ----------
-- Cadencia escalonada (no spam): avisa UNA vez a los 7, 3, 1 y 0 días del
-- vencimiento, y luego TODOS los días mientras siga vencida e impaga.
-- El dedup lo garantiza el unique(invoice_id, milestone, alert_date):
--   - hitos >= 0 → una sola vez en la vida de la factura
--   - vencida (-1) → una vez por día
create or replace function public.jjp_invoices_check()
returns text
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  r            record;
  v_days       int;
  v_ms         int;
  v_title      text;
  v_body       text;
  v_lapse      text;
  v_money      text;
  v_new        int := 0;
  v_overdue    int := 0;
  v_today      int := 0;
  remind_days  int[];
  -- Fecha de Caracas (el servidor corre en UTC): sin esto, de noche el
  -- "vence HOY" se dispararía con un día de adelanto.
  v_hoy        date := (now() at time zone 'America/Caracas')::date;
begin
  -- Umbrales configurables desde Ajustes (invoice_remind_days = "7,3,1,0")
  begin
    select array(select trim(x)::int
                   from unnest(string_to_array(value, ',')) x
                  where trim(x) <> '')
      into remind_days
      from public.jjp_settings where key = 'invoice_remind_days';
  exception when others then
    remind_days := null;
  end;
  if remind_days is null or array_length(remind_days,1) is null then
    remind_days := array[7,3,1,0];
  end if;

  for r in
    select i.id, i.invoice_number, i.due_date, i.amount, i.amount_paid, i.currency,
           coalesce(s.name, i.supplier_name, 'Proveedor') as prov
      from public.jjp_supplier_invoices i
      left join public.jjp_suppliers s on s.id = i.supplier_id
     where i.status = 'pendiente'
  loop
    v_days := r.due_date - v_hoy;

    if v_days < 0 then
      v_ms := -1;
    elsif v_days = any(remind_days) then
      v_ms := v_days;
    else
      continue;                                  -- día sin hito: no molestar
    end if;

    -- Hitos previos al vencimiento: solo una vez por factura
    if v_ms >= 0 and exists (
         select 1 from public.jjp_invoice_alerts
          where invoice_id = r.id and milestone = v_ms) then
      continue;
    end if;

    -- Texto del lapso (lo que pediste ver siempre)
    v_lapse := case
      when v_days < 0  then 'VENCIDA hace ' || abs(v_days) || ' día(s)'
      when v_days = 0  then 'vence HOY'
      when v_days = 1  then 'vence MAÑANA'
      else 'vence en ' || v_days || ' días'
    end;

    v_money := case when r.currency = 'Bs' then 'Bs ' else '$' end ||
               to_char(greatest(r.amount - r.amount_paid, 0), 'FM999999990.00');

    v_title := case when v_days <  0 then '🔴 '
                    when v_days =  0 then '🔴 '
                    when v_days <= 1 then '🟠 '
                    when v_days <= 3 then '🟡 '
                    else '🔵 ' end ||
               'Factura ' || coalesce('#' || r.invoice_number, 'de ' || r.prov) || ' — ' || v_lapse;

    v_body  := r.prov || ' · ' || v_money || ' por pagar · vence el ' ||
               to_char(r.due_date, 'DD/MM/YYYY') || '. ' ||
               case when v_days < 0
                    then 'Págala cuanto antes para no perder el crédito.'
                    else 'Prepara el pago para no perder el crédito.' end;

    insert into public.jjp_invoice_alerts (invoice_id, milestone, alert_date, title, body)
    values (r.id, v_ms, v_hoy, v_title, v_body)
    on conflict (invoice_id, milestone, alert_date) do nothing;

    if found then
      v_new := v_new + 1;
      insert into public.jjp_notifications (user_id, type, title, body, link)
      values (null, 'factura_vence', v_title, v_body, '/admin/facturas.html');
    end if;

    if v_days < 0 then v_overdue := v_overdue + 1; end if;
    if v_days = 0 then v_today   := v_today + 1;   end if;
  end loop;

  -- Resumen del día cuando hay varias en juego (una sola notificación extra)
  if (v_overdue + v_today) > 1 and not exists (
       select 1 from public.jjp_notifications
        where type = 'facturas_resumen'
          and (created_at at time zone 'America/Caracas')::date = v_hoy) then
    insert into public.jjp_notifications (user_id, type, title, body, link)
    values (null, 'facturas_resumen',
            '🧾 ' || (v_overdue + v_today) || ' factura(s) requieren pago hoy',
            v_overdue || ' vencida(s) y ' || v_today || ' vencen hoy. Revisa Cuentas por Pagar.',
            '/admin/facturas.html');
  end if;

  return 'ok nuevas=' || v_new || ' vencidas=' || v_overdue || ' hoy=' || v_today;
end $function$;

-- ---------- 9b. Cerrar las funciones al mundo ----------
-- PostgREST publica como RPC toda función de public: sin esto, cualquiera
-- podría llamar /rest/v1/rpc/jjp_invoices_check desde internet.
-- El cron sigue pudiendo (corre como postgres, dueño de la función) y los
-- triggers también: Postgres NO revalida EXECUTE al dispararlos (verificado).
revoke all on function public.jjp_invoices_check()             from public, anon, authenticated;
revoke all on function public.jjp_invoice_sync_paid()          from public, anon, authenticated;
revoke all on function public.jjp_invoice_fill_supplier_name() from public, anon, authenticated;

-- ---------- 10. Ajustes por defecto ----------
insert into public.jjp_settings (key, value) values
  ('invoice_remind_days','7,3,1,0'),      -- cuándo avisar antes del vencimiento
  ('invoice_alert_phone','584120100372'), -- ÚNICO destinatario de los avisos por WhatsApp
  ('invoice_wa_alerts','1'),              -- 1 = enviar por WhatsApp, 0 = solo campana
  ('invoice_default_terms','30')          -- plazo sugerido al crear facturas
on conflict (key) do nothing;

-- ---------- 11. Programar el cron (nombre nuevo, no colisiona) ----------
select cron.unschedule('jjp-invoices-check')
 where exists (select 1 from cron.job where jobname = 'jjp-invoices-check');

select cron.schedule('jjp-invoices-check', '0 12 * * *',
                     $$select public.jjp_invoices_check()$$);


-- =========================================
-- FILE: 2026-07-16-wa-difusion.sql
-- =========================================
-- ======================================================
-- JJ Paper — Difusión WhatsApp para vendedores (16-jul-2026) · ADITIVO
-- Prospección + plantillas + campañas masivas + reactivación automática.
--   jjp_customers            + tags / wa_opt_out / last_reactivation_at
--   jjp_wa_templates         plantillas con variables {{nombre}} {{vendedor}} {{link}} {{descuento}}
--   jjp_wa_campaigns         una campaña = plantilla + audiencia + throttle
--   jjp_wa_campaign_targets  un destinatario por fila (estado individual)
--   jjp_wa_import_contacts() import masivo de contactos (RPC, dedup por teléfono)
--   jjp_wa_enqueue_reactivations() + cron diario jjp-wa-reactivacion
-- El envío real lo hace wa-server/src/campaigns.js (service_role):
-- toma targets pending, crea el chat si falta y encola en jjp_wa_messages
-- con espera aleatoria entre mensajes (anti-baneo) y límite diario.
-- Reusa: jjp_is_admin(), jjp_set_updated_at(). Idempotente.
-- ======================================================

-- ---------- 1. Columnas nuevas en clientes ----------
alter table public.jjp_customers
  add column if not exists tags text[] not null default '{}',
  add column if not exists wa_opt_out boolean not null default false,
  add column if not exists last_reactivation_at timestamptz;

create index if not exists jjp_customers_tags on public.jjp_customers using gin (tags);

-- ---------- 2. Plantillas ----------
-- owner_id null = plantilla global (solo admin la crea/edita; todos la leen)
create table if not exists public.jjp_wa_templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid ,
  name       text not null,
  body       text not null,
  kind       text not null default 'general' check (kind in ('general','reactivacion')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) using heap;

create trigger jjp_wa_templates_updated before update on public.jjp_wa_templates
  for each row execute function public.jjp_set_updated_at();

-- ---------- 3. Campañas ----------
create table if not exists public.jjp_wa_campaigns (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null ,
  name         text not null,
  kind         text not null default 'manual' check (kind in ('manual','reactivacion')),
  template_id  uuid ,
  body         text not null,            -- snapshot de la plantilla al lanzar
  status       text not null default 'en_cola'
               check (status in ('en_cola','enviando','pausada','completada','cancelada')),
  delay_min_s  int not null default 25 check (delay_min_s >= 10),
  delay_max_s  int not null default 70 check (delay_max_s >= delay_min_s),
  total        int not null default 0,
  sent_count   int not null default 0,
  failed_count int not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_campaigns_owner on public.jjp_wa_campaigns (owner_id, created_at desc);
create index if not exists jjp_wa_campaigns_active on public.jjp_wa_campaigns (status)
  where status in ('en_cola','enviando');

create trigger jjp_wa_campaigns_updated before update on public.jjp_wa_campaigns
  for each row execute function public.jjp_set_updated_at();

-- ---------- 4. Destinatarios ----------
create table if not exists public.jjp_wa_campaign_targets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null ,
  owner_id    uuid not null ,
  customer_id uuid ,
  phone       text not null,
  name        text,
  vars        jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
              check (status in ('pending','sent','failed','skipped')),
  message_id  uuid ,
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_targets_campaign on public.jjp_wa_campaign_targets (campaign_id, status);
create index if not exists jjp_wa_targets_owner_sent on public.jjp_wa_campaign_targets (owner_id, sent_at)
  where status = 'sent';

-- ---------- 5. RLS ----------
alter table public.jjp_wa_templates        enable row level security;
alter table public.jjp_wa_campaigns        enable row level security;
alter table public.jjp_wa_campaign_targets enable row level security;

-- Plantillas: leo las mías + las globales; escribo solo las mías; admin todo
create policy wa_tpl_sel on public.jjp_wa_templates for select to authenticated
  using (owner_id = auth.uid() or owner_id is null or public.jjp_is_admin());
create policy wa_tpl_ins on public.jjp_wa_templates for insert to authenticated
  with check (owner_id = auth.uid() or (owner_id is null and public.jjp_is_admin()));
create policy wa_tpl_upd on public.jjp_wa_templates for update to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_tpl_del on public.jjp_wa_templates for delete to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());

-- Campañas: cada vendedor las suyas; admin lee todas (supervisión)
create policy wa_camp_sel on public.jjp_wa_campaigns for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_camp_ins on public.jjp_wa_campaigns for insert to authenticated
  with check (owner_id = auth.uid());
create policy wa_camp_upd on public.jjp_wa_campaigns for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Targets: insertar solo en campañas propias; estados los cambia wa-server (service_role)
create policy wa_tgt_sel on public.jjp_wa_campaign_targets for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_tgt_ins on public.jjp_wa_campaign_targets for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.jjp_wa_campaigns c
                where c.id = campaign_id and c.owner_id = auth.uid())
  );

-- ---------- 6. Import masivo de contactos ----------
-- p_rows: [{name, phone, city?, tags?[], notes?}, ...]
-- Dedup por teléfono normalizado. Nuevos → cartera del vendedor que importa.
-- Existentes → solo completa vacíos y fusiona tags (no roba clientes de otros).
create or replace function public.jjp_wa_import_contacts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  r jsonb; v_name text; v_phone text; v_tags text[];
  v_ins int := 0; v_upd int := 0; v_bad int := 0;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Formato inválido o más de 500 filas';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name  := nullif(trim(r->>'name'), '');
    -- normalización VE: misma lógica que normVePhone, guardado local '0412...'
    v_phone := regexp_replace(coalesce(r->>'phone',''), '\D', '', 'g');
    if v_phone ~ '^58\d{10}$' then v_phone := '0' || substr(v_phone, 3); end if;
    if v_phone ~ '^[24]\d{9}$' then v_phone := '0' || v_phone; end if;
    v_tags  := coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(r->'tags','[]'::jsonb)) t), '{}');

    if v_name is null or v_phone !~ '^0\d{10}$' then
      v_bad := v_bad + 1; continue;
    end if;

    select id into v_id from public.jjp_customers where phone = v_phone;
    if v_id is null then
      insert into public.jjp_customers (name, phone, city, notes, tags, seller_id)
      values (v_name, v_phone, nullif(trim(r->>'city'),''), nullif(trim(r->>'notes'),''), v_tags, auth.uid());
      v_ins := v_ins + 1;
    else
      update public.jjp_customers set
        city       = coalesce(city, nullif(trim(r->>'city'),'')),
        notes      = coalesce(notes, nullif(trim(r->>'notes'),'')),
        tags       = (select array_agg(distinct t) from unnest(tags || v_tags) t),
        seller_id  = coalesce(seller_id, auth.uid()),
        updated_at = now()
      where id = v_id;
      v_upd := v_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_bad);
end $$;

revoke execute on function public.jjp_wa_import_contacts(jsonb) from public, anon;
grant execute on function public.jjp_wa_import_contacts(jsonb) to authenticated;

-- ---------- 7. Reactivación automática de inactivos ----------
-- Diario: por cada vendedor con sesión WhatsApp habilitada, crea UNA campaña
-- 'reactivacion' con sus clientes inactivos (+wa_react_days, cooldown, sin opt-out).
-- wa-server la despacha igual que una manual. También notifica al vendedor.
create or replace function public.jjp_wa_enqueue_reactivations()
returns text
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_days     int := coalesce((select value::int from public.jjp_settings where key='wa_react_days'), 60);
  v_cool     int := coalesce((select value::int from public.jjp_settings where key='wa_react_cooldown_days'), 30);
  v_disc     int := coalesce((select value::int from public.jjp_settings where key='wa_react_discount'), 10);
  v_on       boolean := coalesce((select value from public.jjp_settings where key='wa_react_enabled'), 'true') in ('true','1','si');
  v_site     text := coalesce((select value from public.jjp_settings where key='site_url'), 'https://jjpaper-store.netlify.app');
  v_body     text;
  v_tpl      uuid;
  v_seller   record;
  v_camp     uuid;
  v_n        int;
  v_total    int := 0;
begin
  if not v_on then return 'reactivación desactivada (wa_react_enabled)'; end if;

  select id, body into v_tpl, v_body from public.jjp_wa_templates
   where kind = 'reactivacion' and owner_id is null and active
   order by created_at limit 1;
  if v_body is null then return 'sin plantilla global de reactivación'; end if;

  for v_seller in
    select p.id, p.name, p.ref_code
      from public.jjp_profiles p
      join public.jjp_wa_sessions s on s.profile_id = p.id and s.enabled
     where p.active
  loop
    -- evita duplicar si el cron corre dos veces el mismo día
    if exists (select 1 from public.jjp_wa_campaigns
                where owner_id = v_seller.id and kind = 'reactivacion'
                  and created_at::date = current_date) then
      continue;
    end if;

    insert into public.jjp_wa_campaigns (owner_id, name, kind, template_id, body, status)
    values (v_seller.id, 'Reactivación ' || to_char(now(), 'DD/MM'), 'reactivacion', v_tpl, v_body, 'en_cola')
    returning id into v_camp;

    insert into public.jjp_wa_campaign_targets (campaign_id, owner_id, customer_id, phone, name, vars)
    select v_camp, v_seller.id, c.id, c.phone, c.name,
           jsonb_build_object(
             'nombre',    c.name,
             'vendedor',  v_seller.name,
             'descuento', v_disc::text,
             'link',      v_site || '/catalogo.html' ||
                          coalesce('?ref=' || v_seller.ref_code, ''))
      from public.jjp_customers c
     where c.seller_id = v_seller.id
       and not c.wa_opt_out
       and c.phone is not null and c.phone <> ''
       and c.total_orders > 0
       and c.last_order_at is not null
       and c.last_order_at < now() - (v_days || ' days')::interval
       and (c.last_reactivation_at is null or c.last_reactivation_at < now() - (v_cool || ' days')::interval);

    get diagnostics v_n = row_count;
    if v_n = 0 then
      delete from public.jjp_wa_campaigns where id = v_camp;
      continue;
    end if;

    update public.jjp_wa_campaigns set total = v_n where id = v_camp;
    update public.jjp_customers set last_reactivation_at = now()
     where id in (select customer_id from public.jjp_wa_campaign_targets where campaign_id = v_camp);

    insert into public.jjp_notifications (user_id, type, title, body, link)
    values (v_seller.id, 'wa_reactivacion',
            '🔄 Campaña de reactivación creada',
            v_n || ' cliente(s) inactivos +' || v_days || 'd recibirán tu mensaje con ' ||
            v_disc || '% de descuento. Puedes pausarla en Difusión.',
            '/vendedor/difusion.html');

    v_total := v_total + v_n;
  end loop;

  return 'ok targets=' || v_total;
end $$;

revoke execute on function public.jjp_wa_enqueue_reactivations() from public, anon, authenticated;

-- ---------- 8. Settings ----------
insert into public.jjp_settings (key, value) values
  ('wa_react_days', '60'),
  ('wa_react_cooldown_days', '30'),
  ('wa_react_discount', '10'),
  ('wa_react_enabled', 'true'),
  ('wa_daily_limit', '150')
on conflict (key) do nothing;

-- ---------- 9. Plantillas globales semilla ----------
insert into public.jjp_wa_templates (owner_id, name, body, kind)
select null, 'Presentación de catálogo',
'Hola {{nombre}} 👋, le saluda {{vendedor}} de *JJ Paper* 📄

Somos distribuidores de papelería y suministros de oficina: resmas, tóner, artículos escolares y más, con entrega y precios al mayor.

Le comparto nuestro catálogo actualizado para que lo revise cuando guste:
👉 {{link}}

Si necesita una cotización, quedo atento por aquí. ¡Gracias por su tiempo!',
'general'
where not exists (select 1 from public.jjp_wa_templates where owner_id is null and kind = 'general');

insert into public.jjp_wa_templates (owner_id, name, body, kind)
select null, 'Reactivación con descuento',
'Hola {{nombre}} 👋, le escribe {{vendedor}} de *JJ Paper* 📄

Hace tiempo no le acompañamos con su papelería y suministros de oficina, y no queremos que se quede con stock bajo 📉.

Para ponérselo fácil: haciendo su pedido por este enlace obtiene *{{descuento}}% de descuento* en su facturación, sea el producto o la cantidad que escoja:
👉 {{link}}

Estamos para servirle. ¡Será un gusto atenderle de nuevo! 🤝',
'reactivacion'
where not exists (select 1 from public.jjp_wa_templates where owner_id is null and kind = 'reactivacion');

-- ---------- 10. Realtime (progreso en vivo en el panel) ----------
alter publication supabase_realtime add table public.jjp_wa_campaigns;
alter publication supabase_realtime add table public.jjp_wa_campaign_targets;

-- ---------- 11. Cron diario (9:15am Venezuela = 13:15 UTC) ----------
select cron.schedule('jjp-wa-reactivacion', '15 13 * * *',
  $$select public.jjp_wa_enqueue_reactivations()$$);


-- =========================================
-- FILE: 2026-07-18-count-tally.sql
-- =========================================
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
  variant_id  uuid not null ,
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


-- =========================================
-- FILE: 2026-07-18-count-log.sql
-- =========================================
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
  variant_id    uuid ,
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


-- =========================================
-- FILE: 2026-07-18-count-control.sql
-- =========================================
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
  variant_id  uuid ,
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


-- =========================================
-- FILE: 2026-07-18-scan-bridge-v2.sql
-- =========================================
-- ============================================================
-- JJ Paper — Puente de escaneo teléfono ⇄ PC  (v2, bidireccional)
--
-- v1 era de una sola vía: el teléfono insertaba el código y quedaba
-- a ciegas (no sabía si la PC lo recibió, ni de qué producto se trataba).
-- v2 agrega la vía de vuelta: la PC procesa el evento, escribe el
-- resultado y el teléfono lo ve en vivo por Realtime.
--
-- Aditivo. Idempotente. Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Columnas de respuesta ----------
alter table public.jjp_scan_events
  add column if not exists handled_at timestamptz,          -- cuándo lo procesó la PC
  add column if not exists result     jsonb,                -- { ok, kind, name, counted, msg }
  add column if not exists device     text;                 -- etiqueta del teléfono (opcional)

-- Pendientes: lo que el teléfono envió y la PC todavía no procesó
-- (permite recuperar escaneos hechos con la PC cerrada o desconectada)
create index if not exists jjp_scan_events_pending_idx
  on public.jjp_scan_events (owner_id, created_at)
  where handled_at is null;

-- ---------- 2. RLS: permitir que la PC responda ----------
drop policy if exists jjp_scan_upd on public.jjp_scan_events;
create policy jjp_scan_upd on public.jjp_scan_events for update to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

-- ---------- 3. Realtime en los UPDATE ----------
-- Sin REPLICA IDENTITY FULL, Supabase no emite el filtro owner_id en updates.
alter table public.jjp_scan_events replica identity full;

-- ---------- 4. Limpieza automática ----------
-- Los eventos son efímeros: sólo sirven durante el conteo.
create or replace function public.jjp_purge_scan_events()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare n integer;
begin
  delete from public.jjp_scan_events where created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 5. Progreso del conteo ----------
-- stock = -1 significa "sin control" y, durante un inventario, "aún no contado".
-- Esta vista da el avance sin traerse las 490 filas al teléfono.
create or replace view public.jjp_count_progress
with (security_invoker = on) as
  select
    count(*)                                  as total,
    count(*) filter (where stock >= 0)        as contados,
    count(*) filter (where stock < 0)         as pendientes,
    count(*) filter (where barcode is not null and barcode <> '') as con_codigo
  from public.jjp_product_variants
  where active is not false;

grant select on public.jjp_count_progress to authenticated;


-- =========================================
-- FILE: 2026-07-18-sku-bridge.sql
-- =========================================
-- ============================================================
-- JJ Paper — Puente de SKU entre productos, variantes e imágenes
--
-- Problema: el SKU vive sólo en jjp_product_variants. Las 502 filas
-- de jjp_products tienen sku vacío. Cualquier import o script que
-- busque un producto por products.sku no encuentra nada y termina
-- creando un producto duplicado — que es exactamente el cruce de
-- inventario que queremos evitar al subir las fotos clasificadas.
--
-- Solución: copiar el SKU de la variante al producto (hoy la relación
-- es 1:1 — verificado: 0 productos con más de una variante) y poner
-- un índice único que impida el duplicado a futuro.
--
-- Aditivo. Idempotente. No toca stock, conteos ni precios.
-- Base: oeiuczltgdexwjjgquyq.
-- ============================================================

-- ---------- 1. Copiar SKU de la variante al producto ----------
-- Sólo rellena lo vacío: nunca pisa un SKU ya escrito a mano.
update public.jjp_products p
set    sku = v.sku
from   public.jjp_product_variants v
where  v.product_id = p.id
  and  coalesce(p.sku, '') = ''
  and  coalesce(v.sku, '') <> '';

-- ---------- 2. Índice único, insensible a mayúsculas ----------
-- Parcial: los productos sin SKU (altas rápidas desde el escáner)
-- siguen siendo válidos. 'ko-boa' y 'KO-BOA' cuentan como el mismo.
create unique index if not exists jjp_products_sku_uniq
  on public.jjp_products (upper(sku))
  where coalesce(sku, '') <> '';

create unique index if not exists jjp_product_variants_sku_uniq
  on public.jjp_product_variants (upper(sku))
  where coalesce(sku, '') <> '';

-- ---------- 3. Resolver un SKU a su variante ----------
-- Lo que usa subir_imagenes.py: dado el SKU del nombre de archivo,
-- devuelve a qué variante pertenece y si ya tiene foto. Nunca crea
-- nada — si el SKU no existe devuelve 0 filas y el script aparta la
-- imagen en SIN_MATCH/ para revisión manual.
create or replace function public.jjp_variant_by_sku(p_sku text)
returns table (
  variant_id   uuid,
  product_id   uuid,
  nombre       text,
  tiene_imagen boolean
)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select v.id,
         p.id,
         p.name,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '')
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  where  upper(v.sku) = upper(trim(p_sku))
  limit  1;
$$;

-- ---------- 4. Catálogo vivo para el clasificador ----------
-- Reemplaza al catalogo_full.csv exportado a mano. El clasificador
-- lee de acá, así que un producto dado de alta desde el escáner
-- aparece de inmediato y la IA deja de mandarlo a _revisar_manual.
create or replace view public.jjp_catalog_export as
  select v.sku            as codigo,
         p.name           as descripcion,
         coalesce(c.name, '') as categoria,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '') as tiene_imagen
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.sku,'') <> '';

-- ---------- 5. Cola de fotos priorizada ----------
-- Lo que alimenta la pestaña "Faltan fotos" del admin: los productos
-- sin imagen, ordenados por plata inmovilizada (stock ya contado x
-- precio). Primero lo que está en el estante sin poder venderse.
create or replace view public.jjp_missing_photos as
  select v.id               as variant_id,
         v.sku,
         p.name             as producto,
         coalesce(c.name, 'Sin categoría') as categoria,
         nullif(v.stock, -1) as stock,
         v.price_usd,
         case when coalesce(v.stock,-1) > 0
              then round(v.stock * coalesce(v.price_usd,0), 2)
              else 0 end   as usd_parado
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.image_url,'') = ''
    and  coalesce(p.image_url,'') = '';

grant select on public.jjp_catalog_export  to authenticated;
grant select on public.jjp_missing_photos  to authenticated;

-- ============================================================
-- CORRECCIÓN (misma fecha): las vistas de arriba se crearon sin
-- security_invoker y con dueño postgres, así que se ejecutaban con los
-- permisos del dueño y salteaban el RLS de las tablas de abajo. Un
-- cliente autenticado podía leer stock y costos por ahí — justo lo que
-- se acababa de sacar de la ficha pública.
--
-- Se recrean con security_invoker (respetan el RLS de quien consulta) y
-- con un filtro de personal adentro de la propia vista, para que
-- devuelvan 0 filas a quien no sea staff. El service_role queda exento
-- porque los scripts de wa-server no tienen auth.uid().
--
-- Verificado: admin ve 284 filas, usuario autenticado sin perfil ve 0.
-- Ver la migración `missing_photos_views_staff_only`.
-- ============================================================

-- ---------- 6. Resolver SKU: versión final ----------
-- El clasificador sanea el nombre de archivo reemplazando lo no
-- alfanumérico por guiones, así que "CEL-T1/2" llega como "cel-t1-2" y
-- la comparación exacta falla (11 SKU llevan barra). Segundo intento sin
-- separadores; verificado 0 colisiones entre los 502 SKU. 'exacto'
-- distingue el acierto literal del recuperado.
drop function if exists public.jjp_variant_by_sku(text);

create function public.jjp_variant_by_sku(p_sku text)
returns table (
  variant_id   uuid,
  product_id   uuid,
  nombre       text,
  tiene_imagen boolean,
  exacto       boolean
)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  with buscado as (
    select upper(trim(p_sku)) as crudo,
           regexp_replace(upper(trim(p_sku)), '[^A-Z0-9]', '', 'g') as plano
  )
  select v.id, p.id, p.name,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> ''),
         (upper(v.sku) = b.crudo)
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  cross  join buscado b
  where  upper(v.sku) = b.crudo
     or  regexp_replace(upper(v.sku), '[^A-Z0-9]', '', 'g') = b.plano
  order  by (upper(v.sku) = b.crudo) desc
  limit  1;
$$;

-- ---------- 7. Vistas: versión final, sólo personal ----------
create or replace view public.jjp_catalog_export
with (security_invoker = true) as
  select v.sku            as codigo,
         p.name           as descripcion,
         coalesce(c.name, '') as categoria,
         (coalesce(v.image_url,'') <> '' or coalesce(p.image_url,'') <> '') as tiene_imagen
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.sku,'') <> ''
    and  ( auth.role() = 'service_role'
           or exists (select 1 from public.jjp_profiles
                      where id = auth.uid() and active) );

create or replace view public.jjp_missing_photos
with (security_invoker = true) as
  select v.id               as variant_id,
         v.sku,
         p.name             as producto,
         coalesce(c.name, 'Sin categoría') as categoria,
         nullif(v.stock, -1) as stock,
         v.price_usd,
         case when coalesce(v.stock,-1) > 0
              then round(v.stock * coalesce(v.price_usd,0), 2)
              else 0 end   as usd_parado
  from   public.jjp_product_variants v
  join   public.jjp_products p on p.id = v.product_id
  left   join public.jjp_categories c on c.id = p.category_id
  where  coalesce(v.image_url,'') = ''
    and  coalesce(p.image_url,'') = ''
    and  ( auth.role() = 'service_role'
           or exists (select 1 from public.jjp_profiles
                      where id = auth.uid() and active) );

revoke all    on public.jjp_catalog_export from anon;
revoke all    on public.jjp_missing_photos from anon;
grant  select on public.jjp_catalog_export to authenticated;
grant  select on public.jjp_missing_photos to authenticated;


-- =========================================
-- FILE: 2026-07-19-count-batch.sql
-- =========================================
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


-- =========================================
-- FILE: 2026-07-19-count-multiuser.sql
-- =========================================
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


-- =========================================
-- FILE: 2026-07-19-security-hardening.sql
-- =========================================
-- ============================================================
-- JJ Paper — Endurecimiento de seguridad (aplicado 19-jul-2026)
--
-- A partir de los asesores de Supabase (75 avisos, todos WARN, sin ERROR).
-- Cambios QUIRÚRGICOS: no tocan el sitio público (lead, rastreo, catálogo
-- siguen siendo anon).
--   1. Se le quita a `anon`/PUBLIC la ejecución de las RPC de conteo y de
--      códigos (authenticated conserva su grant explícito; el wa-server usa
--      service_role). Antes anon podía invocarlas (aunque fallaban por
--      auth.uid() nulo) — defensa en profundidad.
--   2. Se fija search_path en los triggers de updated_at (evita hijacking).
--   3. Se borran funciones huérfanas del proyecto viejo de fútbol
--      (calc_ovr / trigger_recalc_ovr): ningún trigger las usaba.
--
-- Pendiente MANUAL (no es SQL): activar "Leaked password protection" en
-- Supabase Dashboard → Authentication → Passwords.
--
-- Base: oeiuczltgdexwjjgquyq. Idempotente.
-- ============================================================

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'jjp_count%' or p.proname in ('jjp_barcode_assign','jjp_barcode_clear'))
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('calc_ovr','trigger_recalc_ovr')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

alter function public.jjp_set_updated_at() set search_path = 'public','pg_temp';
alter function public.update_updated_at_column() set search_path = 'public','pg_temp';


-- =========================================
-- FILE: 2026-07-23-fx-rates-history.sql
-- =========================================
-- =====================================================================
-- Historial de tasas de cambio (BCV, Binance P2P real, Monitor/paralelo)
-- Aplicada el 23-jul-2026 como migración "fx_rates_history".
-- Lo alimenta wa-server/src/rates.js cada hora.
--
-- Contexto: el sitio cobra en Bs a tasa BCV, pero los proveedores cobran
-- a tasa USDT Binance P2P. La fuente anterior (dolarapi "paralelo") es el
-- Monitor, que va por debajo del Binance real → el factor de protección
-- de margen quedaba corto. Ahora: Binance real (CriptoYa) + Monitor como
-- referencia + historial para ver la tendencia.
-- =====================================================================

create table if not exists public.jjp_fx_rates (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  bcv        numeric(12,4),
  binance    numeric(12,4),
  monitor    numeric(12,4)
);

create index if not exists jjp_fx_rates_at_idx on public.jjp_fx_rates (at desc);

alter table public.jjp_fx_rates enable row level security;

-- Solo usuarios autenticados (admin/vendedor) leen; escribe únicamente service_role.
drop policy if exists "fx rates read auth" on public.jjp_fx_rates;
create policy "fx rates read auth" on public.jjp_fx_rates
  for select to authenticated using (true);

revoke all on public.jjp_fx_rates from anon;


-- =========================================
-- FILE: 2026-07-25-delivery.sql
-- =========================================
-- ======================================================
-- Delivery cotizado por distancia (25-jul-2026)
-- Aplicada en Supabase como migración: delivery_fee_orders
--
-- El cliente marca el punto de entrega en el checkout (Leaflet + OSM),
-- la distancia se calcula en línea recta × 1.4 desde la tienda
-- (jjp_settings.map_lat/map_lng) y el costo = base + $/km.
-- El staff CONFIRMA o ajusta el costo en admin/pedidos antes de preparar.
-- ======================================================

alter table public.jjp_orders
  add column if not exists delivery_type          text check (delivery_type in ('retiro','delivery')),
  add column if not exists delivery_lat           numeric,
  add column if not exists delivery_lng           numeric,
  add column if not exists delivery_distance_km   numeric,
  add column if not exists delivery_fee_usd       numeric not null default 0 check (delivery_fee_usd >= 0),
  add column if not exists delivery_fee_confirmed boolean not null default false;

-- Tarifas configurables desde admin/ajustes.
-- Quedan legibles por anon a propósito: el checkout público las necesita
-- (la política jjp_settings_sel_public es lista negra y no las bloquea).
insert into public.jjp_settings (key, value) values
  ('delivery_base_usd','1'),        -- costo base del envío
  ('delivery_per_km_usd','0.20'),   -- $ por km (línea recta × 1.4)
  ('delivery_free_over_usd','50')   -- envío gratis desde este subtotal (0 = nunca)
on conflict (key) do nothing;

-- ------------------------------------------------------
-- Fix aplicado como migración: decide_discount_keeps_delivery_fee
-- El total ahora puede incluir envío: al aprobar/rechazar un descuento
-- hay que conservar delivery_fee_usd (antes total_usd = subtotal*(1-pct)
-- borraba el costo del envío del total).
-- Cambio: total_usd/total_bs suman coalesce(delivery_fee_usd,0) en ambas ramas.
-- (definición completa en el historial de migraciones de Supabase)
-- ------------------------------------------------------

-- ------------------------------------------------------
-- Migración: track_normalize_and_delete_order (25-jul-2026)
-- 1) jjp_track_order / jjp_track_quote: número case-insensitive y teléfono
--    comparado por últimos 10 dígitos (formatos 0412-..., +58412... coinciden).
-- 2) jjp_delete_order(uuid): borrado real de pedidos, SOLO admin y SOLO
--    en estado rechazado/cancelado; repone stock si estaba descontado.
--    EXECUTE revocado de public y anon.
-- (definiciones completas en el historial de migraciones de Supabase)
-- ------------------------------------------------------


-- =========================================
-- FILE: 2026-07-25-wa-presence.sql
-- =========================================
-- ============================================================
-- JJ Paper — presencia entrante del CRM WhatsApp (25-jul-2026)
--
-- El panel ya podía MANDAR "escribiendo…" al cliente, pero no RECIBIR el del
-- cliente. Para eso wa-server necesita dos permisos nuevos desde el panel:
--
--   watch    → observar la presencia de un chat (presenceSubscribe)
--   online   → el panel está a la vista: nos declaramos disponibles en WhatsApp
--              (es requisito de WhatsApp para que entregue la presencia ajena)
--   offline  → el panel se cerró: volvemos a invisible
--
-- 'online'/'offline' no pertenecen a ningún chat: van con chat_id nulo y
-- jid = 'self'. La presencia recibida NO se guarda en ninguna tabla — viaja por
-- Realtime Broadcast (canal 'wa-presence-<profile_id>'), así que no gasta cuota.
-- ============================================================

alter table public.jjp_wa_actions drop constraint if exists jjp_wa_actions_kind_check;

alter table public.jjp_wa_actions add constraint jjp_wa_actions_kind_check
  check (kind = any (array['react', 'read', 'typing', 'stop_typing', 'watch', 'online', 'offline']));


-- =========================================
-- FILE: 2026-07-26-factura-fiscal.sql
-- =========================================
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


-- =========================================
-- FILE: 2026-07-26-integraciones.sql
-- =========================================
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
  ;
alter table public.jjp_orders add column if not exists quote_id uuid
  ;
alter table public.jjp_quotes add column if not exists customer_id uuid
  ;

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


-- =========================================
-- FILE: 2026-08-06-seller-prices.sql
-- =========================================
-- Migración: Precios personalizados por vendedor
-- Creado: 2026-08-06

-- 1. Crear la tabla de precios personalizados por vendedor
CREATE TABLE IF NOT EXISTS public.jjp_seller_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL ,
    product_id UUID NOT NULL ,
    variant_id UUID ,
    price_usd NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Índices únicos para garantizar que un vendedor solo tenga un precio personalizado por producto/variante
CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_with_variant 
ON public.jjp_seller_prices (seller_id, product_id, variant_id) 
WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_no_variant 
ON public.jjp_seller_prices (seller_id, product_id) 
WHERE variant_id IS NULL;

-- 3. Habilitar RLS en la tabla
ALTER TABLE public.jjp_seller_prices ENABLE ROW LEVEL SECURITY;

-- 4. Crear las políticas de RLS
-- Cualquiera (incluyendo anon o visitantes de catálogo, aunque no lo usen directamente) puede leer para consistencia
CREATE POLICY "Cualquiera puede leer precios personalizados" 
ON public.jjp_seller_prices FOR SELECT 
USING (true);

-- Solo el vendedor dueño de la fila puede insertar, actualizar o eliminar sus precios
CREATE POLICY "Vendedores pueden gestionar sus propios precios" 
ON public.jjp_seller_prices FOR ALL 
USING (auth.uid() = seller_id);


-- =========================================
-- FILE: 2026-08-17-customers-zone.sql
-- =========================================
-- ======================================================
-- JJ Paper — Columna `zone` en jjp_customers
-- 17-ago-2026 · ADITIVO e idempotente
--
-- El CRM (admin/clientes.html y vendedor/clientes.html) lee,
-- filtra y escribe `c.zone` (assets/js/admin/aclients.js,
-- assets/js/vendedor/vcustomers.js), pero la columna nunca se
-- creó en la reconstrucción de la base (13-jul). Sin ella:
--   · los filtros por zona no funcionan,
--   · los badges de zona se ven vacíos,
--   · "Nuevo cliente" (admin y vendedor) falla con el error
--     "column jjp_customers.zone does not exist".
--
-- Cómo ejecutar: Supabase Dashboard → SQL Editor → pegar y Run.
-- ======================================================

alter table public.jjp_customers
  add column if not exists zone text;

create index if not exists jjp_customers_zone_idx
  on public.jjp_customers (zone);

-- Backfill desde la carga previa: la zona estaba escrita en notes
-- ("Zona: 008"). Se copia a la columna nueva para no perder datos
-- antes de la recarga limpia.
update public.jjp_customers
   set zone = regexp_replace(notes, '^Zona:\s*', '')
 where zone is null
   and notes ~ '^Zona:\s*[0-9]+$';


-- =========================================
-- FILE: 2026-08-19-seller-settings.sql
-- =========================================
-- ======================================================
-- JJ Paper — Ajustes por vendedor (jjp_seller_settings)
-- Fecha: 2026-08-19
-- ------------------------------------------------------
-- Cada vendedor configura su propia "tasa del día", firma
-- de mensajes y preferencias (mostrar/ocultar Bs) sin
-- tocar los ajustes globales del negocio (jjp_settings).
--
-- Claves usadas por el panel del vendedor:
--   rate_usd        → tasa del día del vendedor (Bs por USD).
--                     Vacía/ausente = usa la oficial (BCV).
--   rate_updated_at → cuándo la fijó (solo lectura informativa).
--   signature       → firma que se agrega al pie de sus envíos.
--   show_bs         → '1' o '0' para mostrar/ocultar Bs.
--
-- IMPORTANTE: correr este archivo en el SQL editor de
-- Supabase (Dashboard → SQL Editor). No se aplica solo.
-- ======================================================

create table if not exists public.jjp_seller_settings (
  seller_id  uuid not null ,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (seller_id, key)
);

alter table public.jjp_seller_settings enable row level security;

-- Cada vendedor lee y escribe SOLO sus propias filas
create policy jjp_seller_settings_sel_own on public.jjp_seller_settings
  for select to authenticated
  using (seller_id = auth.uid());

create policy jjp_seller_settings_ins_own on public.jjp_seller_settings
  for insert to authenticated
  with check (seller_id = auth.uid());

create policy jjp_seller_settings_upd_own on public.jjp_seller_settings
  for update to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

create policy jjp_seller_settings_del_own on public.jjp_seller_settings
  for delete to authenticated
  using (seller_id = auth.uid());

-- Los admins pueden leerlas todas (visión general desde admin)
create policy jjp_seller_settings_sel_admin on public.jjp_seller_settings
  for select to authenticated
  using (public.jjp_is_admin());

-- Guarda la fecha de actualización en cada upsert (mismo patrón que jjp_settings)
create or replace function public.jjp_touch_seller_setting()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jjp_seller_settings_touch on public.jjp_seller_settings;
create trigger jjp_seller_settings_touch
  before insert or update on public.jjp_seller_settings
  for each row execute function public.jjp_touch_seller_setting();

-- =========================================
-- FILE: 2026-08-28-wa-campaigns-batch-columns.sql
-- =========================================
-- ══════════════════════════════════════════════════════════════════════════════
-- 2026-08-28 · BLINDAJE COMPLETO: jjp_wa_campaigns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS owner_id        UUID,
  ADD COLUMN IF NOT EXISTS created_by      UUID,
  ADD COLUMN IF NOT EXISTS name            TEXT,
  ADD COLUMN IF NOT EXISTS body            TEXT,
  ADD COLUMN IF NOT EXISTS message         TEXT,
  ADD COLUMN IF NOT EXISTS template_id     UUID,
  ADD COLUMN IF NOT EXISTS total           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_min_s     INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS delay_max_s     INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS batch_size      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_pause_m   INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS media_path      TEXT,
  ADD COLUMN IF NOT EXISTS media_type      TEXT,
  ADD COLUMN IF NOT EXISTS media_mime      TEXT,
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS media_size      INTEGER,
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ;

ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
ALTER TABLE public.jjp_wa_campaigns
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;

-- Migrar title→name solo si la columna title existe (SQL dinámico para evitar error de compilación)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jjp_wa_campaigns'
      AND column_name = 'title'
  ) THEN
    EXECUTE 'UPDATE public.jjp_wa_campaigns SET name = title WHERE name IS NULL AND title IS NOT NULL';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- =========================================
-- FILE: 2026-08-28-wa-messages-columnas-faltantes.sql
-- =========================================
-- ============================================================================
-- 2026-08-28 · Columnas faltantes en jjp_wa_messages (base nueva czzvsqnmxtjzqzioknnn)
-- Motivo: el wa-server inserta mensajes ENTRANTES con estas columnas; sin
--   ellas el CRM pierde todos los mensajes entrantes
--   ("Could not find the 'forwarded' column" a cientos en logs/server.log).
-- Aditivo: SOLO agrega columnas. NO toca filas, campañas, plantillas ni correos.
-- Ejecutar en Supabase SQL editor (proyecto czzvsqnmxtjzqzioknnn).
-- ============================================================================

ALTER TABLE public.jjp_wa_messages
  ADD COLUMN IF NOT EXISTS forwarded      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_to_wa_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_preview  TEXT,
  ADD COLUMN IF NOT EXISTS reply_from     TEXT,
  ADD COLUMN IF NOT EXISTS reaction       TEXT,
  ADD COLUMN IF NOT EXISTS reaction_from  TEXT;

-- =========================================
-- FILE: 2026-08-31-eliminar-campanas.sql
-- =========================================
-- ======================================================
-- JJ Paper — Eliminación real de campañas de WhatsApp (31-ago-2026)
-- Solo el dueño o el admin pueden borrar. Con ON DELETE CASCADE en
-- jjp_wa_campaign_targets, eliminar la campaña limpia sus destinatarios.
-- ======================================================

CREATE OR REPLACE FUNCTION public.jjp_delete_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Solo dueño o admin
  IF NOT EXISTS (
    SELECT 1 FROM public.jjp_wa_campaigns c
    WHERE c.id = p_campaign_id
      AND (c.owner_id = auth.uid() OR c.created_by = auth.uid() OR public.jjp_is_admin())
  ) THEN
    RETURN false;
  END IF;

  -- Borra la campaña; los targets caen por CASCADE
  DELETE FROM public.jjp_wa_campaigns WHERE id = p_campaign_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.jjp_delete_campaign(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jjp_delete_campaign(uuid) TO authenticated;

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';


-- =========================================
-- FILE: 2026-08-31-email-skipped-count.sql
-- =========================================
ALTER TABLE public.jjp_email_campaigns
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';


-- =========================================
-- FILE: 2026-08-31-reparacion-backend.sql
-- =========================================
-- Fase 1 — SQL de reparación definitiva

-- 1.1 y 1.2: Eliminar CHECKs restrictivos de campaigns y targets, y agregar columnas faltantes
ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER;

ALTER TABLE public.jjp_wa_campaigns 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
ALTER TABLE public.jjp_wa_campaigns 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;
ALTER TABLE public.jjp_wa_campaign_targets 
  DROP CONSTRAINT IF EXISTS jjp_wa_campaign_targets_status_check;

-- 1.3: Crear tablas jjp_email_campaigns + jjp_email_campaign_targets
CREATE TABLE IF NOT EXISTS public.jjp_email_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL ,
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  html          TEXT,
  attachments   JSONB DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','paused','done','cancelled')),
  delay_min_s   INT NOT NULL DEFAULT 5 CHECK (delay_min_s >= 1),
  delay_max_s   INT NOT NULL DEFAULT 15 CHECK (delay_max_s >= delay_min_s),
  total         INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  failed_count  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jjp_email_campaign_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL ,
  owner_id      UUID NOT NULL ,
  customer_id   UUID ,
  to_addr       TEXT NOT NULL,
  name          TEXT,
  vars          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sending','sent','failed','skipped')),
  email_id      UUID,
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.jjp_email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY ec_all ON public.jjp_email_campaigns FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

ALTER TABLE public.jjp_email_campaign_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ect_all ON public.jjp_email_campaign_targets FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.jjp_is_admin());

-- Índices
CREATE INDEX IF NOT EXISTS jjp_ec_status ON public.jjp_email_campaigns (status);
CREATE INDEX IF NOT EXISTS jjp_ect_camp ON public.jjp_email_campaign_targets (campaign_id, status);

-- 1.4: Alinear jjp_emails (agregar owner_id, to_addr, etc.)
ALTER TABLE public.jjp_emails
  ADD COLUMN IF NOT EXISTS owner_id    UUID ,
  ADD COLUMN IF NOT EXISTS to_addr     TEXT,
  ADD COLUMN IF NOT EXISTS from_addr   TEXT,
  ADD COLUMN IF NOT EXISTS body        TEXT,
  ADD COLUMN IF NOT EXISTS html        TEXT,
  ADD COLUMN IF NOT EXISTS gmail_id    TEXT,
  ADD COLUMN IF NOT EXISTS thread_id   TEXT,
  ADD COLUMN IF NOT EXISTS snippet     TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_id  TEXT,
  ADD COLUMN IF NOT EXISTS attach_state TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS campaign_id UUID;

-- Migrar datos de columnas viejas si existían
UPDATE public.jjp_emails SET owner_id = profile_id WHERE owner_id IS NULL AND profile_id IS NOT NULL;
UPDATE public.jjp_emails SET to_addr = to_email WHERE to_addr IS NULL AND to_email IS NOT NULL;
UPDATE public.jjp_emails SET from_addr = from_email WHERE from_addr IS NULL AND from_email IS NOT NULL;
UPDATE public.jjp_emails SET body = body_text WHERE body IS NULL AND body_text IS NOT NULL;
UPDATE public.jjp_emails SET html = body_html WHERE html IS NULL AND body_html IS NOT NULL;

CREATE INDEX IF NOT EXISTS jjp_emails_owner_dir ON public.jjp_emails (owner_id, direction);
CREATE INDEX IF NOT EXISTS jjp_emails_gmail_id ON public.jjp_emails (gmail_id) WHERE gmail_id IS NOT NULL;

-- 1.5: Agregar al Realtime las tablas nuevas
ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaigns;

-- 1.6: Notificar a postgrest para recargar esquema
NOTIFY pgrst, 'reload schema';


-- =========================================
-- FILE: 2026-08-31-skipped-count.sql
-- =========================================
ALTER TABLE public.jjp_wa_campaigns
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
