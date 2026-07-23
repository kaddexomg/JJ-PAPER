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
