import fs from 'node:fs';

const statZ = fs.statSync('Z:/comp01/MXENCCOT.DBF');
const statM11 = fs.statSync('M:/MIX11/comp01/MXENCCOT.DBF');
const statM = fs.statSync('M:/comp01/MXENCCOT.DBF');

console.log('Z:/comp01/MXENCCOT.DBF size: ' + statZ.size + ' mtime: ' + statZ.mtime.toISOString());
console.log('M:/MIX11/comp01/MXENCCOT.DBF size: ' + statM11.size + ' mtime: ' + statM11.mtime.toISOString());
console.log('M:/comp01/MXENCCOT.DBF size: ' + statM.size + ' mtime: ' + statM.mtime.toISOString());
