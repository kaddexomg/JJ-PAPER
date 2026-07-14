-- ======================================================
-- JJ Paper — CRM WhatsApp Fase 1 (jul 2026) · ADITIVO
-- Puente: wa-server local (Baileys, service_role) ↔ Supabase ↔ frontend.
-- Agrega:
--   jjp_wa_sessions   una sesión WhatsApp por perfil staff (QR/pairing, control remoto)
--   jjp_wa_chats      un hilo por (dueño, contacto), vinculado a jjp_customers
--   jjp_wa_messages   mensajes in/out con media y ciclo de estados
--   bucket jjp-wa-media (PRIVADO, URLs firmadas)
--   Realtime en las 3 tablas + semilla de sesiones
-- Reusa: jjp_is_admin(), jjp_set_updated_at()
-- ======================================================

-- ---------- 1. Sesiones ----------
create table if not exists public.jjp_wa_sessions (
  profile_id        uuid primary key references public.jjp_profiles(id) on delete cascade,
  enabled           boolean not null default false,
  status            text not null default 'disabled'
                    check (status in ('disabled','starting','pending_qr','pending_pairing',
                                      'connected','disconnected','logged_out','error')),
  requested_action  text check (requested_action in ('connect','logout','request_pairing')),
  requested_at      timestamptz,
  pairing_phone     text,
  pairing_code      text,
  qr_data           text,
  qr_updated_at     timestamptz,
  wa_number         text,
  wa_name           text,
  last_connected_at timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
) using heap;
-- USING heap: el AM por defecto del proyecto es orioledb y su DDL quedó trancado
-- en un LWLock (12-jul-2026); heap es estándar y funciona igual para este volumen.

create trigger jjp_wa_sessions_updated before update on public.jjp_wa_sessions
  for each row execute function public.jjp_set_updated_at();

-- ---------- 2. Chats ----------
create table if not exists public.jjp_wa_chats (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.jjp_profiles(id) on delete cascade,
  jid                  text not null,
  phone                text not null,
  customer_id          uuid references public.jjp_customers(id) on delete set null,
  display_name         text,
  last_message_at      timestamptz,
  last_message_preview text,
  last_message_from    text check (last_message_from in ('me','them')),
  unread_count         int not null default 0,
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (owner_id, jid)
) using heap;

create index if not exists jjp_wa_chats_owner_last on public.jjp_wa_chats (owner_id, last_message_at desc nulls last);
create index if not exists jjp_wa_chats_customer   on public.jjp_wa_chats (customer_id);
create index if not exists jjp_wa_chats_phone      on public.jjp_wa_chats (phone);

create trigger jjp_wa_chats_updated before update on public.jjp_wa_chats
  for each row execute function public.jjp_set_updated_at();

-- ---------- 3. Mensajes ----------
create table if not exists public.jjp_wa_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references public.jjp_wa_chats(id) on delete cascade,
  owner_id       uuid not null references public.jjp_profiles(id) on delete cascade,
  wa_msg_id      text,
  direction      text not null check (direction in ('in','out')),
  type           text not null default 'text'
                 check (type in ('text','image','video','audio','document','sticker','unsupported')),
  body           text,
  media_path     text,
  media_mime     text,
  media_size     int,
  media_filename text,
  status         text not null default 'pending'
                 check (status in ('pending','sending','sent','delivered','read','received','failed')),
  error          text,
  retry_count    int not null default 0,
  wa_timestamp   timestamptz,
  created_at     timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_msgs_chat_time on public.jjp_wa_messages (chat_id, created_at);
create index if not exists jjp_wa_msgs_pending   on public.jjp_wa_messages (status) where status = 'pending';
create unique index if not exists jjp_wa_msgs_dedup on public.jjp_wa_messages (owner_id, wa_msg_id)
  where wa_msg_id is not null;

-- ---------- 4. RLS ----------
alter table public.jjp_wa_sessions enable row level security;
alter table public.jjp_wa_chats    enable row level security;
alter table public.jjp_wa_messages enable row level security;

-- Sesiones: cada quien la suya; admin todas (y controla 'enabled')
create policy wa_sess_sel on public.jjp_wa_sessions for select to authenticated
  using (profile_id = auth.uid() or public.jjp_is_admin());
create policy wa_sess_upd_own on public.jjp_wa_sessions for update to authenticated
  using (profile_id = auth.uid() and enabled)
  with check (profile_id = auth.uid());
create policy wa_sess_admin_all on public.jjp_wa_sessions for all to authenticated
  using (public.jjp_is_admin()) with check (public.jjp_is_admin());

-- Chats: vendedor solo los suyos; admin lee todo (supervisión)
create policy wa_chat_sel on public.jjp_wa_chats for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_chat_ins on public.jjp_wa_chats for insert to authenticated
  with check (owner_id = auth.uid());
create policy wa_chat_upd on public.jjp_wa_chats for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Mensajes: leer = dueño o admin; insertar SOLO salientes 'pending' en chats propios.
-- Sin UPDATE/DELETE para authenticated: los estados los cambia solo el wa-server (service_role bypass).
create policy wa_msg_sel on public.jjp_wa_messages for select to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());
create policy wa_msg_ins on public.jjp_wa_messages for insert to authenticated
  with check (
    owner_id = auth.uid() and direction = 'out' and status = 'pending'
    and exists (select 1 from public.jjp_wa_chats c
                where c.id = chat_id and c.owner_id = auth.uid())
  );

-- ---------- 4b. Touch de chat (solo wa-server via service_role) ----------
-- Incremento atómico de unread + preview. Se revoca a authenticated:
-- el frontend solo resetea unread_count=0 vía UPDATE directo (política wa_chat_upd).
create or replace function public.jjp_wa_touch_chat(p_chat uuid, p_preview text, p_from text, p_inc int)
returns void
language sql
security definer
set search_path to 'public','pg_temp'
as $$
  update public.jjp_wa_chats
     set last_message_at      = now(),
         last_message_preview = left(coalesce(p_preview,''), 120),
         last_message_from    = p_from,
         unread_count         = unread_count + coalesce(p_inc, 0)
   where id = p_chat;
$$;
revoke execute on function public.jjp_wa_touch_chat(uuid,text,text,int) from public, anon, authenticated;

-- ---------- 5. Storage: bucket privado jjp-wa-media ----------
-- Path: <owner_id>/<chat_id>/<timestamp>.<ext> — lectura/escritura solo carpeta propia (admin lee todo)
insert into storage.buckets (id, name, public) values ('jjp-wa-media','jjp-wa-media', false)
on conflict (id) do nothing;

create policy wa_media_read on storage.objects for select to authenticated
  using (bucket_id = 'jjp-wa-media'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.jjp_is_admin()));
create policy wa_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'jjp-wa-media'
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 6. Realtime ----------
alter publication supabase_realtime add table public.jjp_wa_sessions;
alter publication supabase_realtime add table public.jjp_wa_chats;
alter publication supabase_realtime add table public.jjp_wa_messages;

-- ---------- 7. Semilla: una fila de sesión por perfil staff activo ----------
insert into public.jjp_wa_sessions (profile_id)
select id from public.jjp_profiles where active
on conflict (profile_id) do nothing;
