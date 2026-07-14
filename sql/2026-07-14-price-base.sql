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
