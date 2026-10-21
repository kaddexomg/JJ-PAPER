import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const row = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'nomcli', 'tot_cot'], 10, true);
for (const r of row) {
  if (['00053497', '00053496', '00053495', '00053494'].includes(r.numcot)) {
    console.log(JSON.stringify(r));
  }
}
