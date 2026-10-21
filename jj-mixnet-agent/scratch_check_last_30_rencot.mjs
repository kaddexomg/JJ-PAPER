import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sRenCot = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const rows = readDbfRows(sRenCot, ['numcot', 'item', 'descrip', 'cantidad', 'despacho', 'bulto', 'iva', 'oferta'], 30, true);
console.log('Last 30 rows in MXRENCOT:');
for (const r of rows) {
  console.log(JSON.stringify(r));
}
