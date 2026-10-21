import fs from 'node:fs';

const errLog = 'M:/MIX11/Error.log';
if (fs.existsSync(errLog)) {
  const content = fs.readFileSync(errLog, 'latin1');
  const lines = content.split('\n');
  console.log('Error.log total lines: ' + lines.length);
  console.log('Last 100 lines of Error.log:');
  console.log(lines.slice(-100).join('\n'));
} else {
  console.log('Error.log not found');
}
