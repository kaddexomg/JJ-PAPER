import fs from 'node:fs';

console.log('=== C:/vDos/config.txt ===');
console.log(fs.readFileSync('C:/vDos/config.txt', 'utf-8'));
