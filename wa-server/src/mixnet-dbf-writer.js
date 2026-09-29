/* ======================================================
   mixnet-dbf-writer.js — Escritura nativa DBF compatible
   con MixNet (dBase III, versión 0x03, sin memo).
   ------------------------------------------------------
   Permite a JJ Paper escribir cotizaciones y pedidos
   directamente en las tablas reales de MixNet:
     - MXENCCOT / MXRENCOT  (cotizaciones + renglones)
     - MXENCPED / MXRENPED  (pedidos + renglones)
     - MXCTACLI             (clientes)
   Respetando los seriales correlativos (NUMCOT/NUMPED)
   y los códigos de cliente (CODCLI) de MixNet.
   ====================================================== */

import fs from 'node:fs';
import path from 'node:path';

// Lee la cabecera y descriptor de campos de un DBF.
export function readDbfStruct(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 33) return null;
  return {
    path: filePath,
    buf,
    numRecords: buf.readUInt32LE(4),
    headerLen: buf.readUInt16LE(8),
    recordLen: buf.readUInt16LE(10)
  };
}

// Extrae la lista de campos con name/type/len/dec/pos (pos = offset dentro del registro).
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

// Decodifica un valor de campo DBF a string crudo (tipo actual de MixNet: no numérico nativo).
function decodeRaw(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s.trim();
}

// Lee maxLimit filas (solo campos indicados si se provee names[]).
export function readDbfRows(struct, names, maxLimit = 400000) {
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
    if (flag !== 0x2A && flag === 0x20) {
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

// Codifica un valor según el tipo de campo DBF (siempre latin1/CP1252, ancho fijo).
function latin1Pad(str, len) {
  const b = Buffer.from(String(str), 'latin1');
  if (b.length >= len) return b.subarray(0, len);
  const out = Buffer.alloc(len, 0x20, 'latin1');
  b.copy(out, 0);
  return out;
}

function encodeField(f, value) {
  let str = value === null || value === undefined ? '' : String(value).trim();
  switch (f.type) {
    case 'D': // fecha YYYYMMDD
      str = str.replace(/[-/.]/g, '');
      if (!/^\d{8}$/.test(str)) str = '';
      return latin1Pad(str, f.len);
    case 'L': // lógico
      str = /^(t|y|true|1)$/i.test(str) ? 'T' : (/^(f|n|false|0)$/i.test(str) ? 'F' : '?');
      return latin1Pad(str, f.len);
    case 'N': { // numérico: a la derecha, espacios a la izquierda
      const num = parseFloat(str.replace(/[^\d.,\-]/g, '').replace(/,/g, '.')) || 0;
      const dec = f.dec || 0;
      const formatted = dec > 0 ? num.toFixed(dec) : String(Math.round(num));
      if (formatted.length > f.len) {
        return latin1Pad('*'.repeat(f.len), f.len);
      }
      return latin1Pad(formatted.padStart(f.len, ' '), f.len);
    }
    default: { // C (caracter) y resto
      str = str.replace(/\s+/g, ' ').trim();
      return latin1Pad(str, f.len);
    }
  }
}

// Construye el buffer de un registro (flag activo + campos codificados).
export function buildDbfRecord(struct, valuesByField) {
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const record = Buffer.alloc(struct.recordLen, 0x20, 'latin1');
  record[0] = 0x20; // registro activo (no borrado)
  for (const f of fields) {
    const v = valuesByField[f.name];
    if (v === undefined) continue;
    const enc = encodeField(f, v);
    enc.copy(record, f.pos);
  }
  return record;
}

// Verifica que el archivo de destino existe y es una tabla dBase.
function ensureWritable(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, error: `No existe ${filePath}` };
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Append atómico de registros: actualiza contador en cabecera y añade buffers al final.
export async function appendDbfRecords(filePath, records, { backupPrefix = null } = {}) {
  const chk = ensureWritable(filePath);
  if (!chk.ok) return { ok: false, error: chk.error };

  const struct = readDbfStruct(filePath);
  if (!struct) return { ok: false, error: `Estructura DBF inválida en ${filePath}` };

  // Backup previo opcional (por defecto a backups/ junto al archivo)
  let backupPath = null;
  if (backupPrefix) {
    const dir = path.dirname(filePath);
    backupPath = backupPrefix.startsWith(dir) ? backupPrefix : path.join(dir, backupPrefix);
  }

  const fd = fs.openSync(filePath, 'r+');
  try {
    // Posición de escritura = headerLen + numRecords*recordLen
    const writePos = struct.headerLen + struct.numRecords * struct.recordLen;
    const totalBytes = Buffer.concat(records);
    const fileLen = fs.fstatSync(fd).size;

    // Si el archivo tiene marcador EOF (0x1A) al final, se sobrescribe
    const hasEOF = fileLen > writePos && totalBytes[totalBytes.length - 1] !== 0x1A;

    if (backupPath) {
      const data = fs.readFileSync(filePath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, data);
    }

    // 1. Escribir/actualizar contador de registros en cabecera (offset 4)
    const newCount = struct.numRecords + records.length;
    const countBuf = Buffer.alloc(4, 0);
    countBuf.writeUInt32LE(newCount, 0);
    fs.writeSync(fd, countBuf, 0, 4, 4);

    // 2. Escribir registros al final
    fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);

    fs.closeSync(fd);
    return { ok: true, added: records.length, newCount, backupPath };
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return { ok: false, error: e.message };
  }
}

// Obtiene el siguiente serial correlativo para un campo numérico de 8 dígitos.
export function getNextSerial(filePath, fieldName) {
  const struct = readDbfStruct(filePath);
  if (!struct) return { ok: false, error: 'Estructura DBF inválida' };
  let max = 0;
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const f = fields.find(x => x.name === fieldName.toLowerCase());
  if (!f) return { ok: false, error: `Campo ${fieldName} no existe` };
  const names = new Set([f.name]);
  const rows = readDbfRows(struct, [f.name], 500000);
  for (const r of rows) {
    const v = parseInt(r[f.name] || '0', 10);
    if (!isNaN(v) && v > max) max = v;
  }
  const next = max + 1;
  return { ok: true, current: max, next, nextFormatted: String(next).padStart(f.len, '0').slice(-f.len) };
}

// Obtiene el número correlativo actual desde tablas de control de 1 registro (MXNUMPED / MXNUMCOT)
export function getDbfControlSerial(filePath, fieldName = 'numero') {
  try {
    if (!fs.existsSync(filePath)) return null;
    const struct = readDbfStruct(filePath);
    if (!struct || struct.numRecords < 1) return null;
    const rows = readDbfRows(struct, [fieldName], 1);
    if (rows && rows.length > 0) {
      const raw = String(rows[0][fieldName.toLowerCase()] || '').trim();
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

// Actualiza el número correlativo en tablas de control de 1 registro (MXNUMPED / MXNUMCOT)
export function setDbfSerial(filePath, nextSerial) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const struct = readDbfStruct(filePath);
    if (!struct || struct.numRecords < 1) return false;
    const fd = fs.openSync(filePath, 'r+');
    try {
      const serialStr = String(nextSerial).padStart(8, '0').slice(-8);
      const buf = Buffer.from(serialStr, 'latin1');
      // Primer registro comienza en headerLen + 1 (después del byte flag 0x20)
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

// Busca un cliente en MXCTACLI por CIF, nombre o teléfono. Devuelve la fila codcli.
export function findCliente(mxctacliPath, { cif = '', phone = '', name = '' }) {
  const struct = readDbfStruct(mxctacliPath);
  if (!struct) return null;
  const cleanCif = cif.toUpperCase().replace(/[\s.-]/g, '');
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const cmpName = name.toUpperCase().replace(/\s+/g, ' ').trim();
  const rows = readDbfRows(struct, ['codcli', 'nomcli', 'cif', 'nit', 'tlf1', 'tlf2'], 400000);
  for (const r of rows) {
    if (cleanCif && cleanCif.length >= 5 && (r.cif.toUpperCase().replace(/[\s.-]/g, '') === cleanCif)) return r;
  }
  if (cleanPhone && cleanPhone.length >= 7) {
    for (const r of rows) {
      if (r.tlf1 && (r.tlf1.replace(/[^0-9]/g, '').slice(-7) === cleanPhone.slice(-7))) return r;
      if (r.tlf2 && (r.tlf2.replace(/[^0-9]/g, '').slice(-7) === cleanPhone.slice(-7))) return r;
    }
  }
  if (cmpName && cmpName.length >= 4) {
    for (const r of rows) {
      if (r.nomcli.toUpperCase().replace(/\s+/g, ' ').trim() === cmpName) return r;
    }
  }
  return null;
}

// Genera un CODCLI nuevo del prefijo de vendedor (ej. 008-###) usando la mayor secuencia existente.
export function getNextClienteCode(mxctacliPath, prefix) {
  const struct = readDbfStruct(mxctacliPath);
  if (!struct) return { ok: false, error: 'Estructura DBF inválida' };
  const rows = readDbfRows(struct, ['codcli'], 400000);
  let max = 0;
  const p = String(prefix || '').trim().padStart(3, '0');
  for (const r of rows) {
    const m = r.codcli.match(/^(\d{3})-(\d+)$/);
    if (m && m[1] === p) {
      const n = parseInt(m[2], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const code = `${p}-${String(next).padStart(3, '0')}`;
  return { ok: true, code, next };
}

// Alta / actualización de cliente en MXCTACLI.DBF (sin tocar campos sensibles si ya existe).
export async function upsertCliente(mxctacliPath, { cif = '', phone = '', name = '', email = '', direccion = '', vendedor = '' }, dbfDir) {
  const existing = findCliente(mxctacliPath, { cif, phone, name });
  if (existing) {
    return { ok: true, codcli: existing.codcli, created: false };
  }
  const prefix = String(vendedor || '').trim() || '000';
  const codeRes = getNextClienteCode(mxctacliPath, prefix);
  if (!codeRes.ok) return codeRes;

  // Construir campos del registro nuevo de cliente
  const struct = readDbfStruct(mxctacliPath);
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const now = today;
  const hhmmss = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  const dirLines = String(direccion || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const valuesByField = {
    codcli: codeRes.code,
    nomcli: name || 'CLIENTE NUEVO',
    cif: cif || null,
    nit: cif || null,
    direc1: dirLines[0] || null,
    direc2: dirLines[1] || null,
    direc3: dirLines[2] || null,
    direc4: dirLines.slice(3).join(' ') || null,
    tlf1: phone || null,
    fax: null,
    estatus: '01',
    vendedor: String(vendedor || '').trim(),
    telefono: null,
    fechaing: ymd,
    email: email || null,
    fecha_mod: ymd,
    hora_mod: hhmmss,
    activo: 'T'
  };

  const record = buildDbfRecord(struct, valuesByField);
  const res = await appendDbfRecords(mxctacliPath, [record], { backupPrefix: `backup_${path.basename(mxctacliPath)}` });
  if (!res.ok) return res;
  return { ok: true, codcli: codeRes.code, created: true, added: res.added };
}

// Actualiza un registro existente por campo de búsqueda o lo anexa si no existe.
export async function upsertDbfHeader(filePath, matchField, matchValue, newRecordBuffer, { backupPrefix = null } = {}) {
  const chk = ensureWritable(filePath);
  if (!chk.ok) return { ok: false, error: chk.error };

  const struct = readDbfStruct(filePath);
  if (!struct) return { ok: false, error: `Estructura DBF inválida en ${filePath}` };

  const fields = readDbfFields(struct.buf, struct.headerLen);
  const f = fields.find(x => x.name === matchField.toLowerCase());
  if (!f) return { ok: false, error: `Campo ${matchField} no encontrado en ${filePath}` };

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

  // Si existe, sobrescribir en su posición exacta
  if (foundIndex >= 0) {
    const fd = fs.openSync(filePath, 'r+');
    try {
      const writePos = struct.headerLen + (foundIndex * struct.recordLen);
      fs.writeSync(fd, newRecordBuffer, 0, newRecordBuffer.length, writePos);
      fs.closeSync(fd);
      return { ok: true, updated: true, index: foundIndex };
    } catch (e) {
      try { fs.closeSync(fd); } catch (_) {}
      return { ok: false, error: e.message };
    }
  }

  // Si no existe, anexo normal
  return await appendDbfRecords(filePath, [newRecordBuffer], { backupPrefix });
}

// Reemplaza o sincroniza los renglones de detalle (MXRENPED / MXRENCOT) para un documento
export async function replaceDbfDetails(detPath, numField, numDoc, newDetailBuffers, { backupPrefix = null } = {}) {
  const chk = ensureWritable(detPath);
  if (!chk.ok) return { ok: false, error: chk.error };

  const struct = readDbfStruct(detPath);
  if (!struct) return { ok: false, error: `Estructura DBF inválida en ${detPath}` };

  const fields = readDbfFields(struct.buf, struct.headerLen);
  const f = fields.find(x => x.name === numField.toLowerCase());
  if (!f) return { ok: false, error: `Campo ${numField} no encontrado en ${detPath}` };

  const targetVal = String(numDoc).trim().padStart(8, '0').slice(-8).toLowerCase();
  const existingIndices = [];
  const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);
  let pos = struct.headerLen;
  let idx = 0;

  while (pos + struct.recordLen <= maxDataEnd && idx < struct.numRecords) {
    const val = decodeRaw(struct.buf, pos + f.pos, f.len).padStart(8, '0').slice(-8).toLowerCase();
    if (val === targetVal) {
      existingIndices.push(idx);
    }
    pos += struct.recordLen;
    idx++;
  }

  const fd = fs.openSync(detPath, 'r+');
  try {
    const existingCount = existingIndices.length;
    const newCount = newDetailBuffers.length;

    // 1. Reemplazar slots existentes
    const minCount = Math.min(existingCount, newCount);
    for (let i = 0; i < minCount; i++) {
      const writePos = struct.headerLen + (existingIndices[i] * struct.recordLen);
      fs.writeSync(fd, newDetailBuffers[i], 0, newDetailBuffers[i].length, writePos);
    }

    // 2. Si habían más registros antes que ahora, marcar los sobrantes como borrados (0x2A '*')
    if (existingCount > newCount) {
      const delFlag = Buffer.from([0x2A]);
      for (let i = newCount; i < existingCount; i++) {
        const writePos = struct.headerLen + (existingIndices[i] * struct.recordLen);
        fs.writeSync(fd, delFlag, 0, 1, writePos);
      }
    }

    // 3. Si hay más registros nuevos que los que existían, anexar los sobrantes al final
    if (newCount > existingCount) {
      const remainder = newDetailBuffers.slice(existingCount);
      const totalBytes = Buffer.concat(remainder);
      const writePos = struct.headerLen + (struct.numRecords * struct.recordLen);

      // Actualizar total de registros en cabecera (offset 4)
      const newTotalRecords = struct.numRecords + remainder.length;
      const countBuf = Buffer.alloc(4, 0);
      countBuf.writeUInt32LE(newTotalRecords, 0);
      fs.writeSync(fd, countBuf, 0, 4, 4);

      // Escribir nuevos registros al final
      fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);
    }

    fs.closeSync(fd);
    return { ok: true, existingReused: minCount, deletedExcess: Math.max(0, existingCount - newCount), appended: Math.max(0, newCount - existingCount) };
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return { ok: false, error: e.message };
  }
}