import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const s = readDbfStruct(path.join(compDir, 'MXNUMCOT.DBF'));
console.log('MXNUMCOT.DBF:', readDbfRows(s, ['numero'], s.numRecords, false));
