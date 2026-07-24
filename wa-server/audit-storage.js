// AUDITORÍA READ-ONLY del backend de Storage.
// Lista recursivamente cada bucket con la service_role key y suma el peso real.
// NO borra nada. Solo reporta.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Falta SUPABASE_URL / SERVICE_ROLE en .env'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function listAll(bucket, prefix = '') {
  let out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, {
      limit, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) { console.error(`  list error ${bucket}/${prefix}:`, error.message); break; }
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Carpeta: id null => recursar. Archivo: tiene metadata.size
      if (item.id === null) {
        out = out.concat(await listAll(bucket, path));
      } else {
        out.push({ path, size: item.metadata?.size ?? 0, mime: item.metadata?.mimetype });
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

const { data: buckets, error: bErr } = await sb.storage.listBuckets();
if (bErr) { console.error('listBuckets error:', bErr.message); process.exit(1); }

let grand = 0, grandCount = 0;
console.log('=== RECONCILIACIÓN STORAGE (API service_role) ===\n');
for (const b of buckets) {
  const files = await listAll(b.id);
  const bytes = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  grand += bytes; grandCount += files.length;
  console.log(`${b.id}  [${b.public ? 'público' : 'privado'}]  ${files.length} archivos  ${(bytes/1048576).toFixed(2)} MB`);
}
console.log(`\nTOTAL API: ${grandCount} archivos  ${(grand/1048576).toFixed(2)} MB`);
console.log('\nSi este total ~= 59 MB pero el dashboard cobra 2.07 GB =>');
console.log('el peso es basura de backend NO listable por API (GC interno de Supabase).');
