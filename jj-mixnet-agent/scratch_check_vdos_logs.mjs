import fs from 'node:fs';

const vdos = 'C:/vDos';
if (fs.existsSync(vdos)) {
  const files = fs.readdirSync(vdos);
  console.log('vDos files:');
  for (const f of files) {
    if (f.endsWith('.log') || f.endsWith('.txt') || f.endsWith('.err')) {
      console.log(`- ${f}`);
    }
  }
}
