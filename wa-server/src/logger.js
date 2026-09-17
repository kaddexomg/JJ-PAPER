import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Los logs iban SOLO a la ventana del .bat: al relanzarse el servidor se
// perdía el motivo de la caída. Ahora también van a wa-server/logs/server.log.
//
// La rotación se hace al ARRANCAR, no en caliente: en Windows no se puede
// renombrar un archivo que el proceso tiene abierto. Como el supervisor
// relanza en cada caída, en la práctica rota igual.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR   = path.join(__dirname, '..', 'logs');
const LOG_FILE  = path.join(LOG_DIR, 'server.log');
const MAX_BYTES_BOOT = 10 * 1024 * 1024;   // 10 MB por archivo al arranque
const MAX_BYTES_RUNTIME = 50 * 1024 * 1024; // 50 MB en ejecución
const KEEP      = 5;                 // server.1.log … server.5.log

fs.mkdirSync(LOG_DIR, { recursive: true });

function rotateLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const oldPath = path.join(LOG_DIR, 'server.old.log');
    fs.copyFileSync(LOG_FILE, oldPath);
    fs.truncateSync(LOG_FILE, 0);
  } catch (e) {
    console.error('No pude rotar el log:', e.message);
  }
}

(function rotateOnBoot() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    if (fs.statSync(LOG_FILE).size < MAX_BYTES_BOOT) return;
    rotateLog();
  } catch (e) {}
})();

// Límite de 50MB en caliente
setInterval(() => {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    if (fs.statSync(LOG_FILE).size > MAX_BYTES_RUNTIME) {
      rotateLog();
    }
  } catch (e) {}
}, 60000);

export const LOG_PATH = LOG_FILE;

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      { target: 'pino-pretty', level: process.env.LOG_LEVEL || 'info',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      { target: 'pino/file', level: 'info',
        options: { destination: LOG_FILE, mkdir: true } }
    ]
  }
});

// Logger silencioso para Baileys (es MUY ruidoso en trace/debug)
export const baileysLogger = pino({ level: 'silent' });
