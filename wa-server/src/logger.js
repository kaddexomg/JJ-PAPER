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
const MAX_BYTES = 5 * 1024 * 1024;   // 5 MB por archivo
const KEEP      = 5;                 // server.1.log … server.5.log

fs.mkdirSync(LOG_DIR, { recursive: true });

(function rotateOnBoot() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    if (fs.statSync(LOG_FILE).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = path.join(LOG_DIR, `server.${i}.log`);
      const to   = path.join(LOG_DIR, `server.${i + 1}.log`);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'server.1.log'));
  } catch (e) {
    console.error('No pude rotar el log:', e.message);
  }
})();

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
