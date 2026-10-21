import { execSync } from 'node:child_process';

try {
  const out = execSync('netstat -ano | findstr :8790', { encoding: 'utf-8' });
  console.log('Port 8790 status:\n' + out);
} catch (e) {
  console.log('Port 8790 is NOT listening.');
}

try {
  const pList = execSync('tasklist | findstr node', { encoding: 'utf-8' });
  console.log('Node processes:\n' + pList);
} catch (e) {
  console.log('No node processes found.');
}
