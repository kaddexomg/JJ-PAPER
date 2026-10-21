import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const encRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'nomcli', 'tot_cot'], sEnc.numRecords, false);

const found = encRows.filter(r => ['00053425', '00053442', '00053495'].includes(r.numcot));
for (const f of found) {
  console.log(JSON.stringify(f));
}
