import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bEnc = path.join(compDir, 'MXENCCOT.DBF.20261019_1030.BAK');
const sEnc = readDbfStruct(bEnc);
const rows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot', 'comen1', 'comen2'], 35, true);

console.log('Last 35 records in 1030 backup:');
for (const r of rows) {
  console.log(`Rec ${r._recNo}: cot=${r.numcot} date=${r.emision} cli=${r.cliente} ven=${r.codven} tot=${r.tot_cot} nom=${r.nomcli} com1=${r.comen1} com2=${r.comen2}`);
}
