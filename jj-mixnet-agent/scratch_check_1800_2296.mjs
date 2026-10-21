import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bEnc = path.join(compDir, 'MXENCCOT.DBF.20261019_1030.BAK');
const sEnc = readDbfStruct(bEnc);
const rows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot', 'comen1'], sEnc.numRecords, false);

console.log(`Total rows in 1030 backup: ${rows.length}`);
console.log('Sample rows around 1800-1820:');
for (let i = 1800; i < Math.min(1820, rows.length); i++) {
  console.log(`Rec ${i+1}: ${JSON.stringify(rows[i])}`);
}

console.log('\nDates and quote numbers in records 1800 to 2296:');
const slice = rows.slice(1800);
const dates = new Set(slice.map(r => r.emision));
console.log('Unique emission dates:', Array.from(dates));
console.log(`Min quote: ${slice[0]?.numcot}, Max quote: ${slice[slice.length - 1]?.numcot}`);
