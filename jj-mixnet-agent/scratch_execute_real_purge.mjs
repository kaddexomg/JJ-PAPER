import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { reindexNtx } from './ntx-builder.js';

const compDir = 'M:/MIX11/comp01';
console.log('=== INICIANDO SANEAMIENTO QUIRÚRGICO DE DBF ===');

// --- 1. SANEAMIENTO DE MXENCCOT.DBF ---
const encPath = path.join(compDir, 'MXENCCOT.DBF');
const sEnc = readDbfStruct(encPath);
const bufEnc = fs.readFileSync(encPath);

const comenField = sEnc.fields.find(f => f.name === 'comen1');
const cliField = sEnc.fields.find(f => f.name === 'cliente');

// Backup de seguridad
fs.writeFileSync(path.join(compDir, 'backups', `SAFETY_MXENCCOT_PREPURGE_${Date.now()}.DBF`), bufEnc);

// Marcar como borrados RecNo 1803 y 1750 (0-based: 1802 y 1749)
for (const recNo of [1803, 1750]) {
  const p = sEnc.headerLen + (recNo - 1) * sEnc.recordLen;
  bufEnc[p] = 0x2A; // Deleted flag '*'
  console.log(`MXENCCOT: Registro #${recNo} marcado como ELIMINADO (0x2A).`);
}

// Limpiar comentarios con huellas y cliente en 1731, 1733, 1751
for (const recNo of [1731, 1733, 1751]) {
  const p = sEnc.headerLen + (recNo - 1) * sEnc.recordLen;
  if (comenField) {
    // Rellenar comen1 con espacios
    bufEnc.fill(0x20, p + comenField.pos, p + comenField.pos + comenField.len);
  }
  if (cliField) {
    // Escribir 000-001 en cliente
    const cliStr = '000-001'.padEnd(cliField.len, ' ');
    bufEnc.write(cliStr, p + cliField.pos, cliField.len, 'latin1');
  }
  console.log(`MXENCCOT: Registro #${recNo} huella eliminada y cliente actualizado a '000-001'.`);
}

fs.writeFileSync(encPath, bufEnc);
console.log('MXENCCOT.DBF actualizado en disco.');

// --- 2. SANEAMIENTO DE MXRENCOT.DBF ---
const renPath = path.join(compDir, 'MXRENCOT.DBF');
const sRen = readDbfStruct(renPath);
const bufRen = fs.readFileSync(renPath);

const itemField = sRen.fields.find(f => f.name === 'item');
const renCliField = sRen.fields.find(f => f.name === 'cliente');

fs.writeFileSync(path.join(compDir, 'backups', `SAFETY_MXRENCOT_PREPURGE_${Date.now()}.DBF`), bufRen);

// Marcar como borrados renglones basura (14853, 14854, 14832)
for (const recNo of [14853, 14854, 14832]) {
  const p = sRen.headerLen + (recNo - 1) * sRen.recordLen;
  bufRen[p] = 0x2A; // Deleted
  console.log(`MXRENCOT: Renglón #${recNo} marcado como ELIMINADO (0x2A).`);
}

// En 14297 (de 00053425), asignar código real INEL-SBDEL y cliente 000-001
if (itemField && renCliField) {
  const recNo = 14297;
  const p = sRen.headerLen + (recNo - 1) * sRen.recordLen;
  const itemStr = 'INEL-SBDEL'.padEnd(itemField.len, ' ');
  bufRen.write(itemStr, p + itemField.pos, itemField.len, 'latin1');
  
  const cliStr = '000-001'.padEnd(renCliField.len, ' ');
  bufRen.write(cliStr, p + renCliField.pos, renCliField.len, 'latin1');
  console.log(`MXRENCOT: Renglón #${recNo} asignado código oficial 'INEL-SBDEL' y cliente '000-001'.`);
}

// También actualizar cliente en 14296 a '000-001'
if (renCliField) {
  const recNo = 14296;
  const p = sRen.headerLen + (recNo - 1) * sRen.recordLen;
  const cliStr = '000-001'.padEnd(renCliField.len, ' ');
  bufRen.write(cliStr, p + renCliField.pos, renCliField.len, 'latin1');
}

fs.writeFileSync(renPath, bufRen);
console.log('MXRENCOT.DBF actualizado en disco.');

// --- 3. REINDEXACIÓN OFICIAL DE LOS 5 ÍNDICES NTX ---
console.log('Recompilando los 5 índices .NTX de cotizaciones...');
const idx1 = reindexNtx(encPath, path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
const idx2 = reindexNtx(encPath, path.join(compDir, 'MXENCZX2.NTX'), 'DTOS(EMISION)', 8);
const idx3 = reindexNtx(encPath, path.join(compDir, 'MXENCZX3.NTX'), 'CLIENTE', 8);
const idx4 = reindexNtx(renPath, path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
const idx5 = reindexNtx(renPath, path.join(compDir, 'MXRECZX2.NTX'), 'ITEM+NUMCOT', 23);

console.log('Índices NTX recompilados con éxito.');
