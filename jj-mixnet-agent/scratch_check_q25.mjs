import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const renRows = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], sRen.numRecords, false);
const r25 = renRows.filter(r => r.numcot === '00053425');
console.log('Renglones for 00053425:');
for (const r of r25) {
  console.log(JSON.stringify(r));
}
