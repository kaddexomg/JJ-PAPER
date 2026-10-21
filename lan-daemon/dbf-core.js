/* ======================================================
   JJ Paper LAN Daemon — Motor Central DBF MixNet
   (dBase III, versión 0x03, compatible Clipper 5.x / Harbour)
   ====================================================== */

import fs from 'node:fs';
import path from 'node:path';

// Lee la cabecera y descriptor de campos de un DBF
export function readDbfStruct(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;
    return {
      path: filePath,
      buf,
      numRecords: buf.readUInt32LE(4),
      headerLen: buf.readUInt16LE(8),
      recordLen: buf.readUInt16LE(10)
    };
  } catch (_) {
    return null;
  }
}

// Extrae la lista de campos con name/type/len/dec/pos
export function readDbfFields(buf, headerLen) {
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
    const name = raw.trim().toLowerCase();
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

// Decodifica un valor de campo DBF a string crudo
function decodeRaw(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s.trim();
}

// Lee filas de un DBF
export function readDbfRows(struct, names, maxLimit = 200000) {
  if (typeof names === 'number') {
    maxLimit = names;
    names = null;
  }
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const want = (names && Array.isArray(names)) ? new Set(names.map(n => n.toLowerCase())) : null;
  const rows = [];
  const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);
  let pos = struct.headerLen;
  while (pos + struct.recordLen <= maxDataEnd && rows.length < maxLimit) {
    const flag = struct.buf[pos];
    if (flag !== 0x2A) { // 0x2A = borrado (*)
      const row = {};
      for (const f of fields) {
        if (want && !want.has(f.name)) continue;
        row[f.name] = decodeRaw(struct.buf, pos + f.pos, f.len);
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }
  return rows;
}

function latin1Pad(str, len, padLeft = false) {
  const buf = Buffer.alloc(len, 0x20, 'latin1');
  const src = Buffer.from(String(str || ''), 'latin1');
  if (padLeft) {
    const off = Math.max(0, len - src.length);
    src.copy(buf, off, 0, Math.min(src.length, len));
  } else {
    src.copy(buf, 0, 0, Math.min(src.length, len));
  }
  return buf;
}

function encodeField(f, val) {
  let str = (val === null || val === undefined) ? '' : String(val);
  switch (f.type) {
    case 'D': {
      str = str.replace(/\D/g, '').slice(0, 8);
      return latin1Pad(str, 8);
    }
    case 'L': {
      str = /^(t|y|true|1)$/i.test(str) ? 'T' : (/^(f|n|false|0)$/i.test(str) ? 'F' : '?');
      return latin1Pad(str, f.len);
    }
    case 'N': {
      const num = parseFloat(str.replace(/[^\d.,\-]/g, '').replace(/,/g, '.')) || 0;
      const dec = f.dec || 0;
      const formatted = dec > 0 ? num.toFixed(dec) : String(Math.round(num));
      return latin1Pad(formatted.padStart(f.len, ' '), f.len);
    }
    default: {
      str = str.replace(/\s+/g, ' ').trim();
      return latin1Pad(str, f.len);
    }
  }
}

// Construye un buffer de registro DBF
export function buildDbfRecord(struct, valuesByField) {
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const record = Buffer.alloc(struct.recordLen, 0x20, 'latin1');
  record[0] = 0x20; // 0x20 = registro activo
  for (const f of fields) {
    const v = valuesByField[f.name];
    if (v === undefined) continue;
    const enc = encodeField(f, v);
    enc.copy(record, f.pos);
  }
  return record;
}

// Obtiene el serial actual desde tablas de control (MXNUMCOT / MXNUMPED)
export function getDbfControlSerial(filePath, fieldName = 'numero') {
  try {
    if (!fs.existsSync(filePath)) return null;
    const struct = readDbfStruct(filePath);
    if (!struct || struct.numRecords < 1) return null;
    const rows = readDbfRows(struct, [fieldName], 1);
    if (rows && rows.length > 0) {
      const raw = String(rows[0][fieldName.toLowerCase()] || '').trim().replace(/^(COT-|PED-)/i, '');
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num > 0) {
        return { num, formatted: String(num).padStart(8, '0').slice(-8) };
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Actualiza el serial en tablas de control (MXNUMCOT / MXNUMPED)
export function setDbfSerial(filePath, nextSerial) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const struct = readDbfStruct(filePath);
    if (!struct || struct.numRecords < 1) return false;
    const fd = fs.openSync(filePath, 'r+');
    try {
      const serialStr = String(nextSerial).padStart(8, '0').slice(-8);
      const buf = Buffer.from(serialStr, 'latin1');
      fs.writeSync(fd, buf, 0, 8, struct.headerLen + 1);
      fs.closeSync(fd);
      return true;
    } catch (e) {
      try { fs.closeSync(fd); } catch (_) {}
      return false;
    }
  } catch (_) {
    return false;
  }
}

// Actualiza o anexa la cabecera en DBF
export async function upsertDbfHeader(filePath, matchField, matchValue, newRecordBuffer, { backupPrefix = null } = {}) {
  const struct = readDbfStruct(filePath);
  if (!struct) return { ok: false, error: `Estructura DBF invalida en ${filePath}` };

  const fields = readDbfFields(struct.buf, struct.headerLen);
  const f = fields.find(x => x.name === matchField.toLowerCase());
  if (!f) return { ok: false, error: `Campo ${matchField} no encontrado` };

  const targetVal = String(matchValue).trim().toLowerCase();
  let foundIndex = -1;
  const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);
  let pos = struct.headerLen;
  let idx = 0;

  while (pos + struct.recordLen <= maxDataEnd && idx < struct.numRecords) {
    const val = decodeRaw(struct.buf, pos + f.pos, f.len).toLowerCase();
    if (val === targetVal) {
      foundIndex = idx;
      break;
    }
    pos += struct.recordLen;
    idx++;
  }

  // Backup opcional
  if (backupPrefix) {
    try {
      fs.mkdirSync(path.dirname(backupPrefix), { recursive: true });
      fs.copyFileSync(filePath, backupPrefix);
    } catch (_) {}
  }

  const fd = fs.openSync(filePath, 'r+');
  try {
    if (foundIndex >= 0) {
      const writePos = struct.headerLen + (foundIndex * struct.recordLen);
      fs.writeSync(fd, newRecordBuffer, 0, newRecordBuffer.length, writePos);
      fs.closeSync(fd);
      return { ok: true, updated: true, index: foundIndex };
    }

    // Anexar al final
    const writePos = struct.headerLen + (struct.numRecords * struct.recordLen);
    const newTotal = struct.numRecords + 1;
    const countBuf = Buffer.alloc(4, 0);
    countBuf.writeUInt32LE(newTotal, 0);
    fs.writeSync(fd, countBuf, 0, 4, 4);
    fs.writeSync(fd, newRecordBuffer, 0, newRecordBuffer.length, writePos);
    // Marcador oficial de fin de archivo dBase III / Clipper (0x1A)
    const eofBuf = Buffer.from([0x1A]);
    fs.writeSync(fd, eofBuf, 0, 1, writePos + newRecordBuffer.length);
    fs.closeSync(fd);
    return { ok: true, appended: true, newTotal };
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return { ok: false, error: e.message };
  }
}

// Reemplaza o anexa renglones de detalle
export async function replaceDbfDetails(detPath, numField, numDoc, newDetailBuffers, { backupPrefix = null } = {}) {
  const struct = readDbfStruct(detPath);
  if (!struct) return { ok: false, error: `Estructura DBF invalida en ${detPath}` };

  const fields = readDbfFields(struct.buf, struct.headerLen);
  const f = fields.find(x => x.name === numField.toLowerCase());
  if (!f) return { ok: false, error: `Campo ${numField} no encontrado` };

  const targetVal = String(numDoc).trim().padStart(8, '0').slice(-8).toLowerCase();
  const existingIndices = [];
  const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);
  let pos = struct.headerLen;
  let idx = 0;

  while (pos + struct.recordLen <= maxDataEnd && idx < struct.numRecords) {
    const val = decodeRaw(struct.buf, pos + f.pos, f.len).padStart(8, '0').slice(-8).toLowerCase();
    if (val === targetVal) existingIndices.push(idx);
    pos += struct.recordLen;
    idx++;
  }

  if (backupPrefix) {
    try {
      fs.mkdirSync(path.dirname(backupPrefix), { recursive: true });
      fs.copyFileSync(detPath, backupPrefix);
    } catch (_) {}
  }

  const fd = fs.openSync(detPath, 'r+');
  try {
    const existingCount = existingIndices.length;
    const newCount = newDetailBuffers.length;
    const minCount = Math.min(existingCount, newCount);

    for (let i = 0; i < minCount; i++) {
      const writePos = struct.headerLen + (existingIndices[i] * struct.recordLen);
      fs.writeSync(fd, newDetailBuffers[i], 0, newDetailBuffers[i].length, writePos);
    }

    if (existingCount > newCount) {
      const delFlag = Buffer.from([0x2A]);
      for (let i = newCount; i < existingCount; i++) {
        const writePos = struct.headerLen + (existingIndices[i] * struct.recordLen);
        fs.writeSync(fd, delFlag, 0, 1, writePos);
      }
    }

    if (newCount > existingCount) {
      const remainder = newDetailBuffers.slice(existingCount);
      const totalBytes = Buffer.concat(remainder);
      const writePos = struct.headerLen + (struct.numRecords * struct.recordLen);
      const newTotalRecords = struct.numRecords + remainder.length;
      const countBuf = Buffer.alloc(4, 0);
      countBuf.writeUInt32LE(newTotalRecords, 0);
      fs.writeSync(fd, countBuf, 0, 4, 4);
      fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);
      // Marcador oficial de fin de archivo dBase III / Clipper (0x1A)
      const eofBuf = Buffer.from([0x1A]);
      fs.writeSync(fd, eofBuf, 0, 1, writePos + totalBytes.length);
    }

    fs.closeSync(fd);
    return { ok: true, updated: minCount, added: Math.max(0, newCount - existingCount) };
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return { ok: false, error: e.message };
  }
}
