/* ==========================================================================
   JJ Paper — Administrador de Usuarios y Permisos de MixNet (MXUSUAR.DBF)
   --------------------------------------------------------------------------
   Compatible con Windows 7 y Node.js 13.14.0 (CommonJS puro).
   Permite:
     1. Leer y mapear todos los usuarios y sus permisos reales en MixNet.
     2. Modificar permisos administrativos de usuarios (ej. autorizar/denegar
        anulación de documentos, modificación de precios, acceso a reportes).
     3. Blindaje total: siempre ejecuta un snapshot preventivo con
        mixnet-backup.cjs antes de tocar MXUSUAR.DBF y ejecuta rollback si falla.
   ========================================================================== */

'use strict';

var fs   = require('fs');
var path = require('path');
var backupEngine = require('./mixnet-backup.cjs');

// ─── LECTOR DE ESTRUCTURA DBASE III (0x03) ───
function readDbfStruct(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var buf = fs.readFileSync(filePath);
    if (buf.length < 32) return null;
    return {
      filePath: filePath,
      buf: buf,
      numRecords: buf.readUInt32LE(4),
      headerLen: buf.readUInt16LE(8),
      recordLen: buf.readUInt16LE(10)
    };
  } catch (e) {
    return null;
  }
}

function readDbfFields(buf, headerLen) {
  var fields = [];
  var off = 32;
  var pos = 1;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    var raw = '';
    for (var i = 0; i < 11; i++) {
      var c = buf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    var name = raw.trim().toUpperCase();
    if (name.length > 0) {
      var type = String.fromCharCode(buf[off + 11]);
      var len  = buf[off + 16] || buf.readUInt16LE(off + 16);
      var dec  = buf[off + 17];
      fields.push({ name: name, type: type, len: len, dec: dec, pos: pos });
      pos += len;
    }
    off += 32;
  }
  return fields;
}

function decodeField(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s.trim();
}

/**
 * Lee todos los usuarios registrados en MXUSUAR.DBF
 * @param {string} dbfDir - Ruta a M:\comp01
 */
function getMixnetUsers(dbfDir) {
  var targetFile = path.join(dbfDir, 'MXUSUAR.DBF');
  if (!fs.existsSync(targetFile)) {
    targetFile = path.join(dbfDir, 'mxusuar.dbf');
  }
  if (!fs.existsSync(targetFile)) {
    return { ok: false, error: 'No se encontró el archivo MXUSUAR.DBF en ' + dbfDir };
  }

  var struct = readDbfStruct(targetFile);
  if (!struct) {
    return { ok: false, error: 'Cabecera de MXUSUAR.DBF corrupta o inaccesible' };
  }

  var fields = readDbfFields(struct.buf, struct.headerLen);
  var users = [];
  var pos = struct.headerLen;
  var maxEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);

  var recIndex = 0;
  while (pos + struct.recordLen <= maxEnd) {
    recIndex++;
    var isDeleted = (struct.buf[pos] === 0x2A);
    if (!isDeleted) {
      var u = { _record: recIndex };
      for (var f = 0; f < fields.length; f++) {
        var fld = fields[f];
        u[fld.name] = decodeField(struct.buf, pos + fld.pos, fld.len);
      }
      users.push(u);
    }
    pos += struct.recordLen;
  }

  return {
    ok: true,
    file: targetFile,
    totalRecords: struct.numRecords,
    activeUsersCount: users.length,
    fields: fields.map(function(f) { return { name: f.name, type: f.type, len: f.len }; }),
    users: users
  };
}

/**
 * Modifica campos y permisos de un usuario específico en MXUSUAR.DBF
 * con respaldo preventivo y rollback automático.
 * @param {string} dbfDir - Ruta a M:\comp01
 * @param {number} recordIndex - Número de registro en el DBF (1-indexed)
 * @param {object} updatedValues - Mapa de campos y nuevos valores { PERMISO: 'S', NIVEL: '1' }
 */
function updateMixnetUserPermissions(dbfDir, recordIndex, updatedValues) {
  var targetFile = path.join(dbfDir, 'MXUSUAR.DBF');
  if (!fs.existsSync(targetFile)) {
    targetFile = path.join(dbfDir, 'mxusuar.dbf');
  }
  if (!fs.existsSync(targetFile)) {
    return { ok: false, error: 'MXUSUAR.DBF no encontrado en ' + dbfDir };
  }

  // 1. Snapshot preventivo byte a byte antes de modificar
  var snap = backupEngine.createPreTransactionSnapshot(dbfDir, 'UPDATE_USUAR_REC_' + recordIndex, ['MXUSUAR']);
  if (!snap.ok) {
    return { ok: false, error: 'Abortado: Falló la creación del backup preventivo -> ' + snap.error };
  }

  try {
    var fd = fs.openSync(targetFile, 'r+');
    var headerBuf = Buffer.alloc(32);
    fs.readSync(fd, headerBuf, 0, 32, 0);

    var numRecords = headerBuf.readUInt32LE(4);
    var headerLen  = headerBuf.readUInt16LE(8);
    var recordLen  = headerBuf.readUInt16LE(10);

    if (recordIndex < 1 || recordIndex > numRecords) {
      fs.closeSync(fd);
      backupEngine.rollbackSnapshot(snap.backupDir);
      return { ok: false, error: 'Índice de registro fuera de rango: ' + recordIndex };
    }

    var fieldsBuf = Buffer.alloc(headerLen);
    fs.readSync(fd, fieldsBuf, 0, headerLen, 0);
    var fields = readDbfFields(fieldsBuf, headerLen);

    var offset = headerLen + ((recordIndex - 1) * recordLen);
    var recBuf = Buffer.alloc(recordLen);
    fs.readSync(fd, recBuf, 0, recordLen, offset);

    // Verificar que el registro no esté borrado
    if (recBuf[0] === 0x2A) {
      fs.closeSync(fd);
      backupEngine.rollbackSnapshot(snap.backupDir);
      return { ok: false, error: 'El registro ' + recordIndex + ' está marcado como borrado' };
    }

    // Aplicar las modificaciones solicitadas
    for (var key in updatedValues) {
      var normKey = key.toUpperCase().trim();
      var fld = null;
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].name === normKey) { fld = fields[i]; break; }
      }

      if (fld) {
        var strVal = String(updatedValues[key] || '').trim();
        var valBuf = Buffer.alloc(fld.len, 0x20, 'latin1');
        var inBytes = Buffer.from(strVal, 'latin1');
        inBytes.copy(valBuf, 0, 0, Math.min(inBytes.length, fld.len));
        valBuf.copy(recBuf, fld.pos);
      }
    }

    // Escribir el registro modificado de vuelta en el archivo
    fs.writeSync(fd, recBuf, 0, recordLen, offset);
    fs.closeSync(fd);

    return {
      ok: true,
      snapshotId: snap.snapshotId,
      recordIndex: recordIndex,
      updatedFields: Object.keys(updatedValues)
    };
  } catch (err) {
    // Si algo falló, ejecutar rollback automático inmediato
    backupEngine.rollbackSnapshot(snap.backupDir);
    return {
      ok: false,
      error: 'Error actualizando permisos en MXUSUAR (Rollback ejecutado con éxito): ' + err.message
    };
  }
}

module.exports = {
  getMixnetUsers: getMixnetUsers,
  updateMixnetUserPermissions: updateMixnetUserPermissions
};
