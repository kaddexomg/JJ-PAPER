import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));
const invRows = readDbfRows(sInv, ['codart', 'nomart', 'unidad', 'iva'], sInv.numRecords, false);

const hits = invRows.filter(r => r.nomart && (r.nomart.toLowerCase().includes('silicon') || r.nomart.toLowerCase().includes('pega')));
console.log('Silicon or pega in MXCTAINV: ' + hits.length);
for (const h of hits) {
  console.log(JSON.stringify(h));
}
