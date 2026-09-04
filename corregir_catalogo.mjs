/* ======================================================
   JJ Paper — CORRECCIÓN DE CATÁLOGO
   ------------------------------------------------------
   Corrige los problemas de la sincronización anterior:
   1. Matchea productos CSV ↔ BD por nombre fuzzy
   2. Actualiza SKU genérico → SKU real del CSV
   3. Actualiza precio y stock del CSV
   4. Desactiva productos que NO están en el CSV
   5. NO crea duplicados

   Uso:
     node corregir_catalogo.mjs --dry-run
     node corregir_catalogo.mjs --execute
   ====================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'catalogo actualizado 03_09_2026 - Hoja 1.csv');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');
const DRY_RUN = !process.argv.includes('--execute');

function loadEnv(p) {
  const m = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const r = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (r) m[r[1]] = r[2].replace(/^"|"$/g, '');
  }
  return m;
}
const env = loadEnv(ENV_PATH);
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Faltan credenciales'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(path, opts = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H, ...opts });
  const t = await r.text();
  let b; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path} → ${String(t).slice(0, 500)}`);
  return b;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Token-based similarity for better matching
function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.95;

  // Token-based: how many words in common
  const tokA = na.split(' ').filter(t => t.length > 2);
  const tokB = nb.split(' ').filter(t => t.length > 2);
  if (!tokA.length || !tokB.length) return 0;

  let common = 0;
  for (const t of tokA) {
    if (tokB.some(tb => tb === t || t.includes(tb) || tb.includes(t))) common++;
  }
  return common / Math.max(tokA.length, tokB.length);
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

function loadCSV() {
  const raw = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);
  const header = rows[0].map(h => h.trim().toUpperCase());
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 3) continue;
    const obj = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    const codigo = obj.CODIGO || '';
    const producto = obj.PRODUCTO || '';
    const precio = parseFloat(obj.PRECIO_USD) || 0;
    const stock = parseInt(obj.STOCK) || 0;
    if (!producto || producto === '(SIN NOMBRE)') continue;
    if (precio <= 0) continue;
    products.push({ codigo, name: producto, price_usd: precio, stock });
  }
  return products;
}

// Paginated fetch for large tables
async function fetchAllProducts() {
  const all = [];
  let offset = 0;
  while (true) {
    const batch = await rest(
      `jjp_products?select=id,name,sku,price_usd,stock,image_url,active,sort_order,category_id&active=eq.true&order=name&limit=1000&offset=${offset}`
    );
    all.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function main() {
  console.log(`\n📦 CORRECCIÓN DE CATÁLOGO — JJ Paper`);
  console.log(`   Modo: ${DRY_RUN ? '🔍 DRY-RUN' : '⚡ EJECUTAR'}\n`);

  // 1. Load data
  const csvProducts = loadCSV();
  const dbProducts = await fetchAllProducts();
  console.log(`   CSV: ${csvProducts.length} productos`);
  console.log(`   BD:  ${dbProducts.length} productos activos\n`);

  // 2. For each CSV product, find the best match in BD
  const csvMatched = new Map();  // csvIndex → dbProduct
  const dbUsed = new Set();      // IDs of DB products that were matched
  const csvByCode = new Map();
  for (const csv of csvProducts) {
    if (csv.codigo) csvByCode.set(csv.codigo.toUpperCase(), csv);
  }

  // Pass 1: Match by exact SKU
  for (let i = 0; i < csvProducts.length; i++) {
    const csv = csvProducts[i];
    if (!csv.codigo) continue;
    const skuKey = csv.codigo.toUpperCase();
    const match = dbProducts.find(p => p.sku && p.sku.toUpperCase() === skuKey && !dbUsed.has(p.id));
    if (match) {
      csvMatched.set(i, match);
      dbUsed.add(match.id);
    }
  }

  // Pass 2: Match by exact name (normalized)
  const dbNameMap = new Map();
  for (const p of dbProducts) {
    if (dbUsed.has(p.id)) continue;
    dbNameMap.set(norm(p.name), p);
  }
  for (let i = 0; i < csvProducts.length; i++) {
    if (csvMatched.has(i)) continue;
    const csv = csvProducts[i];
    const match = dbNameMap.get(norm(csv.name));
    if (match && !dbUsed.has(match.id)) {
      csvMatched.set(i, match);
      dbUsed.add(match.id);
    }
  }

  // Pass 3: Fuzzy match by best similarity
  for (let i = 0; i < csvProducts.length; i++) {
    if (csvMatched.has(i)) continue;
    const csv = csvProducts[i];
    let bestMatch = null, bestScore = 0;
    for (const p of dbProducts) {
      if (dbUsed.has(p.id)) continue;
      const score = similarity(csv.name, p.name);
      if (score > bestScore) { bestScore = score; bestMatch = p; }
    }
    if (bestMatch && bestScore >= 0.75) {
      csvMatched.set(i, bestMatch);
      dbUsed.add(bestMatch.id);
    }
  }

  // 3. Categorize
  const toUpdate = [];
  const toCreate = [];
  const toDeactivate = [];

  for (let i = 0; i < csvProducts.length; i++) {
    const csv = csvProducts[i];
    const match = csvMatched.get(i);
    if (match) {
      const changes = {};
      // Always update SKU to the real one
      if (match.sku !== csv.codigo) changes.sku = csv.codigo;
      // Update price
      if (match.price_usd != csv.price_usd) changes.price_usd = csv.price_usd;
      // Update stock
      if (match.stock != csv.stock) changes.stock = csv.stock;
      if (Object.keys(changes).length > 0) {
        toUpdate.push({ id: match.id, name: match.name, csvName: csv.name, changes, image_url: match.image_url });
      }
    } else {
      toCreate.push(csv);
    }
  }

  for (const p of dbProducts) {
    if (!dbUsed.has(p.id)) {
      toDeactivate.push(p);
    }
  }

  // 4. Report
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  RESUMEN DE CORRECCIÓN`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  ✏️  A actualizar (SKU/precio/stock): ${toUpdate.length}`);
  console.log(`  ➕ A crear (sin match en BD):        ${toCreate.length}`);
  console.log(`  ❌ A desactivar (sin match en CSV):  ${toDeactivate.length}`);
  console.log(`  ✅ Ya correctos:                     ${dbProducts.length - toUpdate.length - toDeactivate.length}`);
  console.log(`  📊 Total después:                    ${dbProducts.length - toDeactivate.length + toCreate.length}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  if (toUpdate.length > 0) {
    console.log(`✏️ PRODUCTOS A ACTUALIZAR (SKU → real, precio, stock):`);
    for (const u of toUpdate.slice(0, 40)) {
      const ch = Object.entries(u.changes).map(([k,v]) => `${k}: ${v}`).join(', ');
      const tag = u.name !== u.csvName ? ` (era: "${u.name}")` : '';
      console.log(`   ${u.image_url ? '📷' : '  '} ${u.csvName}${tag} → ${ch}`);
    }
    if (toUpdate.length > 40) console.log(`   ... y ${toUpdate.length - 40} más`);
    console.log('');
  }

  if (toCreate.length > 0) {
    console.log(`➕ PRODUCTOS A CREAR (primeros 20):`);
    for (const c of toCreate.slice(0, 20)) {
      console.log(`   [${c.codigo}] ${c.name} — $${c.price_usd}`);
    }
    if (toCreate.length > 20) console.log(`   ... y ${toCreate.length - 20} más`);
    console.log('');
  }

  if (toDeactivate.length > 0) {
    console.log(`❌ A DESACTIVAR (${toDeactivate.length} productos sin match en CSV):`);
    for (const d of toDeactivate.slice(0, 20)) {
      console.log(`   ${d.image_url ? '📷' : '  '} ${d.name} | SKU: ${d.sku || 'N/A'}`);
    }
    if (toDeactivate.length > 20) console.log(`   ... y ${toDeactivate.length - 20} más`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log(`\n🔍 DRY-RUN completado. Para aplicar: node corregir_catalogo.mjs --execute`);
    return;
  }

  // 5. Execute
  console.log(`\n⚡ Aplicando correcciones...\n`);

  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  writeFileSync(join(BACKUP_DIR, `catalogo_pre_correccion_${ts}.json`), JSON.stringify(dbProducts, null, 2));
  console.log(`   💾 Backup guardado`);

  let upd = 0, crt = 0, deact = 0, err = 0;

  // Updates
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    const promises = batch.map(u =>
      rest(`jjp_products?id=eq.${u.id}`, { method: 'PATCH', body: JSON.stringify(u.changes) })
        .then(() => { upd++; console.log(`   ✏️ ${u.csvName}`); })
        .catch(e => { err++; console.error(`   ❌ ${u.csvName}: ${e.message}`); })
    );
    await Promise.all(promises);
  }

  // Creates
  let defaultCat = null;
  try {
    const cats = await rest('jjp_categories?select=id&order=sort_order&limit=1');
    if (Array.isArray(cats) && cats.length) defaultCat = cats[0].id;
  } catch {}

  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50).map((csv, idx) => ({
      name: csv.name,
      price_usd: csv.price_usd,
      stock: csv.stock,
      sku: csv.codigo,
      active: true,
      sort_order: 10000 + i + idx,
      category_id: defaultCat,
    }));
    try {
      await rest('jjp_products', { method: 'POST', body: JSON.stringify(batch) });
      crt += batch.length;
      console.log(`   ➕ Creados ${batch.length} productos`);
    } catch (e) { err++; console.error(`   ❌ Error creando: ${e.message}`); }
  }

  // Deactivations
  for (let i = 0; i < toDeactivate.length; i += 50) {
    const batch = toDeactivate.slice(i, i + 50);
    const ids = batch.map(p => p.id);
    try {
      await rest(`jjp_products?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
      deact += batch.length;
      console.log(`   ❌ Desactivados ${batch.length} productos`);
    } catch (e) { err++; console.error(`   ❌ Error desactivando: ${e.message}`); }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  ✅ CORRECCIÓN COMPLETADA`);
  console.log(`  ✏️  Actualizados: ${upd}`);
  console.log(`  ➕ Creados:      ${crt}`);
  console.log(`  ❌ Desactivados: ${deact}`);
  console.log(`  ⚠️  Errores:     ${err}`);
  console.log(`═══════════════════════════════════════════════════════\n`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
