import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';

function checkTable(filename, idField) {
  const fPath = path.join(compDir, filename);
  const s = readDbfStruct(fPath);
  const fd = fs.openSync(fPath, 'r');
  const buf = Buffer.alloc(s.recordLen);

  const idCol = s.fields.find(f => f.name.toLowerCase() === idField.toLowerCase());
  let activeBlank = 0;
  let deletedCount = 0;
  let total = s.numRecords;
  const issues = [];

  for (let r = 1; r <= total; r++) {
    fs.readSync(fd, buf, 0, s.recordLen, s.headerLen + (r - 1) * s.recordLen);
    const isDel = buf[0] === 0x2A;
    if (isDel) {
      deletedCount++;
    } else {
      const idVal = buf.toString('latin1', 1 + idCol.offset, 1 + idCol.offset + idCol.length).trim();
      if (!idVal) {
        activeBlank++;
        issues.push({ recNo: r, issue: 'ACTIVE BUT BLANK ID' });
      }
    }
  }
  fs.closeSync(fd);
  console.log(`[${filename}] Total: ${total}, Active: ${total - deletedCount}, Deleted: ${deletedCount}, Active Blank: ${activeBlank}`);
  if (issues.length > 0) {
    console.log(`  Issues:`, issues);
  }
}

checkTable('MXENCCOT.DBF', 'numcot');
checkTable('MXRENCOT.DBF', 'numcot');
checkTable('MXENCPED.DBF', 'numped');
checkTable('MXRENPED.DBF', 'numped');
