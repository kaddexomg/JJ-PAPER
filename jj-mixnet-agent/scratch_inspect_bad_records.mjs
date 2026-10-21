import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

// Check MXENCCOT
const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const encRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'nomcli'], sEnc.numRecords, false);
const badEnc = encRows.filter(r => r.comen1 && (r.comen1.toLowerCase().includes('jj paper') || r.comen1.toLowerCase().includes('web')));
console.log(`Bad headers in MXENCCOT: ${badEnc.length}`);
for (const b of badEnc) {
  console.log(JSON.stringify(b));
}

// Check MXRENCOT
const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const renRows = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cliente', 'codven'], sRen.numRecords, false);
const badRen = renRows.filter(r => r.item === 'LIBRE' || (r.descrip && r.descrip.toLowerCase().includes('jj paper')));
console.log(`Bad details in MXRENCOT: ${badRen.length}`);
for (const b of badRen) {
  console.log(JSON.stringify(b));
}

// Check MXENCPED
const sEncPed = readDbfStruct(path.join(compDir, 'MXENCPED.DBF'));
if (sEncPed) {
  const encPedRows = readDbfRows(sEncPed, ['numped', 'emision', 'cliente', 'codven', 'comen1', 'nomcli'], sEncPed.numRecords, false);
  const badPed = encPedRows.filter(r => r.comen1 && (r.comen1.toLowerCase().includes('jj paper') || r.comen1.toLowerCase().includes('web')));
  console.log(`Bad headers in MXENCPED: ${badPed.length}`);
  for (const b of badPed) {
    console.log(JSON.stringify(b));
  }
}

// Check MXRENPED
const sRenPed = readDbfStruct(path.join(compDir, 'MXRENPED.DBF'));
if (sRenPed) {
  const renPedRows = readDbfRows(sRenPed, ['numped', 'item', 'descrip', 'cliente', 'codven'], sRenPed.numRecords, false);
  const badRenPed = renPedRows.filter(r => r.item === 'LIBRE' || (r.descrip && r.descrip.toLowerCase().includes('jj paper')));
  console.log(`Bad details in MXRENPED: ${badRenPed.length}`);
  for (const b of badRenPed) {
    console.log(JSON.stringify(b));
  }
}
