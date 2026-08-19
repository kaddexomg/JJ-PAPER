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
  seller_id  uuid not null references public.jjp_profiles(id) on delete cascade,
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