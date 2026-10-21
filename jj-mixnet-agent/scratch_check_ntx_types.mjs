import fs from 'node:fs';

const comp01 = 'M:/MIX11/comp01';
const ntxs = fs.readdirSync(comp01).filter(f => f.toUpperCase().endsWith('.NTX'));

const rel = ntxs.filter(f => {
  const u = f.toUpperCase();
  return u.includes('COT') || u.includes('PED') || u.includes('CZX') || u.includes('PEX') || u.includes('CPX') || u.includes('ENCP') || u.includes('ENCZ');
});

console.log('Related NTX files:');
for (const f of rel) {
  const stat = fs.statSync(`${comp01}/${f}`);
  console.log(`- ${f}: size ${stat.size}, modified: ${stat.mtime.toISOString()}`);
}
