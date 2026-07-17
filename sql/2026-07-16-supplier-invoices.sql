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
  supplier_id    uuid references public.jjp_suppliers(id) on delete set null,
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
  invoice_id uuid not null references public.jjp_supplier_invoices(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  method     text,                       -- efectivo / transferencia / Zelle...
  reference  text,
  note       text,
  paid_at    timestamptz not null default now(),
  created_by uuid references public.jjp_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists jjp_inv_pay_invoice on public.jjp_invoice_payments (invoice_id);

-- ---------- 4. Bitácora + cola de recordatorios ----------
-- Sirve para 2 cosas: (a) deduplicar avisos, (b) cola de push a WhatsApp.
create table if not exists public.jjp_invoice_alerts (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.jjp_supplier_invoices(id) on delete cascade,
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
