const { spawn } = require('child_process');
const path = require('path');

const waDir = __dirname;
const cp = spawn('cmd.exe', ['/c', 'run-service.bat'], {
  cwd: waDir,
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});

cp.unref();
console.log('wa-server iniciado en segundo plano persistente (PID:', cp.pid, ')');
process.exit(0);
