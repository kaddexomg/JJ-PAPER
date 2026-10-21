import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));
const invRows = readDbfRows(sInv, ['codigo', 'descrip', 'unidad'], sInv.numRecords, false);
const hits = invRows.filter(r => r.descrip && (r.descrip.toLowerCase().includes('barra') || r.descrip.toLowerCase().includes('pega')));
console.log('Hits for barra/pega in catalog:');
for (const h of hits) {
  console.log(JSON.stringify(h));
}
