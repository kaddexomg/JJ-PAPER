import { db } from './supabase.js';
import { log } from './logger.js';

// Presencia del cliente ("escribiendo…", "grabando audio…", "en línea").
// Va por Realtime BROADCAST, no por tablas: es un dato que caduca en segundos y
// escribirlo en la base gastaría cuota para nada. Si el panel no está abierto,
// el mensaje simplemente se descarta.
//
// Canal por dueño de sesión: 'wa-presence-<profile_id>'.

const chans = new Map();          // profile_id → Promise<canal suscrito | null>
const SUB_TIMEOUT = 8000;

function open(ownerId) {
  const ch = db.channel('wa-presence-' + ownerId, {
    config: { broadcast: { self: false, ack: false } }
  });
  return new Promise(resolve => {
    let listo = false;
    const t = setTimeout(() => {
      if (listo) return;
      listo = true;
      chans.delete(ownerId);            // reintentar en la próxima presencia
      log.warn({ owner: ownerId }, 'canal de presencia no se suscribió a tiempo');
      resolve(null);
    }, SUB_TIMEOUT);
    ch.subscribe(st => {
      if (st !== 'SUBSCRIBED' || listo) return;
      listo = true;
      clearTimeout(t);
      resolve(ch);
    });
  });
}

export async function publishPresence(ownerId, payload) {
  try {
    if (!chans.has(ownerId)) chans.set(ownerId, open(ownerId));
    const ch = await chans.get(ownerId);
    if (!ch) return;
    await ch.send({ type: 'broadcast', event: 'presence', payload: { owner: ownerId, ...payload } });
  } catch (e) {
    chans.delete(ownerId);
    log.warn({ err: e.message, owner: ownerId }, 'publicar presencia falló');
  }
}
