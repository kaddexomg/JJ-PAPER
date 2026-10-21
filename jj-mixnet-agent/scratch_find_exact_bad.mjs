import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

const sEnc = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const encActive = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'comen1', 'nomcli', 'tot_cot'], sEnc.numRecords, false);
const badEnc = encActive.filter(r => r.comen1 && (r.comen1.includes('JJ Paper') || r.comen1.includes('MixNet') || r.comen1.includes('mixnet')));
console.log('Bad Enc records:');
for (const b of badEnc) {
  console.log(JSON.stringify(b));
}

const sRen = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const renActive = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cliente', 'codven'], sRen.numRecords, false);
const badRen = renActive.filter(r => r.item === 'LIBRE' || r.item === 'COTIZACION' || r.item === 'PEDIDO');
console.log('Bad Ren records:');
for (const b of badRen) {
  console.log(JSON.stringify(b));
}
