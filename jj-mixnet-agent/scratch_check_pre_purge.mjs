import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bakEnc = path.join(compDir, 'MXENCCOT.DBF.PRE_PURGE_1792423887236.BAK');
const sEnc = readDbfStruct(bakEnc);
console.log(`Backing up Enc numRecords: ${sEnc.numRecords}`);
const lastEnc = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot', 'comen1'], 10, true);
console.log('Last quotes in PRE_PURGE bak:');
for (const r of lastEnc) {
  console.log(JSON.stringify(r));
}

const bakRen = path.join(compDir, 'MXRENCOT.DBF.PRE_PURGE_1792423887459.BAK');
const sRen = readDbfStruct(bakRen);
console.log(`\nBacking up Ren numRecords: ${sRen.numRecords}`);
const lastRen = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren', 'iva', 'codven'], 15, true);
console.log('Last ren in PRE_PURGE bak:');
for (const r of lastRen) {
  console.log(JSON.stringify(r));
}
