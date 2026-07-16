/* ======================================================
   JJ Paper — Subida masiva de fotos de producto al catálogo
   Uso (una sola vez, desde la carpeta wa-server con .env listo):
     node upload-images.js "C:\\Users\\PC\\Desktop\\productos"
   - Fotos con código  (…_SH-BRNE.jpg) → se casan por SKU exacto.
   - Fotos con nombre   (shark-marcadores-…​.jpg) → se casan por nombre (difuso).
   - Sube cada foto al bucket público jjp-products y setea jjp_products.image_url.
   - Si varias fotos apuntan al mismo producto, usa la de MAYOR tamaño (mejor calidad).
   - Reporta al final qué quedó sin casar (para revisarlo a mano).
   NO borra ni renombra tus archivos. Re-ejecutable (upsert).
   ====================================================== */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const DIR = process.argv[2] || 'C:\\Users\\PC\\Desktop\\productos';
const BUCKET = 'jjp-products';
const EXT_OK = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  // 1) Catálogo: SKU → producto, y nombre normalizado → producto
  const { data: vars, error } = await sb
    .from('jjp_product_variants')
    .select('sku, product_id, jjp_products(id,name)')
    .limit(5000);
  if (error) { console.error('Error leyendo catálogo:', error.message); process.exit(1); }

  const skuKey = s => String(s || '').toUpperCase().replace(/\s+/g, '');   // insensible a espacios/mayúsculas
  const bySku = new Map();          // skuKey → {id, name}
  const byName = [];                // [{tokens:Set, id, name}]
  const seenProd = new Set();
  for (const v of vars) {
    const p = v.jjp_products; if (!p) continue;
    if (v.sku) bySku.set(skuKey(v.sku), { id: p.id, name: p.name });
    if (!seenProd.has(p.id)) {
      seenProd.add(p.id);
      byName.push({ id: p.id, name: p.name, tokens: new Set(norm(p.name).split(' ').filter(Boolean)) });
    }
  }

  // 2) Recorre fotos de la raíz de la carpeta (ignora subcarpetas y descartadas)
  const files = fs.readdirSync(DIR, { withFileTypes: true })
    .filter(d => d.isFile() && EXT_OK.has(path.extname(d.name).toLowerCase()))
    .map(d => d.name);

  const chosen = new Map();   // product_id → {file, size, how}
  const unmatched = [];

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = f.slice(0, -ext.length);
    let match = null, how = '';

    // a) código al final: …_SKU
    const m = /_([A-Z0-9][A-Z0-9/.\-]*)$/i.exec(base);
    if (m && bySku.has(skuKey(m[1]))) { match = bySku.get(skuKey(m[1])); how = 'sku'; }

    // b) nombre difuso por solape de palabras
    if (!match) {
      const ftok = new Set(norm(base.replace(/_[^_]*$/, '')).split(' ').filter(t => t.length > 2));
      let best = null, bestScore = 0;
      for (const p of byName) {
        let hit = 0; for (const t of ftok) if (p.tokens.has(t)) hit++;
        const score = hit / Math.max(3, p.tokens.size);   // proporción de palabras del producto cubiertas
        if (hit >= 3 && score > bestScore) { best = p; bestScore = score; }
      }
      if (best) { match = best; how = 'nombre'; }
    }

    if (!match) { unmatched.push(f); continue; }

    const size = fs.statSync(path.join(DIR, f)).size;
    const prev = chosen.get(match.id);
    if (!prev || size > prev.size) chosen.set(match.id, { file: f, size, how, name: match.name });
  }

  console.log(`Fotos en carpeta: ${files.length} · productos a actualizar: ${chosen.size} · sin casar: ${unmatched.length}\n`);

  // 3) Sube y actualiza image_url
  let ok = 0, fail = 0;
  for (const [pid, info] of chosen) {
    const ext = path.extname(info.file).toLowerCase();
    const buf = fs.readFileSync(path.join(DIR, info.file));
    const dest = `${pid}${ext}`;
    const up = await sb.storage.from(BUCKET).upload(dest, buf, {
      contentType: MIME[ext] || 'image/jpeg', upsert: true,
    });
    if (up.error) { console.log(`✗ ${info.name} — subida: ${up.error.message}`); fail++; continue; }
    const pub = `${URL}/storage/v1/object/public/${BUCKET}/${dest}`;
    const upd = await sb.from('jjp_products').update({ image_url: pub }).eq('id', pid);
    if (upd.error) { console.log(`✗ ${info.name} — image_url: ${upd.error.message}`); fail++; continue; }
    console.log(`✓ ${info.name}  (${info.how})  ←  ${info.file}`);
    ok++;
  }

  console.log(`\nListo: ${ok} imágenes cargadas, ${fail} con error.`);
  if (unmatched.length) {
    console.log(`\nSin casar (${unmatched.length}) — revísalas a mano o renómbralas con su _SKU:`);
    unmatched.forEach(f => console.log('  · ' + f));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
