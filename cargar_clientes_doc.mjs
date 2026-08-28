/* ======================================================
   JJ Paper — Carga real de clientes desde los reportes .DOC
   por zona (CLIENTES/ZONA004|006|008|014.DOC)

   Uso:
     node cargar_clientes_doc.mjs --backup   # solo genera backup y conteos
     node cargar_clientes_doc.mjs --execute  # backup + reemplaza cartera por zona

   Mapeo (fuente: cerebro/Conceptos/Gestion_Clientes_Zonas_JJ_PAPER.md)
     Zona 008  -> Marianela   (seller d9608291-...)
     Zona 014  -> Andreina    (seller b0cd93c5-...)
     Zona 004  -> Giovanni    (seller 95d5ad44-...)
     Zona 006  -> Giovanni    (seller 95d5ad44-...)
   ====================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = join(HERE, 'CLIENTES');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');

const EXECUTE = process.argv.includes('--execute');

/* ---------- seller_id por zona (ids reales en jjp_profiles del proyecto operativo) ---------- */
const ZONE_SELLER = {
  '008': 'd9608291-1363-4790-a7b0-0d6fd426564f', // Marianela
  '014': 'b0cd93c5-e2f0-4322-9d35-e374109d284f', // Andreina
  '004': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', // Giovanni
  '006': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', // Giovanni
};

const ZONE_FILES = [
  { zone: '004', file: 'ZONA004.DOC' },
  { zone: '006', file: 'ZONA006.DOC' },
  { zone: '008', file: 'ZONA008.DOC' },
  { zone: '014', file: 'ZONA014.DOC' },
];

/* ---------- env ---------- */
function loadEnv(path) {
  const map = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}
const env = loadEnv(ENV_PATH);
const URL = process.env.SUPABASE_URL || env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env'); process.exit(1); }

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H, ...opts });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} → ${text.slice(0, 300)}`);
  return body;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllCustomers() {
  const all = [];
  for (let start = 0; ; start += 1000) {
    const page = await rest(`jjp_customers?select=id,name,rif,phone,zone,seller_id&limit=1000&offset=${start}`);
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

/* ---------- parseo de líneas fijas del reporte .DOC ---------- */
function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return d;
  if (d.length === 10 && (d[0] === '2' || d[0] === '4')) return '0' + d;
  if (d.length === 12 && d.startsWith('58')) return '0' + d.slice(2);
  if (d.length === 7) return '0212' + d;
  return null;
}

function parseDoc(zone, file) {
  const text = readFileSync(join(CLIENTS_DIR, file), 'latin1');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!/^\s*\d{3}-\d{3}\s/.test(line)) continue;
    const code = line.substring(1, 9).trim();
    const name = line.substring(10, 40).trim();
    if (!name) continue;
    const phoneRaw = line.length >= 76 ? line.substring(60, 76).trim() : line.substring(60).trim();
    const phone = normPhone(phoneRaw);
    rows.push({
      code,
      name,
      zone,
      phone,
      seller_id: ZONE_SELLER[zone],
      notes: `Zona: ${zone}`,
    });
  }
  return rows;
}

/* ---------- main ---------- */
console.log(`Modo: ${EXECUTE ? 'EXECUTE' : 'BACKUP + REPORTE (--execute para escribir)'}\n`);

const allRecords = [];
const zoneCounts = {};
for (const zf of ZONE_FILES) {
  const rows = parseDoc(zf.zone, zf.file);
  allRecords.push(...rows);
  zoneCounts[zf.zone] = rows.length;
  console.log(`  · ${zf.file}: ${rows.length} clientes (zona ${zf.zone})`);
}

// Deduplicar teléfono (columna única): duplicados posteriores -> NULL
const seenPhones = new Set();
for (const r of allRecords) {
  if (r.phone) {
    if (seenPhones.has(r.phone)) r.phone = null;
    else seenPhones.add(r.phone);
  }
}
const phoneNulls = allRecords.filter(r => !r.phone).length;
console.log(`  · teléfonos duplicados puestos a NULL: ${phoneNulls}`);
console.log(`\n  · TOTAL por zona: ${JSON.stringify(zoneCounts)}`);
const sellerSummary = {};
for (const r of allRecords) sellerSummary[r.seller_id] = (sellerSummary[r.seller_id] || 0) + 1;
console.log('  · TOTAL por vendedor:');
for (const [sid, n] of Object.entries(sellerSummary)) {
  const name = Object.entries(ZONE_SELLER).find(([z, v]) => v === sid)?.[0];
  console.log(`    - ${name || sid}: ${n}`);
}
console.log(`  · TOTAL GRAL: ${allRecords.length}`);

const current = await fetchAllCustomers();
console.log(`\n  · clientes actuales en DB: ${current.length}`);
mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const backupPath = join(BACKUP_DIR, `jjp_customers_antes_recarga_doc_${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(current, null, 2));
console.log(`  · backup guardado: ${backupPath}`);

if (!EXECUTE) {
  console.log('\nSin cambios. Revisa los números y ejecuta con --execute.');
  process.exit(0);
}

/* ---------- reemplazo completo de la cartera por zona ---------- */
console.log('\nBorrando clientes actuales (cartera por zona) para recargar desde .DOC...');
const ids = [];
for (let start = 0; ; start += 1000) {
  const page = await rest(`jjp_customers?select=id&limit=1000&offset=${start}`);
  ids.push(...page.map(c => c.id));
  if (page.length < 1000) break;
}
for (let i = 0; i < ids.length; i += 400) {
  const batch = ids.slice(i, i + 400);
  const idList = batch.map(id => `"${id}"`).join(',');
  await rest(`jjp_customers?id=in.(${idList})`, {
    method: 'DELETE',
    headers: { ...H, Prefer: 'return=minimal' },
  });
  await sleep(300);
}
console.log(`  · quedan: ${(await fetchAllCustomers()).length}`);

console.log('\nInsertando clientes por zona...');
let ok = 0;
for (let i = 0; i < allRecords.length; i += 100) {
  const chunk = allRecords.slice(i, i + 100).map(({ code, ...rest }) => rest);
  try {
    await rest('jjp_customers', {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    ok += chunk.length;
  } catch (e) {
    console.error('  ✗ lote falla:', e.message.slice(0, 200));
  }
  console.log(`  · lote ${Math.floor(i / 100) + 1}/${Math.ceil(allRecords.length / 100)} ok=${ok}`);
  await sleep(150);
}

console.log('\nVerificación final...');
const fin = await fetchAllCustomers();
const finZones = {};
const finSellers = {};
for (const c of fin) {
  const z = c.zone || 'sin';
  finZones[z] = (finZones[z] || 0) + 1;
  const s = c.seller_id || 'sin';
  finSellers[s] = (finSellers[s] || 0) + 1;
}
console.log(`  · total final: ${fin.length}`);
console.log(`  · por zona: ${JSON.stringify(finZones)}`);
console.log('  · por vendedor:');
for (const [z, sid] of Object.entries({ '004': ZONE_SELLER['004'], '006': ZONE_SELLER['006'], '008': ZONE_SELLER['008'], '014': ZONE_SELLER['014'] })) {
  const n = finSellers[sid] || 0;
  console.log(`    - Zonas ${z} → ${n} clientes`);
}
console.log('\nListo ✔');
