-- ==============================================================================
-- CORRECCIÓN DEFINITIVA DE TABLAS, COLUMNAS Y RELACIONES FALTANTES EN SUPABASE
-- ==============================================================================

-- 1. Precios y Variantes: Base comercial para cálculo de márgenes y sugerencias
alter table public.jjp_product_variants
  add column if not exists base_price_usd numeric,
  add column if not exists cost_usd numeric,
  add column if not exists margin_pct numeric;

update public.jjp_product_variants
   set base_price_usd = price_usd
 where base_price_usd is null;

-- 2. Productos: Asegurar cost_usd y group_id / essential
alter table public.jjp_products
  add column if not exists cost_usd numeric,
  add column if not exists essential boolean not null default false;

-- 3. Promociones (jjp_promotions)
create table if not exists public.jjp_promotions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  image_url   text,
  badge       text,
  discount_pct int default 0,
  link_url    text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  starts_at   timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
) using heap;

alter table public.jjp_promotions enable row level security;
drop policy if exists promo_sel on public.jjp_promotions;
create policy promo_sel on public.jjp_promotions for select to public using (true);
drop policy if exists promo_all on public.jjp_promotions;
create policy promo_all on public.jjp_promotions for all to authenticated using (public.jjp_is_admin());

-- 4. Cuenta de Empresa para Correo (jjp_email_company)
create table if not exists public.jjp_email_company (
  id          int primary key default 1 check (id = 1),
  email       text,
  from_name   text,
  app_pass    text,
  enabled     boolean not null default false,
  verified    boolean not null default false,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
) using heap;

alter table public.jjp_email_company add column if not exists has_cred boolean generated always as (app_pass is not null and app_pass <> '') stored;

alter table public.jjp_email_company enable row level security;
drop policy if exists ec_sel on public.jjp_email_company;
create policy ec_sel on public.jjp_email_company for select to authenticated using (public.jjp_is_admin());
drop policy if exists ec_all on public.jjp_email_company;
create policy ec_all on public.jjp_email_company for all to authenticated using (public.jjp_is_admin());

insert into public.jjp_email_company (id, enabled) values (1, false) on conflict (id) do nothing;

-- 5. WhatsApp CRM y Plantillas
create table if not exists public.jjp_wa_templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.jjp_profiles(id) on delete cascade,
  name       text not null,
  body       text not null,
  kind       text not null default 'general' check (kind in ('general','reactivacion','catalogo_corporativo','oferta')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) using heap;

alter table public.jjp_wa_templates enable row level security;
drop policy if exists wa_tpl_sel on public.jjp_wa_templates;
create policy wa_tpl_sel on public.jjp_wa_templates for select to authenticated using (owner_id = auth.uid() or owner_id is null or public.jjp_is_admin());
drop policy if exists wa_tpl_ins on public.jjp_wa_templates;
create policy wa_tpl_ins on public.jjp_wa_templates for insert to authenticated with check (owner_id = auth.uid() or (owner_id is null and public.jjp_is_admin()) or public.jjp_is_admin());
drop policy if exists wa_tpl_upd on public.jjp_wa_templates;
create policy wa_tpl_upd on public.jjp_wa_templates for update to authenticated using (owner_id = auth.uid() or public.jjp_is_admin());
drop policy if exists wa_tpl_del on public.jjp_wa_templates;
create policy wa_tpl_del on public.jjp_wa_templates for delete to authenticated using (owner_id = auth.uid() or public.jjp_is_admin());

-- Semillas de plantillas B2B
insert into public.jjp_wa_templates (owner_id, name, body, kind) values
(null, '💼 Presentación Corporativa B2B (Catálogo Mayorista)', 'Estimados señores de *{{empresa}}* 🏢, un cordial saludo.\n\nLe escribe *{{vendedor}}*, asesor comercial oficial de *JJ Paper*.\n\nNos dirigimos a ustedes para presentarles nuestra línea de suministros corporativos, papelería al mayor, resmas, consumibles de oficina y artículos de limpieza institucional con entrega directa a su empresa y atención personalizada.\n\n📄 Puede consultar nuestro catálogo digital completo y lista de precios actualizada en el siguiente enlace:\n👉 {{link}}\n\nEstamos a su total disposición para cotizaciones formales con RIF y facturación fiscal. ¿Tienen algún requerimiento pendiente esta semana? ¡Será un gusto atenderles! 🤝', 'catalogo_corporativo'),
(null, '📦 Surtido de Oficina y Papelería Mensual', 'Hola {{nombre}} 👋, le saluda *{{vendedor}}* de *JJ Paper*.\n\nEsperamos que todo marche excelente en *{{empresa}}*. Le compartimos nuestro catálogo interactivo para la reposición periódica de sus artículos de oficina, archivo, impresión y papelería:\n👉 {{link}}\n\n💡 *Beneficios corporativos:*\n• Precios especiales por volumen al mayor.\n• Despacho directo a su sede.\n• Atención directa para órdenes de compra y presupuestos.\n\nQuedo a su disposición para prepararle una propuesta a la medida de su empresa.', 'general')
on conflict do nothing;
