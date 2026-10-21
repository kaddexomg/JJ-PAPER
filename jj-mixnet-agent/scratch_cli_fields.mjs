import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sCli = readDbfStruct(path.join(compDir, 'MXCTACLI.DBF'));
console.log('MXCTACLI fields:');
for (const f of sCli.fields) {
  console.log(`- ${f.name} (${f.type}, len: ${f.len})`);
}
