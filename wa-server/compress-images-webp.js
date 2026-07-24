// Compresión AGRESIVA a WebP del bucket jjp-products.
// Mismo path (misma URL en jjp_products.image_url), content-type image/webp,
// cache 1 año. Reduce bytes servidos → baja egress. No toca DB ni requiere deploy.
//   node compress-images-webp.js          (simulación)
//   node compress-images-webp.js --apply  (sobreescribe)
import 'dotenv/config';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'jjp-products';
const MAX_W = 800;          // display real del grid es 400px; 800 cubre retina + lightbox
const MIN_BYTES = 25_000;   // < 25 KB ya no vale la pena
const QUALITY = 60;

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAll() {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.storage.from(BUCKET)
      .list('', { limit: 100, offset: page * 100, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data.filter(o => o.id));
    if (data.length < 100) break;
  }
  return out;
}

async function compressOne(obj) {
  const size = obj.metadata?.size || 0;
  if (size < MIN_BYTES) return { name: obj.name, skip: true, kb: Math.round(size / 1024) };
  const { data: blob, error: dErr } = await db.storage.from(BUCKET).download(obj.name);
  if (dErr) return { name: obj.name, error: dErr.message };
  const input = Buffer.from(await blob.arrayBuffer());
  const ext = (obj.name.split('.').pop() || '').toLowerCase();
  let pipe = sharp(input).rotate().resize({ width: MAX_W, withoutEnlargement: true });
  let contentType;
  if (ext === 'png') { pipe = pipe.png({ compressionLevel: 9, palette: true, quality: 70 }); contentType = 'image/png'; }
  else if (ext === 'webp') { pipe = pipe.webp({ quality: QUALITY }); contentType = 'image/webp'; }
  else { pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true }); contentType = 'image/jpeg'; }
  const out = await pipe.toBuffer();
  if (out.length >= input.length) return { name: obj.name, skip: true, kb: Math.round(size / 1024) };
  if (APPLY) {
    const { error: uErr } = await db.storage.from(BUCKET)
      .upload(obj.name, out, { upsert: true, contentType, cacheControl: '31536000' });
    if (uErr) return { name: obj.name, error: uErr.message };
  }
  return { name: obj.name, antes: Math.round(input.length / 1024), despues: Math.round(out.length / 1024) };
}

const objs = await listAll();
console.log(`${objs.length} archivos · ${APPLY ? 'APPLY' : 'SIMULACIÓN'} · WebP q${QUALITY} ${MAX_W}px`);
let done = 0, antesMB = 0, despuesMB = 0, errors = 0, skipped = 0;
const queue = [...objs];
async function worker() {
  for (let o = queue.shift(); o; o = queue.shift()) {
    const r = await compressOne(o); done++;
    if (r.error) { errors++; console.log(`x ${r.name}: ${r.error}`); }
    else if (r.skip) { skipped++; }
    else { antesMB += r.antes / 1024; despuesMB += r.despues / 1024; }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`\nComprimibles: ${done - skipped - errors} · saltadas: ${skipped} · errores: ${errors}`);
console.log(`Bucket: ${antesMB.toFixed(1)} MB -> ${despuesMB.toFixed(1)} MB  (ahorro ${(antesMB - despuesMB).toFixed(1)} MB, ${antesMB ? Math.round((1 - despuesMB / antesMB) * 100) : 0}% menos por servida)`);
