import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sRenCot = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const allRows = readDbfRows(sRenCot, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren', 'iva'], sRenCot.numRecords, false);

const q96 = allRows.filter(r => r.numcot === '00053496');
console.log('Lines for 00053496:', q96);
