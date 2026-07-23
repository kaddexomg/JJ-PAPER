/* ======================================================
   JJ Paper — Subida de fotos de producto al catálogo

   Uso (desde wa-server con .env listo):
     node upload-images.js                    → simulacro, no escribe nada
     node upload-images.js --apply            → sube de verdad
     node upload-images.js --apply --force    → además pisa fotos existentes
     node upload-images.js --dir "C:\\ruta"    → otra carpeta raíz

   Regla de oro: NUNCA crea productos. Si el SKU del nombre de archivo
   no existe en la base, la foto se reporta como SIN_MATCH y se deja
   quieta. Así la subida no puede inventar productos ni cruzar el
   inventario que ya está contado.

   Casa SOLO por SKU exacto (…_KO-BOA.jpg), resolviéndolo contra la
   base con jjp_variant_by_sku. El casado difuso por nombre se quitó a
   propósito: "BLOCK DE NOTAS #1/#2/#3" comparten todas las palabras y
   terminaba pegando la foto al producto equivocado. Para esas fotos
   está el clasificador con IA, que renombra con el SKU correcto.

   Recorre la raíz y las subcarpetas de trabajo (Clasificadas, Otras…).
   Si varias fotos apuntan al mismo SKU usa la de mayor tamaño.
   No borra ni renombra tus archivos. Re-ejecutable.
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

const argv  = process.argv.slice(2);
const flag  = n => argv.includes(n);
const APPLY = flag('--apply');
const FORCE = flag('--force');
const DIR   = (argv[argv.indexOf('--dir') + 1] && flag('--dir'))
  ? argv[argv.indexOf('--dir') + 1]
  : 'C:\\Users\\PC\\Desktop\\productos';

const BUCKET  = 'jjp-products';
const EXT_OK  = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME    = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
// Subcarpetas de trabajo que sí se recorren. El resto se ignora para no
// arrastrar descartes, miniaturas ni respaldos.
const SUBDIRS = ['Clasificadas', 'Otras', 'Otras 2', 'SIN_CATALOGO'];

const skuKey = s => String(s || '').toUpperCase().replace(/\s+/g, '');

// El clasificador nombra "descripcion-del-producto_SKU.jpg", y agrega
// "_1", "_2" cuando hay repetidos. Se admite ese sufijo.
function skuFromFilename(base) {
  // Se admiten espacios: hay SKU como "KO-CHK 12" y el clasificador los
  // conserva en el nombre de archivo. Sin esto quedaban como "sin SKU".
  const m = /_([A-Za-z0-9][A-Za-z0-9/.\- ]*?)(?:_\d+)?$/.exec(base);
  if (!m) return null;
  const raw = m[1].trim();
  // Descarta lo que claramente no es un SKU: nombres de WhatsApp
  // ("...124257"), contadores sueltos. Un SKU real lleva letras.
  if (!/[A-Za-z]/.test(raw)) return null;
  return raw;
}

function listImages(dir, label) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && EXT_OK.has(path.extname(d.name).toLowerCase()))
    .map(d => ({ file: d.name, full: path.join(dir, d.name), carpeta: label }));
}

async function main() {
  console.log(APPLY
    ? `MODO REAL — se escribirá en la base${FORCE ? ' (incluso pisando fotos existentes)' : ''}\n`
    : 'SIMULACRO — no se escribe nada. Agregá --apply para subir de verdad.\n');

  // 1) Junta las fotos de la raíz + subcarpetas de trabajo
  const files = [
    ...listImages(DIR, 'raíz'),
    ...SUBDIRS.flatMap(s => listImages(path.join(DIR, s), s)),
  ];

  // 2) Resuelve cada archivo a su variante, contra la base (no contra un CSV)
  const chosen    = new Map();   // variant_id → mejor candidata
  const sinSku    = [];          // el nombre no tiene SKU legible
  const sinMatch  = [];          // el SKU no existe en la base
  const yaTiene   = [];          // la variante ya tiene foto

  for (const f of files) {
    const ext  = path.extname(f.file).toLowerCase();
    const base = f.file.slice(0, -ext.length);
    const sku  = skuFromFilename(base);
    if (!sku) { sinSku.push(f); continue; }

    const { data, error } = await sb.rpc('jjp_variant_by_sku', { p_sku: sku });
    if (error) { console.error(`Error resolviendo ${sku}: ${error.message}`); continue; }
    const hit = data?.[0];
    if (!hit) { sinMatch.push({ ...f, sku }); continue; }
    if (hit.tiene_imagen && !FORCE) { yaTiene.push({ ...f, sku, nombre: hit.nombre }); continue; }

    const size = fs.statSync(f.full).size;
    const prev = chosen.get(hit.variant_id);
    if (!prev || size > prev.size) {
      chosen.set(hit.variant_id, {
        ...f, sku, size, ext, nombre: hit.nombre,
        product_id: hit.product_id,
        exacto: hit.exacto,   // false = casó por SKU normalizado (CEL-T1/2 ← cel-t1-2)
      });
    }
  }

  console.log(`Fotos encontradas: ${files.length}`);
  console.log(`  · a subir:            ${chosen.size}`);
  console.log(`  · ya tenían foto:     ${yaTiene.length}${FORCE ? ' (se pisarán)' : ' (se saltan)'}`);
  console.log(`  · SKU inexistente:    ${sinMatch.length}`);
  console.log(`  · sin SKU en nombre:  ${sinSku.length}\n`);

  // 3) Sube y actualiza — variante y producto (hoy la relación es 1:1)
  let ok = 0, fail = 0;
  const MB = 1024 * 1024;
  for (const [variantId, info] of chosen) {
    const marca = info.exacto ? '' : ' [SKU recuperado]';
    if (!APPLY) { console.log(`· [simulacro] ${info.sku}  →  ${info.nombre}${marca}   (${info.carpeta}/${info.file})`); ok++; continue; }

    // Compresión SIEMPRE antes de subir: las fotos de cámara pesan 8-15 MB y
    // matan la carga del catálogo. Máx 1200px, misma extensión/URL.
    let buf = fs.readFileSync(info.full);
    try {
      const sharp = (await import('sharp')).default;
      let pipe = sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true });
      pipe = info.ext === '.png'  ? pipe.png({ compressionLevel: 9, palette: true })
           : info.ext === '.webp' ? pipe.webp({ quality: 78 })
           : pipe.jpeg({ quality: 78, mozjpeg: true });
      const out = await pipe.toBuffer();
      if (out.length < buf.length) {
        console.log(`  · ${info.sku}: ${(buf.length / MB).toFixed(1)} MB → ${(out.length / 1024).toFixed(0)} KB`);
        buf = out;
      }
    } catch (e) { console.log(`  … ${info.sku}: no se pudo comprimir (${e.message}), se sube original`); }
    const dest = `${info.product_id}${info.ext}`;
    const up = await sb.storage.from(BUCKET).upload(dest, buf, {
      contentType: MIME[info.ext] || 'image/jpeg', upsert: true, cacheControl: '31536000',
    });
    if (up.error) { console.log(`✗ ${info.sku} — subida: ${up.error.message}`); fail++; continue; }

    const pub = `${URL}/storage/v1/object/public/${BUCKET}/${dest}`;
    const uv = await sb.from('jjp_product_variants').update({ image_url: pub }).eq('id', variantId);
    const up2 = await sb.from('jjp_products').update({ image_url: pub }).eq('id', info.product_id);
    if (uv.error || up2.error) {
      console.log(`✗ ${info.sku} — image_url: ${(uv.error || up2.error).message}`); fail++; continue;
    }
    console.log(`✓ ${info.sku}  →  ${info.nombre}${marca}`);
    ok++;
  }

  console.log(`\n${APPLY ? 'Listo' : 'Simulacro'}: ${ok} imágenes${APPLY ? ' cargadas' : ' se cargarían'}, ${fail} con error.`);

  // 4) Reporte de lo que hay que mirar a mano
  const rep = path.join(DIR, 'REPORTE_SUBIDA.csv');
  const rows = [
    'motivo;carpeta;archivo;sku',
    ...sinMatch.map(f => `SKU_NO_EXISTE;${f.carpeta};${f.file};${f.sku}`),
    ...sinSku.map(f   => `SIN_SKU_EN_NOMBRE;${f.carpeta};${f.file};`),
    ...yaTiene.map(f  => `YA_TENIA_FOTO;${f.carpeta};${f.file};${f.sku}`),
  ];
  fs.writeFileSync(rep, rows.join('\n'), 'utf8');
  console.log(`\nReporte de pendientes: ${rep}`);
  if (sinMatch.length) {
    console.log(`\nSKU que no existe en la base (${sinMatch.length}) — NO se creó ningún producto:`);
    sinMatch.slice(0, 15).forEach(f => console.log(`  · ${f.sku}   ${f.carpeta}/${f.file}`));
    if (sinMatch.length > 15) console.log(`  … y ${sinMatch.length - 15} más en el CSV`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
