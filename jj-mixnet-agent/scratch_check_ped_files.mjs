import path from 'node:path';
import fs from 'node:fs';

const compDir = 'M:/MIX11/comp01';
console.log('Files with PED in M:/MIX11/comp01:');
const files = fs.readdirSync(compDir).filter(f => f.toUpperCase().includes('PED'));
console.log(files);
