// ======================================================================
// JJ Paper — Compresión de IMÁGENES del bucket jjp-wa-media
//
// Solo toca archivos de imagen (jpg/png/webp/gif). NO toca pdf/ogg/etc.
// Re-escribe EN EL MISMO path (no rompe media_path de campañas/mensajes),
// redimensionando a máx 1200px y recomprimiendo a <4 MB para que WhatsApp
// pueda entregarlas (WhatsApp limita imágenes a ~5 MB).
//
// Uso:  node compress-wa-media.js          (simulación, no toca nada)
//       node compress-wa-media.js --apply  (comprime y sobreescribe)
// ======================================================================
import 'dotenv/config';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'jjp-wa-media';
const MAX_W = 1200;          // suficiente para WhatsApp/chat
const MAX_BYTES = 4_000_000; // objetivo: que quede bajo el límite de WhatsApp
const QUALITY = 80;
const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAll(prefix = '') {
  const out = [];
  const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const o of data || []) {
    if (o.id) out.push(prefix ? `${prefix}/${o.name}` : o.name);
    else out.push(...(await listAll(prefix ? `${prefix}/${o.name}` : o.name)));
  }
  return out;
}

const ext = n => (n.split('.').pop() || '').toLowerCase();

async function compressOne(name) {
  const { data: blob, error: dErr } = await db.storage.from(BUCKET).download(name);
  if (dErr) return { name, error: dErr.message };
  const input = Buffer.from(await blob.arrayBuffer());
  if (input.length < 50_000) return { name, skip: true };   // ya liviana

  let pipe = sharp(input).rotate().resize({ width: MAX_W, withoutEnlargement: true });
  const e = ext(name);
  let contentType;
  if (e === 'png') { pipe = pipe.png({ compressionLevel: 9, palette: true, quality: 80 }); contentType = 'image/png'; }
  else if (e === 'webp') { pipe = pipe.webp({ quality: QUALITY }); contentType = 'image/webp'; }
  else if (e === 'gif') { pipe = pipe.gif(); contentType = 'image/gif'; }
  else { pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true }); contentType = 'image/jpeg'; }

  const out = await pipe.toBuffer();
  // Mantener la extensión original aunque el content-type real sea webp/jpeg
  if (out.length >= input.length && input.length <= MAX_BYTES) return { name, skip: true };

  if (APPLY) {
    const { error: uErr } = await db.storage.from(BUCKET)
      .upload(name, out, { upsert: true, contentType });
    if (uErr) return { name, error: uErr.message };
  }
  return { name, antes: Math.round(input.length / 1024), despues: Math.round(out.length / 1024), mb: input.length / 1048576 };
}

const allFiles = await listAll();
const images = allFiles.filter(f => IMG_EXT.has(ext(f)));
console.log(`${allFiles.length} archivos · imágenes a revisar: ${images.length} · modo: ${APPLY ? 'APPLY' : 'simulación'}`);

let antesMB = 0, despuesMB = 0, done = 0, errors = 0, skipped = 0;
const queue = [...images];
async function worker() {
  for (let n = queue.shift(); n; n = queue.shift()) {
    const r = await compressOne(n); done++;
    if (r.error) { errors++; console.log(`x ${r.name}: ${r.error}`); }
    else if (r.skip) { skipped++; }
    else { antesMB += r.mb; despuesMB += r.antes ? (r.despues / 1024) : 0; }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
const comprimidas = done - skipped - errors;
console.log(`\nComprimibles: ${comprimidas} · saltadas: ${skipped} · errores: ${errors}`);
console.log(`Imágenes: ${antesMB.toFixed(1)} MB -> ${despuesMB.toFixed(1)} MB  (ahorro ${(antesMB - despuesMB).toFixed(1)} MB)`);
