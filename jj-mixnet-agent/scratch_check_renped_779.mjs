import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const renPath = path.join(compDir, 'MXRENPED.DBF');
const s = readDbfStruct(renPath);
const allRows = readDbfRows(s, ['numped', 'item', 'descrip'], s.numRecords, false);

const found779 = allRows.filter(r => r.numped === '00112779');
console.log('Lines with 00112779 in MXRENPED:', found779);

const blankLines = allRows.filter(r => !r.numped.trim());
console.log('Blank lines in MXRENPED:', blankLines);
