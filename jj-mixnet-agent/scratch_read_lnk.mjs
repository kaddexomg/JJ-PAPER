import fs from 'node:fs';

const buf = fs.readFileSync('C:/Users/Supervisor/Desktop/Mixnet.lnk');
// Find ASCII strings in .lnk
const str = buf.toString('latin1');
const matches = str.match(/[A-Za-z]:\\[A-Za-z0-9_\\\.\-]+/g);
console.log('Paths found in Mixnet.lnk:', matches);
