import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let pg;
try {
  pg = (await import('pg')).default;
} catch {
  pg = (await import(pathToFileURL(path.join(ROOT, 'wa-server/node_modules/pg/lib/index.js')).href)).default;
}
const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'wa-server/.env'), 'utf8').split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const dataPath = (() => {
  const i = args.indexOf('--data');
  return i >= 0 ? args[i + 1] : path.join(ROOT, 'CLIENTES/catalogo_activos.json');
})();

async function main() {
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const num = v => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

const activos = JSON.parse(fs.readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''));
const cods = new Set(activos.map(r => norm(r.COD)));

const client = new pg.Client({
  host: ENV.PG_HOST_CORE, port: 5432, database: 'postgres',
  user: ENV.PG_USER_CORE, password: ENV.PG_PASS_CORE,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ids = (arr) => arr.length ? `(${arr.map((_, i) => `$${i + 1}`).join(',')})` : null;

const { rows: products } = await client.query(
  `SELECT p.id, upper(btrim(p.sku)) AS sku, p.name, p.mixnet_status, p.active, p.stock,
          (p.image_url IS NOT NULL AND p.image_url <> '') AS img,
          v.id AS variant_id, v.sku AS v_sku, v.brand_id
   FROM jjp_products p
   LEFT JOIN jjp_product_variants v ON v.product_id = p.id`);

const toDelete = products.filter(p => !cods.has(norm(p.sku)));
const toDeleteIds = toDelete.map(p => p.id);
const toDeleteVariantIds = toDelete.filter(p => p.variant_id).map(p => p.variant_id);

const keep = products.filter(p => cods.has(norm(p.sku)));
const keepIds = new Set(keep.map(p => p.id));
const dbCods = new Set(keep.map(p => norm(p.sku)));

const byStatus = {};
toDelete.forEach(p => { byStatus[p.mixnet_status || '(null)'] = (byStatus[p.mixnet_status || '(null)'] || 0) + 1; });
const activeInDelete = toDelete.filter(p => p.active).length;
const junkActive = toDelete.filter(p => (p.mixnet_status || '') === 'ACTIVO');

const line = (sql, values) => client.query(sql, values);

const referential = async () => {
  const out = {};
  if (toDeleteVariantIds.length) {
    const ph = ids(toDeleteVariantIds);
    for (const t of ['jjp_count_tally', 'jjp_count_log', 'jjp_barcode_log', 'jjp_stock_moves']) {
      const r = await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE variant_id IN ${ph}`, toDeleteVariantIds);
      out[t] = r.rows[0].n;
    }
    const sp1 = await client.query(`SELECT count(*)::int AS n FROM jjp_seller_prices WHERE variant_id IN ${ph}`, toDeleteVariantIds);
    const sp2 = await client.query(`SELECT count(*)::int AS n FROM jjp_seller_prices WHERE product_id IN ${ids(toDeleteIds)}`, toDeleteIds);
    out.jjp_seller_prices = sp1.rows[0].n + sp2.rows[0].n;
  }
  return out;
};

const stockNow = products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
const stockThen = activos.reduce((s, r) => s + Math.max(0, Math.round(num(r.EXISTENCIA || 0))), 0);
const missing = activos.filter(r => !dbCods.has(norm(r.COD)));

if (!execute) {
  console.log('MODO DRY-RUN (sin cambios)');
  console.log('Fuente :', dataPath, `(${activos.length} productos activos)`);
  console.log('BD Core: jjp_products tiene', products.length, '| con codigo en lista:', keep.length);
  console.log('\nA ELIMINAR:', toDelete.length, 'productos y', toDeleteVariantIds.length, 'variantes');
  console.log('  por mixnet_status:', JSON.stringify(byStatus));
  console.log('  activos visibles hoy (active=true):', activeInDelete);
  console.log('  con imagen:', toDelete.filter(p => p.img).length);
  console.log('  ACTIVO fuera de la lista (revisar):');
  junkActive.forEach(p => console.log('   -', p.sku, '|', (p.name || '').slice(0, 70)));
  const ref = await referential();
  console.log('\nFilas satelitales que se borraran:', JSON.stringify(ref));
  console.log('\nStock actual BD:', stockNow, '| Stock objetivo (EXISTENCIA xlsx):', stockThen);
  console.log('Productos de la lista que NO estan en BD:', missing.length);
  const noPrice = activos.filter(r => num(r['PRECIO_B_(US$)']) <= 0).length;
  console.log('Activos sin PRECIO B en xlsx:', noPrice);
  const emptyName = activos.filter(r => !String(r.NOMBRE || '').trim()).map(r => r.COD);
  console.log('Activos sin nombre (se conserva el actual):', JSON.stringify(emptyName));
  console.log('\nRESUMEN: se mantendran', keep.length, 'productos (902 reales) y se eliminaran', toDelete.length);
  return;
}

console.log('MODO EXECUTE — aplicando cambios...');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(ROOT, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const ref = await referential();

await client.query('BEGIN');
if (toDeleteVariantIds.length) {
  const ph = ids(toDeleteVariantIds);
  for (const t of ['jjp_count_tally', 'jjp_count_log', 'jjp_barcode_log', 'jjp_stock_moves']) {
    await line(`DELETE FROM ${t} WHERE variant_id IN ${ph}`, toDeleteVariantIds);
  }
  await line(`DELETE FROM jjp_seller_prices WHERE variant_id IN ${ph}`, toDeleteVariantIds);
  await line(`DELETE FROM jjp_seller_prices WHERE product_id IN ${ids(toDeleteIds)}`, toDeleteIds);
  await line(`DELETE FROM jjp_product_variants WHERE id IN ${ph}`, toDeleteVariantIds);
}
if (toDeleteIds.length) {
  await line(`DELETE FROM jjp_products WHERE id IN ${ids(toDeleteIds)}`, toDeleteIds);
}

const { rows: keepRowsPostDelete } = await client.query('SELECT id, sku FROM jjp_products');
const keepMap = new Map(keepRowsPostDelete.map(p => [norm(p.sku), p.id]));
let updated = 0, skipped = 0;
for (const r of activos) {
  const pid = keepMap.get(norm(r.COD));
  if (!pid) { skipped++; continue; }
  const name = String(r.NOMBRE || '').trim() || null;
  const pa = num(r['PRECIO_A_(US$)']);
  const pb = num(r['PRECIO_B_(US$)']);
  const pc = num(r['PRECIO_C_(Bs)']);
  const pd = num(r['PRECIO_D_(Bs)']);
  const stock = Math.max(0, Math.round(num(r.EXISTENCIA)));
  await line(
    `UPDATE jjp_products SET price_usd = $2, price_a = $3, price_b = $4, price_c_bs = $5, price_d_bs = $6, stock = $7, mixnet_status = 'ACTIVO', active = true${name ? ', name = $8' : ''} WHERE id = $1`,
    name ? [pid, pb, pa, pb, pc, pd, stock, name] : [pid, pb, pa, pb, pc, pd, stock]);
  const vr = await client.query('SELECT id FROM jjp_product_variants WHERE product_id = $1', [pid]);
  if (vr.rows[0]) {
    await line(
      `UPDATE jjp_product_variants SET price_usd = $2, base_price_usd = $2, price_a = $3, price_b = $4, price_c_bs = $5, price_d_bs = $6, stock = $7, active = true, mixnet_status = 'ACTIVO' WHERE id = $1`,
      [vr.rows[0].id, pb, pa, pb, pc, pd, stock]);
  }
  updated++;
}
await client.query('COMMIT');

const after = await client.query(`SELECT count(*)::int AS n FROM jjp_products`);
const afterStock = await client.query(`SELECT sum(stock)::int AS n FROM jjp_products`);
const thumbs = await client.query(`SELECT count(*)::int AS n FROM jjp_products WHERE image_url IS NOT NULL AND image_url <> ''`);

const backup = {
  created_at: new Date().toISOString(),
  mode: 'execute',
  source: dataPath,
  deleted_products: toDelete.map(p => ({ id: p.id, sku: p.sku, mixnet_status: p.mixnet_status, name: p.name })),
  deleted_variant_ids: toDeleteVariantIds,
  referential_deleted: ref,
  updated_products: updated,
};
fs.writeFileSync(path.join(backupDir, `catalogo_respaldo_${ts}.json`), JSON.stringify(backup, null, 2), 'utf8');

console.log('Backup :', path.join(backupDir, `catalogo_respaldo_${ts}.json`));
console.log('Borrados:', toDelete.length, 'productos,', toDeleteVariantIds.length, 'variantes');
console.log('Filas satelitales:', JSON.stringify(ref));
console.log('Actualizados:', updated, '| sin match (skipped):', skipped);
console.log('Productos restantes:', after.rows[0].n, '| Stock total:', afterStock.rows[0].n, '| Con imagen:', thumbs.rows[0].n);

await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });