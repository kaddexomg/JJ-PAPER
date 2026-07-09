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
