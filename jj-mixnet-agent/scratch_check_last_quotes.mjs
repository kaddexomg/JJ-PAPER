import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const activeRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'nomcli'], 10, true);
console.log('Last 10 active quotes in MXENCCOT:');
for (const r of activeRows) {
  console.log(JSON.stringify(r));
}
