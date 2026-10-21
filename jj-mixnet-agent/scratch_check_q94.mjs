import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const ren = readDbfRows(sRen, null, 100, true);
const r94 = ren.filter(r => r.numcot === '00053494');
console.log('Renglones for 00053494 (' + r94.length + '):');
for (const r of r94) {
  console.log(JSON.stringify(r));
}
