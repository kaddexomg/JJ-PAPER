/* Diagnóstico: cuántos productos activos, cuántos duplicados por nombre, etc. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  const m = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const r = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (r) m[r[1]] = r[2].replace(/^"|"$/g, '');
  }
  return m;
}
const env = loadEnv(join(HERE, 'wa-server', '.env'));
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

async function rest(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H });
  const t = await r.text();
  try { return JSON.parse(t); } catch { console.error('Raw:', t.slice(0, 200)); throw new Error(`HTTP ${r.status}`); }
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  // Load all active products
  const all = [];
  let offset = 0;
  while (true) {
    const batch = await rest(`jjp_products?select=id,name,sku,price_usd,stock,image_url,active,created_at&active=eq.true&order=name&limit=1000&offset=${offset}`);
    all.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Total activos: ${all.length}`);

  // Group by normalized name
  const byName = new Map();
  for (const p of all) {
    const k = norm(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }

  // Find duplicates
  const dups = [...byName.entries()].filter(([k, v]) => v.length > 1);
  console.log(`Nombres únicos: ${byName.size}`);
  console.log(`Nombres duplicados: ${dups.length}`);
  console.log(`Productos en duplicados: ${dups.reduce((s, [k, v]) => s + v.length, 0)}`);

  // Show some examples
  console.log('\n--- Ejemplos de duplicados (primeros 20) ---');
  for (const [name, items] of dups.slice(0, 20)) {
    console.log(`\n"${items[0].name}" (${items.length} copias):`);
    for (const p of items) {
      const img = p.image_url ? '📷' : '  ';
      console.log(`  ${img} SKU:${p.sku || 'SIN SKU'} | $${p.price_usd} | stock:${p.stock} | id:${p.id.slice(0, 8)}`);
    }
  }

  // Check how many products DON'T have a real SKU (generic ones)
  const noSku = all.filter(p => !p.sku || p.sku.length < 3);
  console.log(`\n\nProductos sin SKU o SKU genérico (<3 chars): ${noSku.length}`);

  // Group by SKU
  const bySku = new Map();
  for (const p of all) {
    if (p.sku) {
      const sk = p.sku.toUpperCase();
      if (!bySku.has(sk)) bySku.set(sk, []);
      bySku.get(sk).push(p);
    }
  }
  const skuDups = [...bySku.entries()].filter(([k, v]) => v.length > 1);
  console.log(`SKUs duplicados: ${skuDups.length}`);
  for (const [sku, items] of skuDups.slice(0, 10)) {
    console.log(`  SKU "${sku}": ${items.length} copias → ${items.map(i => i.name).join(' | ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
