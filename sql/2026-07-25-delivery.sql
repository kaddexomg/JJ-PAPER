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
