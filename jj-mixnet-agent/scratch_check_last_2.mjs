import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const rows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot'], 10, true);
console.log('Last quotes in MXENCCOT:');
for (const r of rows) {
  console.log(JSON.stringify(r));
}
