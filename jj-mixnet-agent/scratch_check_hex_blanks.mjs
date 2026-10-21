import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

const sEnc = readDbfStruct(path.join(compDir, 'MXENCPED.DBF'));
const fdEnc = fs.openSync(path.join(compDir, 'MXENCPED.DBF'), 'r');
const bufEnc = Buffer.alloc(sEnc.recordLen);
fs.readSync(fdEnc, bufEnc, 0, sEnc.recordLen, sEnc.headerLen + (5550 - 1) * sEnc.recordLen);
fs.closeSync(fdEnc);
console.log('Rec 5550 in MXENCPED:');
console.log('Deleted flag:', bufEnc[0], '(0x20 is space/active, 0x2A is asterisk/deleted)');
console.log('Hex dump:', bufEnc.toString('hex').slice(0, 100));

const sRen = readDbfStruct(path.join(compDir, 'MXRENPED.DBF'));
const fdRen = fs.openSync(path.join(compDir, 'MXRENPED.DBF'), 'r');
const bufRen = Buffer.alloc(sRen.recordLen);
for (const r of [20422, 20423]) {
  fs.readSync(fdRen, bufRen, 0, sRen.recordLen, sRen.headerLen + (r - 1) * sRen.recordLen);
  console.log(`Rec ${r} in MXRENPED:`);
  console.log('Deleted flag:', bufRen[0]);
  console.log('Hex dump:', bufRen.toString('hex').slice(0, 100));
}
fs.closeSync(fdRen);
