// Subida directa de fotos de catálogo por SKU sin depender de RPC intermedias
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const DIR = 'C:\\Users\\PC\\Desktop\\productos';
const BUCKET = 'jjp-products';
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function skuFromFilename(base) {
  const m = /_([A-Za-z0-9][A-Za-z0-9/.\- ]*?)(?:_\d+)?$/.exec(base);
  return m ? m[1].trim() : null;
}

function collectFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(full));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MIME[ext]) files.push(full);
    }
  }
  return files;
}

async function run() {
  console.log('=== SUBIENDO FOTOS DE PRODUCTOS AL NUEVO STORAGE ===');
  const files = collectFiles(DIR);
  console.log(`Encontrados ${files.length} archivos de imagen en ${DIR}`);

  let uploaded = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, ext);
    const sku = skuFromFilename(base);
    if (!sku) continue;

    // Buscar variante en DB directamente
    const { data: variant } = await sb
      .from('jjp_product_variants')
      .select('id, product_id')
      .ilike('sku', sku)
      .limit(1)
      .single();

    if (variant) {
      const dest = `${variant.product_id}${ext}`;
      const buf = fs.readFileSync(file);
      const { error: upErr } = await sb.storage.from(BUCKET).upload(dest, buf, {
        upsert: true,
        contentType: MIME[ext]
      });

      if (!upErr) {
        const publicUrl = `${URL}/storage/v1/object/public/${BUCKET}/${dest}`;
        await sb.from('jjp_products').update({ image_url: publicUrl }).eq('id', variant.product_id);
        await sb.from('jjp_product_variants').update({ image_url: publicUrl }).eq('id', variant.id);
        uploaded++;
        console.log(`✓ Foto asignada a SKU [${sku}] -> ${dest}`);
      } else {
        console.log(`Error subiendo ${dest}:`, upErr.message);
      }
    }
  }

  console.log(`\n=== PROCESO COMPLETADO: ${uploaded} imágenes vinculadas al catálogo ===`);
}

run();
