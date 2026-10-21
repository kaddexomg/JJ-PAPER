import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));
console.log('Fields of MXCTAINV:');
for (const f of sInv.fields) {
  console.log(`- ${f.name} (${f.type}, len: ${f.len})`);
}
