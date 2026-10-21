import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const encPath = path.join(compDir, 'MXENCPED.DBF');
const s = readDbfStruct(encPath);
const fd = fs.openSync(encPath, 'r');
const buf = Buffer.alloc(s.recordLen);

for (let r = 5545; r <= s.numRecords; r++) {
  fs.readSync(fd, buf, 0, s.recordLen, s.headerLen + (r - 1) * s.recordLen);
  const delMarker = buf[0] === 0x2A ? '[DELETED]' : '[ACTIVE]';
  const recStr = buf.toString('latin1', 1);
  console.log(`Rec ${r}: ${delMarker} | numped: ${recStr.slice(0, 8)} | cliente: ${recStr.slice(16, 23)} | codven: ${recStr.slice(25, 28)}`);
}
fs.closeSync(fd);
