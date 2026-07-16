-- ======================================================
-- JJ Paper — Difusión WhatsApp para vendedores (16-jul-2026) · ADITIVO
-- Prospección + plantillas + campañas masivas + reactivación automática.
--   jjp_customers            + tags / wa_opt_out / last_reactivation_at
--   jjp_wa_templates         plantillas con variables {{nombre}} {{vendedor}} {{link}} {{descuento}}
--   jjp_wa_campaigns         una campaña = plantilla + audiencia + throttle
--   jjp_wa_campaign_targets  un destinatario por fila (estado individual)
--   jjp_wa_import_contacts() import masivo de contactos (RPC, dedup por teléfono)
--   jjp_wa_enqueue_reactivations() + cron diario jjp-wa-reactivacion
-- El envío real lo hace wa-server/src/campaigns.js (service_role):
-- toma targets pending, crea el chat si falta y encola en jjp_wa_messages
-- con espera aleatoria entre mensajes (anti-baneo) y límite diario.
-- Reusa: jjp_is_admin(), jjp_set_updated_at(). Idempotente.
-- ======================================================

-- ---------- 1. Columnas nuevas en clientes ----------
alter table public.jjp_customers
  add column if not exists tags text[] not null default '{}',
  add column if not exists wa_opt_out boolean not null default false,
  add column if not exists last_reactivation_at timestamptz;

create index if not exists jjp_customers_tags on public.jjp_customers using gin (tags);

-- ---------- 2. Plantillas ----------
-- owner_id null = plantilla global (solo admin la crea/edita; todos la leen)
create table if not exists public.jjp_wa_templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.jjp_profiles(id) on delete cascade,
  name       text not null,
  body       text not null,
  kind       text not null default 'general' check (kind in ('general','reactivacion')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) using heap;

create trigger jjp_wa_templates_updated before update on public.jjp_wa_templates
  for each row execute function public.jjp_set_updated_at();

-- ---------- 3. Campañas ----------
create table if not exists public.jjp_wa_campaigns (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.jjp_profiles(id) on delete cascade,
  name         text not null,
  kind         text not null default 'manual' check (kind in ('manual','reactivacion')),
  template_id  uuid references public.jjp_wa_templates(id) on delete set null,
  body         text not null,            -- snapshot de la plantilla al lanzar
  status       text not null default 'en_cola'
               check (status in ('en_cola','enviando','pausada','completada','cancelada')),
  delay_min_s  int not null default 25 check (delay_min_s >= 10),
  delay_max_s  int not null default 70 check (delay_max_s >= delay_min_s),
  total        int not null default 0,
  sent_count   int not null default 0,
  failed_count int not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_campaigns_owner on public.jjp_wa_campaigns (owner_id, created_at desc);
create index if not exists jjp_wa_campaigns_active on public.jjp_wa_campaigns (status)
  where status in ('en_cola','enviando');

create trigger jjp_wa_campaigns_updated before update on public.jjp_wa_campaigns
  for each row execute function public.jjp_set_updated_at();

-- ---------- 4. Destinatarios ----------
create table if not exists public.jjp_wa_campaign_targets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.jjp_wa_campaigns(id) on delete cascade,
  owner_id    uuid not null references public.jjp_profiles(id) on delete cascade,
  customer_id uuid references public.jjp_customers(id) on delete set null,
  phone       text not null,
  name        text,
  vars        jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
              check (status in ('pending','sent','failed','skipped')),
  message_id  uuid references public.jjp_wa_messages(id) on delete set null,
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_targets_campaign on public.jjp_wa_campaign_targets (campaign_id, status);
create index if not exists jjp_wa_targets_owner_sent on public.jjp_wa_campaign_targets (owner_id, sent_at)
  where status = 'sent';

-- ---------- 5. RLS ----------
alter table public.jjp_wa_templates        enable row level security;
alter table public.jjp_wa_campaigns        enable row level security;
alter table public.jjp_wa_campaign_targets enable row level security;

-- Plantillas: leo las mías + las globales; escribo solo las mías; admin todo
create policy wa_tpl_sel on public.jjp_wa_templates for select to authenticated
  using (owner_id = auth.uid() or owner_id is null or public.jjp_is_admin());
create policy wa_tpl_ins on public.jjp_wa_templates for insert to authenticated
  with check (owner_id = auth.uid() or (owner_id is null and public.jjp_is_admin()));
create policy wa_tpl_upd on public.jjp_wa_templates for update to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_tpl_del on public.jjp_wa_templates for delete to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());

-- Campañas: cada vendedor las suyas; admin lee todas (supervisión)
create policy wa_camp_sel on public.jjp_wa_campaigns for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_camp_ins on public.jjp_wa_campaigns for insert to authenticated
  with check (owner_id = auth.uid());
create policy wa_camp_upd on public.jjp_wa_campaigns for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Targets: insertar solo en campañas propias; estados los cambia wa-server (service_role)
create policy wa_tgt_sel on public.jjp_wa_campaign_targets for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_tgt_ins on public.jjp_wa_campaign_targets for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.jjp_wa_campaigns c
                where c.id = campaign_id and c.owner_id = auth.uid())
  );

-- ---------- 6. Import masivo de contactos ----------
-- p_rows: [{name, phone, city?, tags?[], notes?}, ...]
-- Dedup por teléfono normalizado. Nuevos → cartera del vendedor que importa.
-- Existentes → solo completa vacíos y fusiona tags (no roba clientes de otros).
create or replace function public.jjp_wa_import_contacts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  r jsonb; v_name text; v_phone text; v_tags text[];
  v_ins int := 0; v_upd int := 0; v_bad int := 0;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Formato inválido o más de 500 filas';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name  := nullif(trim(r->>'name'), '');
    -- normalización VE: misma lógica que normVePhone, guardado local '0412...'
    v_phone := regexp_replace(coalesce(r->>'phone',''), '\D', '', 'g');
    if v_phone ~ '^58\d{10}$' then v_phone := '0' || substr(v_phone, 3); end if;
    if v_phone ~ '^[24]\d{9}$' then v_phone := '0' || v_phone; end if;
    v_tags  := coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(r->'tags','[]'::jsonb)) t), '{}');

    if v_name is null or v_phone !~ '^0\d{10}$' then
      v_bad := v_bad + 1; continue;
    end if;

    select id into v_id from public.jjp_customers where phone = v_phone;
    if v_id is null then
      insert into public.jjp_customers (name, phone, city, notes, tags, seller_id)
      values (v_name, v_phone, nullif(trim(r->>'city'),''), nullif(trim(r->>'notes'),''), v_tags, auth.uid());
      v_ins := v_ins + 1;
    else
      update public.jjp_customers set
        city       = coalesce(city, nullif(trim(r->>'city'),'')),
        notes      = coalesce(notes, nullif(trim(r->>'notes'),'')),
        tags       = (select array_agg(distinct t) from unnest(tags || v_tags) t),
        seller_id  = coalesce(seller_id, auth.uid()),
        updated_at = now()
      where id = v_id;
      v_upd := v_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_bad);
end $$;

revoke execute on function public.jjp_wa_import_contacts(jsonb) from public, anon;
grant execute on function public.jjp_wa_import_contacts(jsonb) to authenticated;

-- ---------- 7. Reactivación automática de inactivos ----------
-- Diario: por cada vendedor con sesión WhatsApp habilitada, crea UNA campaña
-- 'reactivacion' con sus clientes inactivos (+wa_react_days, cooldown, sin opt-out).
-- wa-server la despacha igual que una manual. También notifica al vendedor.
create or replace function public.jjp_wa_enqueue_reactivations()
returns text
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_days     int := coalesce((select value::int from public.jjp_settings where key='wa_react_days'), 60);
  v_cool     int := coalesce((select value::int from public.jjp_settings where key='wa_react_cooldown_days'), 30);
  v_disc     int := coalesce((select value::int from public.jjp_settings where key='wa_react_discount'), 10);
  v_on       boolean := coalesce((select value from public.jjp_settings where key='wa_react_enabled'), 'true') in ('true','1','si');
  v_site     text := coalesce((select value from public.jjp_settings where key='site_url'), 'https://jjpaper-store.netlify.app');
  v_body     text;
  v_tpl      uuid;
  v_seller   record;
  v_camp     uuid;
  v_n        int;
  v_total    int := 0;
begin
  if not v_on then return 'reactivación desactivada (wa_react_enabled)'; end if;

  select id, body into v_tpl, v_body from public.jjp_wa_templates
   where kind = 'reactivacion' and owner_id is null and active
   order by created_at limit 1;
  if v_body is null then return 'sin plantilla global de reactivación'; end if;

  for v_seller in
    select p.id, p.name, p.ref_code
      from public.jjp_profiles p
      join public.jjp_wa_sessions s on s.profile_id = p.id and s.enabled
     where p.active
  loop
    -- evita duplicar si el cron corre dos veces el mismo día
    if exists (select 1 from public.jjp_wa_campaigns
                where owner_id = v_seller.id and kind = 'reactivacion'
                  and created_at::date = current_date) then
      continue;
    end if;

    insert into public.jjp_wa_campaigns (owner_id, name, kind, template_id, body, status)
    values (v_seller.id, 'Reactivación ' || to_char(now(), 'DD/MM'), 'reactivacion', v_tpl, v_body, 'en_cola')
    returning id into v_camp;

    insert into public.jjp_wa_campaign_targets (campaign_id, owner_id, customer_id, phone, name, vars)
    select v_camp, v_seller.id, c.id, c.phone, c.name,
           jsonb_build_object(
             'nombre',    c.name,
             'vendedor',  v_seller.name,
             'descuento', v_disc::text,
             'link',      v_site || '/catalogo.html' ||
                          coalesce('?ref=' || v_seller.ref_code, ''))
      from public.jjp_customers c
     where c.seller_id = v_seller.id
       and not c.wa_opt_out
       and c.phone is not null and c.phone <> ''
       and c.total_orders > 0
       and c.last_order_at is not null
       and c.last_order_at < now() - (v_days || ' days')::interval
       and (c.last_reactivation_at is null or c.last_reactivation_at < now() - (v_cool || ' days')::interval);

    get diagnostics v_n = row_count;
    if v_n = 0 then
      delete from public.jjp_wa_campaigns where id = v_camp;
      continue;
    end if;

    update public.jjp_wa_campaigns set total = v_n where id = v_camp;
    update public.jjp_customers set last_reactivation_at = now()
     where id in (select customer_id from public.jjp_wa_campaign_targets where campaign_id = v_camp);

    insert into public.jjp_notifications (user_id, type, title, body, link)
    values (v_seller.id, 'wa_reactivacion',
            '🔄 Campaña de reactivación creada',
            v_n || ' cliente(s) inactivos +' || v_days || 'd recibirán tu mensaje con ' ||
            v_disc || '% de descuento. Puedes pausarla en Difusión.',
            '/vendedor/difusion.html');

    v_total := v_total + v_n;
  end loop;

  return 'ok targets=' || v_total;
end $$;

revoke execute on function public.jjp_wa_enqueue_reactivations() from public, anon, authenticated;

-- ---------- 8. Settings ----------
insert into public.jjp_settings (key, value) values
  ('wa_react_days', '60'),
  ('wa_react_cooldown_days', '30'),
  ('wa_react_discount', '10'),
  ('wa_react_enabled', 'true'),
  ('wa_daily_limit', '150')
on conflict (key) do nothing;

-- ---------- 9. Plantillas globales semilla ----------
insert into public.jjp_wa_templates (owner_id, name, body, kind)
select null, 'Presentación de catálogo',
'Hola {{nombre}} 👋, le saluda {{vendedor}} de *JJ Paper* 📄

Somos distribuidores de papelería y suministros de oficina: resmas, tóner, artículos escolares y más, con entrega y precios al mayor.

Le comparto nuestro catálogo actualizado para que lo revise cuando guste:
👉 {{link}}

Si necesita una cotización, quedo atento por aquí. ¡Gracias por su tiempo!',
'general'
where not exists (select 1 from public.jjp_wa_templates where owner_id is null and kind = 'general');

insert into public.jjp_wa_templates (owner_id, name, body, kind)
select null, 'Reactivación con descuento',
'Hola {{nombre}} 👋, le escribe {{vendedor}} de *JJ Paper* 📄

Hace tiempo no le acompañamos con su papelería y suministros de oficina, y no queremos que se quede con stock bajo 📉.

Para ponérselo fácil: haciendo su pedido por este enlace obtiene *{{descuento}}% de descuento* en su facturación, sea el producto o la cantidad que escoja:
👉 {{link}}

Estamos para servirle. ¡Será un gusto atenderle de nuevo! 🤝',
'reactivacion'
where not exists (select 1 from public.jjp_wa_templates where owner_id is null and kind = 'reactivacion');

-- ---------- 10. Realtime (progreso en vivo en el panel) ----------
alter publication supabase_realtime add table public.jjp_wa_campaigns;
alter publication supabase_realtime add table public.jjp_wa_campaign_targets;

-- ---------- 11. Cron diario (9:15am Venezuela = 13:15 UTC) ----------
select cron.schedule('jjp-wa-reactivacion', '15 13 * * *',
  $$select public.jjp_wa_enqueue_reactivations()$$);
