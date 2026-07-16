/* ======================================================
   JJ Paper — Logos oficiales de marcas → Supabase Storage
   Uso (desde wa-server con .env listo):
     node upload-brand-logos.js
   - Descarga el logo oficial de cada marca (Wikimedia / sitio
     oficial), lo sube al bucket público jjp-brands y actualiza
     jjp_brands.logo_url. Re-ejecutable (upsert).
   - Las marcas sin fuente oficial conocida se dejan como están.
   ====================================================== */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Carpeta local opcional: pon aquí archivos llamados <slug>.png/.jpg/.webp/.gif
// (ej. ofiart.png, la-nieve.png, ibt.png, j-color.png) y tienen prioridad
// sobre las URLs de SOURCES.
const LOCAL_DIR = 'C:\\Users\\PC\\Desktop\\logos-marcas';

const URL_ = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  process.exit(1);
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const BUCKET = 'jjp-brands';

// slug de jjp_brands → URL del logo oficial
// Wikimedia Special:FilePath renderiza los SVG como PNG con ?width=
const SOURCES = {
  'bic':         'https://commons.wikimedia.org/wiki/Special:FilePath/Bic_logo.svg?width=256',
  'sharpie':     'https://commons.wikimedia.org/wiki/Special:FilePath/Sharpie_markers_logo.svg?width=256',
  'paper-mate':  'https://commons.wikimedia.org/wiki/Special:FilePath/Paper_mate_textlogo.svg?width=256',
  'parker':      'https://upload.wikimedia.org/wikipedia/en/thumb/d/d1/Parker_Pen_Company_logo.svg/250px-Parker_Pen_Company_logo.svg.png',
  'prismacolor': 'https://commons.wikimedia.org/wiki/Special:FilePath/Prismacolor_logo.svg?width=256',
  'kores':       'https://commons.wikimedia.org/wiki/Special:FilePath/Kores_Logo.jpg?width=256',
  'studmark':    'https://www.studmark.com/uploads/2/5/9/6/25969184/published/logo2020_1.png',
  'cellux':      'https://cellux.co/wp-content/uploads/2023/11/Logo-Cellux-Rojo-1.png',
  // Segunda pasada (16-jul): sitios oficiales, seeklogo e Instagram (unavatar)
  'luxor':       'https://commons.wikimedia.org/wiki/Special:FilePath/Luxor_pen_logo.png?width=256',
  'artesco':     'https://seeklogo.com/images/A/artesco-logo-951ABF48EF-seeklogo.com.gif',
  'mongol':      'https://d1yjjnpx0p53s8.cloudfront.net/styles/logo-thumbnail/s3/122010/untitled-1_132.png?itok=nVRXsgfO', // lápiz Mongol clásico (Brands of the World)
  'shark':       'https://grupo-shark.com/site/wp-content/uploads/2024/04/l1-1.png',
  'liderpen':    'https://img1.wsimg.com/isteam/ip/2e617686-0db7-482a-8935-01461e003a71/liderpen-logo.png',
  'mayka':       'https://mayka.com.ve/wp-content/uploads/2022/08/mayka-logo.jpg',
  'printa':      'https://www.printa.com.ve/templates/PrintaFinal/images/logo_logo.png',
  'caribe':      'https://www.cuadernoscaribe.com/image/Logo-caribe-mini-responsive.png',
  'levo':        'https://levovzla.com/wp-content/uploads/2023/06/Levo-logo-horizontal-negro-rojo.png',
  'ofiart':      'https://unavatar.io/instagram/ofiart.ve?fallback=false',
};

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/gif': '.gif' };

async function main() {
  // Bucket público (idempotente)
  const mk = await sb.storage.createBucket(BUCKET, { public: true });
  if (mk.error && !/already exists/i.test(mk.error.message)) {
    console.error('Error creando bucket:', mk.error.message); process.exit(1);
  }

  const { data: brands, error } = await sb.from('jjp_brands').select('id,slug,name');
  if (error) { console.error('Error leyendo marcas:', error.message); process.exit(1); }

  const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
  const localFile = slug => {
    if (!fs.existsSync(LOCAL_DIR)) return null;
    for (const e of Object.keys(MIME_BY_EXT)) {
      const p = path.join(LOCAL_DIR, slug + e);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  let ok = 0, fail = 0, skip = 0;
  for (const b of brands) {
    const local = localFile(b.slug);
    const src = SOURCES[b.slug];
    if (!local && !src) { skip++; continue; }
    try {
      let buf, type;
      if (local) {
        buf  = fs.readFileSync(local);
        type = MIME_BY_EXT[path.extname(local).toLowerCase()];
      } else {
        const res = await fetch(src, {
          headers: { 'User-Agent': 'JJPaperCatalog/1.0 (logo fetch; contacto: picoj386@gmail.com)' },
          redirect: 'follow',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        type = (res.headers.get('content-type') || '').split(';')[0].trim();
        if (!EXT[type]) throw new Error(`tipo inesperado: ${type}`);
        buf = Buffer.from(await res.arrayBuffer());
      }
      const ext = EXT[type];
      if (buf.length < 500) throw new Error(`archivo sospechosamente pequeño (${buf.length} bytes)`);

      const dest = `${b.slug}${ext}`;
      const up = await sb.storage.from(BUCKET).upload(dest, buf, {
        contentType: type, upsert: true,
      });
      if (up.error) throw new Error('subida: ' + up.error.message);

      const pub = `${URL_}/storage/v1/object/public/${BUCKET}/${dest}`;
      const upd = await sb.from('jjp_brands').update({ logo_url: pub }).eq('id', b.id);
      if (upd.error) throw new Error('logo_url: ' + upd.error.message);

      console.log(`✓ ${b.name}  ←  ${dest} (${(buf.length / 1024).toFixed(1)} KB)`);
      ok++;
    } catch (e) {
      console.log(`✗ ${b.name} — ${e.message}`);
      fail++;
    }
  }
  console.log(`\nListo: ${ok} logos subidos, ${fail} con error, ${skip} sin fuente oficial (quedan como están).`);
}

main().catch(e => { console.error(e); process.exit(1); });
