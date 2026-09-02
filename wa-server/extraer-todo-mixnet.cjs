/*
  ============================================================
  JJ Paper — Extractor TOTAL MixNet v3.1 (Con Soporte MEMO)
  ============================================================
  Extrae TODA la informacion util de MixNet, incluyendo
  correos electronicos ocultos en archivos .DBT / .FPT.
  
  Compatible con Node 13+ (CommonJS, Windows 7).
  NO necesita npm install — usa solo modulos nativos.
  ============================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ═══════════════ SALIDA ═══════════════ */
function say(s) { try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); } }
function ts() { var d = new Date(); return '[' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ']'; }
function log(m) { say(ts() + ' ' + m); }
function logOK(m) { say(ts() + '   OK ' + m); }
function logWarn(m) { say(ts() + '   !! ' + m); }

/* ═══════════════ CP1252 (acentos) ═══════════════ */
var CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178'
};

function decodeByte(b) {
  if (b < 128) return String.fromCharCode(b);
  if (b >= 0xA0) return String.fromCharCode(b);
  return CP1252[b] || '';
}

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    s += decodeByte(b);
  }
  return s.trim();
}

/* ═══════════════ LECTOR DBF Y MEMO ═══════════════ */
function cleanFieldName(raw) {
  return raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function readDbfStructure(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;

    var numRecords = buf.readUInt32LE(4);
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);

    if (headerLen < 33 || recordLen < 1 || headerLen > buf.length) return null;

    var fields = [];
    var off = 32;
    while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = buf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = cleanFieldName(rawName);
      if (clean.length > 0) {
        fields.push({
          name: clean,
          rawName: rawName.trim(),
          type: String.fromCharCode(buf[off + 11]),
          len: buf[off + 16] || buf.readUInt16LE(off + 16)
        });
      }
      off += 32;
    }

    return {
      path: filePath,
      fileName: path.basename(filePath).toUpperCase(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      fields: fields,
      fieldNames: fields.map(function (f) { return f.name; })
    };
  } catch (_) {
    return null;
  }
}

// Abre el archivo .DBT o .FPT asociado para leer campos Memo
function openMemo(struct) {
  var base = struct.path.substring(0, struct.path.length - 4);
  var paths = [base + '.DBT', base + '.dbt', base + '.FPT', base + '.fpt'];
  struct.memoFd = null;

  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    if (fs.existsSync(p)) {
      try {
        struct.memoFd = fs.openSync(p, 'r');
        var ext = p.toUpperCase().slice(-3);
        struct.memoExt = ext;
        if (ext === 'FPT') {
          var hbuf = Buffer.alloc(8);
          fs.readSync(struct.memoFd, hbuf, 0, 8, 0);
          struct.memoBlockSize = hbuf.readUInt16BE(6);
          if (struct.memoBlockSize < 64) struct.memoBlockSize = 512;
        } else {
          struct.memoBlockSize = 512;
        }
        break;
      } catch (_) {}
    }
  }
}

function readMemo(struct, blockStr) {
  if (!struct.memoFd) return '';
  var blockNum = parseInt(blockStr, 10);
  if (isNaN(blockNum) || blockNum <= 0) return '';
  
  try {
    var startPos = blockNum * struct.memoBlockSize;
    if (struct.memoExt === 'DBT') {
      var buf = Buffer.alloc(4096); // Asumimos que un correo no pasa de 4KB
      var bytesRead = fs.readSync(struct.memoFd, buf, 0, 4096, startPos);
      var text = '';
      for (var i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x1A || buf[i] === 0x00) break;
        text += decodeByte(buf[i]);
      }
      return text.trim();
    } else if (struct.memoExt === 'FPT') {
      var hbuf = Buffer.alloc(8);
      fs.readSync(struct.memoFd, hbuf, 0, 8, startPos);
      var dataLen = hbuf.readUInt32BE(4);
      if (dataLen <= 0 || dataLen > 65536) return '';
      var dbuf = Buffer.alloc(dataLen);
      fs.readSync(struct.memoFd, dbuf, 0, dataLen, startPos + 8);
      var text = '';
      for (var i = 0; i < dataLen; i++) {
        if (dbuf[i] === 0) break;
        text += decodeByte(dbuf[i]);
      }
      return text.trim();
    }
  } catch (_) {}
  return '';
}

function closeMemo(struct) {
  if (struct.memoFd) {
    try { fs.closeSync(struct.memoFd); } catch (_) {}
    struct.memoFd = null;
  }
}

function readDbfData(struct, maxRows) {
  if (!struct) return [];
  maxRows = maxRows || 500000;
  openMemo(struct); // Abrimos soporte para leer correos

  try {
    var buf = fs.readFileSync(struct.path);
    var maxEnd = Math.min(struct.headerLen + struct.numRecords * struct.recordLen, buf.length);
    var rows = [];
    var pos = struct.headerLen;
    while (pos + struct.recordLen <= maxEnd && rows.length < maxRows) {
      var rec = buf.slice(pos, pos + struct.recordLen);
      if (rec[0] !== 0x2A) { // no borrado
        var obj = {};
        var fpos = 1;
        for (var fi = 0; fi < struct.fields.length; fi++) {
          var f = struct.fields[fi];
          if (fpos + f.len > rec.length) break;
          var val = decodeStr(rec, fpos, f.len);
          
          if (f.type === 'M') {
            // Es un campo MEMO! Leer del archivo externo
            obj[f.name] = readMemo(struct, val);
          } else if (f.type === 'N' || f.type === 'F') {
            var num = parseFloat(val);
            obj[f.name] = isNaN(num) ? 0 : num;
          } else {
            obj[f.name] = val;
          }
          fpos += f.len;
        }
        rows.push(obj);
      }
      pos += struct.recordLen;
    }
    closeMemo(struct);
    return rows;
  } catch (_) {
    closeMemo(struct);
    return [];
  }
}

/* ═══════════════ MATCHING DE CAMPOS ═══════════════ */
function findField(fieldNames, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi] === c || fieldNames[fi].indexOf(c) === 0) return fieldNames[fi];
    }
  }
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    if (c.length < 3) continue;
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi].indexOf(c) !== -1) return fieldNames[fi];
    }
  }
  return null;
}

function findFieldExact(fieldNames, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi] === c) return fieldNames[fi];
    }
  }
  return null;
}

function hasField(fieldNames, candidates) {
  return findField(fieldNames, candidates) !== null;
}

/* ═══════════════ SCORING DE TABLAS ═══════════════ */
function scoreCliente(struct) {
  var fn = struct.fieldNames;
  var s = 0;
  if (hasField(fn, ['nomcli', 'razonsocial', 'razon'])) s += 3;
  if (hasField(fn, ['cifoi', 'rif', 'cedula', 'nit'])) s += 3;
  if (hasField(fn, ['vendedor', 'vended', 'codven'])) s += 2;
  if (hasField(fn, ['direc1', 'direccion', 'dir1'])) s += 2;
  if (hasField(fn, ['tlf1', 'telefono', 'tel1', 'telf'])) s += 2;
  if (hasField(fn, ['email', 'correo', 'mail'])) s += 2;
  if (hasField(fn, ['zona', 'zonacto'])) s += 1;
  return s;
}

function scoreProducto(struct) {
  var fn = struct.fieldNames;
  var s = 0;
  var fnStr = struct.fileName;
  
  // Nombres de archivos conocidos para inventario
  if (/ARTIC|PROALM|PRODUC|ITEM/i.test(fnStr)) s += 10;
  if (/LISPRE/i.test(fnStr)) s += 5;
  if (/VICTAINV|MXCTAINV|CTAINV/i.test(fnStr)) s += 1000; /* SUPER BONUS FOR ACTUAL TABLES */
  
  if (hasField(fn, ['codarti', 'codart', 'codigo', 'codinv', 'cod_art', 'art'])) s += 3;
  if (hasField(fn, ['descrip', 'nombre', 'detalle', 'articulo', 'descri', 'nom', 'des'])) s += 3;
  if (hasField(fn, ['precio1', 'precio', 'pvp', 'pventa', 'p1', 'prec', 'p_vta'])) s += 3;
  if (hasField(fn, ['exist', 'stock', 'saldoinv', 'cant', 'cantidad'])) s += 2;
  if (hasField(fn, ['costo', 'cost', 'ultcos', 'cost_u'])) s += 2;
  if (hasField(fn, ['familia', 'fam', 'grupo', 'cat'])) s += 2;
  
  // Penalizar fuertemente las tablas de facturas o lineas temporales (REN, NUM, ENC, TRA)
  if (/REN|ENC|NUM|TRA|HIS|BUF/i.test(fnStr)) s -= 15;
  if (hasField(fn, ['fecha', 'fec']) && hasField(fn, ['nrofac', 'numfac', 'factura', 'docto'])) s -= 5;
  
  return s;
}

/* ═══════════════ BUSQUEDA INTELIGENTE ═══════════════ */
function listDbf(dir) {
  try { return fs.readdirSync(dir).filter(function (f) { return /\.dbf$/i.test(f); }); } catch (_) { return []; }
}

function scanForMixnet(baseDir, maxDepth, results) {
  if (maxDepth < 0) return;
  try { var entries = fs.readdirSync(baseDir, { withFileTypes: true }); } catch (_) { return; }
  var dbfs = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var name = e.name;
    var nameLow = name.toLowerCase();
    if (e.isFile() && /\.dbf$/i.test(name)) dbfs.push(name);
    if (e.isDirectory()) {
      if (/^(windows|program|appdata|perflogs|\$|users|node_modules|\.)/i.test(nameLow)) continue;
      if (/^comp\d/i.test(nameLow)) {
        var compDir = path.join(baseDir, name);
        var compDbfs = listDbf(compDir);
        if (compDbfs.length > 5) results.push({ path: compDir, dbfCount: compDbfs.length, newestMs: fs.statSync(compDir).mtimeMs });
      }
      if (/mixnet|mixer|respami|mix\d|sistema|datos|factur/i.test(nameLow) || maxDepth > 1) {
        scanForMixnet(path.join(baseDir, name), maxDepth - 1, results);
      }
    }
  }
  if (dbfs.filter(function (f) { return /^MX/i.test(f); }).length > 5) {
    results.push({ path: baseDir, dbfCount: dbfs.length, newestMs: fs.statSync(baseDir).mtimeMs });
  }
}

function findBestMixnetDir() {
  log('[FASE 1] Buscando bases de datos MixNet...');
  var results = [];
  var knownPaths = [
    'M:\\comp01', 'M:\\COMP02', 'M:\\COMP03', 'M:\\COMP01d',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01', 'C:\\RESPAMIX\\COMP01-10012023',
    'P:\\Elias\\MIX\\MIX11\\comp01', 'C:\\MIXNET\\comp01', 'D:\\MIXNET\\comp01'
  ];

  for (var i = 0; i < knownPaths.length; i++) {
    var p = knownPaths[i];
    var dbfs = listDbf(p);
    if (dbfs.length > 5) {
      logOK(p + ' — ' + dbfs.length + ' archivos DBF');
      results.push({ path: p, dbfCount: dbfs.length, newestMs: fs.statSync(p).mtimeMs });
    }
  }

  if (results.length === 0) {
    log('  No se encontraron rutas conocidas. Escaneando unidades...');
    var drives = ['M:', 'P:', 'Z:', 'C:', 'D:', 'E:', 'F:'];
    for (var i = 0; i < drives.length; i++) {
      var root = drives[i] + '\\';
      if (fs.existsSync(root)) { log('  Escaneando ' + drives[i] + '...'); scanForMixnet(root, 3, results); }
    }
  }

  if (results.length === 0) return null;
  results.sort(function (a, b) { return b.newestMs - a.newestMs; });
  log('  -> SELECCIONADO: ' + results[0].path);
  return results[0].path;
}

/* ═══════════════ CSV HELPERS ═══════════════ */
function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' '); // quitar saltos de linea en correos
  if (/[",]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function writeOut(texto, nombre) {
  var rutas = [path.join(__dirname, nombre)];
  var u = process.env.USERPROFILE || '';
  if (fs.existsSync(path.join(u, 'Desktop'))) rutas.push(path.join(u, 'Desktop', nombre));
  if (fs.existsSync(path.join(u, 'Escritorio'))) rutas.push(path.join(u, 'Escritorio', nombre));
  
  for (var i = 0; i < rutas.length; i++) {
    try { fs.writeFileSync(rutas[i], texto, 'utf8'); } catch (_) { }
  }
}

/* ═══════════════ EXTRACCION PRINCIPAL ═══════════════ */
function main() {
  say(''); log('============================================================');
  log('  JJ PAPER — EXTRACTOR MIXNET v3.1 (SOPORTE MEMO ACTIVADO)');
  log('============================================================'); say('');

  var baseDir = findBestMixnetDir();
  if (!baseDir) { log('[ERROR] No se encontraron datos de MixNet.'); return; }

  say(''); log('[FASE 2] Leyendo estructura de tablas...');
  var allDbfFiles = listDbf(baseDir);
  
  // Buscar tambien en subcarpetas EJ*
  try {
    var subdirs = fs.readdirSync(baseDir, { withFileTypes: true });
    for (var i = 0; i < subdirs.length; i++) {
      if (subdirs[i].isDirectory() && /^EJ\d/i.test(subdirs[i].name)) {
        var ejDbfs = listDbf(path.join(baseDir, subdirs[i].name));
        for (var j = 0; j < ejDbfs.length; j++) allDbfFiles.push(path.join(subdirs[i].name, ejDbfs[j]));
      }
    }
  } catch (_) { }

  var allStructs = [];
  for (var i = 0; i < allDbfFiles.length; i++) {
    var p = path.isAbsolute(allDbfFiles[i]) ? allDbfFiles[i] : path.join(baseDir, allDbfFiles[i]);
    var struct = readDbfStructure(p);
    if (struct && struct.fields.length > 0) allStructs.push(struct);
  }

  var clientTable = null, productTable = null, stockTable = null;
  var bcs = 4, bps = 2; // Threshold for products (lowered to catch main tables that lack specific column names)

  for (var i = 0; i < allStructs.length; i++) {
    var sc = scoreCliente(allStructs[i]);
    if (sc > bcs && allStructs[i].numRecords > 30) { bcs = sc; clientTable = allStructs[i]; }
    
    var sp = scoreProducto(allStructs[i]);
    if (sp > bps && allStructs[i].numRecords > 5) { bps = sp; productTable = allStructs[i]; }
    
    if (false && /VICTAINV|FISINV|MXCTAINV|JJCTAINV/i.test(allStructs[i].fileName)) {
      if (!stockTable || allStructs[i].numRecords > stockTable.numRecords) stockTable = allStructs[i];
    }
  }

  if (clientTable) log('  CLIENTES: ' + clientTable.fileName + ' (' + clientTable.numRecords + ' registros)');
  if (productTable) log('  PRODUCTOS: ' + productTable.fileName + ' (' + productTable.numRecords + ' registros)');
  if (stockTable) log('  EXISTENCIAS: ' + stockTable.fileName + ' (' + stockTable.numRecords + ' registros)');

  say(''); log('[FASE 3] Extrayendo datos reales (procesando .DBT/.FPT si existen)...');
  
  var d = new Date();
  var p = function(n) { return String(n).padStart(2, '0'); };
  var stamp = '' + d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  var BOM = '\uFEFF';

  // ═══════════ A) CLIENTES ═══════════
  if (clientTable) {
    var fn = clientTable.fieldNames;
    var fEmail = findFieldExact(fn, ['email', 'emailngq', 'correo', 'mail']) || findField(fn, ['email', 'correo', 'mail']);
    var fEmailSuc = findField(fn, ['email_suc', 'emailsuc', 'emailsu']);
    if (fEmail === fEmailSuc) fEmailSuc = null;

    var fieldMap = {
      codigo: findField(fn, ['codcli', 'codigo', 'cod_cli', 'id']),
      nombre: findField(fn, ['nomcli', 'razonsocial', 'razon', 'nombre']),
      rif: findField(fn, ['cifoi', 'rif', 'cedula']),
      direc1: findField(fn, ['direc1', 'dir1', 'direccion1']),
      direc2: findField(fn, ['direc2', 'dir2', 'direccion2']),
      direc3: findField(fn, ['direc3', 'dir3']),
      tlf1: findField(fn, ['tlf1', 'tlf14', 'telefono1', 'tel1']),
      tlf2: findField(fn, ['tlf2', 'tlf24', 'telefono2']),
      email: fEmail,
      email_sucursal: fEmailSuc,
      contacto: findField(fn, ['contact', 'contac']),
      vendedor: findField(fn, ['vendedor', 'vended', 'codven']),
      cobrador: findField(fn, ['cobrador', 'cobrad']),
      zona: findField(fn, ['zonacto', 'zona']),
      grupo: findField(fn, ['grupoi', 'grupo']),
      estatus: findField(fn, ['estatus', 'status']),
      lim_cre: findField(fn, ['lim_cre', 'limcre', 'limite']),
      saldo: findField(fn, ['saldo', 'saldoor'])
    };

    var cRows = readDbfData(clientTable);
    var cHeader = 'codigo,nombre,rif,direccion,telefono1,telefono2,email,email_sucursal,contacto,vendedor_cod,cobrador,zona,grupo,estatus,limite_credito,saldo';
    var cLines = [cHeader];
    
    var emailCount = 0;
    
    for (var i = 0; i < cRows.length; i++) {
      var r = cRows[i];
      var val = function(key) { return fieldMap[key] ? String(r[fieldMap[key]] || '').trim() : ''; };
      var direccion = [val('direc1'), val('direc2'), val('direc3')].filter(function(x) { return x; }).join(' ').trim();
      var ev = val('email');
      if (ev && ev.indexOf('@') !== -1) emailCount++;
      
      cLines.push([
        escCSV(val('codigo')), escCSV(val('nombre')), escCSV(val('rif')), escCSV(direccion),
        escCSV(val('tlf1')), escCSV(val('tlf2')), escCSV(ev), escCSV(val('email_sucursal')),
        escCSV(val('contacto')), escCSV(val('vendedor')), escCSV(val('cobrador')),
        escCSV(val('zona')), escCSV(val('grupo')), escCSV(val('estatus')),
        escCSV(val('lim_cre')), escCSV(val('saldo'))
      ].join(','));
    }
    
    var cFile = 'jj_clientes_' + stamp + '.csv';
    writeOut(BOM + cLines.join('\r\n'), cFile);
    log('  -> ' + cFile + ' generados (' + cRows.length + ' clientes, ' + emailCount + ' emails leidos del Memo!)');
  }

  // ═══════════ B) PRODUCTOS (Mejorado) ═══════════
  if (productTable) {
    var pRows = readDbfData(productTable);
    var pFile = 'jj_productos_' + stamp + '.csv';
    var pFn = productTable.fieldNames;
    var pf = {
      codigo: findField(pFn, ['codarti', 'codart', 'codigo', 'art', 'id']),
      descrip: findField(pFn, ['descrip', 'nombre', 'detalle', 'nom', 'des']),
      p1: findField(pFn, ['precio1', 'p1', 'precio', 'p_vta']),
      p2: findField(pFn, ['precio2', 'p2']),
      p3: findField(pFn, ['precio3', 'p3']),
      costo: findField(pFn, ['costo', 'cost', 'cost_u']),
      exist: findField(pFn, ['exist', 'stock', 'cant', 'saldo']),
      fam: findField(pFn, ['familia', 'fam', 'grupo', 'cat']),
      uni: findField(pFn, ['unidad', 'uni', 'medida'])
    };

    var sMap = {};
    if (stockTable && stockTable !== productTable) {
      var sRows = readDbfData(stockTable);
      var sCod = findField(stockTable.fieldNames, ['codarti', 'codart', 'codigo', 'art']);
      var sEx = findField(stockTable.fieldNames, ['exist', 'stock', 'cantidad', 'cant', 'saldo']);
      if (sCod && sEx) {
        for (var i=0; i<sRows.length; i++) {
          var c = String(sRows[i][sCod]).trim();
          if (c) sMap[c] = sRows[i][sEx];
        }
      }
    }

    var pLines = ['codigo,descripcion,precio1,precio2,precio3,costo,existencia,familia,unidad'];
    for (var i = 0; i < pRows.length; i++) {
      var r = pRows[i];
      var cod = String(r[pf.codigo] || '').trim();
      var ex = r[pf.exist];
      if ((!ex || ex==='' || ex===0) && sMap[cod] !== undefined) ex = sMap[cod];
      pLines.push([
        escCSV(cod), escCSV(r[pf.descrip]), escCSV(r[pf.p1]), escCSV(r[pf.p2]), escCSV(r[pf.p3]),
        escCSV(r[pf.costo]), escCSV(ex), escCSV(r[pf.fam]), escCSV(r[pf.uni])
      ].join(','));
    }
    writeOut(BOM + pLines.join('\r\n'), pFile);
    log('  -> ' + pFile + ' (' + pRows.length + ' productos extraidos completos!)');
  }

  say(''); log('============================================================');
  log('  ¡LISTO! La extraccion v3.1 ha finalizado correctamente.');
  log('============================================================');
}

try { main(); } catch (e) { log('[ERROR] ' + (e.stack || e)); }