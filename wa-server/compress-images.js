// ======================================================================
// JJ Paper — Compresión masiva de imágenes del bucket jjp-products
//
// Problema: fotos originales de hasta 14 MB → catálogo lentísimo y 2 GB
// de storage. Este script las reescribe EN EL MISMO path (misma URL en
// jjp_products.image_url) redimensionadas a máx 1200px y recomprimidas.
//
// Uso:  node compress-images.js           (simulación, no toca nada)
//       node compress-images.js --apply   (comprime y sobreescribe)
// ======================================================================
import 'dotenv/config';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'jjp-products';
const MAX_W = 1200;          // suficiente para grid + lightbox
const MIN_BYTES = 300_000;   // < 300 KB se deja tal cual
const QUALITY = 78;

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAll() {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.storage.from(BUCKET)
      .list('', { limit: 100, offset: page * 100, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data.filter(o => o.id));   // solo archivos
    if (data.length < 100) break;
  }
  return out;
}

async function compressOne(obj) {
  const size = obj.metadata?.size || 0;
  if (size < MIN_BYTES) return { name: obj.name, skip: 'ya liviana', kb: Math.round(size / 1024) };

  const { data: blob, error: dErr } = await db.storage.from(BUCKET).download(obj.name);
  if (dErr) return { name: obj.name, error: dErr.message };
  const input = Buffer.from(await blob.arrayBuffer());

  const ext = (obj.name.split('.').pop() || '').toLowerCase();
  let pipe = sharp(input).rotate().resize({ width: MAX_W, withoutEnlargement: true });
  let contentType;
  if (ext === 'png') { pipe = pipe.png({ compressionLevel: 9, palette: true }); contentType = 'image/png'; }
  else if (ext === 'webp') { pipe = pipe.webp({ quality: QUALITY }); contentType = 'image/webp'; }
  else { pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true }); contentType = 'image/jpeg'; }

  const out = await pipe.toBuffer();
  if (out.length >= input.length) return { name: obj.name, skip: 'no mejora', kb: Math.round(size / 1024) };

  if (APPLY) {
    const { error: uErr } = await db.storage.from(BUCKET)
      .upload(obj.name, out, { upsert: true, contentType, cacheControl: '31536000' });
    if (uErr) return { name: obj.name, error: uErr.message };
  }
  return { name: obj.name, antes: Math.round(input.length / 1024), despues: Math.round(out.length / 1024) };
}

const objs = await listAll();
console.log(`${objs.length} archivos en ${BUCKET} · modo: ${APPLY ? 'APPLY (sobreescribe)' : 'simulación'}`);

let done = 0, savedMB = 0, errors = 0;
const queue = [...objs];
async function worker() {
  for (let o = queue.shift(); o; o = queue.shift()) {
    const r = await compressOne(o);
    done++;
    if (r.error) { errors++; console.log(`✗ ${r.name}: ${r.error}`); }
    else if (r.skip) { /* silencioso */ }
    else {
      savedMB += (r.antes - r.despues) / 1024;
      console.log(`✓ [${done}/${objs.length}] ${r.name}: ${r.antes} KB → ${r.despues} KB`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log(`\nListo: ${done} revisadas · ahorro ${savedMB.toFixed(0)} MB · ${errors} errores`);
