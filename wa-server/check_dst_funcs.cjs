const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const backupFile = path.resolve(__dirname, '..', 'backups', 'backup_completo_origen_2026-09-07T17-43-28-075Z.json');
const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const tables = [
  'jjp_profiles',
  'jjp_wa_sessions',
  'jjp_wa_templates',
  'jjp_wa_chats',
  'jjp_wa_messages',
  'jjp_wa_campaigns',
  'jjp_wa_campaign_targets',
  'jjp_email_accounts',
  'jjp_email_company',
  'jjp_emails',
  'jjp_email_campaigns',
  'jjp_email_campaign_targets'
];

(async () => {
  const c = new Client(DS_B);
  await c.connect();
  console.log('Conectado a Proyecto B para restaurar datos...');
  await c.query('SET session_replication_role = replica;');

  // Permitir to_email null para correos entrantes de sistema/newsletter
  await c.query('ALTER TABLE public.jjp_emails ALTER COLUMN to_email DROP NOT NULL;');
  await c.query('ALTER TABLE public.jjp_email_campaigns ALTER COLUMN body_html DROP NOT NULL;');
  await c.query('ALTER TABLE public.jjp_email_campaign_targets ALTER COLUMN email DROP NOT NULL;');

  let totalIns = 0;
  for (const table of tables) {
    const rows = backup.tables[table];
    if (!rows || rows.length === 0) {
      console.log('· ' + table + ': 0 filas');
      continue;
    }
    const colRes = await c.query(
      "select column_name, is_generated from information_schema.columns where table_schema = 'public' and table_name = $1",
      [table]
    );
    const validCols = new Set(colRes.rows.filter(r => r.is_generated === 'NEVER').map(r => r.column_name));

    let count = 0;
    for (const row of rows) {
      const keys = Object.keys(row).filter(k => validCols.has(k));
      const values = keys.map(k => {
        const v = row[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      const ph = keys.map((_, idx) => '$' + (idx + 1)).join(', ');
      const sql = 'insert into public.' + table + ' (' + keys.map(k => '"' + k + '"').join(', ') + ') values (' + ph + ') on conflict do nothing;';
      await c.query(sql, values);
      count++;
    }
    totalIns += count;
    console.log('✅ ' + table + ': ' + count + ' filas migradas.');
  }

  // Asegurar admin Keyder Salazar
  await c.query(`
    INSERT INTO public.jjp_profiles (id, name, role, active)
    VALUES ('bddc57dc-5bf9-4a72-9e1c-751d07b03164', 'Keyder Salazar', 'admin', true)
    ON CONFLICT (id) DO UPDATE SET role = 'admin', active = true;
  `);
  console.log('✅ Perfil admin verificado en Proyecto B.');

  await c.query('SET session_replication_role = DEFAULT;');
  await c.end();
  console.log('🎉 Migración de datos de Comunicación completada: ' + totalIns + ' filas.');
})().catch(console.error);


