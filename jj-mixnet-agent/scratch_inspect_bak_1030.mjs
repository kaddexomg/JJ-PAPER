import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bEnc = path.join(compDir, 'MXENCCOT.DBF.20261019_1030.BAK');
const bRen = path.join(compDir, 'MXRENCOT.DBF.20261019_1030.BAK');

const sEnc = readDbfStruct(bEnc);
console.log(`bEnc total: ${sEnc.numRecords}`);
const lastEnc = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot', 'comen1'], 20, true);
console.log('Last 20 in 1030 bEnc:');
for (const r of lastEnc) {
  console.log(JSON.stringify(r));
}

const sRen = readDbfStruct(bRen);
console.log(`\nbRen total: ${sRen.numRecords}`);
const lastRen = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren', 'iva', 'codven'], 20, true);
console.log('Last 20 in 1030 bRen:');
for (const r of lastRen) {
  console.log(JSON.stringify(r));
}
