import fs from 'node:fs';
import path from 'node:path';

function findBackups(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  for (const f of list) {
    if (f.toUpperCase().includes('BACKUP') || f.toUpperCase().includes('SAFETY') || f.toUpperCase().endsWith('.BAK') || f.toUpperCase().endsWith('.OLD')) {
      console.log(`Backup in ${dir}: ${f}`);
    }
  }
}

findBackups('M:/MIX11/comp01');
findBackups('M:/MIX11/comp01/backups');
findBackups('C:/Users/Supervisor/.JJ-PAPER/lan-daemon/backups');
findBackups('C:/Users/Supervisor/.JJ-PAPER/lan-daemon');
findBackups('M:/comp01');
findBackups('M:/comp01/backups');
