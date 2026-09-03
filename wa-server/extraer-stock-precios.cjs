/*
  ============================================================
  JJ Paper — Extractor de Stock y Precios (v2.0)
  ============================================================
  Lee SOLO la tabla activa del servidor MixNet (VICTAINV.DBF)
  y genera un CSV limpio con 4 columnas:
    CODIGO | PRODUCTO | PRECIO_USD | STOCK

  - Filtra productos obsoletos (sin stock y sin precio)
  - Ordena alfabéticamente por nombre de producto
  - Formato CSV con separador punto y coma (;) para Excel ES
  - Guarda en escritorio y en la carpeta wa-server

  Uso:  node extraer-stock-precios.cjs
  ============================================================
*/
'use strict';

var fs   = require('fs');
var path = require('path');

/* ═══════════════ UTILIDADES DE CONSOLA ═══════════════ */

function say(s) {
  try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); }
}

function banner(msg) {
  say('');
  say('  ============================================================');
  say('  ' + msg);
  say('  ============================================================');
  say('');
}

function ok(msg)   { say('  ✔ ' + msg); }
function warn(msg) { say('  ⚠ ' + msg); }
function fail(msg) { say('  ✖ ' + msg); }
function info(msg) { say('  → ' + msg); }

/* ═══════════════ DECODIFICACIÓN CP1252 (acentos) ═══════════════ */

var CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178'
};

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128 || b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

/* ═══════════════ LECTOR DBF ═══════════════ */

function readDbf(filePath) {
  var buf = fs.readFileSync(filePath);
  if (buf.length < 33) throw new Error('Archivo DBF demasiado pequeño: ' + filePath);

  var numRecords = buf.readUInt32LE(4);
  var headerLen  = buf.readUInt16LE(8);
  var recordLen  = buf.readUInt16LE(10);

  // Leer campos del header
  var fields = [];
  var off = 32;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    var rawName = '';
    for (var i = 0; i < 11; i++) {
      var c = buf[off + i];
      if (c === 0) break;
      rawName += String.fromCharCode(c);
    }
    var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (clean.length > 0) {
      fields.push({
        name: clean,
        type: String.fromCharCode(buf[off + 11]),
        len:  buf[off + 16] || buf.readUInt16LE(off + 16)
      });
    }
    off += 32;
  }

  // Leer registros
  var rows = [];
  var pos = headerLen;
  var maxEnd = Math.min(headerLen + numRecords * recordLen, buf.length);

  while (pos + recordLen <= maxEnd) {
    var rec = buf.slice(pos, pos + recordLen);

    // 0x2A = registro borrado → saltar
    if (rec[0] !== 0x2A) {
      var obj = {};
      var fpos = 1;
      for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        if (fpos + f.len > rec.length) break;
        var val = decodeStr(rec, fpos, f.len);
        if (f.type === 'N' || f.type === 'F') {
          var num = parseFloat(val);
          obj[f.name] = isNaN(num) ? 0 : num;
        } else {
          obj[f.name] = val;
        }
        fpos += f.len;
      }
      rows.push(obj);
    }
    pos += recordLen;
  }

  return { fields: fields, rows: rows, numRecords: numRecords };
}

/* ═══════════════ CSV HELPERS ═══════════════ */

function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[";]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function fmtPrecio(n) {
  if (!n || n <= 0) return '0.00';
  return n.toFixed(2);
}

function fmtStock(n) {
  if (!n || n < 0) return '0';
  return Math.floor(n).toString();
}

/* ═══════════════ BÚSQUEDA INTELIGENTE DE LA TABLA ACTIVA ═══════════════ */

/**
 * Busca la tabla de inventario activa del servidor MixNet.
 * Prioridad:
 *   1. VICTAINV.DBF en M:\comp01  (tabla viva del servidor)
 *   2. MXCTAINV.DBF en M:\comp01  (tabla estándar MixNet)
 *   3. Cualquier *CTAINV.DBF en M:\comp01
 *   4. Fallback: buscar en directorios alternativos
 */
function findActiveTable() {
  // Directorios en ORDEN de prioridad (el servidor activo primero)
  var liveDirs = [
    'M:\\comp01',
    'M:\\COMP02',
    'M:\\COMP03'
  ];

  // Directorios de respaldo (solo si no hay servidor activo)
  var backupDirs = [
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\RESPAMIX\\COMP01-10012023',
    'C:\\MIXNET\\comp01',
    'D:\\MIXNET\\comp01'
  ];

  // Nombres de tabla en orden de prioridad
  var tableNames = ['VICTAINV.DBF', 'MXCTAINV.DBF'];

  // 1. Buscar en servidor activo
  for (var d = 0; d < liveDirs.length; d++) {
    for (var t = 0; t < tableNames.length; t++) {
      var p = path.join(liveDirs[d], tableNames[t]);
      if (fs.existsSync(p)) {
        return { path: p, source: 'servidor activo (' + liveDirs[d] + ')', isFallback: false };
      }
    }
    // Buscar cualquier archivo *CTAINV.DBF
    try {
      var files = fs.readdirSync(liveDirs[d]);
      for (var f = 0; f < files.length; f++) {
        if (/CTAINV\.DBF$/i.test(files[f])) {
          var fp = path.join(liveDirs[d], files[f]);
          return { path: fp, source: 'servidor activo (' + liveDirs[d] + ')', isFallback: false };
        }
      }
    } catch (_) {}
  }

  // 2. Buscar en respaldos (fallback)
  for (var d = 0; d < backupDirs.length; d++) {
    for (var t = 0; t < tableNames.length; t++) {
      var p = path.join(backupDirs[d], tableNames[t]);
      if (fs.existsSync(p)) {
        return { path: p, source: 'respaldo (' + backupDirs[d] + ')', isFallback: true };
      }
    }
    try {
      var files = fs.readdirSync(backupDirs[d]);
      for (var f = 0; f < files.length; f++) {
        if (/CTAINV\.DBF$/i.test(files[f]) && !/^j\d/i.test(files[f])) {
          var fp = path.join(backupDirs[d], files[f]);
          return { path: fp, source: 'respaldo (' + backupDirs[d] + ')', isFallback: true };
        }
      }
    } catch (_) {}
  }

  return null;
}

/* ═══════════════ PROGRAMA PRINCIPAL ═══════════════ */

function main() {
  banner('JJ PAPER — EXPORTAR PRODUCTOS Y PRECIOS v2.0');

  // ─── Paso 1: Localizar tabla activa ───
  info('Buscando tabla de inventario en el servidor MixNet...');

  var table = findActiveTable();
  if (!table) {
    fail('No se encontró ninguna tabla de inventario.');
    fail('Verifica que la unidad M:\\ esté conectada (red del servidor).');
    say('');
    say('  Rutas buscadas:');
    say('    M:\\comp01\\VICTAINV.DBF');
    say('    M:\\comp01\\MXCTAINV.DBF');
    say('    C:\\RESPAMIX\\...\\VICTAINV.DBF');
    process.exit(1);
  }

  ok('Tabla encontrada: ' + path.basename(table.path));
  info('Fuente: ' + table.source);
  if (table.isFallback) {
    warn('ATENCIÓN: Se está usando un RESPALDO, no el servidor en vivo.');
    warn('Los datos pueden NO estar actualizados.');
  }

  // ─── Paso 2: Leer la tabla ───
  say('');
  info('Leyendo datos...');

  var data;
  try {
    data = readDbf(table.path);
  } catch (e) {
    fail('Error al leer la tabla: ' + e.message);
    process.exit(1);
  }

  ok('Registros leidos: ' + data.rows.length);

  // Verificar que los campos necesarios existen
  var fieldNames = data.fields.map(function(f) { return f.name; });
  var fCode  = fieldNames.indexOf('codart')    !== -1 ? 'codart'    : null;
  var fName  = fieldNames.indexOf('nomart')    !== -1 ? 'nomart'    : null;
  var fPrice = fieldNames.indexOf('precio_a')  !== -1 ? 'precio_a'  : null;
  var fStock = fieldNames.indexOf('existe_act') !== -1 ? 'existe_act' : null;

  if (!fCode || !fName) {
    fail('La tabla no tiene los campos esperados (codart, nomart).');
    fail('Campos encontrados: ' + fieldNames.join(', '));
    process.exit(1);
  }

  if (!fPrice) {
    // Intentar precio alternativo
    if (fieldNames.indexOf('precio_c') !== -1) {
      fPrice = 'precio_c';
      warn('No se encontró precio_a (USD). Usando precio_c (Bs) como respaldo.');
    } else {
      warn('No se encontró campo de precio. Se exportará sin precio.');
    }
  }

  if (!fStock) {
    warn('No se encontró campo de stock (existe_act).');
  }

  // ─── Paso 3: Filtrar y limpiar datos ───
  say('');
  info('Filtrando productos activos...');

  var productos = [];
  var descartados = 0;
  var sinCodigo = 0;

  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];

    // Código obligatorio
    var codigo = String(row[fCode] || '').trim();
    if (!codigo) { sinCodigo++; continue; }

    // Nombre del producto
    var nombre = String(row[fName] || '').trim();
    if (!nombre) nombre = '(SIN NOMBRE)';

    // Precio de venta en USD
    var precio = fPrice ? (row[fPrice] || 0) : 0;
    if (typeof precio !== 'number') precio = parseFloat(precio) || 0;

    // Stock actual
    var stock = fStock ? (row[fStock] || 0) : 0;
    if (typeof stock !== 'number') stock = parseFloat(stock) || 0;
    if (stock < 0) stock = 0;

    // Filtrar: descartar productos sin precio Y sin stock
    if (precio <= 0 && stock <= 0) {
      descartados++;
      continue;
    }

    productos.push({
      codigo: codigo,
      nombre: nombre,
      precio: precio,
      stock:  Math.floor(stock)
    });
  }

  // Ordenar alfabéticamente por nombre
  productos.sort(function(a, b) {
    return a.nombre.localeCompare(b.nombre);
  });

  ok('Productos activos: ' + productos.length);
  info('Descartados (sin precio ni stock): ' + descartados);
  if (sinCodigo > 0) info('Sin código (ignorados): ' + sinCodigo);

  // ─── Paso 4: Generar CSV limpio ───
  say('');
  info('Generando archivo CSV...');

  var lines = ['CODIGO;PRODUCTO;PRECIO_USD;STOCK'];

  for (var i = 0; i < productos.length; i++) {
    var p = productos[i];
    lines.push([
      escCSV(p.codigo),
      escCSV(p.nombre),
      fmtPrecio(p.precio),
      fmtStock(p.stock)
    ].join(';'));
  }

  var csvContent = '\uFEFF' + lines.join('\r\n');
  var outName = 'productos_jj_paper.csv';

  // Guardar en carpeta wa-server
  var outLocal = path.join(__dirname, outName);
  fs.writeFileSync(outLocal, csvContent, 'utf8');
  ok('Guardado en: ' + outLocal);

  // Guardar en escritorio
  var userProfile = process.env.USERPROFILE || '';
  if (userProfile) {
    var desktopPaths = [
      path.join(userProfile, 'Desktop', outName),
      path.join(userProfile, 'Escritorio', outName)
    ];
    for (var d = 0; d < desktopPaths.length; d++) {
      try {
        fs.writeFileSync(desktopPaths[d], csvContent, 'utf8');
        ok('Guardado en escritorio: ' + desktopPaths[d]);
      } catch (_) {}
    }
  }

  // ─── Paso 5: Resumen final ───
  banner('RESUMEN');
  say('  Archivo generado:    ' + outName);
  say('  Total productos:     ' + productos.length);
  say('  Columnas:            CODIGO | PRODUCTO | PRECIO_USD | STOCK');
  say('  Fuente de datos:     ' + path.basename(table.path));
  say('  Servidor:            ' + table.source);
  say('');
  say('  Abre el archivo con Excel o Google Sheets.');
  say('  El separador es punto y coma (;) para que');
  say('  Excel en español lo lea correctamente.');
  say('');
}

try {
  main();
} catch (e) {
  fail('Error inesperado: ' + e.message);
  say(e.stack || '');
  process.exit(1);
}