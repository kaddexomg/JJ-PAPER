/* ======================================================
   JJ Paper — SINCRONIZA catálogo CSV → Supabase
   ------------------------------------------------------
   Toma el catálogo real (CSV con CODIGO, PRODUCTO, PRECIO_USD, STOCK)
   y lo sincroniza con jjp_products + jjp_product_variants en Supabase.

   Estrategia:
   - Match por nombre normalizado (sin acentos, minúsculas)
   - Productos existentes: actualiza precio, stock, SKU
   - Productos nuevos del CSV: los crea
   - Productos en BD que no están en CSV: se desactivan (no se borran)
   - CONSERVA las imágenes existentes (image_url)

   Uso:
     node sincronizar_catalogo.mjs --dry-run   # simula
     node sincronizar_catalogo.mjs --execute   # aplica cambios
   ====================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'catalogo actualizado 03_09_2026 - Hoja 1.csv');
const ENV_PATH = join(HERE, 'wa-server', '.env');
const BACKUP_DIR = join(HERE, 'backups');
const DRY_RUN = !process.argv.includes('--execute');

// ── Load env ──────────────────────────────────────────────
function loadEnv(path) {
  const map = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}
const env = loadEnv(ENV_PATH);
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H, ...opts });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} → ${String(text).slice(0, 500)}`);
  return body;
}

// ── Helpers ───────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// More aggressive normalization for fuzzy matching
function normFuzzy(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// Check if two strings are similar enough (for matching products)
function isSimilar(a, b, threshold = 0.8) {
  const na = normFuzzy(a);
  const nb = normFuzzy(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Simple similarity: common chars / total chars
  let common = 0;
  for (const c of na) { if (nb.includes(c)) common++; }
  return (common / Math.max(na.length, nb.length)) >= threshold;
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
    if (precio <= 0) continue; // skip productos sin precio
    products.push({ codigo, name: producto, price_usd: precio, stock });
  }
  return products;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\n📦 Sincronizando catálogo CSV → Supabase`);
  console.log(`   Modo: ${DRY_RUN ? '🔍 DRY-RUN (sin cambios)' : '⚡ EJECUTAR (aplicando cambios)'}\n`);

  // 1. Load CSV
  const csvProducts = loadCSV();
  console.log(`   CSV: ${csvProducts.length} productos válidos (con precio > 0)\n`);

  // 2. Load current products from Supabase
  console.log(`   Cargando productos actuales de Supabase...`);
  const existingProducts = await rest(
    'jjp_products?select=id,name,price_usd,stock,active,image_url,sku,category_id,sort_order&active=eq.true&order=sort_order',
    { method: 'GET' }
  );
  if (!Array.isArray(existingProducts)) throw new Error(`Respuesta inesperada de Supabase: ${JSON.stringify(existingProducts).slice(0,300)}`);
  console.log(`   BD: ${existingProducts.length} productos activos\n`);

  // Build lookup: normalized name → product
  const existingByName = new Map();
  for (const p of existingProducts) {
    existingByName.set(norm(p.name), p);
  }

  // Also build a lookup by SKU for products that have one
  const existingBySku = new Map();
  for (const p of existingProducts) {
    if (p.sku) existingBySku.set(p.sku.toUpperCase(), p);
  }

  // 3. Categorize CSV products
  const toUpdate = [];   // existentes con cambios
  const toCreate = [];   // nuevos
  const csvNormNames = new Set();
  const matchedExistingIds = new Set(); // track which existing products were matched

  for (const csv of csvProducts) {
    const key = norm(csv.name);
    csvNormNames.add(key);

    // Try exact name match
    let existing = existingByName.get(key);

    // Try SKU match if no exact name match
    if (!existing && csv.codigo) {
      existing = existingBySku.get(csv.codigo.toUpperCase());
    }

    // NO fuzzy matching - only exact matches to avoid incorrect pairings
    // Products not matched will be created as new

    if (existing) {
      matchedExistingIds.add(existing.id);
      const changes = {};
      if (existing.price_usd != csv.price_usd) changes.price_usd = csv.price_usd;
      if (existing.stock != csv.stock) changes.stock = csv.stock;
      if (existing.sku !== csv.codigo) changes.sku = csv.codigo;
      if (Object.keys(changes).length > 0) {
        toUpdate.push({ id: existing.id, name: existing.name, changes, image_url: existing.image_url });
      }
    } else {
      toCreate.push(csv);
    }
  }

  // 4. NO desactivar productos - el usuario quiere conservar todos
  // Solo se actualizan precios/stock de existentes y se crean nuevos
  const toDeactivate = [];

  // ── Report ──────────────────────────────────────────────
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  RESUMEN DE CAMBIOS`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  ✏️  A actualizar (precio/stock/SKU): ${toUpdate.length}`);
  console.log(`  ➕ A crear (nuevos):                 ${toCreate.length}`);
  console.log(`  ❌ A desactivar (no están en CSV):   ${toDeactivate.length}`);
  console.log(`  ✅ Sin cambios:                      ${existingProducts.length - toUpdate.length - toDeactivate.length}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  if (toUpdate.length > 0) {
    console.log(`📝 PRODUCTOS A ACTUALIZAR:`);
    for (const u of toUpdate.slice(0, 30)) {
      const ch = Object.entries(u.changes).map(([k,v]) => `${k}: ${v}`).join(', ');
      console.log(`   - ${u.name} → ${ch}`);
    }
    if (toUpdate.length > 30) console.log(`   ... y ${toUpdate.length - 30} más`);
    console.log('');
  }

  if (toCreate.length > 0) {
    console.log(`➕ PRODUCTOS A CREAR (primeros 30):`);
    for (const c of toCreate.slice(0, 30)) {
      console.log(`   - [${c.codigo}] ${c.name} — $${c.price_usd} (stock: ${c.stock})`);
    }
    if (toCreate.length > 30) console.log(`   ... y ${toCreate.length - 30} más`);
    console.log('');
  }

  if (toDeactivate.length > 0) {
    console.log(`❌ PRODUCTOS A DESACTIVAR (no están en CSV):`);
    for (const d of toDeactivate.slice(0, 30)) {
      console.log(`   - ${d.name} ${d.image_url ? '📷 tiene imagen' : ''}`);
    }
    if (toDeactivate.length > 30) console.log(`   ... y ${toDeactivate.length - 30} más`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log(`\n🔍 DRY-RUN completado. Para aplicar: node sincronizar_catalogo.mjs --execute`);
    return;
  }

  // ── Execute ─────────────────────────────────────────────
  console.log(`\n⚡ Aplicando cambios...\n`);

  // Backup
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  writeFileSync(join(BACKUP_DIR, `catalogo_antes_sincronizar_${ts}.json`), JSON.stringify(existingProducts, null, 2));
  console.log(`   💾 Backup guardado en backups/catalogo_antes_sincronizar_${ts}.json`);

  let updated = 0, created = 0, deactivated = 0, errors = 0;

  // Updates (batches of 50)
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    const promises = batch.map(u =>
      rest(`jjp_products?id=eq.${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify(u.changes),
      }).then(() => { updated++; console.log(`   ✅ ${u.name}`); })
        .catch(e => { errors++; console.error(`   ❌ ${u.name}: ${e.message}`); })
    );
    await Promise.all(promises);
  }

  // Creates (batches of 50)
  // Necesitamos una categoría por defecto para los productos nuevos
  let defaultCategoryId = null;
  try {
    const cats = await rest('jjp_categories?select=id&order=sort_order&limit=1', { method: 'GET' });
    if (Array.isArray(cats) && cats.length) defaultCategoryId = cats[0].id;
  } catch (e) { console.warn('   ⚠️ No se pudo obtener categoría default:', e.message); }

  const newProducts = toCreate.map((csv, idx) => ({
    name: csv.name,
    price_usd: csv.price_usd,
    stock: csv.stock,
    sku: csv.codigo,
    active: true,
    sort_order: 10000 + idx,
    category_id: defaultCategoryId,
  }));

  for (let i = 0; i < newProducts.length; i += 50) {
    const batch = newProducts.slice(i, i + 50);
    try {
      const result = await rest('jjp_products', {
        method: 'POST',
        body: JSON.stringify(batch),
      });
      created += batch.length;
      console.log(`   ➕ Creados ${batch.length} productos`);
    } catch (e) {
      errors++;
      console.error(`   ❌ Error creando lote: ${e.message}`);
    }
  }

  // Deactivations (batches of 50)
  for (let i = 0; i < toDeactivate.length; i += 50) {
    const batch = toDeactivate.slice(i, i + 50);
    const ids = batch.map(p => p.id);
    try {
      await rest('jjp_products?id=in.(' + ids.join(',') + ')', {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
      deactivated += batch.length;
      console.log(`   ❌ Desactivados ${batch.length} productos`);
    } catch (e) {
      errors++;
      console.error(`   ❌ Error desactivando lote: ${e.message}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  ✅ SINCRONIZACIÓN COMPLETADA`);
  console.log(`  ✏️  Actualizados: ${updated}`);
  console.log(`  ➕ Creados:      ${created}`);
  console.log(`  ❌ Desactivados: ${deactivated}`);
  console.log(`  ⚠️  Errores:     ${errors}`);
  console.log(`═══════════════════════════════════════════════════════\n`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
