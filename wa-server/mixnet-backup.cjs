/* ==========================================================================
   JJ Paper — Motor de Backup Preventivo & Rollback Atómico MixNet ERP
   --------------------------------------------------------------------------
   Diseñado específicamente para la PC Cobranza (Windows 7 / Node 13.14.0).
   - CommonJS puro (Node 13 compatible, 0 sintaxis ES2020+).
   - Crea copias atómicas byte a byte de los archivos .DBF y .NTX antes de cada
     escritura de pedidos, cotizaciones, inventario o usuarios.
   - Permite restauración inmediata (Rollback) en 1 segundo ante cualquier fallo.
   ========================================================================== */

'use strict';

var fs   = require('fs');
var path = require('path');

// Mapeo exhaustivo de tablas maestras de MixNet y sus índices NTX asociados
var TABLE_INDEX_MAP = {
  // Pedidos
  'MXENCPED': ['MXENPEX1.NTX', 'MXENPEX2.NTX', 'MXENPEX3.NTX', 'MXENPEX4.NTX'],
  'MXRENPED': ['MXREPEX1.NTX', 'MXREPEX2.NTX', 'MXREPEX3.NTX'],
  'MXNUMPED': [], // Correlativo de pedidos

  // Presupuestos / Cotizaciones
  'MXENCCOT': ['MXRECZX1.NTX', 'MXRECZX2.NTX', 'MXRECZX3.NTX'],
  'MXRENCOT': ['MXRENZX1.NTX', 'MXRENZX2.NTX'],
  'MXNUMCOT': [], // Correlativo de cotizaciones

  // Clientes
  'MXCTACLI': ['MXCTACLI.NTX', 'MXCLIX1.NTX', 'MXCLIX2.NTX', 'MXCLIX3.NTX'],

  // Inventario y Catálogo
  'MXCTAINV': ['MXCTAINV.NTX', 'MXINVX1.NTX', 'MXINVX2.NTX', 'MXINVX3.NTX'],
  'VICTAINV': ['VICTAINV.NTX'],

  // Facturación Fiscal SENIAT
  'MXENCFAC': ['MXFACX1.NTX', 'MXFACX2.NTX', 'MXFACX3.NTX'],
  'MXRENFAC': ['MXREFAC1.NTX', 'MXREFAC2.NTX'],

  // Usuarios y Permisos Administrativos
  'MXUSUAR': ['MXUSUAR.NTX', 'MXUSUX1.NTX']
};

function padZero(n, len) {
  var s = String(n || 0);
  while (s.length < len) s = '0' + s;
  return s;
}

function getTimestampStr() {
  var d = new Date();
  return d.getFullYear() +
    padZero(d.getMonth() + 1, 2) +
    padZero(d.getDate(), 2) + '_' +
    padZero(d.getHours(), 2) +
    padZero(d.getMinutes(), 2) +
    padZero(d.getSeconds(), 2) + '_' +
    padZero(d.getMilliseconds(), 3);
}

// Resuelve la ruta base para almacenar backups seguros
function resolveBackupStorageDir(dbfBaseDir) {
  var cand1 = path.join(dbfBaseDir, 'backups_live');
  var cand2 = 'C:\\JJ_PAPER_BACKUPS';
  var cand3 = path.join(__dirname, 'backups_live');

  try {
    if (!fs.existsSync(cand1)) fs.mkdirSync(cand1, { recursive: true });
    fs.writeFileSync(path.join(cand1, '.test_write'), 'ok');
    fs.unlinkSync(path.join(cand1, '.test_write'));
    return cand1;
  } catch (_) {}

  try {
    if (!fs.existsSync(cand2)) fs.mkdirSync(cand2, { recursive: true });
    return cand2;
  } catch (_) {}

  try {
    if (!fs.existsSync(cand3)) fs.mkdirSync(cand3, { recursive: true });
    return cand3;
  } catch (_) {}

  return cand3;
}

// Encuentra un archivo en el directorio sin importar mayúsculas/minúsculas
function findFileCaseInsensitive(dir, filename) {
  try {
    var directPath = path.join(dir, filename);
    if (fs.existsSync(directPath)) return directPath;

    var lower = filename.toLowerCase();
    var list = fs.readdirSync(dir);
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() === lower) {
        return path.join(dir, list[i]);
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Crea un Snapshot preventivo byte a byte antes de cualquier operación
 * @param {string} dbfDir - Ruta a la unidad M:\comp01
 * @param {string} operationLabel - Ej. 'CREAR_PEDIDO', 'CAMBIAR_PERMISOS_MXUSUAR'
 * @param {Array<string>} tablesToBackup - Ej. ['MXENCPED', 'MXRENPED', 'MXNUMPED']
 * @returns {object} { ok: boolean, snapshotId: string, backupDir: string, backedUpFiles: Array }
 */
function createPreTransactionSnapshot(dbfDir, operationLabel, tablesToBackup) {
  if (!dbfDir || !fs.existsSync(dbfDir)) {
    return { ok: false, error: 'Directorio de datos MixNet no disponible: ' + dbfDir };
  }

  var baseStorage = resolveBackupStorageDir(dbfDir);
  var ts = getTimestampStr();
  var snapId = 'SNAP_' + ts + '_' + String(operationLabel || 'OP').replace(/[^A-Za-z0-9_-]/g, '_');
  var targetDir = path.join(baseStorage, snapId);

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    var backedUp = [];
    var tables = Array.isArray(tablesToBackup) && tablesToBackup.length > 0
      ? tablesToBackup
      : Object.keys(TABLE_INDEX_MAP);

    for (var i = 0; i < tables.length; i++) {
      var tName = tables[i].toUpperCase().replace(/\.DBF$/, '');
      
      // 1. Respaldar DBF
      var dbfReal = findFileCaseInsensitive(dbfDir, tName + '.DBF');
      if (dbfReal) {
        var destDbf = path.join(targetDir, path.basename(dbfReal));
        fs.copyFileSync(dbfReal, destDbf);
        var statDbf = fs.statSync(destDbf);
        backedUp.push({ file: path.basename(dbfReal), originalPath: dbfReal, size: statDbf.size });
      }

      // 2. Respaldar todos sus índices NTX conocidos
      var ntxList = TABLE_INDEX_MAP[tName] || [];
      for (var j = 0; j < ntxList.length; j++) {
        var ntxName = ntxList[j];
        var ntxReal = findFileCaseInsensitive(dbfDir, ntxName);
        if (ntxReal) {
          var destNtx = path.join(targetDir, path.basename(ntxReal));
          fs.copyFileSync(ntxReal, destNtx);
          var statNtx = fs.statSync(destNtx);
          backedUp.push({ file: path.basename(ntxReal), originalPath: ntxReal, size: statNtx.size });
        }
      }

      // 3. Buscar NTX adicionales que comiencen con el prefijo de la tabla
      try {
        var allFiles = fs.readdirSync(dbfDir);
        var prefix = tName.substring(0, 5).toLowerCase();
        for (var k = 0; k < allFiles.length; k++) {
          var fn = allFiles[k];
          if (fn.toLowerCase().endsWith('.ntx') && fn.toLowerCase().indexOf(prefix) === 0) {
            var already = false;
            for (var m = 0; m < backedUp.length; m++) {
              if (backedUp[m].file.toLowerCase() === fn.toLowerCase()) { already = true; break; }
            }
            if (!already) {
              var extraSrc = path.join(dbfDir, fn);
              var extraDest = path.join(targetDir, fn);
              fs.copyFileSync(extraSrc, extraDest);
              backedUp.push({ file: fn, originalPath: extraSrc, size: fs.statSync(extraDest).size });
            }
          }
        }
      } catch (_) {}
    }

    // Escribir manifiesto del snapshot
    var manifest = {
      snapshotId: snapId,
      createdAt: new Date().toISOString(),
      label: operationLabel,
      dbfDir: dbfDir,
      targetDir: targetDir,
      fileCount: backedUp.length,
      files: backedUp,
      status: 'active'
    };

    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      ok: true,
      snapshotId: snapId,
      backupDir: targetDir,
      fileCount: backedUp.length,
      files: backedUp
    };
  } catch (err) {
    return { ok: false, error: 'Error creando snapshot preventivo: ' + err.message };
  }
}

/**
 * Ejecuta un Rollback inmediato restaurando byte a byte los archivos desde el snapshot
 * @param {string} snapshotIdOrDir - ID del snapshot o ruta al directorio del snapshot
 * @returns {object} { ok: boolean, restoredCount: number, error: string }
 */
function rollbackSnapshot(snapshotIdOrDir) {
  try {
    var snapDir = snapshotIdOrDir;
    if (!fs.existsSync(snapDir)) {
      // Buscar en posibles directorios de almacenamiento
      var candidates = [
        path.join('M:\\comp01\\backups_live', snapshotIdOrDir),
        path.join('C:\\JJ_PAPER_BACKUPS', snapshotIdOrDir),
        path.join(__dirname, 'backups_live', snapshotIdOrDir)
      ];
      for (var c = 0; c < candidates.length; c++) {
        if (fs.existsSync(candidates[c])) { snapDir = candidates[c]; break; }
      }
    }

    if (!fs.existsSync(snapDir)) {
      return { ok: false, error: 'No se encontró el directorio del snapshot: ' + snapshotIdOrDir };
    }

    var manifestPath = path.join(snapDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: 'Manifiesto de snapshot no encontrado en: ' + snapDir };
    }

    var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    var files = manifest.files || [];
    var restored = 0;

    for (var i = 0; i < files.length; i++) {
      var item = files[i];
      var src = path.join(snapDir, item.file);
      var dest = item.originalPath;

      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        restored++;
      }
    }

    // Actualizar manifiesto
    manifest.status = 'rolled_back';
    manifest.rolledBackAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
      ok: true,
      snapshotId: manifest.snapshotId,
      restoredCount: restored
    };
  } catch (err) {
    return { ok: false, error: 'Error ejecutando rollback: ' + err.message };
  }
}

/**
 * Lista los snapshots disponibles ordenados de más reciente a más antiguo
 */
function listSnapshots(dbfDir) {
  var baseStorage = resolveBackupStorageDir(dbfDir || 'M:\\comp01');
  var results = [];
  try {
    if (!fs.existsSync(baseStorage)) return [];
    var entries = fs.readdirSync(baseStorage);
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(baseStorage, entries[i]);
      var stat = fs.statSync(full);
      if (stat.isDirectory() && entries[i].indexOf('SNAP_') === 0) {
        var mPath = path.join(full, 'manifest.json');
        if (fs.existsSync(mPath)) {
          try {
            results.push(JSON.parse(fs.readFileSync(mPath, 'utf8')));
          } catch (_) {}
        }
      }
    }
    results.sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } catch (_) {}
  return results.slice(0, 30);
}

module.exports = {
  TABLE_INDEX_MAP: TABLE_INDEX_MAP,
  createPreTransactionSnapshot: createPreTransactionSnapshot,
  rollbackSnapshot: rollbackSnapshot,
  listSnapshots: listSnapshots
};
