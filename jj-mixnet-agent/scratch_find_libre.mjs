import fs from 'node:fs';
import path from 'node:path';

function searchDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.git') && entry.name !== 'node_modules') {
      searchDir(full);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.html') || entry.name.endsWith('.json'))) {
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes('LIBRE') || content.includes('libre')) {
        console.log(`Found in: ${full}`);
        const lines = content.split('\n');
        lines.forEach((l, idx) => {
          if (l.toLowerCase().includes('libre')) {
            console.log(`  Line ${idx + 1}: ${l.trim()}`);
          }
        });
      }
    }
  }
}

searchDir('C:/Users/Supervisor/.JJ-PAPER');
