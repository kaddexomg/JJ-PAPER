/* ==========================================================================
   JJ Paper — Cartógrafo y Mapeador Exhaustivo de Archivos y Bases de Datos
   --------------------------------------------------------------------------
   - Compatible con Node.js 13+ (CommonJS puro, cero dependencias npm).
   - 100% Solo Lectura (Read-Only estricto): NO modifica ningún archivo.
   - Mapea CADA CARPETA, CADA DIRECTORIO Y CADA ARCHIVO de la unidad.
   - Analiza e identifica todos los formatos:
       * Bases de datos: .DBF, .FDB, .GDB, .MDB, .ACCDB, .SQLITE, .DB, .DAT, .BIN
       * Índices: .NTX, .CDX, .NDX, .IDX
       * Documentos y Hojas: .CSV, .TXT, .XLS, .XLSX, .PDF, .DOC, .DOCX
       * Configuración y código: .INI, .CFG, .PRG, .CH, .BAT, .CMD, .JSON, .XML
   - Para tablas DBF:
       * Inspecciona cabecera dBase/Clipper: registros, longitud de registro
       * Extrae todos los nombres de campos, tipos (C/N/D/L/M) y longitudes
       * Detecta automáticamente si contiene matrices de permisos (200+ flags),
         usuarios, cotizaciones, pedidos, clientes, inventario o facturas
       * Muestra de los primeros registros reales
   - Genera informes completos en la misma carpeta:
       * MAPA_TOTAL_DIRECTORIOS.txt
       * MAPA_TOTAL_DIRECTORIOS.json
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

// ─── CLASIFICACIÓN DE FORMATOS DE ARCHIVO ───
var FORMAT_CATEGORIES = {
  'DBF': 'BASE_DE_DATOS_DBF',
  'NTX': 'INDICE_CLIPPER_NTX',
  'CDX': 'INDICE_FOXPRO_CDX',
  'NDX': 'INDICE_DBASE_NDX',
  'IDX': 'INDICE_GENERAL',
  'FDB': 'BASE_FIREBIRD',
  'GDB': 'BASE_INTERBASE',
  'MDB': 'BASE_ACCESS',
  'ACCDB': 'BASE_ACCESS',
  'SQLITE': 'BASE_SQLITE',
  'DB': 'BASE_DE_DATOS_GENERICA',
  'DAT': 'DATOS_BINARIOS_DAT',
  'BIN': 'DATOS_BINARIOS_BIN',
  'CSV': 'HOJA_CSV',
  'TXT': 'TEXTO_PLANO',
  'PRN': 'TEXTO_IMPRESION',
  'XLS': 'EXCEL_BIFF',
  'XLSX': 'EXCEL_XML',
  'INI': 'CONFIGURACION_INI',
  'CFG': 'CONFIGURACION_CFG',
  'XML': 'DATOS_XML',
  'JSON': 'DATOS_JSON',
  'PRG': 'CODIGO_CLIPPER_HARBOUR',
  'CH': 'CABECERA_CLIPPER',
  'BAT': 'SCRIPT_BATCH_WINDOWS',
  'CMD': 'SCRIPT_CMD',
  'EXE': 'EJECUTABLE_SISTEMA',
  'DLL': 'LIBRERIA_DINAMICA',
  'BAK': 'RESPALDO_COPIA'
};

// ─── INSPECTOR PROFUNDO DBASE III / CLIPPER (.DBF) ───
function inspectDbfHeader(filePath) {
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

    // Muestra de los primeros 3 registros
    var sampleRows = [];
    var maxSamples = Math.min(3, numRecords);
    var sampleOffset = headerLen;
    var recBuf = Buffer.alloc(recordLen);

    for (var r = 0; r < numRecords && sampleRows.length < maxSamples; r++) {
      fs.readSync(fd, recBuf, 0, recordLen, sampleOffset);
      sampleOffset += recordLen;

      if (recBuf[0] !== 0x2A) {
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

    var fNamesStr = fields.map(function(f) { return f.name; }).join(' ');
    var tags = [];

    // Identificar matrices de permisos (200+ flags o campos PERM)
    if (/PERM|OPC|FLAG|NIVEL|CLAVE|PASS|USUAR|USER|LOGIN|ACCES|MODU|SECU|SEGUR|AUTH|PRIV/.test(fNamesStr)) {
      tags.push('MATRIZ_PERMISOS_USUARIOS');
    }
    // Revisar si algún campo es muy largo (típico de cadenas de 200 flags 'S/N' o '0/1')
    for (var k = 0; k < fields.length; k++) {
      if (fields[k].len >= 100 && /PERM|OPC|FLAG|ACCES|CADENA/.test(fields[k].name)) {
        tags.push('CADENA_FLAGS_LARGA_' + fields[k].len + '_BYTES');
      }
    }

    if (/NUMCOT|COTIZ|PRESU/.test(fNamesStr)) tags.push('COTIZACIONES');
    if (/NUMPED|PEDID/.test(fNamesStr)) tags.push('PEDIDOS');
    if (/NOMCLI|RIF|CIF|CODCLI|DIREC/.test(fNamesStr)) tags.push('CLIENTES');
    if (/PRECIO|EXISTEN|STOCK|DESCRIP|ITEM|ARTIC/.test(fNamesStr)) tags.push('INVENTARIO');
    if (/NUMFAC|SENIAT|CONTROL|FACTUR/.test(fNamesStr)) tags.push('FACTURAS');
    if (/CODVEN|VENDEDOR|COMIS/.test(fNamesStr)) tags.push('VENDEDORES');

    return {
      numRecords: numRecords,
      recordLen: recordLen,
      headerLen: headerLen,
      fieldsCount: fields.length,
      fields: fields,
      tags: tags,
      sampleRows: sampleRows
    };
  } catch (_) {
    return null;
  }
}

// ─── ESTRUCTURA DEL MAPEO ───
var stats = {
  totalDirs: 0,
  totalFiles: 0,
  totalSize: 0,
  byCategory: {}
};

var allDirectoriesMap = {};
var securityPermTables = [];
var candidateDatabaseFiles = [];

var SKIP_SYSTEM_DIRS = {
  'WINDOWS': true,
  '$RECYCLE.BIN': true,
  'RECYCLER': true,
  'SYSTEM VOLUME INFORMATION': true,
  'APPDATA': true,
  'NODE_MODULES': true,
  'WINSXS': true
};

function mapDirectoryRecursive(dirPath, maxDepth, currentDepth) {
  if (currentDepth > maxDepth) return;

  var entries = null;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return;
  }

  stats.totalDirs++;
  var dirFilesList = [];

  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var fullPath = path.join(dirPath, ent.name);

    if (ent.isDirectory()) {
      var uName = ent.name.toUpperCase();
      if (!SKIP_SYSTEM_DIRS[uName]) {
        mapDirectoryRecursive(fullPath, maxDepth, currentDepth + 1);
      }
    } else {
      stats.totalFiles++;
      if (stats.totalFiles % 300 === 0) {
        try {
          fs.writeSync(1, '\r  [Mapeando archivos...] ' + stats.totalFiles + ' procesados · Directorios: ' + stats.totalDirs + ' · Tamaño: ' + fmtBytes(stats.totalSize));
        } catch (_) {}
      }

      var stat = null;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }

      stats.totalSize += stat.size;

      var rawExt = path.extname(ent.name).replace('.', '').toUpperCase();
      var category = FORMAT_CATEGORIES[rawExt] || ('OTRO_' + (rawExt || 'SIN_EXTENSION'));
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

      var fileInfo = {
        name: ent.name,
        size: stat.size,
        ext: rawExt,
        category: category,
        modified: stat.mtime.toISOString()
      };

      // Si es tabla DBF, inspeccionar cabecera y estructura
      if (rawExt === 'DBF') {
        var dbfData = inspectDbfHeader(fullPath);
        if (dbfData) {
          fileInfo.dbf = dbfData;
          if (dbfData.tags.indexOf('MATRIZ_PERMISOS_USUARIOS') !== -1 || dbfData.tags.some(function(t) { return t.indexOf('CADENA_FLAGS') !== -1; })) {
            securityPermTables.push({
              path: fullPath,
              dir: dirPath,
              file: ent.name,
              info: fileInfo
            });
          }
        }
      }

      // Guardar en bases de datos candidatas
      if (['DBF', 'FDB', 'GDB', 'MDB', 'ACCDB', 'SQLITE', 'DB', 'DAT'].indexOf(rawExt) !== -1) {
        candidateDatabaseFiles.push({
          path: fullPath,
          category: category,
          size: stat.size
        });
      }

      dirFilesList.push(fileInfo);
    }
  }

  if (dirFilesList.length > 0) {
    allDirectoriesMap[dirPath] = {
      filesCount: dirFilesList.length,
      files: dirFilesList
    };
  }
}

function runFullMapping() {
  print('====================================================================');
  print('  JJ PAPER — CARTOGRAFO Y MAPEADOR EXHAUSTIVO (WINDOWS 7 / LAN)');
  print('====================================================================');
  print('  Escaneo exhaustivo: CADA CARPETA, CADA DIRECTORIO, CADA ARCHIVO');
  print('  100% Solo Lectura (Inspeccion de cabeceras, formatos y permisos)');
  print('--------------------------------------------------------------------\n');

  var candidateDrives = ['M:', 'P:', 'C:', 'D:', 'Z:', 'Y:', 'X:'];
  var activeDrives = [];

  for (var d = 0; d < candidateDrives.length; d++) {
    var root = candidateDrives[d] + '\\';
    if (fs.existsSync(root)) {
      activeDrives.push(root);
    }
  }

  print('Unidades activas encontradas en esta estacion: ' + activeDrives.join(' '));
  print('Iniciando recorrido integral...\n');

  var tStart = Date.now();

  for (var u = 0; u < activeDrives.length; u++) {
    var driveRoot = activeDrives[u];
    print('--> Mapeando unidad: ' + driveRoot + ' ...');
    mapDirectoryRecursive(driveRoot, 5, 1);
  }

  try { fs.writeSync(1, '\r                                                                                        \r'); } catch (_) {}

  var totalTimeSec = ((Date.now() - tStart) / 1000).toFixed(1);

  print('\n[OK] Mapeo completado exitosamente en ' + totalTimeSec + ' segundos.');
  print('     Total Directorios mapeados: ' + stats.totalDirs);
  print('     Total Archivos catalogados: ' + stats.totalFiles);
  print('     Tamaño Total indexado:      ' + fmtBytes(stats.totalSize));
  print('     Tablas con permisos/flags:  ' + securityPermTables.length);

  // ─── GENERAR INFORME DE TEXTO MAPA_TOTAL_DIRECTORIOS.txt ───
  var out = [];
  out.push('====================================================================');
  out.push('  JJ PAPER — MAPA CARTOGRAFICO INTEGRAL DE ARCHIVOS Y DIRECTORIOS');
  out.push('  Fecha: ' + new Date().toISOString() + ' | Tiempo: ' + totalTimeSec + 's');
  out.push('  Directorio analizados: ' + stats.totalDirs + ' | Archivos: ' + stats.totalFiles);
  out.push('====================================================================\n');

  out.push('1. RESUMEN DE ARCHIVOS POR CATEGORIA Y FORMATO:');
  out.push('--------------------------------------------------------------------');
  var catKeys = Object.keys(stats.byCategory).sort(function(a, b) {
    return stats.byCategory[b] - stats.byCategory[a];
  });
  for (var c = 0; c < catKeys.length; c++) {
    var k = catKeys[c];
    out.push('  ' + pad(stats.byCategory[k], 7) + ' archivos  | ' + k);
  }
  out.push('');

  out.push('2. TABLAS Y ARCHIVOS DETECTADOS CON PERMISOS / SEGURIDAD / FLAGS (200+):');
  out.push('--------------------------------------------------------------------');
  if (securityPermTables.length === 0) {
    out.push('  (No se encontraron tablas DBF con campos explicitos de seguridad en el escaneo)');
  } else {
    for (var p = 0; p < securityPermTables.length; p++) {
      var item = securityPermTables[p];
      var dbf = item.info.dbf;
      out.push('  ▶ RUTA: ' + item.path);
      out.push('    Tamaño: ' + fmtBytes(item.info.size) + ' | Registros: ' + dbf.numRecords + ' | Bytes/Reg: ' + dbf.recordLen);
      out.push('    Etiquetas: ' + dbf.tags.join(', '));
      out.push('    Campos (' + dbf.fields.length + '):');
      for (var fIdx = 0; fIdx < dbf.fields.length; fIdx++) {
        var f = dbf.fields[fIdx];
        out.push('       • ' + pad(f.name, 12) + ' Tipo: ' + f.type + ' | Longitud: ' + pad(f.len, 4) + ' | Posicion: ' + f.pos);
      }
      if (dbf.sampleRows && dbf.sampleRows.length > 0) {
        out.push('    Muestra de datos (primeros registros reales):');
        for (var sIdx = 0; sIdx < dbf.sampleRows.length; sIdx++) {
          out.push('       [' + (sIdx + 1) + '] ' + JSON.stringify(dbf.sampleRows[sIdx]));
        }
      }
      out.push('');
    }
  }

  out.push('3. MAPA DETALLADO CARPETA POR CARPETA (DIRECTORIO Y CONTENIDO):');
  out.push('--------------------------------------------------------------------');
  var dirPaths = Object.keys(allDirectoriesMap).sort();
  for (var dIdx = 0; dIdx < dirPaths.length; dIdx++) {
    var dName = dirPaths[dIdx];
    var dirData = allDirectoriesMap[dName];
    out.push('\n📁 [CARPETA]: ' + dName + '  (' + dirData.filesCount + ' archivos)');
    for (var fi = 0; fi < dirData.files.length; fi++) {
      var fObj = dirData.files[fi];
      var dbfExtra = '';
      if (fObj.dbf) {
        dbfExtra = ' [DBF Regs: ' + fObj.dbf.numRecords + ' | Campos: ' + fObj.dbf.fieldsCount + ' | ' + fObj.dbf.tags.join(',') + ']';
      }
      out.push('   • ' + pad(fObj.name, 20) + ' | ' + pad(fmtBytes(fObj.size), 9) + ' | ' + pad(fObj.category, 20) + dbfExtra);
      if (fObj.dbf && fObj.dbf.fields) {
        out.push('     Campos: ' + fObj.dbf.fields.map(function(x) { return x.name + '(' + x.len + ')'; }).join(', '));
      }
    }
  }

  var reportContent = out.join('\n');

  var txtFile = path.join(__dirname, 'MAPA_TOTAL_DIRECTORIOS.txt');
  var jsonFile = path.join(__dirname, 'MAPA_TOTAL_DIRECTORIOS.json');

  fs.writeFileSync(txtFile, reportContent, 'utf8');
  fs.writeFileSync(jsonFile, JSON.stringify({
    metadata: {
      fecha: new Date().toISOString(),
      duracion_segundos: totalTimeSec,
      unidades: activeDrives,
      total_directorios: stats.totalDirs,
      total_archivos: stats.totalFiles,
      tamano_total_bytes: stats.totalSize
    },
    resumen_categorias: stats.byCategory,
    tablas_seguridad_permisos: securityPermTables,
    directorios: allDirectoriesMap
  }, null, 2), 'utf8');

  print('====================================================================');
  print('  ✔ REPORTES GENERADOS CON ÉXITO:');
  print('    1. ' + txtFile);
  print('    2. ' + jsonFile);
  print('====================================================================\n');
  print('Abre o copia MAPA_TOTAL_DIRECTORIOS.txt para ver el mapa exacto.');
}

runFullMapping();
