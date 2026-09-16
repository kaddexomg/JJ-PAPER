import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let pg;
try { pg = (await import('pg')).default; }
catch { pg = (await import(pathToFileURL(path.join(ROOT, 'wa-server/node_modules/pg/lib/index.js')).href)).default; }

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'wa-server/.env'), 'utf8').split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

await (async () => {
  const c = new pg.Client({ host: env.PG_HOST_CORE, port: 5432, database: 'postgres',
    user: env.PG_USER_CORE, password: env.PG_PASS_CORE, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: prods } = await c.query(
    `SELECT id, sku, name, image_url FROM jjp_products WHERE image_url IS NOT NULL AND image_url <> ''`);
  const { rows: vars } = await c.query(
    `SELECT v.id, v.product_id, v.sku, v.image_url FROM jjp_product_variants v
     WHERE v.image_url IS NOT NULL AND v.image_url <> ''`);
  console.log('productos con imagen:', prods.length, '| variantes con imagen:', vars.length);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const manifest = {
    created_at: new Date().toISOString(),
    reason: 'Reemplazo total del catalogo: se despegan las imagenes para reclasificar luego',
    products: prods, variants: vars,
    product_ids: prods.map(p => p.id),
  };
  const backupDir = path.join(ROOT, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `imagenes_catalogo_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
  await c.query('BEGIN');
  const p = await c.query(`UPDATE jjp_products SET image_url = NULL WHERE image_url IS NOT NULL AND image_url <> ''`);
  const v = await c.query(`UPDATE jjp_product_variants SET image_url = NULL WHERE image_url IS NOT NULL AND image_url <> ''`);
  await c.query('COMMIT');
  const rem = await c.query(`SELECT count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS n FROM jjp_products`);
  console.log('Manifiesto :', file);
  console.log('Limpios    : productos', p.rowCount, '| variantes', v.rowCount);
  console.log('Restan productos con imagen:', rem.rows[0].n);
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });