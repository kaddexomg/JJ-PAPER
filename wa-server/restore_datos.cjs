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

// Tablas prioritarias en orden estricto de dependencias
const tableOrder = [
  'jjp_settings',
  'jjp_fx_rates',
  'jjp_profiles',
  'jjp_categories',
  'jjp_category_groups',
  'jjp_brands',
  'jjp_units',
  'jjp_products',
  'jjp_product_variants',
  'jjp_customers',
  'jjp_quotes',
  'jjp_orders',
  'jjp_reviews',
  'jjp_promos',
  'jjp_clients',
  'jjp_count_tally',
  'jjp_server_control',
  'jjp_wa_sessions',
  'jjp_wa_templates',
  'jjp_wa_chats',
  'jjp_wa_messages',
  'jjp_email_accounts',
  'jjp_email_company',
  'jjp_emails',
  'jjp_email_campaigns',
  'jjp_email_campaign_targets',
  'jjp_notifications'
];

(async () => {
  const c = new Client(DS_A);
  await c.connect();
  console.log('Conectado a Proyecto A. Iniciando inserción limpia y estructurada...');

  // Desactivar temporalmente triggers de auditoría para no alterar timestamps ni stats originales
  await c.query('SET session_replication_role = replica;');

  let totalIns = 0;

  for (const table of tableOrder) {
    const rows = backup.tables[table];
    if (!rows || rows.length === 0) {
      console.log('· ' + table + ': 0 filas (omitida)');
      continue;
    }

    // Obtener columnas existentes en la tabla destino
    const colRes = await c.query(
      "select column_name, data_type, is_generated, is_identity, identity_generation from information_schema.columns where table_schema = 'public' and table_name = $1",
      [table]
    );
    const validCols = new Set(colRes.rows.filter(r => r.is_generated === 'NEVER').map(r => r.column_name));
    if (validCols.size === 0) {
      console.log('⚠️ Tabla ' + table + ' no existe en destino.');
      continue;
    }

    // Truncar antes de rellenar
    await c.query('truncate table public.' + table + ' cascade;');

    // Verificar si la tabla tiene columnas de tipo identity ALWAYS
    const hasIdentity = colRes.rows.some(r => r.is_identity === 'YES' || r.identity_generation === 'ALWAYS');
    const overridingClause = hasIdentity ? ' OVERRIDING SYSTEM VALUE ' : ' ';


    let count = 0;
    for (const row of rows) {
      const keys = Object.keys(row).filter(k => validCols.has(k));
      const values = keys.map(k => {
        const v = row[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      const ph = keys.map((_, idx) => '$' + (idx + 1)).join(', ');
      const sql = 'insert into public.' + table + ' (' + keys.map(k => '"' + k + '"').join(', ') + ')' + overridingClause + 'values (' + ph + ') on conflict do nothing;';
      await c.query(sql, values);
      count++;
    }
    totalIns += count;
    console.log('✅ ' + table + ': ' + count + ' filas insertadas.');

  }

  // Reactivar triggers
  await c.query('SET session_replication_role = DEFAULT;');

  console.log('\n🎉 INSERCIÓN FINALIZADA CON ÉXITO: ' + totalIns + ' filas.');
  await c.end();
})().catch(e => console.error('FATAL:', e));

