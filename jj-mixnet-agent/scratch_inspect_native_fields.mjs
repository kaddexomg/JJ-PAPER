import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));

// Read all fields for 1804 and 1805 (native quotes from today)
const enc1804 = readDbfRows(sEnc, null, 5, true);
console.log('=== NATIVE MXENCCOT ROWS (all fields) ===');
for (const r of enc1804) {
  if (['00053495', '00053496'].includes(r.numcot)) {
    console.log(`\n--- Quote ${r.numcot} ---`);
    for (const [k, v] of Object.entries(r)) {
      if (v !== '' && k !== '_recNo') {
        console.log(`  ${k}: '${v}'`);
      }
    }
  }
}

console.log('\n=== NATIVE MXRENCOT ROWS (all fields) ===');
const renRows = readDbfRows(sRen, null, 20, true);
for (const r of renRows) {
  if (['00053495', '00053496'].includes(r.numcot)) {
    console.log(`\n--- Ren ${r.numcot} Item: ${r.item} ---`);
    for (const [k, v] of Object.entries(r)) {
      if (v !== '' && k !== '_recNo') {
        console.log(`  ${k}: '${v}'`);
      }
    }
  }
}
