import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
console.log('Exists compDir:', fs.existsSync(compDir));

if (fs.existsSync(compDir)) {
  const cliPath = path.join(compDir, 'MXCTACLI.DBF');
  const sCli = readDbfStruct(cliPath);
  console.log('MXCTACLI numRecords:', sCli?.numRecords);

  if (sCli) {
    const allRows = readDbfRows(sCli, ['codcli', 'nomcli', 'cif'], sCli.numRecords, false);
    
    // Look for recuperada or 00001 or 00 001
    const matches = allRows.filter(r => 
      (r.nomcli && r.nomcli.toLowerCase().includes('recuperad')) ||
      (r.codcli && (r.codcli.includes('001') || r.codcli.startsWith('00')))
    );

    console.log('--- MATCHES FOUND (' + matches.length + ') ---');
    for (const m of matches.slice(0, 30)) {
      console.log(`CODCLI: '${m.codcli}' | NOMCLI: '${m.nomcli}' | CIF: '${m.cif}'`);
    }

    const exactRecup = allRows.filter(r => r.nomcli && r.nomcli.toLowerCase().includes('recuperad'));
    console.log('--- EXACT RECUPERADA (' + exactRecup.length + ') ---');
    for (const m of exactRecup) {
      console.log(`CODCLI: '${m.codcli}' | NOMCLI: '${m.nomcli}' | CIF: '${m.cif}'`);
    }
  }
}
