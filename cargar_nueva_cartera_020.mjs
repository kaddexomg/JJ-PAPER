/* ======================================================
   JJ Paper — CARGAR NUEVA CARTERA DE CLIENTES MIXNET (ZONA 020)
   ------------------------------------------------------
   Importa los clientes del maestro MixNet
   (CLIENTES/mixnet_clientes_cartera_20260908_1205.csv)
   que no pertenecen a las carteras de vendedores conocidas
   (004, 006, 008, 014, 010).

   Asigna:
     - zone: '020'
     - seller_id: null (cartera libre / disponible para todos)
     - city: 'Caracas'
     - notes: 'MixNet: [CODIGO] | Zona orig: [ORIG]'

   Manejo estricto de restricciones:
     - Deduplicación contra BD existente por teléfono, nombre y RIF.
     - Teléfonos repetidos se limpian a null para respetar UNIQUE(phone).
     - Inserta por lotes de 50 registros con reintentos seguros.

   Uso:
     node cargar_nueva_cartera_020.mjs --dry-run
     node cargar_nueva_cartera_020.mjs --execute
   ====================================================== */

import fs from 'node:fs';
import readline from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'CLIENTES', 'mixnet_clientes_cartera_20260908_1205.csv');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');

const EXEC = process.argv.includes('--execute');
const KNOWN_ZONES = new Set(['004', '006', '008', '014', '010']);

function loadEnv(path) {
  const map = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}

const env = loadEnv(ENV_PATH);
const URL = env.SUPABASE_URL_CORE || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY_CORE || env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Faltan credenciales SUPABASE_URL_CORE / SUPABASE_SERVICE_ROLE_KEY_CORE en wa-server/.env');
  process.exit(1);
}

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
  if (d.length === 11 && (d.startsWith('04') || d.startsWith('02'))) return d;
  if (d.length === 10 && (d[0] === '2' || d[0] === '4')) return '0' + d;
  if (d.length === 12 && d.startsWith('58')) {
    const local = '0' + d.slice(2);
    if (local.length === 11 && (local.startsWith('04') || local.startsWith('02'))) return local;
  }
  if (d.length === 7) return '0212' + d;
  if (d.length === 11) return d;
  return null;
}

function cleanText(str) {
  if (!str) return '';
  return String(str)
    .replace(/^"+|"+$/g, '')
    .replace(/¥/g, 'Ñ')
    .replace(/§/g, 'º')
    .replace(/µ/g, 'Á')
    .replace(/Ö/g, 'Í')
    .replace(/ù/g, 'Ú')
    .replace(/à/g, 'Ó')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRif(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^JVEGP0-9-]/g, '');
  return s.length >= 6 ? s : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n======================================================`);
  console.log(`   CARGA DE NUEVA CARTERA MIXNET (ZONA 020)`);
  console.log(`   Modo: ${EXEC ? '>>> EXECUTE (Escribiendo en BD) <<<' : '*** DRY-RUN (Simulación) ***'}`);
  console.log(`======================================================\n`);

  console.log('1. Obteniendo clientes actuales de Supabase...');
  const existing = [];
  for (let start = 0; ; start += 1000) {
    const page = await rest(`jjp_customers?select=id,name,phone,rif,zone,seller_id&limit=1000&offset=${start}`);
    existing.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  console.log(`   -> Total clientes existentes en BD: ${existing.length}`);

  const dbPhones = new Set();
  const dbNames = new Set();
  const dbRifs = new Set();

  existing.forEach(c => {
    if (c.phone) dbPhones.add(c.phone);
    const n = norm(c.name);
    if (n && n.length >= 6) dbNames.add(n);
    if (c.rif) dbRifs.add(c.rif.toUpperCase().replace(/[^JVEGP0-9]/g, ''));
  });

  console.log('\n2. Procesando archivo CSV MixNet...');
  const fileStream = fs.createReadStream(CSV_PATH);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineCount = 0;
  const candidates = [];

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue;

    const parts = [];
    let inQuotes = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { parts.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    parts.push(cur.trim());

    const codigo = parts[0] || '';
    const rawName = parts[1] || '';
    const cleanName = cleanText(rawName);
    if (!cleanName || cleanName.length < 2) continue;

    const rif = cleanRif(parts[2]);
    const rawPhone = parts[3] || parts[4] || '';
    const email = (parts[5] || '').trim() || null;
    const address = cleanText(parts[6]) || null;
    const seller = (parts[7] || '').trim();
    const zone = (parts[8] || '').trim();

    // Ignorar si pertenece a carteras ya asignadas
    if (KNOWN_ZONES.has(zone) || KNOWN_ZONES.has(seller)) {
      continue;
    }

    candidates.push({
      codigo,
      name: cleanName,
      rif,
      rawPhone,
      phone: normPhone(rawPhone),
      email: (email && email.includes('@')) ? email.toLowerCase() : null,
      address,
      origSeller: seller,
      origZone: zone,
    });
  }

  console.log(`   -> Total filas fuera de 004, 006, 008, 014 y 010: ${candidates.length}`);

  // Filtrado y deduplicación estricta
  const toInsert = [];
  const skippedExisting = [];
  const batchPhones = new Set();
  const batchNames = new Set();

  for (const cand of candidates) {
    const normN = norm(cand.name);
    const rifKey = cand.rif ? cand.rif.replace(/[^JVEGP0-9]/g, '') : null;

    // 1. ¿Ya existe en BD por teléfono exacto?
    if (cand.phone && dbPhones.has(cand.phone)) {
      skippedExisting.push({ reason: 'phone_in_db', item: cand });
      continue;
    }

    // 2. ¿Ya existe en BD por nombre casi idéntico (>=8 chars)?
    if (normN.length >= 8 && dbNames.has(normN)) {
      skippedExisting.push({ reason: 'name_in_db', item: cand });
      continue;
    }

    // 3. ¿Ya existe en BD por RIF?
    if (rifKey && rifKey.length >= 7 && dbRifs.has(rifKey)) {
      skippedExisting.push({ reason: 'rif_in_db', item: cand });
      continue;
    }

    // 4. ¿Duplicado dentro del mismo lote CSV por nombre?
    if (normN.length >= 8 && batchNames.has(normN)) {
      continue; // Ignorar repetido en el archivo
    }

    // 5. Deduplicación de teléfono en el lote
    let assignedPhone = cand.phone;
    if (assignedPhone) {
      if (batchPhones.has(assignedPhone) || dbPhones.has(assignedPhone)) {
        // Para evitar choque con UNIQUE(phone), si el teléfono ya fue tomado se deja null
        assignedPhone = null;
      } else {
        batchPhones.add(assignedPhone);
      }
    }

    if (normN.length >= 8) batchNames.add(normN);

    const notes = [
      cand.codigo ? `MixNet: ${cand.codigo}` : '',
      cand.origZone ? `Zona orig: ${cand.origZone}` : (cand.origSeller ? `Vend orig: ${cand.origSeller}` : ''),
    ].filter(Boolean).join(' | ');

    toInsert.push({
      name: cand.name,
      phone: assignedPhone,
      rif: cand.rif,
      email: cand.email,
      address: cand.address,
      city: 'Caracas',
      zone: '020',
      seller_id: null,
      notes: notes || 'MixNet Cartera 020',
      total_orders: 0,
      total_usd: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`\n3. Resumen de clasificación:`);
  console.log(`   -> Clientes ya existentes en BD (omitidos): ${skippedExisting.length}`);
  console.log(`   -> Nuevos clientes listos para insertar en Zona 020: ${toInsert.length}`);
  const withPhone = toInsert.filter(c => c.phone).length;
  const withRif = toInsert.filter(c => c.rif).length;
  const withAddr = toInsert.filter(c => c.address).length;
  console.log(`      · Con teléfono móvil/fijo validado: ${withPhone}`);
  console.log(`      · Con RIF: ${withRif}`);
  console.log(`      · Con dirección física: ${withAddr}`);

  console.log(`\n4. Muestra de los primeros 5 clientes a insertar:`);
  toInsert.slice(0, 5).forEach((c, i) => {
    console.log(`   [${i + 1}] ${c.name} | Tel: ${c.phone || 'S/T'} | RIF: ${c.rif || 'S/R'} | Dir: ${(c.address || 'S/D').slice(0, 30)}`);
  });

  if (!EXEC) {
    console.log(`\n[!] Modo DRY-RUN finalizado. No se escribieron datos en Supabase.`);
    console.log(`    Para ejecutar la inserción real en la base de datos, ejecuta:`);
    console.log(`    node cargar_nueva_cartera_020.mjs --execute\n`);
    return;
  }

  // Creación de backup previo
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupPath = join(BACKUP_DIR, `jjp_customers_antes_cartera_020_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2));
  console.log(`\n· Backup de seguridad guardado en: ${backupPath}`);

  console.log(`\n5. Insertando clientes en Supabase (Lotes de 50)...`);
  const BATCH_SIZE = 50;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const chunk = toInsert.slice(i, i + BATCH_SIZE);
    try {
      await rest('jjp_customers', {
        method: 'POST',
        headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify(chunk),
      });
      ok += chunk.length;
    } catch (e) {
      // Si falla el lote completo (p. ej. colisión de teléfono imprevista), insertar 1 a 1 con fallback
      for (const item of chunk) {
        try {
          await rest('jjp_customers', {
            method: 'POST',
            headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify(item),
          });
          ok++;
        } catch (e2) {
          // Reintentar sin teléfono por si colisiona
          try {
            await rest('jjp_customers', {
              method: 'POST',
              headers: { ...H, Prefer: 'return=minimal' },
              body: JSON.stringify({ ...item, phone: null }),
            });
            ok++;
          } catch (e3) {
            fail++;
            console.error(`   ✗ Error con "${item.name}": ${e3.message.slice(0, 100)}`);
          }
        }
        await sleep(30);
      }
    }
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toInsert.length / BATCH_SIZE);
    if (currentBatch % 5 === 0 || currentBatch === totalBatches) {
      console.log(`   -> Progreso: Lote ${currentBatch}/${totalBatches} | Insertados: ${ok} | Fallos: ${fail}`);
    }
    await sleep(100);
  }

  console.log(`\n======================================================`);
  console.log(`   CARGA COMPLETADA CON ÉXITO`);
  console.log(`   Total insertados: ${ok} | Fallos: ${fail}`);
  console.log(`======================================================\n`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
