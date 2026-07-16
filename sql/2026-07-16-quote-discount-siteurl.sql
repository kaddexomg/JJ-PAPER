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
