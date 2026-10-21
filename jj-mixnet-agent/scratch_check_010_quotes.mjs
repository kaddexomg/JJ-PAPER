import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const allRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot'], sEnc.numRecords, false);

const kRows = allRows.filter(r => r.codven === '010');
console.log(`Quotes in MXENCCOT with codven = '010' (${kRows.length}):`);
for (const r of kRows) {
  console.log(JSON.stringify(r));
}
