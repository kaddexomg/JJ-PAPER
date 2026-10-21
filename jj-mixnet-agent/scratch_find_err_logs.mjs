import fs from 'node:fs';

for (const dir of ['M:/MIX11', 'M:/MIX11/comp01', 'Z:', 'Z:/comp01']) {
  if (fs.existsSync(dir)) {
    const list = fs.readdirSync(dir);
    const logs = list.filter(f => f.toUpperCase().includes('ERR') || f.toUpperCase().includes('LOG') || f.toUpperCase().endsWith('.MEM'));
    console.log(`Logs in ${dir}:`, logs);
  }
}
