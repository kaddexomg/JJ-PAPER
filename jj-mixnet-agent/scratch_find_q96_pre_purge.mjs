import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

const compDir = 'M:/MIX11/comp01/backups';
const bakEnc = path.join(compDir, 'MXENCCOT.DBF.PRE_PURGE_1792423887236.BAK');
const sEnc = readDbfStruct(bakEnc);
const q96Enc = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'codven', 'nomcli', 'tot_cot', 'comen1'], sEnc.numRecords, false).filter(r => r.numcot === '00053496');
console.log('00053496 in pre-purge enc:', q96Enc);

const bakRen = path.join(compDir, 'MXRENCOT.DBF.PRE_PURGE_1792423887459.BAK');
const sRen = readDbfStruct(bakRen);
const q96Ren = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], sRen.numRecords, false).filter(r => r.numcot === '00053496');
console.log('00053496 in pre-purge ren:', q96Ren);
