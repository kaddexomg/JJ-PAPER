const { spawn } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname);
const child = spawn('cmd.exe', ['/c', 'run-service.bat'], {
  cwd,
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});

child.unref();

console.log('wa-server service launched detached. PID:', child.pid);
process.exit(0);
