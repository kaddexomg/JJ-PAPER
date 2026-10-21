import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));
const invRows = readDbfRows(sInv, ['codigo', 'descrip', 'unidad'], sInv.numRecords, false);
const silicon = invRows.filter(r => r.descrip && r.descrip.toLowerCase().includes('silicon'));
console.log('Silicon products in catalog:');
for (const s of silicon) {
  console.log(JSON.stringify(s));
}
