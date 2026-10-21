import fs from 'node:fs';
import path from 'node:path';

// Check M:/MIX11 files
const mix11 = 'M:/MIX11';
if (fs.existsSync(mix11)) {
  console.log('M:/MIX11 entries:');
  const entries = fs.readdirSync(mix11);
  console.log(entries);
}

// Check comp01 NTX files
const comp01 = 'M:/MIX11/comp01';
if (fs.existsSync(comp01)) {
  const ntxs = fs.readdirSync(comp01).filter(f => f.endsWith('.NTX') || f.endsWith('.ntx'));
  console.log('All NTX in comp01 (' + ntxs.length + '):');
  console.log(ntxs);
}
