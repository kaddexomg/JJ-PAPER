import { execSync } from 'node:child_process';

const out = execSync('net use', { encoding: 'utf-8' });
console.log('Network drives:\n' + out);
