import fs from 'node:fs';
import path from 'node:path';

const bDir = 'M:/MIX11/comp01/backups';
if (fs.existsSync(bDir)) {
  console.log('Backups in M:/MIX11/comp01/backups:');
  const files = fs.readdirSync(bDir);
  for (const f of files) {
    const stat = fs.statSync(path.join(bDir, f));
    console.log(`${f} - ${stat.size} bytes - ${stat.mtime.toISOString()}`);
  }
} else {
  console.log('No backups folder in M:/MIX11/comp01');
}

const bDirLocal = 'M:/comp01/backups';
if (fs.existsSync(bDirLocal)) {
  console.log('Backups in M:/comp01/backups:');
  const files = fs.readdirSync(bDirLocal);
  for (const f of files) {
    const stat = fs.statSync(path.join(bDirLocal, f));
    console.log(`${f} - ${stat.size} bytes - ${stat.mtime.toISOString()}`);
  }
}
