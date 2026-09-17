/*
  ============================================================
  JJ Paper — Explorador / Dumper de datos de MixNet
  ------------------------------------------------------------
  Propósito: correr en la OTRA PC (la que está conectada a la
  red de la empresa, con unidades C:, M:, P:, Z: y Node 13).

  Escanea unidades completas, detecta el tipo de cada archivo
  (CSV, Excel, DBF, Firebird, TXT plano, JSON, ZIP, etc.) y
  genera un REPORTE de inventario en texto y JSON.

  NO modifica nada: solo LEE y reporta. Es el PASO 1 para
  localizar dónde viven los datos de clientes y en qué formato.

  Uso (en la otra PC):
     node explorar-mixnet.cjs
     node explorar-mixnet.cjs --drives "M:;P:;Z:"
     node explorar-mixnet.cjs --max-depth 3

  Compatible con Node 13 (CommonJS, sin features modernas).
  2026-08-31
  ============================================================
*/
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- utilidades mínimas ---------- */
function pad(n, w) { n = String(n); while (n.length < w) n = ' ' + n; return n; }

// Escribe directo al terminal y FUERZA el vaciado inmediato.
// En Windows 7 la consola bufferiza console.log y no muestra nada hasta que
// se llena el buffer o termina el script → por eso solo se veían unas líneas.
function say(s) {
  try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); }
}

function fmtSize(b) {
  b = b || 0;
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

/* ---------- detección de tipo por extensión ---------- */
const EXT_MAP = {
  // Hojas de cálculo
  'xls': 'EXCEL', 'xlsx': 'EXCEL', 'xlsm': 'EXCEL', 'xlsb': 'EXCEL',
  'csv': 'CSV', 'tsv': 'CSV', 'prn': 'CSV',
  // Bases de datos
  'dbf': 'DBF', 'dbt': 'DBF', 'fpt': 'DBF',
  'fdb': 'FIREBIRD', 'gdb': 'FIREBIRD', 'frd': 'FIREBIRD',
  'db': 'SQLITE_DB', 'sqlite': 'SQLITE_DB', 'sqlite3': 'SQLITE_DB',
  'mdb': 'ACCESS', 'accdb': 'ACCESS',
  'dat': 'DAT', 'datx': 'DAT', 'bin': 'DAT',
  'sql': 'SQL', 'bak': 'BACKUP', 'gback': 'BACKUP',
  // Texto / datos planos
  'txt': 'TXT', 'log': 'TXT', 'ini': 'INI', 'cfg': 'TXT',
  'json': 'JSON', 'xml': 'XML',
  // Comprimidos
  'zip': 'ZIP', 'rar': 'ZIP', '7z': 'ZIP', 'gz': 'ZIP', 'bz2': 'ZIP',
  // Documentos
  'pdf': 'PDF', 'doc': 'WORD', 'docx': 'WORD',
};

// Detecta por contenido (primeros bytes) cuando la extensión no es concluyente
function sniffType(buf) {
  const u = buf;
  if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4b && (u[2] === 0x03 || u[2] === 0x05)) return 'ZIP';
  if (u.length >= 4 && u[0] === 0x53 && u[1] === 0x51 && u[2] === 0x4c && u[3] === 0x69) return 'SQLITE_DB';
  if (u.length >= 5 && u[0] === 0x7b && u[5] === 0x5b) return 'DBF'; // field descriptor header
  if (u.length >= 2 && u[0] === 0xd0 && u[1] === 0xcf) return 'XLS(BIFF)';
  if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04) return 'XLSX(ZIP-based)';
  if (u.length >= 2 && u[0] === 0x25 && u[1] === 0x50) return 'PDF';
  if (u.length >= 2 && u[0] === 0x1f && u[1] === 0x8b) return 'GZIP';
  // Firebird: cabecera clásica empieza con "Firebird" o bytes 0x03 en offset 0
  if (u.length >= 8 && String.fromCharCode(u[0], u[1], u[2], u[3], u[4]) === 'Firib') return 'FIREBIRD';
  return null;
}

/* ---------- conteo + inventario ---------- */
const stats = { dirs: 0, files: 0, size: 0, errors: 0, byType: {} };
const matches = [];       // archivos que parecen relevantes por nombre
const bigFiles = [];      // archivos grandes (posible base de datos)
const ALLOWED_EXT = new Set(Object.keys(EXT_MAP));

const RELEVANT_KEYWORDS = [
  'cliente', 'client', 'razon', 'rif', 'proveedor', 'factura', 'factur',
  'pedido', 'venta', 'inventario', 'producto', 'articulo', 'art', 'mixnet',
  'mixer', 'sistema', 'datos', 'data', 'based', 'base', 'empresa',
];

// Progreso en vivo. Actualizar MUY seguido para que veas que no está colgado.
let lastProg = 0;
const PROG_MS = 150;      // refrescar la línea de estado cada 150 ms

function progress(curDir) {
  const now = Date.now();
  if (now - lastProg < PROG_MS) return;
  lastProg = now;
  let dir = curDir || '';
  if (dir.length > 70) dir = '...' + dir.slice(dir.length - 67);
  const line = '\r  [leyendo...] archivos=' + stats.files +
    ' | carpetas=' + stats.dirs +
    ' | tam=' + fmtSize(stats.size) +
    ' | ' + dir;
  try { fs.writeSync(1, line + String.fromCharCode(27) + '[K'); } catch (_) { process.stdout.write(line); }
}

function walk(dir, depth, maxDepth, drivesRoot) {
  // Mostrar la carpeta ANTES de leerla: así, si es una unidad de red lenta y se
  // bloquea aquí, al menos ves EN QUÉ carpeta está parado (sigue "vivo").
  progress(dir);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    stats.errors++;
    progress(dir + '  (sin acceso)');
    return;
  }

  for (const ent of entries) {
    const fp = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        stats.dirs++;
        walk(fp, depth + 1, maxDepth, drivesRoot);
      } else if (ent.isFile()) {
        stats.files++;
        const st = fs.statSync(fp);
        stats.size += st.size;
        classifyFile(fp, st);
        progress(dir);
      }
    } catch (e) {
      stats.errors++;
    }
  }
}

function classifyFile(fp, st) {
  const ext = (path.extname(fp) || '').slice(1).toLowerCase();
  const name = path.basename(fp).toLowerCase();
  let type = EXT_MAP[ext] || 'OTRO';

  // Relevante por nombre
  const isRelevant = RELEVANT_KEYWORDS.some(k => name.includes(k));
  if (isRelevant) {
    matches.push({ path: fp, size: st.size, type });
  }
  // Base de datos / hoja → marcar como grande por extensión
  if (['DBF','FIREBIRD','SQLITE_DB','ACCESS','EXCEL','CSV','DAT','SQL'].includes(type)) {
    bigFiles.push({ path: fp, size: st.size, type });
  } else if (st.size > 20 * 1024 * 1024) {
    bigFiles.push({ path: fp, size: st.size, type });
  }

  stats.byType[type] = (stats.byType[type] || 0) + 1;
}

/* ---------- barrera de lectura profunda hacia logs ---------- */
// Para evitar leer basura, reservamos lecturas de cabecera solo para tipos dudosos
function borderSniff() {}

/* ---------- arranque ---------- */
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--drives' && argv[i + 1]) { a.drives = argv[++i]; }
    else if (k === '--max-depth' && argv[i + 1]) { a.maxDepth = parseInt(argv[++i], 10) || 4; }
    else if (k === '--no-size' ) { a.noSize = true; }
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  const drives = (args.drives ? args.drives.split(';') : ['C:', 'M:', 'P:', 'Z:'])
    .map(d => (d.endsWith('\\') ? d : d + '\\'))
    .filter(d => fs.existsSync(d));
  const maxDepth = args.maxDepth;

  if (!drives.length) {
    say('No se encontró ninguna de las unidades C: M: P: Z:. Revisa que estén montadas/visibles y vuelve a intentar.');
    process.exit(1);
  }

  say('========================================================');
  say('   EXPLORADOR DE DATOS MIXNET  (solo lectura)');
  say('========================================================');
  say('Unidades a escanear: ' + drives.join(' '));
  say('Profundidad máxima:  ' + (maxDepth ? String(maxDepth) : 'ilimitada'));
  say('');
  say('IMPORTANTE: mientras escanea verás [leyendo...] con el número de');
  say('archivos que va procesando. Si una unidad de red (M: P: Z:) tarda,');
  say('es normal: tarda más que el disco local. NO cierres la ventana.');
  say('');

  for (const d of drives) {
    say('Escaneando ' + d + ' ...');
    const t0 = Date.now();
    lastProg = 0;
    walk(d, 0, maxDepth, d);
    try { fs.writeSync(1, '\r                                \r'); } catch (_) {}
    say('  ✔ ' + d + '  (archivos=' + stats.files + ' · carpetas=' + stats.dirs +
      ' · tam=' + fmtSize(stats.size) + ')  en ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  say('');

  // Reporte
  const out = [];
  out.push('=== RESUMEN ===');
  out.push('Carpetas: ' + stats.dirs);
  out.push('Archivos: ' + stats.files);
  out.push('Tamaño total: ' + fmtSize(stats.size));
  out.push('Errores de acceso: ' + stats.errors);
  out.push('');
  out.push('=== ARCHIVOS POR TIPO ===');
  const types = Object.keys(stats.byType).sort((a, b) => stats.byType[b] - stats.byType[a]);
  for (const t of types) out.push('  ' + pad(stats.byType[t], 6) + '  ' + t);
  out.push('');

  out.push('=== ARCHIVOS DE DATOS (relevantes, agrupados) ===');
  const grupos = {};
  for (const m of matches) {
    const base = path.join(path.dirname(m.path), path.basename(m.path).replace(/[_\-\s]*\d+\./, '.').replace(/\.\d+/, ''));
    grupos[base] = grupos[base] || { n: 0, size: 0, types: {} };
    grupos[base].n++;
    grupos[base].size += m.size;
    grupos[base].types[m.type] = (grupos[base].types[m.type] || 0) + 1;
  }
  const grouped = Object.keys(grupos).sort((a, b) => grupos[b].size - grupos[a].size);
  for (const g of grouped.slice(0, 120)) {
    const g0 = grupos[g];
    out.push('  [' + Object.keys(g0.types).filter(t => g0.types[t]).join(',') + '] ' +
      fmtSize(g0.size) + (g0.n > 1 ? '  ~' + g0.n + ' archivos' : '') + '  ' + g);
  }
  out.push('');

  out.push('=== POSIBLES BASES DE DATOS / ARCHIVOS GRANDES ===');
  bigFiles.sort((a, b) => b.size - a.size);
  for (const b of bigFiles.slice(0, 300)) out.push('  [' + b.type + '] ' + fmtSize(b.size) + '  ' + b.path);

  const txt = out.join('\n');
  say('\n' + txt);

  // Guardar reportes
  const reportJs = {
    generado: new Date().toISOString(),
    unidades: drives,
    resumen: { carpetas: stats.dirs, archivos: stats.files, tamano_total: stats.size, errores: stats.errors, por_tipo: stats.byType },
    relevantes: matches,
    grandes: bigFiles,
  };
  try { fs.writeFileSync(path.join(__dirname, 'reporte_mixnet.json'), JSON.stringify(reportJs, null, 2), 'utf8'); } catch (e) {}
  try { fs.writeFileSync(path.join(__dirname, 'reporte_mixnet.txt'), txt, 'utf8'); } catch (e) {}

  console.log('\nReportes guardados en:');
  console.log('  ' + path.join(__dirname, 'reporte_mixnet.txt'));
  console.log('  ' + path.join(__dirname, 'reporte_mixnet.json'));
  console.log('\nListo ✔');
}

function KEYW(p) {
  const n = path.basename(p).toLowerCase();
  let w = 0;
  for (let i = 0; i < RELEVANT_KEYWORDS.length; i++) if (n.includes(RELEVANT_KEYWORDS[i])) w++;
  return -w;
}

main();
