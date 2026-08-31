// Respaldo JJ Paper: copia DATOS + STORAGE del proyecto ACTUAL al NUEVO por API
// Ejecutar DESDE wa-server (donde esta @supabase/supabase-js)
// Uso: node backup_to_new.mjs <dst_url> <dst_service_role>
// El origen usa wa-server/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const SRC_URL = process.env.SUPABASE_URL;
const SRC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = process.argv[2];
const DST_KEY = process.argv[3];

if (!SRC_URL || !SRC_KEY) { console.error('Faltan credenciales ORIGEN en wa-server/.env'); process.exit(1); }
if (!DST_URL || !DST_KEY) { console.error('Uso: node backup_to_new.mjs <dst_url> <dst_service_role>'); process.exit(1); }

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } });

const BACKUP_DIR = path.join(__dirname, '..', 'supabase_backup', 'dump');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Las 44 tablas reales del ORIGEN (listadas desde el OpenAPI de PostgREST)
const TABLES = [
  'jjp_wa_campaign_targets','jjp_category_groups','jjp_server_control','jjp_count_tally',
  'jjp_stock_moves','jjp_seller_settings','jjp_orders','jjp_wa_sessions','jjp_units',
  'jjp_suppliers','jjp_seller_prices','jjp_brands','jjp_wa_templates','jjp_quotes',
  'jjp_invoice_alerts','jjp_supplier_invoices','jjp_count_conflicts','jjp_count_valued',
  'jjp_reviews','jjp_count_log_view','jjp_barcode_dupes','jjp_barcode_log','jjp_emails',
  'jjp_email_company','jjp_notifications','jjp_categories','jjp_fx_rates','jjp_settings',
  'jjp_count_totals','jjp_wa_messages','jjp_email_accounts','jjp_email_campaign_targets',
  'jjp_wa_campaigns','jjp_email_campaigns','jjp_wa_chats','jjp_count_log','jjp_profiles',
  'jjp_product_variants','jjp_count_counters','jjp_missing_photos','jjp_count_unknown',
  'jjp_products','jjp_promos','jjp_customers'
];
const BUCKETS = ['jjp-products','jjp-brands','jjp-wa-media','jjp-email-media','jjp-receipts'];

async function fetchAll(from, table) {
  const rows = [];
  let fromIdx = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await from.from(table).select('*').range(fromIdx, fromIdx + PAGE - 1);
    if (error) { if (/does not exist|PGRST/.test(error.message)) return { error }; throw error; }
    if (!data || !data.length) break;
    rows.push(...data);
    fromIdx += data.length;
    if (data.length < PAGE) break;
  }
  return { rows };
}

async function insertAll(to, table, rows) {
  if (!rows || !rows.length) return { inserted: 0, errors: 0 };
  let inserted = 0, errors = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const firstError = await (async () => {
      const { error } = await to.from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
      return error;
    })();
    if (firstError) {
      // reintento simple: si falta la columna id, insert plano
      const { error: e2 } = await to.from(table).insert(chunk);
      if (e2) { errors += chunk.length; console.log('    ⚠️ lote '+i+' '+table+': '+e2.message.slice(0,120)); }
      else inserted += chunk.length;
    } else inserted += chunk.length;
  }
  return { inserted, errors };
}

async function listAllS3(bucket) {
  const names = []; const dirs = [''];
  while (dirs.length) {
    const d = dirs.shift();
    const { data, error } = await src.storage.from(bucket).list(d, { limit: 1000 });
    if (error) { return { error }; }
    for (const f of data || []) {
      const full = d ? d + '/' + f.name : f.name;
      if (f.id) names.push(full);
      else dirs.push(full);
    }
  }
  return { names };
}

async function copyBucket(bucket) {
  const { names, error } = await listAllS3(bucket);
  if (error) { console.log('  bucket '+bucket+' list ERR: '+error.message); return; }
  console.log('  [storage] '+bucket+': '+names.length+' archivos');
  for (const name of names) {
    try {
      const { data, error: dl } = await src.storage.from(bucket).download(name);
      if (dl) { console.log('    ⚠️ download '+name+': '+dl.message); continue; }
      const buf = Buffer.from(await data.arrayBuffer());
      const { error: up } = await dst.storage.from(bucket).upload(name, buf, { contentType: 'application/octet-stream', upsert: true });
      if (up) console.log('    ⚠️ upload '+name+': '+up.message.split('\n')[0]);
    } catch (e) { console.log('    ⚠️ '+name+': '+e.message.slice(0,100)); }
  }
}

async function main() {
  console.log('ORIGEN : '+SRC_URL);
  console.log('DESTINO: '+DST_URL+'\n');
  let totalFilas = 0;
  for (const t of TABLES) {
    try {
      const res = await fetchAll(src, t);
      if (res.error) { console.log('✋ '+t+': '+res.error.message.slice(0,60)); continue; }
      const rows = res.rows || [];
      console.log('📦 '+t+': '+rows.length+' filas');
      if (rows.length) {
        fs.writeFileSync(path.join(BACKUP_DIR, t + '.json'), JSON.stringify(rows, null, 1));
        const r = await insertAll(dst, t, rows);
        totalFilas += r.inserted;
        if (r.errors) console.log('    ⚠️ ' + r.errors + ' insert fallidos');
      }
      await new Promise(r => setTimeout(r, 150));
    } catch (e) { console.log('❌ '+t+': '+e.message.slice(0,100)); }
  }
  console.log('\n== Copiando STORAGE ('+BUCKETS.length+' buckets) ==');
  for (const b of BUCKETS) await copyBucket(b);
  console.log('\n✅ RESPALDO COMPLETO. Filas copiadas: '+totalFilas);
  console.log('   Copias JSON en: '+BACKUP_DIR);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
