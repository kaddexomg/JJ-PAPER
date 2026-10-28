/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Consulta de Usuarios (Solo Lectura)
   ======================================================================
   REGLA DE ORO DE MIXNET:
   Cero modificaciones en MXUSUAR.DBF, cero modificaciones a permisos,
   cero alteración de código fuente Clipper / PRG.
   MixNet es el dueño soberano de sus usuarios y permisos nativos.
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';
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
 * Lee todos los usuarios registrados en MXUSUAR.DBF (Solo Lectura)
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
 * Modificación de usuarios y permisos BLOQUEADA por protocolo de soberanía.
 */
export function updateMixnetUserPermissions(dbfDir, recordIndex, updatedValues) {
  log(`[GUARDRAIL MIXNET] Modificación de MXUSUAR.DBF rechazada: operación prohibida por seguridad ERP.`, 'WARN');
  return {
    ok: false,
    blocked: true,
    message: 'Operación no permitida: Los usuarios y permisos de MixNet se gestionan exclusivamente dentro del menú de MixNet en Clipper. Cero alteraciones externas a MXUSUAR.DBF.'
  };
}
