/* ======================================================
   JJ Paper — ACTUALIZA clientes en la BD (Supabase)
   ------------------------------------------------------
   Toma la cartera corregida (CLIENTES/cartera_corregida_mixnet.csv,
   con RIF/teléfono/dirección reales de MixNet) y ACTUALIZA los
   clientes YA existentes en public.jjp_customers, haciendo match
   por nombre normalizado + zona (tolerando que los nombres en la
   BD estén truncados a ~30 caracters).

   NO borra ni toca registros "otros" (clientes reales que no vienen
   del CSV). Actualiza los existentes (rif, phone, address, city) y
   ADEMÁS inserta los clientes de la cartera que NO están en la BD.

   Uso:
     node actualizar_clientes_bd.mjs --dry-run   # simula, no escribe
     node actualizar_clientes_bd.mjs --execute   # aplica (update + insert)
     node actualizar_clientes_bd.mjs --no-insert # solo actualiza, no inserta
   ====================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'CLIENTES', 'cartera_corregida_mixnet.csv');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');

const EXEC = process.argv.includes('--execute');
const NO_INSERT = process.argv.includes('--no-insert');

const ZONE_SELLER = {
  '008': 'd9608291-1363-4790-a7b0-0d6fd426564f', // MANIANELA VENTAS JJ 008
  '014': 'b0cd93c5-e2f0-4322-9d35-e374109d284f', // ANDREINA JJ VENTAS 014
  '006': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', // Yovanni Araujo 006 004
  '004': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6',
};

function loadEnv(path) {
  const map = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}
const env = loadEnv(ENV_PATH);
const URL = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
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

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return d;
  if (d.length === 10 && (d[0] === '2' || d[0] === '4')) return '0' + d;
  if (d.length === 12 && d.startsWith('58')) return '0' + d.slice(2);
  if (d.length === 7) return '0212' + d;
  return d.length >= 7 ? d : null;
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (row.length || field !== '') { row.push(field); rows.push(row); }
      field = ''; row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else field += ch;
  }
  if (row.length || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

async function fetchAllCustomers() {
  const all = [];
  for (let start = 0; ; start += 1000) {
    const page = await rest(`jjp_customers?select=id,name,rif,phone,notes,zone,seller_id,address,city&limit=1000&offset=${start}`);
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

// ¿es `a` igual o prefijo normalizado compatible de `b` (orden simétrico)?
function nameMatch(aNorm, bNorm) {
  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;
  if (aNorm.length < 8 && bNorm.length < 8) return false; // nombres demasiado cortos/ambiguos
  // una es prefijo de la otra
  if (aNorm.length <= bNorm.length) return bNorm.startsWith(aNorm);
  return aNorm.startsWith(bNorm);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log(`Modo: ${EXEC ? 'EXECUTE (escribe en la BD)' : 'DRY-RUN (no escribe nada)'}\n`);

console.log('Leyendo CSV corregido...');
const lines = parseCSV(readFileSync(CSV_PATH, 'utf8'));
const head = lines[0].map(h => h.trim().toLowerCase());
const idx = {};
head.forEach((h, i) => idx[h] = i);
const csvRows = lines.slice(1).map(l => Object.fromEntries(head.map((h, i) => [h, (l[i] || '').trim()])));
console.log(`  · filas CSV: ${csvRows.length}`);

console.log('\nRecuperando clientes actuales de la BD...');
const db = await fetchAllCustomers();
console.log(`  · clientes en BD: ${db.length}`);

// Índice: por zona → lista de {cliente, normName}
const byZone = new Map();
for (const c of db) {
  const z = (c.zone || (c.notes || '').replace(/^Zona:\s*/, '') || '').trim() || 'sin';
  if (!byZone.has(z)) byZone.set(z, []);
  byZone.get(z).push({ c, nn: norm(c.name) });
}

let willUpdate = 0, matchedButNoChange = 0, toInsert = 0, noAddr = 0, ambiguous = 0;
const noMatchSamples = [];
const ambiguousSamples = [];
const plan = [];
const inserts = [];

// índice global (todas las zonas) para el fallback fuzzy
const dbNorm = db.map(c => ({
  c,
  nn: norm(c.name),
  tokens: norm(c.name).split(' ').filter(w => w.length > 3),
}));

// teléfonos YA usados en la BD (para no chocar con la UNIQUE constraint)
const usedPhones = new Set();
for (const c of db) if (c.phone) usedPhones.add(String(c.phone));

for (const r of csvRows) {
  const name = r.name || '';
  const zone = (r.zone || '').trim();
  const address = r.address || '';
  const rif = r.rif || '';
  const phone = normPhone(r.phone);
  if (!address) noAddr++;

  const nn = norm(name);
  const candidates = byZone.get(zone) || [];

  // 1) exacto en la misma zona
  let found = candidates.find(x => x.nn === nn);
  // 2) prefijo compatible en la misma zona, sin ambigüedad
  if (!found) {
    const matches = candidates.filter(x => nameMatch(nn, x.nn));
    found = matches.length === 1 ? matches[0] : null;
  }
  // 3) fallback: fuzzy por tokens EN CUALQUIER zona, sin ambigüedad
  if (!found) {
    const qt = nn.split(' ').filter(w => w.length > 3).slice(0, 4);
    if (qt.length >= 2) {
      const scored = [];
      for (const d of dbNorm) {
        let hits = 0;
        for (const t of qt) if (d.tokens.some(dt => dt === t || dt.indexOf(t) !== -1 || t.indexOf(dt) !== -1)) hits++;
        const sc = hits / qt.length;
        if (sc >= 0.75) scored.push({ d, sc });
      }
      const best = scored.sort((a, b) => b.sc - a.sc)[0];
      if (scored.length === 1) found = { c: best.d.c, nn: best.d.nn };
      else if (scored.length > 1) { ambiguous++; if (ambiguousSamples.length < 8) ambiguousSamples.push(`${name} | ${zone}`); continue; } // ambiguo → no tocar ni insertar
    }
  }

  if (!found) {
    // genuinamente ausente → insertar
    toInsert++;
    if (noMatchSamples.length < 15) noMatchSamples.push(`${name} | ${zone}`);
    if (!NO_INSERT) {
      const uniquePhone = phone || `s/n-${Math.random().toString(36).slice(2, 8)}`;
      inserts.push({
        name,
        phone: uniquePhone,
        zone,
        seller_id: ZONE_SELLER[zone] || null,
        rif: rif || null,
        email: null,
        city: 'Caracas',
        address: address || null,
        notes: `Zona: ${zone}`,
      });
    }
    continue;
  }

  const changes = {};
  if (rif && String(found.c.rif || '') !== rif) changes.rif = rif;
  if (phone && String(found.c.phone || '') !== phone) {
    // solo si el teléfono NO está usado por OTRO cliente de la BD
    if (usedPhones.has(phone) && String(found.c.phone || '') !== phone) {
      // está tomado por otra fila → omitir phone (seguimos con rif/address/city)
      console.log(`  · tel duplicado, se omite phone para: ${found.c.name} (${phone})`);
    } else {
      changes.phone = phone;
    }
  }
  if (address && String(found.c.address || '') !== address) changes.address = address;
  if (String(found.c.city || '') !== 'Caracas') changes.city = 'Caracas';

  if (Object.keys(changes).length) {
    willUpdate++;
    plan.push({ id: found.c.id, name: found.c.name, changes });
  } else {
    matchedButNoChange++;
  }
}

console.log(`\nResumen del plan:`);
console.log(`  · clientes a ACTUALIZAR: ${willUpdate}`);
console.log(`  · ya estaban completos (sin cambios): ${matchedButNoChange}`);
console.log(`  · clientes a INSERTAR (no están en BD): ${NO_INSERT ? 0 : toInsert}${NO_INSERT ? ' (--no-insert)' : ''}`);
console.log(`  · match ambiguo (no se tocan): ${ambiguous}`);
console.log(`  · filas sin dirección en CSV: ${noAddr}`);

if (noMatchSamples.length) {
  console.log(`\n· Ausentes en BD (se insertarán):`);
  noMatchSamples.forEach(s => console.log(`    - ${s}`));
  console.log(`  … y ${toInsert - noMatchSamples.length} más.`);
}
if (ambiguousSamples.length) {
  console.log(`\n· AMBIGUOS (no se tocan ni insertan, quedan solo en CSV):`);
  ambiguousSamples.forEach(s => console.log(`    ~ ${s}`));
}
console.log(`\n· Primeros 15 a actualizar:`);
plan.slice(0, 15).forEach(p => console.log(`    - ${p.name} -> ${Object.entries(p.changes).map(([k, v]) => `${k}=${String(v).slice(0, 26)}`).join(', ')}`));
if (inserts.length) {
  console.log(`\n· Primeros 8 a insertar:`);
  inserts.slice(0, 8).forEach(p => console.log(`    + ${p.name} | ${p.zone} | tel=${p.phone} | rif=${p.rif || '-'}`));
}

if (!EXEC) {
  console.log('\nDRY-RUN: sin cambios en la BD. Ejecuta con --execute para aplicar.');
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const backupPath = join(BACKUP_DIR, `jjp_customers_antes_actualizar_${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(db, null, 2));
console.log(`\n· backup guardado: ${backupPath}`);

console.log('\nAplicando actualizaciones...');
const BATCH = 50;
let ok = 0, fail = 0;
for (let i = 0; i < plan.length; i += BATCH) {
  const chunk = plan.slice(i, i + BATCH);
  for (const p of chunk) {
    try {
      await rest(`jjp_customers?id=eq.${p.id}`, {
        method: 'PATCH',
        headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ ...p.changes, updated_at: new Date().toISOString() }),
      });
      ok++;
    } catch (e) { fail++; console.error(`  ✗ ${p.name}: ${e.message.slice(0, 120)}`); }
    await sleep(40);
  }
  console.log(`  · lote ${Math.floor(i / BATCH) + 1}/${Math.ceil(plan.length / BATCH)} ok=${ok} fail=${fail}`);
  await sleep(120);
}

let insOk = 0, insFail = 0;
if (inserts.length && !NO_INSERT) {
  console.log(`\nInsertando ${inserts.length} clientes que faltaban...`);
  const insertDone = [];
  for (let i = 0; i < inserts.length; i += 50) {
    const chunk = inserts.slice(i, i + 50);
    for (const x of chunk) {
      let payload = { ...x, updated_at: new Date().toISOString() };
      // si el teléfono ya está usado (otra fila BD o del mismo lote), insertar sin phone
      if (payload.phone && usedPhones.has(payload.phone)) {
        payload = { ...payload, phone: null };
      }
      try {
        await rest('jjp_customers', {
          method: 'POST',
          headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
        if (payload.phone) usedPhones.add(payload.phone);
        insOk++;
      } catch (e) {
        // si algo falla (p.ej. seller_id), reintentar forzando phone null y seller_id null
        try {
          await rest('jjp_customers', {
            method: 'POST',
            headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify({ ...payload, phone: null, seller_id: null, updated_at: new Date().toISOString() }),
          });
          insOk++;
        } catch (e2) { insFail++; console.error(`    ✗ ${x.name}: ${e2.message.slice(0, 110)}`); }
      }
      await sleep(40);
    }
    console.log(`  · lote ${Math.floor(i / 50) + 1}/${Math.ceil(inserts.length / 50)} ok=${insOk} fail=${insFail}`);
    await sleep(120);
  }
}

console.log(`\nFinalizado: actualizados=${ok} (${fail} fallos) · insertados=${insOk} (${insFail} fallos)`);
console.log('Verificación:');
const fin = await fetchAllCustomers();
const withRif = fin.filter(c => c.rif).length;
const withAddr = fin.filter(c => c.address).length;
const finZones = {};
for (const c of fin) { const z = c.zone || (c.notes || '').replace(/^Zona:\s*/, '') || 'sin'; finZones[z] = (finZones[z] || 0) + 1; }
console.log(`  · total BD: ${fin.length} · con RIF: ${withRif} · con address: ${withAddr}`);
console.log(`  · por zona: ${JSON.stringify(finZones)}`);
