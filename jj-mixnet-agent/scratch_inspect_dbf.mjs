import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

// 1. List all DBF files
const files = fs.readdirSync(compDir).filter(f => f.toUpperCase().endsWith('.DBF'));
console.log('Total DBFs:', files.length);

// Check files related to items / products
const itemFiles = files.filter(f => f.includes('ART') || f.includes('INV') || f.includes('PROD') || f.includes('REN') || f.includes('COT') || f.includes('PED'));
console.log('Relevant DBFs:', itemFiles);

// Check structures of MXENCCOT, MXRENCOT, MXENCPED, MXRENPED
for (const f of ['MXENCCOT.DBF', 'MXRENCOT.DBF']) {
  const p = path.join(compDir, f);
  const s = readDbfStruct(p);
  console.log(`\n=== STRUCTURE OF ${f} (numRecords: ${s.numRecords}) ===`);
  for (const fld of s.fields) {
    console.log(`- ${fld.name} (${fld.type}, len: ${fld.len}, dec: ${fld.dec})`);
  }
}

// 2. Read native rows from MXENCCOT where cliente is '000-001' or inspect last 10 native rows
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));

const encRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'comen2', 'nomcli', 'cif', 'tot_cot'], 20, true);
console.log('\n=== LAST 20 ROWS IN MXENCCOT ===');
for (const r of encRows) {
  console.log(JSON.stringify(r));
}

// 3. Read rows from MXRENCOT
const renRows = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren', 'iva', 'unidad', 'cliente', 'codven'], 25, true);
console.log('\n=== LAST 25 ROWS IN MXRENCOT ===');
for (const r of renRows) {
  console.log(JSON.stringify(r));
}
