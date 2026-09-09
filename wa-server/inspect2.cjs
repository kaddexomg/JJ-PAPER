const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DS_A = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv',
  password: '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const backupFile = path.resolve(__dirname, '..', 'backups', 'backup_completo_origen_2026-09-07T17-43-28-075Z.json');
const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

(async () => {
  const c = new Client(DS_A);
  await c.connect();

  await c.query('alter table public.jjp_categories add column if not exists group_id uuid references public.jjp_category_groups(id) on delete set null;');

  const rows = backup.tables.jjp_categories || [];
  for (const r of rows) {
    await c.query(
      'insert into public.jjp_categories (id, name, slug, emoji, color, sort_order, group_id) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing',
      [r.id, r.name, r.slug, r.emoji, r.color, r.sort_order, r.group_id]
    );
  }
  const count = await c.query('select count(*)::int from public.jjp_categories');
  console.log('✅ jjp_categories restauradas:', count.rows[0].count);
  await c.end();
})().catch(e => console.error('FATAL:', e));


(async () => {
  const c = new Client(DS_A);
  await c.connect();

  console.log('1. Creando tablas jjp_server_control, jjp_email_accounts, jjp_email_company...');
  await c.query(`
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
    ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_server_control_all ON public.jjp_server_control;
    CREATE POLICY jjp_server_control_all ON public.jjp_server_control FOR ALL USING (true) WITH CHECK (true);

    CREATE TABLE IF NOT EXISTS public.jjp_email_accounts (
      profile_id UUID PRIMARY KEY REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      from_name TEXT,
      provider TEXT DEFAULT 'google',
      oauth_refresh TEXT,
      app_pass TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      verified BOOLEAN NOT NULL DEFAULT false,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      has_cred BOOLEAN GENERATED ALWAYS AS (
        (oauth_refresh IS NOT NULL AND oauth_refresh <> '') OR
        (app_pass IS NOT NULL AND app_pass <> '')
      ) STORED
    );
    ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_accounts_own ON public.jjp_email_accounts;
    CREATE POLICY jjp_email_accounts_own ON public.jjp_email_accounts FOR ALL TO authenticated
      USING (profile_id = auth.uid() OR public.jjp_is_admin())
      WITH CHECK (profile_id = auth.uid() OR public.jjp_is_admin());

    CREATE TABLE IF NOT EXISTS public.jjp_email_company (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      email TEXT,
      from_name TEXT,
      app_pass TEXT,
      enabled BOOLEAN NOT NULL DEFAULT false,
      verified BOOLEAN NOT NULL DEFAULT false,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      has_cred BOOLEAN GENERATED ALWAYS AS (app_pass IS NOT NULL AND app_pass <> '') STORED
    );
    ALTER TABLE public.jjp_email_company ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ec_sel ON public.jjp_email_company;
    CREATE POLICY ec_sel ON public.jjp_email_company FOR SELECT TO authenticated USING (public.jjp_is_admin());
    DROP POLICY IF EXISTS ec_all ON public.jjp_email_company;
    CREATE POLICY ec_all ON public.jjp_email_company FOR ALL TO authenticated USING (public.jjp_is_admin());
  `);

  console.log('2. Insertando registros...');
  for (const t of ['jjp_server_control', 'jjp_email_accounts', 'jjp_email_company']) {
    const rows = backup.tables[t] || [];
    if (!rows.length) continue;
    const colRes = await c.query(
      "select column_name, is_generated from information_schema.columns where table_schema = 'public' and table_name = $1",
      [t]
    );
    const validCols = new Set(colRes.rows.filter(r => r.is_generated === 'NEVER').map(r => r.column_name));
    for (const r of rows) {
      const keys = Object.keys(r).filter(k => validCols.has(k));
      const values = keys.map(k => {
        const v = r[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      const ph = keys.map((_, idx) => '$' + (idx + 1)).join(', ');
      const sql = 'insert into public.' + t + ' (' + keys.map(k => '"' + k + '"').join(', ') + ') values (' + ph + ') on conflict do nothing;';
      await c.query(sql, values);
    }
    console.log('✅ ' + t + ': ' + rows.length + ' filas insertadas.');
  }

  await c.end();
})().catch(e => console.error('FATAL:', e));


