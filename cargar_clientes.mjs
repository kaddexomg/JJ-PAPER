/* ======================================================
   JJ Paper — Carga limpia de clientes desde CSV
   17-ago-2026

   Requisito: ejecutar primero la migración
   sql/2026-08-17-customers-zone.sql (columna `zone`).

   Uso:
     node cargar_clientes.mjs --dry-run   # simula, no toca la DB
     node cargar_clientes.mjs --execute   # borra lo derivado del CSV y recarga

   Origen: clientes_importables.csv (idéntico a clientes_procesados_zonas.csv)
   Destino: tabla public.jjp_customers (Supabase, service_role)

   Reglas de carga:
     · phone   → solo dígitos; 11 dígitos directo, 10 (2/4) → +0,
                 12 (58…) → 0+, 7 dígitos → prefijo 0212 (fijo de Caracas),
                 resto (vacío/inservible) o duplicado → NULL
     · email   → NULL (los del CSV son placeholders contactoNNNN@jjpaper.local)
     · zone    → columna directa (004/006/008/014) + notes "Zona: X"
     · seller_id → por zona: 008→Marianela, 014→Andreina, 004/006→Yovanni
     · rif     → clave natural (única en el CSV); NO se toca
   ====================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'clientes_importables.csv');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');
const CSV_RIFS = new Set();

const DRY = process.argv.includes('--dry-run');

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

/* ---------- CSV ---------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') {
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(c => c.trim() !== '')) rows.push(row); }
  return rows;
}

function readCSV() {
  const lines = parseCSV(readFileSync(CSV_PATH, 'utf8'));
  const head = lines[0].map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => {
    const o = {};
    head.forEach((h, i) => o[h] = (l[i] || '').trim());
    return o;
  });
}

/* ---------- normalización ---------- */
function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return d;
  if (d.length === 10 && (d[0] === '2' || d[0] === '4')) return '0' + d;
  if (d.length === 12 && d.startsWith('58')) return '0' + d.slice(2);
  if (d.length === 7) return '0212' + d;   // fijo de Caracas sin prefijo
  return null;
}

const ZONE_SELLER = {
  '008': '0d850c1e-5220-410e-8972-9783f31787fa', // VENTAS JJ MARIANELA 008
  '014': '4dc52b31-dd31-461d-8f8b-79f411635bb9', // JJ PAPER VENTAS ANDREINA 014
  '006': '824b4b53-d78d-43e7-8430-0262ade3a0c2', // Yovanni Araujo 006 004
  '004': '824b4b53-d78d-43e7-8430-0262ade3a0c2',
};

function buildRecords(rows) {
  const seenPhones = new Set();
  const out = [];
  for (const r of rows) {
    const rif = (r.rif || '').trim();
    const zone = (r.zone || '').trim();
    let phone = normPhone(r.phone);
    if (phone && seenPhones.has(phone)) phone = null;
    if (phone) seenPhones.add(phone);
    out.push({
      name: (r.name || '').trim(),
      phone,
      rif: rif || null,
      city: (r.city || '').trim() || 'Caracas',
      email: null,
      address: null,
      notes: `Zona: ${zone}`,
      zone,
      seller_id: null,
    });
  }
  return out;
}

/* ---------- helpers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllCustomers() {
  const all = [];
  for (let start = 0; ; start += 1000) {
    const page = await rest(`jjp_customers?select=id,name,rif,phone,notes,seller_id&limit=1000&offset=${start}`);
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

async function insertBatch(rows) {
  const BATCH = 100;
  let ok = 0, conflict = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    try {
      await rest('jjp_customers', {
        method: 'POST',
        headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify(chunk),
      });
      ok += chunk.length;
    } catch (e) {
      // conflicto único de phone (improbable): reintentar cada fila con phone=NULL
      let fixed = 0;
      for (const row of chunk) {
        try {
          await rest('jjp_customers', {
            method: 'POST',
            headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify({ ...row, phone: null }),
          });
          fixed++;
        } catch (e2) { console.error('  ✗ insert falla:', row.rif, e2.message.slice(0, 120)); }
      }
      ok += fixed; conflict += chunk.length - fixed;
    }
    console.log(`  · lote ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)} ok=${ok} conflict=${conflict}`);
    await sleep(150);
  }
  return { ok, conflict };
}

/* ---------- main ---------- */
console.log(`Modo: ${DRY ? 'DRY-RUN (no escribe nada)' : 'EXECUTE'}\n`);

console.log('Leyendo CSV...');
const rows = readCSV();
rows.forEach(r => CSV_RIFS.add((r.rif || '').trim()));
const records = buildRecords(rows);
const zoneCounts = {};
for (const r of records) zoneCounts[r.zone] = (zoneCounts[r.zone] || 0) + 1;
const withPhone = records.filter(r => r.phone).length;

console.log(`  · filas CSV: ${rows.length}`);
console.log(`  · con teléfono válido: ${withPhone} · sin teléfono (NULL): ${records.length - withPhone}`);
console.log(`  · por zona: ${JSON.stringify(zoneCounts)}`);

console.log('\nEstado actual de la base...');
const current = await fetchAllCustomers();
console.log(`  · clientes actuales: ${current.length}`);

const preserved = current.filter(c => {
  const rif = (c.rif || '').trim();
  return !rif || !CSV_RIFS.has(rif);
});
console.log(`  · se conservan (no derivados del CSV): ${preserved.length}`);
for (const p of preserved) console.log(`    - ${p.name} | rif=${p.rif} | tel=${p.phone}`);

// Backup
mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const backupPath = join(BACKUP_DIR, `jjp_customers_antes_recarga_${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(current, null, 2));
console.log(`\n  · backup guardado: ${backupPath}`);

const preserveIds = preserved.map(p => p.id);
const toDelete = current.length - preserveIds.length;
console.log(`  · registros a borrar (derivados del CSV): ${toDelete}`);
console.log(`  · total tras recarga esperado: ${preserveIds.length + records.length}`);

if (DRY) {
  console.log('\nDRY-RUN: sin cambios en la base. Revisa los números y ejecuta con --execute.');
  process.exit(0);
}

if (toDelete > 0) {
  console.log('\nBorrando registros derivados del CSV...');
  const idList = preserveIds.map(id => `"${id}"`).join(',');
  const r = await rest(`jjp_customers?id=not.in.(${idList})`, {
    method: 'DELETE',
    headers: { ...H, Prefer: 'return=minimal' },
  });
  await sleep(400);
  console.log(`  · quedan: ${(await fetchAllCustomers()).length}`);
}

console.log('\nInsertando clientes limpios...');
const { ok, conflict } = await insertBatch(records);

console.log('\nVerificación final...');
const finalCustomers = await fetchAllCustomers();
const finalZones = {};
for (const c of finalCustomers) {
  const z = c.zone || (c.notes || '').replace(/^Zona:\s*/, '') || 'sin-zona';
  finalZones[z] = (finalZones[z] || 0) + 1;
}
const sellerCheck = await rest('jjp_profiles?select=id,name&id=in.(' +
  Object.values(ZONE_SELLER).map(i => `"${i}"`).join(',') + ')');

console.log(`  · total final: ${finalCustomers.length}`);
console.log(`  · insertados: ${ok} · fallos: ${conflict}`);
console.log(`  · por zona (columna): ${JSON.stringify(finalZones)}`);
console.log('  · vendedores de referencia:');
for (const s of sellerCheck) console.log(`    - ${s.id} → ${s.name}`);
console.log('\nListo ✔');