import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';
import { reindexNtx } from './ntx-builder.js';

const compDir = 'M:/MIX11/comp01';

// 1. Marcar registro 1807 vacío como eliminado en MXENCCOT.DBF
const encPath = path.join(compDir, 'MXENCCOT.DBF');
const sEnc = readDbfStruct(encPath);
const bufEnc = fs.readFileSync(encPath);
const pEnc = sEnc.headerLen + (1807 - 1) * sEnc.recordLen;
bufEnc[pEnc] = 0x2A;
fs.writeFileSync(encPath, bufEnc);
console.log('MXENCCOT: Registro 1807 vacío marcado como 0x2A.');

// 2. Marcar registro 14876 vacío como eliminado en MXRENCOT.DBF
const renPath = path.join(compDir, 'MXRENCOT.DBF');
const sRen = readDbfStruct(renPath);
const bufRen = fs.readFileSync(renPath);
const pRen = sRen.headerLen + (14876 - 1) * sRen.recordLen;
bufRen[pRen] = 0x2A;
fs.writeFileSync(renPath, bufRen);
console.log('MXRENCOT: Registro 14876 vacío marcado como 0x2A.');

// 3. Ajustar MXNUMCOT.DBF al último serial legítimo: 53497
const numPath = path.join(compDir, 'MXNUMCOT.DBF');
const sNum = readDbfStruct(numPath);
const bufNum = fs.readFileSync(numPath);
const numField = sNum.fields.find(f => f.name === 'numero');
if (numField) {
  const pNum = sNum.headerLen + 0 * sNum.recordLen;
  const strVal = '53497'.padStart(numField.len, ' ');
  bufNum.write(strVal, pNum + numField.pos, numField.len, 'latin1');
  fs.writeFileSync(numPath, bufNum);
  console.log(`MXNUMCOT ajustado a serial '53497' (próximo será 00053498).`);
}

// 4. Reindexar
console.log('Recompilando índices NTX...');
reindexNtx(encPath, path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
reindexNtx(encPath, path.join(compDir, 'MXENCZX2.NTX'), 'DTOS(EMISION)', 8);
reindexNtx(encPath, path.join(compDir, 'MXENCZX3.NTX'), 'CLIENTE', 8);
reindexNtx(renPath, path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
reindexNtx(renPath, path.join(compDir, 'MXRECZX2.NTX'), 'ITEM+NUMCOT', 23);
console.log('Reindexación completada.');
