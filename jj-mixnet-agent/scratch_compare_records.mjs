import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

console.log('=== FIELD COMPARISON IN MXENCCOT ===');
const sEncCot = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
const qNative = readDbfRows(sEncCot, null, null, false).find(r => r.numcot === '00053496');
const qInjected = readDbfRows(sEncCot, null, null, false).find(r => r.numcot === '00053497');
console.log('Native Quote 00053496 (Rec 1805):');
console.log(qNative);
console.log('\nInjected Quote 00053497 (Rec 1806):');
console.log(qInjected);

console.log('\n=== FIELD COMPARISON IN MXRENCOT ===');
const sRenCot = readDbfStruct(path.join(compDir, 'MXRENCOT.DBF'));
const rNative = readDbfRows(sRenCot, null, null, false).filter(r => r.numcot === '00053496');
const rInjected = readDbfRows(sRenCot, null, null, false).filter(r => r.numcot === '00053497');
console.log('Native Quote Lines 00053496:');
console.log(rNative);
console.log('\nInjected Quote Lines 00053497:');
console.log(rInjected);
