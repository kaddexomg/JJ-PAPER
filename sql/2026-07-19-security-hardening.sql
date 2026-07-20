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
