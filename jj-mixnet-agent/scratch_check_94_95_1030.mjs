import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bRen = path.join(compDir, 'MXRENCOT.DBF.20261019_1030.BAK');
const sRen = readDbfStruct(bRen);
const allRows = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'despacho', 'precio', 'tot_ren', 'iva', 'codven', 'cliente'], sRen.numRecords, false);

const q95 = allRows.filter(r => r.numcot === '00053495');
console.log('00053495 rows in 1030 backup:');
console.log(q95);

const q94 = allRows.filter(r => r.numcot === '00053494');
console.log('00053494 rows in 1030 backup:');
console.log(q94);
