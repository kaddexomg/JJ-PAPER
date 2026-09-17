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

async function applyFixes() {
  const cA = new Client(DS_A);
  const cB = new Client(DS_B);
  await cA.connect();
  await cB.connect();
  console.log('Conectado a Proyecto A y Proyecto B');

  // ==========================================
  // 1. PROYECTO A (CORE)
  // ==========================================
  console.log('Aplicando correcciones a Proyecto A...');
  await cA.query(`
    -- Agregar columnas faltantes en jjp_customers
    ALTER TABLE public.jjp_customers ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.jjp_customers ADD COLUMN IF NOT EXISTS wa_opt_out BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.jjp_customers ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;

    -- Permisos
    GRANT ALL ON public.jjp_customers TO anon, authenticated, service_role;

    -- Buckets de Storage en Proyecto A
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES 
      ('jjp-email-media', 'jjp-email-media', true, 52428800, NULL),
      ('jjp-wa-media', 'jjp-wa-media', true, 52428800, NULL)
    ON CONFLICT (id) DO UPDATE SET public = true;

    -- Políticas de storage en Proyecto A
    DROP POLICY IF EXISTS "Public Access jjp-email-media" ON storage.objects;
    CREATE POLICY "Public Access jjp-email-media" ON storage.objects FOR ALL TO public USING (bucket_id = 'jjp-email-media') WITH CHECK (bucket_id = 'jjp-email-media');

    DROP POLICY IF EXISTS "Public Access jjp-wa-media" ON storage.objects;
    CREATE POLICY "Public Access jjp-wa-media" ON storage.objects FOR ALL TO public USING (bucket_id = 'jjp-wa-media') WITH CHECK (bucket_id = 'jjp-wa-media');

    NOTIFY pgrst, 'reload schema';
  `);
  console.log('✅ Proyecto A actualizado con éxito');

  // ==========================================
  // 2. PROYECTO B (COMUNICACIÓN)
  // ==========================================
  console.log('Aplicando correcciones a Proyecto B...');
  await cB.query(`
    -- jjp_email_campaigns
    CREATE TABLE IF NOT EXISTS public.jjp_email_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID REFERENCES public.jjp_profiles(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL,
      body TEXT,
      html TEXT,
      body_html TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      delay_min_s INT NOT NULL DEFAULT 15,
      delay_max_s INT NOT NULL DEFAULT 45,
      batch_size INT NOT NULL DEFAULT 0,
      batch_pause_m INT NOT NULL DEFAULT 5,
      total INT NOT NULL DEFAULT 0,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'general';
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS html TEXT;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS body_html TEXT;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS delay_min_s INT DEFAULT 15;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS delay_max_s INT DEFAULT 45;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS batch_size INT DEFAULT 0;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS batch_pause_m INT DEFAULT 5;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS total INT DEFAULT 0;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS sent_count INT DEFAULT 0;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS failed_count INT DEFAULT 0;
    ALTER TABLE public.jjp_email_campaigns ADD COLUMN IF NOT EXISTS skipped_count INT DEFAULT 0;

    -- jjp_email_campaign_targets
    CREATE TABLE IF NOT EXISTS public.jjp_email_campaign_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES public.jjp_email_campaigns(id) ON DELETE CASCADE,
      owner_id UUID NOT NULL,
      customer_id UUID,
      email TEXT,
      to_addr TEXT,
      name TEXT,
      vars JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      email_id UUID,
      error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.jjp_email_campaign_targets ADD COLUMN IF NOT EXISTS to_addr TEXT;
    ALTER TABLE public.jjp_email_campaign_targets ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE public.jjp_email_campaign_targets ADD COLUMN IF NOT EXISTS email_id UUID;
    ALTER TABLE public.jjp_email_campaign_targets ADD COLUMN IF NOT EXISTS vars JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE public.jjp_email_campaign_targets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

    -- Sincronizar email y to_addr por si acaso
    UPDATE public.jjp_email_campaign_targets SET to_addr = email WHERE to_addr IS NULL AND email IS NOT NULL;
    UPDATE public.jjp_email_campaign_targets SET email = to_addr WHERE email IS NULL AND to_addr IS NOT NULL;

    -- Buckets de Storage en Proyecto B
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES 
      ('jjp-email-media', 'jjp-email-media', true, 52428800, NULL),
      ('jjp-wa-media', 'jjp-wa-media', true, 52428800, NULL)
    ON CONFLICT (id) DO UPDATE SET public = true;

    -- Políticas de storage en Proyecto B
    DROP POLICY IF EXISTS "Public Access jjp-email-media" ON storage.objects;
    CREATE POLICY "Public Access jjp-email-media" ON storage.objects FOR ALL TO public USING (bucket_id = 'jjp-email-media') WITH CHECK (bucket_id = 'jjp-email-media');

    DROP POLICY IF EXISTS "Public Access jjp-wa-media" ON storage.objects;
    CREATE POLICY "Public Access jjp-wa-media" ON storage.objects FOR ALL TO public USING (bucket_id = 'jjp-wa-media') WITH CHECK (bucket_id = 'jjp-wa-media');

    -- Permisos RLS
    ALTER TABLE public.jjp_email_campaigns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_camp_all ON public.jjp_email_campaigns;
    CREATE POLICY jjp_email_camp_all ON public.jjp_email_campaigns FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_email_campaign_targets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_tgt_all ON public.jjp_email_campaign_targets;
    CREATE POLICY jjp_email_tgt_all ON public.jjp_email_campaign_targets FOR ALL USING (true) WITH CHECK (true);

    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

    -- Realtime en B
    ALTER TABLE public.jjp_email_campaigns REPLICA IDENTITY FULL;
    ALTER TABLE public.jjp_email_campaign_targets REPLICA IDENTITY FULL;
    DO $$
    BEGIN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaigns;
      EXCEPTION WHEN duplicate_object THEN END;
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_campaign_targets;
      EXCEPTION WHEN duplicate_object THEN END;
    END $$;

    NOTIFY pgrst, 'reload schema';
  `);
  console.log('✅ Proyecto B actualizado con éxito');

  await cA.end();
  await cB.end();
  console.log('🎉 Todas las migraciones completadas exitosamente.');
}

applyFixes().catch(console.error);
