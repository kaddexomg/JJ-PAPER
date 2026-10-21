import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));
console.log('MXCTAINV numRecords:', sInv.numRecords);
const rows = readDbfRows(sInv, ['codigo', 'descrip'], 10, false);
for (const r of rows) {
  console.log(JSON.stringify(r));
}
