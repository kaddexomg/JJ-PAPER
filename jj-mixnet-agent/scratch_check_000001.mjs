import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const encPath = path.join(compDir, 'MXENCCOT.DBF');
const sEnc = readDbfStruct(encPath);
const allRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'nomcli', 'cif', 'tot_cot'], sEnc.numRecords, false);

const c000001 = allRows.filter(r => r.cliente === '000-001');
console.log(`Quotes with cliente == '000-001': ${c000001.length}`);
for (const r of c000001.slice(0, 10)) {
  console.log(JSON.stringify(r));
}
