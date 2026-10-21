import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01';
const sCli = readDbfStruct(path.join(compDir, 'MXCTACLI.DBF'));
const cliRows = readDbfRows(sCli, ['codcli', 'nomcli', 'cif', 'codven', 'zona'], sCli.numRecords, false);
const aerocaribe = cliRows.find(c => c.codcli === '014-522');
console.log('Cliente 014-522 en MXCTACLI:');
console.log(JSON.stringify(aerocaribe, null, 2));
