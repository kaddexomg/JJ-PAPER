/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Administrador de Usuarios y Permisos
   ======================================================================
   Gestiona la tabla maestra de usuarios de GemixNet (MXUSUAR.DBF).
   Permite listar usuarios activos, consultar sus roles/permisos y modificar
   permisos de usuarios reales con snapshot preventivo atómico (.BAK) y
   rollback ante cualquier error.
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';
import { createBackup, rollbackBackup } from './client-reconciler.js';
import { log } from './config.js';

function readDbfFields(buf, headerLen) {
  const fields = [];
  let off = 32;
  let pos = 1;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    let raw = '';
    for (let i = 0; i < 11; i++) {
      const c = buf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    const name = raw.trim().toUpperCase();
    if (name.length > 0) {
      const type = String.fromCharCode(buf[off + 11]);
      const len = buf[off + 16] || buf.readUInt16LE(off + 16);
      const dec = buf[off + 17];
      fields.push({ name, type, len, dec, pos });
      pos += len;
    }
    off += 32;
  }
  return fields;
}

function decodeField(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s.trim();
}

/**
 * Lee todos los usuarios registrados en MXUSUAR.DBF
 * @param {string} dbfDir - Directorio comp01 de MixNet
 */
export function getMixnetUsers(dbfDir) {
  let targetFile = path.join(dbfDir, 'MXUSUAR.DBF');
  if (!fs.existsSync(targetFile)) {
    targetFile = path.join(dbfDir, 'mxusuar.dbf');
  }
  if (!fs.existsSync(targetFile)) {
    return { ok: false, error: `No se encontró el archivo MXUSUAR.DBF en ${dbfDir}` };
  }

  const struct = readDbfStruct(targetFile);
  if (!struct) {
    return { ok: false, error: 'Cabecera de MXUSUAR.DBF corrupta o inaccesible' };
  }

  const fields = readDbfFields(struct.buf, struct.headerLen);
  const users = [];
  let pos = struct.headerLen;
  const maxEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);

  let recIndex = 0;
  while (pos + struct.recordLen <= maxEnd) {
    recIndex++;
    const isDeleted = (struct.buf[pos] === 0x2A);
    if (!isDeleted) {
      const u = { _record: recIndex };
      for (const fld of fields) {
        u[fld.name] = decodeField(struct.buf, pos + fld.pos, fld.len);
      }
      users.push(u);
    }
    pos += struct.recordLen;
  }

  log(`[USUARIOS] ${users.length} usuarios activos leídos desde MXUSUAR.DBF (${struct.numRecords} registros).`);

  return {
    ok: true,
    file: targetFile,
    totalRecords: struct.numRecords,
    activeUsersCount: users.length,
    fields: fields.map(f => ({ name: f.name, type: f.type, len: f.len })),
    users
  };
}

/**
 * Modifica campos y permisos de un usuario específico en MXUSUAR.DBF
 * con respaldo preventivo atómico y rollback automático ante cualquier fallo.
 * @param {string} dbfDir - Directorio comp01 de MixNet
 * @param {number} recordIndex - Número de registro en el DBF (1-indexed)
 * @param {object} updatedValues - Mapa de campos y valores { ANULAR: 'S', PRECIO: 'S', NIVEL: '1' }
 */
export function updateMixnetUserPermissions(dbfDir, recordIndex, updatedValues) {
  let targetFile = path.join(dbfDir, 'MXUSUAR.DBF');
  if (!fs.existsSync(targetFile)) {
    targetFile = path.join(dbfDir, 'mxusuar.dbf');
  }
  if (!fs.existsSync(targetFile)) {
    return { ok: false, error: `MXUSUAR.DBF no encontrado en ${dbfDir}` };
  }

  if (!recordIndex || recordIndex < 1 || !updatedValues || typeof updatedValues !== 'object') {
    return { ok: false, error: 'Parámetros inválidos para actualización de permisos (recordIndex y values requeridos).' };
  }

  // 1. Snapshot preventivo antes de tocar el archivo
  const snap = createBackup(dbfDir, `UPDATE_USUAR_REC_${recordIndex}`);
  if (!snap.ok) {
    return { ok: false, error: `Fallo al crear snapshot preventivo: ${snap.error}` };
  }

  let fd = null;
  try {
    fd = fs.openSync(targetFile, 'r+');
    const headerBuf = Buffer.alloc(32);
    fs.readSync(fd, headerBuf, 0, 32, 0);

    const numRecords = headerBuf.readUInt32LE(4);
    const headerLen  = headerBuf.readUInt16LE(8);
    const recordLen  = headerBuf.readUInt16LE(10);

    if (recordIndex < 1 || recordIndex > numRecords) {
      fs.closeSync(fd);
      fd = null;
      rollbackBackup(dbfDir, snap.snapshot);
      return { ok: false, error: `Índice de registro fuera de rango: ${recordIndex} (total: ${numRecords})` };
    }

    const fieldsBuf = Buffer.alloc(headerLen);
    fs.readSync(fd, fieldsBuf, 0, headerLen, 0);
    const fields = readDbfFields(fieldsBuf, headerLen);

    const offset = headerLen + ((recordIndex - 1) * recordLen);
    const recBuf = Buffer.alloc(recordLen);
    fs.readSync(fd, recBuf, 0, recordLen, offset);

    // Verificar si el registro está borrado
    if (recBuf[0] === 0x2A) {
      fs.closeSync(fd);
      fd = null;
      rollbackBackup(dbfDir, snap.snapshot);
      return { ok: false, error: `El registro #${recordIndex} está marcado como borrado (*). No se pueden modificar usuarios inactivos.` };
    }

    // Aplicar las modificaciones campo a campo respetando tipos y longitud exacta
    const appliedFields = [];
    for (const [key, value] of Object.entries(updatedValues)) {
      const normKey = key.toUpperCase().trim();
      const fld = fields.find(f => f.name === normKey);

      if (fld) {
        const strVal = String(value ?? '').trim();
        const valBuf = Buffer.alloc(fld.len, 0x20, 'latin1');
        const inBytes = Buffer.from(strVal, 'latin1');
        inBytes.copy(valBuf, 0, 0, Math.min(inBytes.length, fld.len));
        valBuf.copy(recBuf, fld.pos);
        appliedFields.push({ field: normKey, value: strVal });
      }
    }

    if (appliedFields.length === 0) {
      fs.closeSync(fd);
      fd = null;
      return { ok: false, error: 'Ninguno de los campos proporcionados existe en la estructura de MXUSUAR.DBF.' };
    }

    // Escribir en el DBF y forzar vaciado a disco
    fs.writeSync(fd, recBuf, 0, recordLen, offset);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    log(`[USUARIOS] Permisos actualizados en MXUSUAR.DBF registro #${recordIndex}: ${JSON.stringify(updatedValues)}`);

    return {
      ok: true,
      snapshot: snap.snapshot,
      recordIndex,
      updatedFields: appliedFields
    };
  } catch (err) {
    if (fd) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    // Rollback automático
    rollbackBackup(dbfDir, snap.snapshot);
    log(`[USUARIOS] Error actualizando permisos. Rollback ejecutado: ${err.message}`, 'ERROR');
    return {
      ok: false,
      error: `Error actualizando MXUSUAR (Rollback ejecutado): ${err.message}`
    };
  }
}
