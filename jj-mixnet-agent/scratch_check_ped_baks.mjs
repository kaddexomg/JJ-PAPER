import fs from 'node:fs';
import path from 'node:path';

const compDir = 'M:/MIX11/comp01/backups';
const files = fs.readdirSync(compDir).filter(f => f.includes('PED'));
console.log('PED backups in M:/MIX11/comp01/backups:', files);
