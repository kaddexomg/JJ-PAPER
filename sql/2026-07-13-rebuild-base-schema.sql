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
  unit_id     uuid references public.jjp_units(id) on delete set null,
  emoji       text,
  image_url   text,
  tag         text,
  active      boolean not null default true,
  featured    boolean not null default false,
  stock       int not null default -1,
  min_qty     int not null default 1,
  category_id uuid references public.jjp_categories(id) on delete set null,
  brand_id    uuid references public.jjp_brands(id) on delete set null,
  sku         text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.jjp_product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.jjp_products(id) on delete cascade,
  brand_id     uuid references public.jjp_brands(id) on delete set null,
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
  seller_id     uuid references public.jjp_profiles(id) on delete set null,
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
  seller_id       uuid references public.jjp_profiles(id) on delete set null,
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
  seller_id           uuid references public.jjp_profiles(id) on delete set null,
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
  user_id    uuid references public.jjp_profiles(id) on delete cascade,
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
