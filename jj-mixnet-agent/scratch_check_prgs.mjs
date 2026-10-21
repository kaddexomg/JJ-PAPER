import fs from 'node:fs';

const mix11 = 'M:/MIX11';
const prgs = fs.readdirSync(mix11).filter(f => f.toUpperCase().endsWith('.PRG'));
console.log('PRG files in M:/MIX11: ' + prgs.length);
if (prgs.length > 0) {
  console.log(prgs.slice(0, 30));
}
