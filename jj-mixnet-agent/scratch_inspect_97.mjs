import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));

const enc = readDbfRows(sEnc, null, 10, true);
for (const r of enc) {
  if (r.numcot === '00053497') {
    console.log(`\n--- Quote 00053497 ---`);
    for (const [k, v] of Object.entries(r)) {
      if (v !== '' && k !== '_recNo') {
        console.log(`  ${k}: '${v}'`);
      }
    }
  }
}

const ren = readDbfRows(sRen, null, 20, true);
for (const r of ren) {
  if (r.numcot === '00053497') {
    console.log(`\n--- Ren 00053497 Item: ${r.item} ---`);
    for (const [k, v] of Object.entries(r)) {
      if (v !== '' && k !== '_recNo') {
        console.log(`  ${k}: '${v}'`);
      }
    }
  }
}
