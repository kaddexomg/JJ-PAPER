import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
function loadEnv(path) {
  const map = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}
const env = loadEnv(join(HERE, 'wa-server', '.env'));
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H, ...opts });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchPaged(table, query = '') {
  let all = [];
  let page = 0;
  const size = 1000;
  while (true) {
    const sep = query ? '&' : '';
    const chunk = await rest(`${table}?${query}${sep}limit=${size}&offset=${page * size}`);
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < size) break;
    page++;
  }
  return all;
}

async function main() {
  const EXECUTE = process.argv.includes('--execute');
  const cats = await fetchPaged('jjp_categories', 'select=id,name');
  const catMap = {};
  cats.forEach(c => { catMap[c.name.toUpperCase()] = c.id; });

  const prods = await fetchPaged('jjp_products', 'select=id,name,sku,category_id,price_usd&active=eq.true');
  console.log(`Total productos activos: ${prods.length}`);

  function deduceCategory(name) {
    const n = name.toUpperCase();
    if (n.startsWith('ARCHIVADOR') || n.startsWith('ARCHICOMODO')) return catMap['ARCHIVADORES'];
    if (n.startsWith('CARPETA') || n.startsWith('CARPETAS') || n.includes('P/CARPETA')) return catMap['CARPETAS'];
    if (n.startsWith('BOLIGRAFO') || n.startsWith('BOLIGRAFOS') || n.includes('REP.WATERMAN') || n.includes('REPUESTO BOLI') || n.includes('REPUESTOS BOL') || n.includes('REPUESTO PARKER')) return catMap['BOLIGRAFOS'];
    if (n.startsWith('BORRADOR') || n.startsWith('GOMA DE BORRAR') || n.startsWith('GOMA BORRONA')) return catMap['TIJERAS'] ? catMap['VARIOS'] : null; // borrador
    if (n.startsWith('CALCULADORA')) return catMap['CALCULADORAS'];
    if (n.startsWith('CARTELERA') || n.startsWith('PIZARRA')) return catMap['CARTELERA'];
    if (n.startsWith('CARTUCHERA') || n.startsWith('CARTUCHERAS')) return catMap['CARTUCHERAS'];
    if (n.startsWith('CARTUCHO') || n.startsWith('TINTA') || n.startsWith('TONER')) return catMap['TINTA SELLOS'];
    if (n.startsWith('CARTULINA')) return catMap['PAPEL'] || catMap['MANUALIDADES'];
    if (n.startsWith('CHINCHE') || n.startsWith('CHINCHES')) return catMap['CHINCHES'];
    if (n.startsWith('CINTA') || n.startsWith('CINTAS') || n.startsWith('TIRRO')) return catMap['CINTAS'];
    if (n.startsWith('CLIP') || n.startsWith('CLIPS') || n.startsWith('GANCHO') || n.startsWith('GANCHOS')) return catMap['CLIPS GANCHOS'];
    if (n.startsWith('COMPAS')) return catMap['COMPASES'];
    if (n.startsWith('CORRECTOR')) return catMap['CORRECTORES'];
    if (n.startsWith('CREYON') || n.startsWith('CREYONES')) return catMap['CREYONES'];
    if (n.startsWith('CUADERNO') || n.startsWith('CUADERNOS') || n.startsWith('LIBRETA') || n.startsWith('LIBRETAS') || n.startsWith('BLOCK')) return catMap['CUADERNOS'];
    if (n.startsWith('CUENTO') || n.startsWith('CUENTOS')) return catMap['LIBROS CUENTOS'];
    if (n.startsWith('ENGRAPADORA') || n.startsWith('GRAPAS')) return catMap['ENGRAPADORAS'];
    if (n.startsWith('ETIQUETA') || n.startsWith('ETIQUETAS')) return catMap['ETIQUETAS'];
    if (n.startsWith('FOAME') || n.startsWith('FOAMY') || n.startsWith('ESCARCHA') || n.startsWith('PLASTILINA')) return catMap['MANUALIDADES'];
    if (n.startsWith('FORMA CONT') || n.startsWith('COMPRO.') || n.startsWith('TALONARIO') || n.startsWith('FICHA')) return catMap['FORMULARIOS'];
    if (n.startsWith('FUNDA') || n.startsWith('FUNDAS') || n.startsWith('LAMINA DE VINIL') || n.startsWith('PLASTICO')) return catMap['FUNDAS PROTECTORES'];
    if (n.startsWith('LAPIZ') || n.startsWith('LÁPIZ') || n.startsWith('MINAS') || n.startsWith('PORTAMINA') || n.startsWith('PORTAMINAS')) return catMap['LAPICES'];
    if (n.startsWith('LIBRO') || n.startsWith('LIBROS')) return catMap['LIBROS CONTABLES'];
    if (n.startsWith('MARCADOR') || n.startsWith('MARACADOR')) return catMap['MARCADORES'];
    if (n.startsWith('MEMORIA') || n.startsWith('PENDRIVE') || n.startsWith('CD-') || n.startsWith('TECLADO')) return catMap['MULTIMEDIA'];
    if (n.startsWith('NOTA') || n.startsWith('NOTAS') || n.startsWith('TACO ENCOLADO')) return catMap['NOTAS ADHESIVAS'];
    if (n.startsWith('PAPEL') || n.startsWith('HOJAS') || n.startsWith('ROLLO') || n.startsWith('ROLLOS')) return catMap['PAPEL'];
    if (n.startsWith('PEGA') || n.startsWith('SILICON') || n.startsWith('GOMA EN BARRA') || n.startsWith('GOMA DE PEGAR') || n.startsWith('PISTOLA')) return catMap['PEGAMENTOS'];
    if (n.startsWith('PERFORADOR') || n.startsWith('PERFORADORA')) return catMap['PERFORADORAS'];
    if (n.startsWith('BATERIA') || n.startsWith('PILA')) return catMap['PILAS'];
    if (n.startsWith('PINTURA') || n.startsWith('PINTADEDO') || n.startsWith('TEMPERA') || n.startsWith('PINCEL')) return catMap['PINTURAS'];
    if (n.startsWith('REGLA') || n.startsWith('REGLAS') || n.startsWith('JUEGO DE GEOMETRIA') || n.startsWith('ESCUADRA')) return catMap['REGLAS'];
    if (n.startsWith('SOBRE') || n.startsWith('SOBRES')) return catMap['SOBRES'];
    if (n.startsWith('SACAPUNTA') || n.startsWith('SACAPUNTAS')) return catMap['TAJALAPICES'];
    if (n.startsWith('TIJERA') || n.startsWith('TIJERAS') || n.startsWith('CORTA CARTON') || n.startsWith('EXACTO') || n.startsWith('GUILLOTINA') || n.startsWith('REPUESTO CUCHILLA')) return catMap['TIJERAS'];
    if (n.startsWith('TIZA') || n.startsWith('TIZAS')) return catMap['TIZAS'];
    if (n.startsWith('BANDEJA') || n.startsWith('BANDEJAS') || n.startsWith('JUEGO ESCRITORIO') || n.startsWith('PAPELERA') || n.startsWith('PORTA TACO') || n.startsWith('PORTA CLIP') || n.startsWith('DISPENSADOR')) return catMap['BANDEJAS'] || catMap['VARIOS'];

    return catMap['VARIOS'];
  }

  let reclassified = 0;
  const updates = [];
  prods.forEach(p => {
    const targetCat = deduceCategory(p.name);
    if (targetCat && targetCat !== p.category_id) {
      reclassified++;
      updates.push({ id: p.id, name: p.name, oldCat: p.category_id, newCat: targetCat });
    }
  });

  console.log(`Productos que se reclasificarán a su categoría correcta: ${reclassified}`);
  console.log('\nMuestra de reclasificaciones (primeras 10):');
  updates.slice(0, 10).forEach(u => console.log(`   ${u.name.slice(0, 40).padEnd(42)}`));

  if (!EXECUTE) {
    console.log('\n💡 Para aplicar la clasificación corre: node verificar_catalogo.mjs --execute');
    return;
  }

  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    await Promise.all(batch.map(u => 
      rest(`jjp_products?id=eq.${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ category_id: u.newCat })
      })
    ));
  }
  console.log(`\n✅ ${updates.length} productos reclasificados con éxito a sus categorías reales.`);
}
main().catch(e => { console.error(e); process.exit(1); });
