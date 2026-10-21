import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

console.log('=== MXNUMPED.DBF ===');
const sNum = readDbfStruct(path.join(compDir, 'MXNUMPED.DBF'));
console.log(readDbfRows(sNum, sNum.fields.map(f => f.name), sNum.numRecords, false));

console.log('=== MXENCPED.DBF ===');
const sEnc = readDbfStruct(path.join(compDir, 'MXENCPED.DBF'));
console.log(`numRecords: ${sEnc.numRecords}`);
const rowsEnc = readDbfRows(sEnc, ['numped', 'emision', 'cliente', 'codven', 'nomcli', 'tot_ped', 'comen1', 'comen2'], 10, true);
for (const r of rowsEnc) {
  console.log(JSON.stringify(r));
}

console.log('=== MXRENPED.DBF ===');
const sRen = readDbfStruct(path.join(compDir, 'MXRENPED.DBF'));
console.log(`numRecords: ${sRen.numRecords}`);
const rowsRen = readDbfRows(sRen, ['numped', 'item', 'descrip', 'cantidad', 'despacho', 'precio', 'tot_ren', 'iva', 'codven'], 10, true);
for (const r of rowsRen) {
  console.log(JSON.stringify(r));
}
