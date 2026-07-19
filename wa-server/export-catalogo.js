/* ======================================================
   JJ Paper — Exporta el catálogo vivo para el clasificador de imágenes

   Uso (desde wa-server con .env listo):
     node export-catalogo.js

   Escribe C:\Users\PC\Desktop\productos\catalogo_full.csv leyendo la
   vista jjp_catalog_export.

   Por qué existe: el clasificador leía un catalogo_full.csv exportado a
   mano hace semanas. Todo producto dado de alta desde admin/escaner.html
   faltaba en ese archivo, así que la IA no lo encontraba y — peor — a
   veces le adjudicaba el SKU del producto más parecido. De ahí salieron
   códigos inventados como ART-CLL (el real es PR-CLL).

   Correr esto ANTES de cada tanda de clasificación.
   ====================================================== */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const DEST = process.argv[2] || 'C:\\Users\\PC\\Desktop\\productos\\catalogo_full.csv';

// Un campo con coma o comilla rompería el CSV que lee el clasificador.
const csvCell = s => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

async function main() {
  const { data, error } = await sb
    .from('jjp_catalog_export')
    .select('codigo,descripcion,categoria,tiene_imagen')
    .order('codigo')
    .limit(10000);
  if (error) { console.error('Error leyendo el catálogo:', error.message); process.exit(1); }

  const rows = ['CODIGO,DESCRIPCION', ...data.map(r => `${csvCell(r.codigo)},${csvCell(r.descripcion)}`)];
  fs.writeFileSync(DEST, rows.join('\n'), 'utf8');

  const sinFoto = data.filter(r => !r.tiene_imagen).length;
  console.log(`Catálogo exportado: ${data.length} productos → ${DEST}`);
  console.log(`  · con foto:  ${data.length - sinFoto}`);
  console.log(`  · sin foto:  ${sinFoto}`);
}

main().catch(e => { console.error(e); process.exit(1); });
