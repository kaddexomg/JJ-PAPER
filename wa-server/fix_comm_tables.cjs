const { Client } = require('pg');

const DS_A = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv',
  password: '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function fix() {
  const cA = new Client(DS_A);
  const cB = new Client(DS_B);
  await cA.connect();
  await cB.connect();
  console.log('Conectado a Proyecto A y Proyecto B por PG directo.');

  // Configurar en B
  await cB.query(`
    CREATE TABLE IF NOT EXISTS public.jjp_server_control (
      id INT PRIMARY KEY DEFAULT 1,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      heartbeat_at TIMESTAMPTZ,
      host TEXT,
      command TEXT,
      modules JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS command TEXT;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS host TEXT;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS modules JSONB DEFAULT '{}'::jsonb;
    INSERT INTO public.jjp_server_control (id, started_at, heartbeat_at, host, modules)
    VALUES (1, now(), now(), 'server', '{}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET heartbeat_at = now();

    CREATE TABLE IF NOT EXISTS public.jjp_emails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
      customer_id UUID REFERENCES public.jjp_customers(id) ON DELETE SET NULL,
      direction TEXT NOT NULL DEFAULT 'out',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS customer_id UUID;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'out';
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS from_addr TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS to_addr TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS from_email TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS to_email TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS subject TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS body_text TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS html TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS body_html TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS snippet TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS gmail_id TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS thread_id TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS attach_state TEXT DEFAULT 'none';
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS error_msg TEXT;
    ALTER TABLE public.jjp_emails ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

    CREATE TABLE IF NOT EXISTS public.jjp_wa_sessions (
      profile_id UUID PRIMARY KEY REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'disabled',
      requested_action TEXT,
      requested_at TIMESTAMPTZ,
      pairing_phone TEXT,
      pairing_code TEXT,
      qr_data TEXT,
      qr_updated_at TIMESTAMPTZ,
      wa_number TEXT,
      wa_name TEXT,
      last_connected_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disabled';
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS qr TEXT;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS wa_name TEXT;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS wa_number TEXT;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS auth_state JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS requested_action TEXT;
    ALTER TABLE public.jjp_wa_sessions ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;

    ALTER TABLE public.jjp_wa_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_sess_all ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_sel ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_upd_own ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_admin_all ON public.jjp_wa_sessions;
    CREATE POLICY wa_sess_all ON public.jjp_wa_sessions FOR ALL USING (true) WITH CHECK (true);

    -- Campañas de WhatsApp y targets completos
    CREATE TABLE IF NOT EXISTS public.jjp_wa_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID,
      created_by UUID,
      name TEXT,
      kind TEXT NOT NULL DEFAULT 'manual',
      template_id UUID,
      body TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'en_cola',
      delay_min_s INTEGER NOT NULL DEFAULT 45,
      delay_max_s INTEGER NOT NULL DEFAULT 90,
      batch_size INTEGER NOT NULL DEFAULT 0,
      batch_pause_m INTEGER NOT NULL DEFAULT 5,
      total INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      media_path TEXT,
      media_type TEXT,
      media_mime TEXT,
      media_filename TEXT,
      media_size INTEGER,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS owner_id UUID;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS created_by UUID;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'manual';
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS template_id UUID;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS message TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'en_cola';
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS delay_min_s INTEGER NOT NULL DEFAULT 45;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS delay_max_s INTEGER NOT NULL DEFAULT 90;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS batch_size INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS batch_pause_m INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS total INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS media_path TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS media_type TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS media_mime TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS media_filename TEXT;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS media_size INTEGER;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_wa_campaigns ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_wa_campaigns DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_status_check;
    ALTER TABLE public.jjp_wa_campaigns DROP CONSTRAINT IF EXISTS jjp_wa_campaigns_kind_check;

    CREATE TABLE IF NOT EXISTS public.jjp_wa_campaign_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES public.jjp_wa_campaigns(id) ON DELETE CASCADE,
      owner_id UUID NOT NULL,
      customer_id UUID,
      phone TEXT NOT NULL,
      name TEXT,
      vars JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      message_id UUID,
      error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.jjp_wa_campaign_targets DROP CONSTRAINT IF EXISTS jjp_wa_campaign_targets_status_check;

    ALTER TABLE public.jjp_wa_campaigns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_camp_all ON public.jjp_wa_campaigns;
    CREATE POLICY wa_camp_all ON public.jjp_wa_campaigns FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_wa_campaign_targets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_camp_tgt_all ON public.jjp_wa_campaign_targets;
    CREATE POLICY wa_camp_tgt_all ON public.jjp_wa_campaign_targets FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_wa_chats ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_chat_all ON public.jjp_wa_chats;
    CREATE POLICY wa_chat_all ON public.jjp_wa_chats FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_wa_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS reply_to_wa_id TEXT;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS reply_preview TEXT;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS reply_from TEXT;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS reaction TEXT;
    ALTER TABLE public.jjp_wa_messages ADD COLUMN IF NOT EXISTS reaction_from TEXT;

    DROP POLICY IF EXISTS wa_msg_all ON public.jjp_wa_messages;
    CREATE POLICY wa_msg_all ON public.jjp_wa_messages FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_emails_all ON public.jjp_emails;
    CREATE POLICY jjp_emails_all ON public.jjp_emails FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_accounts_all ON public.jjp_email_accounts;
    CREATE POLICY jjp_email_accounts_all ON public.jjp_email_accounts FOR ALL USING (true) WITH CHECK (true);

    -- Función para actualizar último mensaje y unread del chat (touchChat)
    CREATE OR REPLACE FUNCTION public.jjp_wa_touch_chat(p_chat uuid, p_preview text, p_from text, p_inc int)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path TO 'public','pg_temp'
    AS $$
      UPDATE public.jjp_wa_chats
         SET last_message_at      = now(),
             last_message_preview = left(coalesce(p_preview,''), 120),
             last_message_from    = p_from,
             unread_count         = unread_count + coalesce(p_inc, 0)
       WHERE id = p_chat;
    $$;

    GRANT EXECUTE ON FUNCTION public.jjp_wa_touch_chat(uuid, text, text, int) TO anon, authenticated, service_role;

    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  console.log('✅ Tablas, RLS y permisos aplicados en Proyecto B');

  // Configurar también en A por si alguna consulta apunta directo
  await cA.query(`
    ALTER TABLE public.jjp_wa_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_sess_all ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_sel ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_upd_own ON public.jjp_wa_sessions;
    DROP POLICY IF EXISTS wa_sess_admin_all ON public.jjp_wa_sessions;
    CREATE POLICY wa_sess_all ON public.jjp_wa_sessions FOR ALL USING (true) WITH CHECK (true);

    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  console.log('✅ RLS en jjp_wa_sessions aplicado en Proyecto A');

  // Sesiones de WhatsApp para cada perfil activo
  const { rows: profiles } = await cA.query("SELECT id FROM public.jjp_profiles WHERE active = true");
  for (const p of profiles) {
    await cB.query(`
      INSERT INTO public.jjp_wa_sessions (profile_id, enabled)
      VALUES ($1, true)
      ON CONFLICT (profile_id) DO NOTHING
    `, [p.id]);
    await cA.query(`
      INSERT INTO public.jjp_wa_sessions (profile_id, enabled)
      VALUES ($1, true)
      ON CONFLICT (profile_id) DO NOTHING
    `, [p.id]);
  }
  console.log('✅ Sesiones de WhatsApp aseguradas en A y B para todos los perfiles activos');

  // Limpiar correos vacíos
  const del = await cB.query("DELETE FROM public.jjp_emails WHERE body IS NULL AND html IS NULL");
  console.log(`✅ Correos vacíos eliminados para re-ingesta: ${del.rowCount}`);

  // Configurar Realtime y REPLICA IDENTITY FULL para que los updates (como QR) fluyan al browser
  await cB.query(`
    ALTER TABLE public.jjp_wa_sessions REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_wa_chats REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_wa_messages REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_emails REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_wa_campaigns REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_server_control REPLICA IDENTITY FULL;

    DO $$
    BEGIN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_server_control;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_sessions;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_chats;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_messages;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_emails;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_campaigns;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_wa_campaign_targets;
      EXCEPTION WHEN duplicate_object THEN END;
    END $$;
  `);
  console.log('✅ Realtime publication & REPLICA IDENTITY configurados en Proyecto B');

  // Notificar schema reload a ambos
  await cA.query("NOTIFY pgrst, 'reload schema';");
  await cB.query("NOTIFY pgrst, 'reload schema';");
  console.log('✅ PostgREST schema reloaded en A y B');

  await cA.end();
  await cB.end();
}
fix().catch(console.error);
