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

    ALTER TABLE public.jjp_wa_chats ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_chat_all ON public.jjp_wa_chats;
    CREATE POLICY wa_chat_all ON public.jjp_wa_chats FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_wa_messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wa_msg_all ON public.jjp_wa_messages;
    CREATE POLICY wa_msg_all ON public.jjp_wa_messages FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_emails_all ON public.jjp_emails;
    CREATE POLICY jjp_emails_all ON public.jjp_emails FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_accounts_all ON public.jjp_email_accounts;
    CREATE POLICY jjp_email_accounts_all ON public.jjp_email_accounts FOR ALL USING (true) WITH CHECK (true);

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

  // Notificar schema reload a ambos
  await cA.query("NOTIFY pgrst, 'reload schema';");
  await cB.query("NOTIFY pgrst, 'reload schema';");
  console.log('✅ PostgREST schema reloaded en A y B');

  await cA.end();
  await cB.end();
}
fix().catch(console.error);
