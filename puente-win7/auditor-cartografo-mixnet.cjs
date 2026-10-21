/* ==========================================================================
   JJ Paper — Auditor y Cartógrafo Maestro de MixNet ERP (Windows 7 / LAN)
   --------------------------------------------------------------------------
   - Diseñado para correr en la PC conectada a la red de la empresa.
   - Compatible 100% con Node 13+ (CommonJS puro, cero npm install).
   - Solo lectura (Read-Only estricto): NO modifica ningún byte.
   - Analiza la cabecera real de cada .DBF:
       * Número de registros
       * Longitud de registro
       * Todos los campos (nombre, tipo C/N/D/L/M, longitud, decimales)
       * Detección de tablas de usuarios, permisos, matrices de flags y seguridad
       * Muestra de los primeros registros reales de muestra
   - Genera:
       * AUDITORIA_MIXNET_MAPA.json  (Estructura completa para la IA y el puente)
       * AUDITORIA_MIXNET_MAPA.txt   (Informe legible directo)
   ========================================================================== */

'use strict';

var fs   = require('fs');
var path = require('path');

function pad(n, w) {
  var s = String(n !== undefined && n !== null ? n : '');
  while (s.length < w) s = ' ' + s;
  return s;
}

function fmtBytes(b) {
  b = b || 0;
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

function print(msg) {
  try {
    fs.writeSync(1, msg + '\n');
  } catch (_) {
    console.log(msg);
  }
}

// ─── LECTOR DBASE III / CLIPPER ───
function inspectDbfFile(filePath) {
  try {
    var stat = fs.statSync(filePath);
    if (stat.size < 32) return null;

    var fd = fs.openSync(filePath, 'r');
    var header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, 32, 0);

    var numRecords = header.readUInt32LE(4);
    var headerLen  = header.readUInt16LE(8);
    var recordLen  = header.readUInt16LE(10);

    if (headerLen < 32 || headerLen > 65535 || recordLen < 1) {
      fs.closeSync(fd);
      return null;
    }

    var fieldsBuf = Buffer.alloc(headerLen);
    fs.readSync(fd, fieldsBuf, 0, headerLen, 0);

    var fields = [];
    var off = 32;
    var pos = 1;

    while (off + 32 <= headerLen - 1 && fieldsBuf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = fieldsBuf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var name = rawName.trim().toUpperCase();
      if (name.length > 0) {
        var type = String.fromCharCode(fieldsBuf[off + 11]);
        var len  = fieldsBuf[off + 16] || fieldsBuf.readUInt16LE(off + 16);
        var dec  = fieldsBuf[off + 17];
        fields.push({
          name: name,
          type: type,
          len: len,
          dec: dec,
          pos: pos
        });
        pos += len;
      }
      off += 32;
    }

    // Leer hasta 5 registros de muestra no borrados
    var sampleRows = [];
    var maxSamples = Math.min(5, numRecords);
    var sampleOffset = headerLen;
    var recBuf = Buffer.alloc(recordLen);

    for (var r = 0; r < numRecords && sampleRows.length < maxSamples; r++) {
      fs.readSync(fd, recBuf, 0, recordLen, sampleOffset);
      sampleOffset += recordLen;

      if (recBuf[0] !== 0x2A) { // no borrado
        var rowObj = { _rec: r + 1 };
        for (var f = 0; f < fields.length; f++) {
          var fld = fields[f];
          var val = '';
          for (var p = fld.pos; p < fld.pos + fld.len && p < recBuf.length; p++) {
            var b = recBuf[p];
            if (b >= 32 && b <= 126) val += String.fromCharCode(b);
          }
          rowObj[fld.name] = val.trim();
        }
        sampleRows.push(rowObj);
      }
    }

    fs.closeSync(fd);

    // Heurística de detección de tipo de tabla
    var fNames = fields.map(function(f) { return f.name; });
    var allNamesStr = fNames.join(' ');
    var tags = [];

    if (/PERM|OPC|FLAG|ACCES|NIVEL|CLAVE|PASS|USUAR|USER|LOGIN/.test(allNamesStr)) {
      tags.push('SEGURIDAD_Y_PERMISOS');
    }
    if (/NUMCOT|COTIZ|PRESU/.test(allNamesStr)) tags.push('COTIZACIONES');
    if (/NUMPED|PEDID/.test(allNamesStr)) tags.push('PEDIDOS');
    if (/NOMCLI|RIF|CIF|CODCLI|DIREC/.test(allNamesStr)) tags.push('CLIENTES');
    if (/PRECIO|EXISTEN|STOCK|DESCRIP|ITEM|ARTIC/.test(allNamesStr)) tags.push('INVENTARIO');
    if (/NUMFAC|SENIAT|CONTROL|FACTUR/.test(allNamesStr)) tags.push('FACTURACION_SENIAT');
    if (/CODVEN|VENDEDOR|COMIS/.test(allNamesStr)) tags.push('VENDEDORES');

    return {
      fileName: path.basename(filePath),
      path: filePath,
      directory: path.dirname(filePath),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      fieldsCount: fields.length,
      fields: fields,
      tags: tags,
      sampleRows: sampleRows
    };
  } catch (err) {
    return null;
  }
}

// ─── EXPLORADOR RECURSIVO ───
var scannedFiles = 0;
var dbfTables = [];
var otherImportantFiles = [];

var SKIP_DIRS = {
  'WINDOWS': true,
  '$RECYCLE.BIN': true,
  'RECYCLER': true,
  'SYSTEM VOLUME INFORMATION': true,
  'PROGRAM FILES': true,
  'PROGRAM FILES (X86)': true,
  'APPDATA': true,
  'NODE_MODULES': true,
  'WINSXS': true
};

function scanFolder(dirPath, maxDepth, curDepth) {
  if (curDepth > maxDepth) return;

  var entries = null;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var full = path.join(dirPath, ent.name);

    if (ent.isDirectory()) {
      var u = ent.name.toUpperCase();
      if (!SKIP_DIRS[u]) {
        scanFolder(full, maxDepth, curDepth + 1);
      }
    } else {
      scannedFiles++;
      if (scannedFiles % 250 === 0) {
        try { fs.writeSync(1, '\r  [Escaneando...] ' + scannedFiles + ' archivos revisados · Tablas DBF halladas: ' + dbfTables.length); } catch (_) {}
      }

      var ext = path.extname(ent.name).toUpperCase();
      if (ext === '.DBF') {
        var info = inspectDbfFile(full);
        if (info) {
          dbfTables.push(info);
        }
      } else if (ext === '.NTX' || ext === '.INI' || ext === '.CFG' || ext === '.DAT') {
        try {
          var st = fs.statSync(full);
          otherImportantFiles.push({
            name: ent.name,
            path: full,
            size: st.size,
            ext: ext
          });
        } catch (_) {}
      }
    }
  }
}

function runAudit() {
  print('====================================================================');
  print('  JJ PAPER — AUDITOR Y CARTOGRAFO MAESTRO DE MIXNET ERP (WIN 7)');
  print('====================================================================');
  print('  Modo: 100% Solo Lectura (Inspeccion de cabeceras, campos y permisos)');
  print('  Iniciando escaneo universal de unidades...\n');

  var candidateDrives = ['M:', 'P:', 'C:', 'D:', 'Z:', 'Y:', 'X:'];
  var activeDrives = [];

  for (var d = 0; d < candidateDrives.length; d++) {
    var root = candidateDrives[d] + '\\';
    if (fs.existsSync(root)) {
      activeDrives.push(root);
    }
  }

  print('Unidades activas detectadas en esta PC: ' + activeDrives.join(' '));
  print('Escaneando carpetas de datos y subdirectorios...\n');

  var tStart = Date.now();

  for (var u = 0; u < activeDrives.length; u++) {
    var driveRoot = activeDrives[u];
    print('--> Explorando unidad ' + driveRoot + ' ...');
    scanFolder(driveRoot, 4, 1);
  }

  try { fs.writeSync(1, '\r                                                                               \r'); } catch (_) {}

  var durationSec = ((Date.now() - tStart) / 1000).toFixed(1);
  print('\n[OK] Escaneo completado en ' + durationSec + ' segundos.');
  print('     Archivos inspeccionados: ' + scannedFiles);
  print('     Tablas DBF analizadas:   ' + dbfTables.length);
  print('     Indices / Archivos aux:  ' + otherImportantFiles.length);

  // ─── CLASIFICACION ESPECIAL PARA LA IA ───
  var tablesByTag = {
    'SEGURIDAD_Y_PERMISOS': [],
    'PEDIDOS': [],
    'COTIZACIONES': [],
    'CLIENTES': [],
    'INVENTARIO': [],
    'FACTURACION_SENIAT': [],
    'VENDEDORES': [],
    'OTRAS_TABLAS': []
  };

  for (var t = 0; t < dbfTables.length; t++) {
    var tab = dbfTables[t];
    var assigned = false;
    for (var g = 0; g < tab.tags.length; g++) {
      var tg = tab.tags[g];
      if (tablesByTag[tg]) {
        tablesByTag[tg].push(tab);
        assigned = true;
      }
    }
    if (!assigned) {
      tablesByTag['OTRAS_TABLAS'].push(tab);
    }
  }

  // ─── GENERAR INFORME DE TEXTO ───
  var lines = [];
  lines.push('====================================================================');
  lines.push('  JJ PAPER — REPORTE CARTOGRAFICO ESTRUCTURAL MIXNET ERP');
  lines.push('  Fecha: ' + new Date().toISOString() + ' | Duracion: ' + durationSec + 's');
  lines.push('====================================================================\n');

  lines.push('1. TABLAS RELACIONADAS CON USUARIOS, CREDENCIALES Y MATRIZ DE PERMISOS:');
  lines.push('--------------------------------------------------------------------');
  var secList = tablesByTag['SEGURIDAD_Y_PERMISOS'];
  if (secList.length === 0) {
    lines.push('  (No se detectaron tablas con campos típicos de seguridad con nombres estándar)');
  } else {
    for (var s = 0; s < secList.length; s++) {
      var item = secList[s];
      lines.push('  ▶ ARCHIVO: ' + item.path);
      lines.push('    Registros: ' + item.numRecords + ' | Longitud Registro: ' + item.recordLen + ' bytes | Tamaño: ' + fmtBytes(item.size));
      lines.push('    Campos (' + item.fields.length + '): ' + item.fields.map(function(f) { return f.name + '(' + f.type + ',' + f.len + ')'; }).join(', '));
      if (item.sampleRows.length > 0) {
        lines.push('    Muestra de datos reales (primeros registros):');
        for (var sr = 0; sr < item.sampleRows.length; sr++) {
          lines.push('      [' + (sr + 1) + '] ' + JSON.stringify(item.sampleRows[sr]));
        }
      }
      lines.push('');
    }
  }

  lines.push('\n2. INVENTARIO DE TODAS LAS TABLAS DBF ENCONTRADAS POR CARPETA:');
  lines.push('--------------------------------------------------------------------');
  // Agrupar por directorio
  var byDir = {};
  for (var b = 0; b < dbfTables.length; b++) {
    var tbl = dbfTables[b];
    byDir[tbl.directory] = byDir[tbl.directory] || [];
    byDir[tbl.directory].push(tbl);
  }

  for (var dirName in byDir) {
    lines.push('\n📁 CARPETA: ' + dirName + ' (' + byDir[dirName].length + ' tablas)');
    for (var dbIdx = 0; dbIdx < byDir[dirName].length; dbIdx++) {
      var dItem = byDir[dirName][dbIdx];
      var tagStr = dItem.tags.length > 0 ? ' [' + dItem.tags.join(', ') + ']' : '';
      lines.push('   • ' + pad(dItem.fileName, 16) + ' | Regs: ' + pad(dItem.numRecords, 6) + ' | Tam: ' + pad(fmtBytes(dItem.size), 9) + tagStr);
      lines.push('     Campos: ' + dItem.fields.map(function(f) { return f.name; }).join(', '));
    }
  }

  var reportText = lines.join('\n');

  // Guardar archivos de salida
  var jsonOutPath = path.join(__dirname, 'AUDITORIA_MIXNET_MAPA.json');
  var txtOutPath  = path.join(__dirname, 'AUDITORIA_MIXNET_MAPA.txt');

  fs.writeFileSync(jsonOutPath, JSON.stringify({
    fecha: new Date().toISOString(),
    duracion_segundos: durationSec,
    unidades: activeDrives,
    total_dbfs: dbfTables.length,
    tablas_seguridad_permisos: secList,
    clasificacion: tablesByTag,
    directorios: byDir
  }, null, 2), 'utf8');

  fs.writeFileSync(txtOutPath, reportText, 'utf8');

  print('\n====================================================================');
  print('  ✔ INFORME GENERADO CON EXITO EN ESTA CARPETA:');
  print('    1. ' + txtOutPath);
  print('    2. ' + jsonOutPath);
  print('====================================================================\n');
  print('Copia o abre "AUDITORIA_MIXNET_MAPA.txt" para ver el mapa exacto de');
  print('todas las tablas, campos y la matriz real de permisos de MixNet.');
}

runAudit();
