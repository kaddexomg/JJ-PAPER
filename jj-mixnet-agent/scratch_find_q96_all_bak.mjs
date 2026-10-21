import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const files = fs.readdirSync(compDir).filter(f => f.includes('RENCOT'));
for (const f of files) {
  try {
    const s = readDbfStruct(path.join(compDir, f));
    if (!s) continue;
    const found = readDbfRows(s, ['numcot', 'item', 'descrip', 'cantidad', 'precio'], s.numRecords, false).filter(r => r.numcot === '00053496');
    console.log(`File ${f} (${s.numRecords} recs) has ${found.length} rows for 00053496`);
    if (found.length > 0) {
      console.log(found);
    }
  } catch (e) {
    console.log(`File ${f} error: ${e.message}`);
  }
}
