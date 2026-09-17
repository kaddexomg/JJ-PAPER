import fs from 'node:fs';
import { db } from './supabase.js';
import { log } from './logger.js';
import { SESSIONS_DIR, SESSIONS_SWEEP_MS } from './config.js';
import { WaSession } from './wa-session.js';
import { normVePhone } from './phone.js';

// Mapa profile_id → WaSession. El frontend "pide" acciones escribiendo
// requested_action en jjp_wa_sessions; aquí se ejecutan y se limpian.

const sessions = new Map();

// Candado anti doble-socket: Realtime y el barrido pueden entregar el MISMO
// 'connect' dos veces; antes se creaban DOS sockets de Baileys con el mismo
// auth → WhatsApp expulsaba a ambos y el QR se regeneraba en bucle.
// Un perfil = UNA acción a la vez. Las demás peticiones se ignoran.
const working = new Set();

export function get(profileId) { return sessions.get(profileId); }
export function all() { return [...sessions.values()]; }

export async function boot() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const { data: rows, error } = await db.from('jjp_wa_sessions').select('*').eq('enabled', true);
  if (error) { log.error({ error: error.message }, 'no pude leer jjp_wa_sessions'); return; }

  // Limpieza de sesiones zombie y vacías.
  // IMPORTANTE: NO purgar sesiones con credenciales reales (account, me, signalIdentities)
  // aunque tengan registered:false — Baileys puede dejar ese campo en false durante
  // la negociación post-QR y nunca actualizarlo si hubo un close transitorio.
  // Solo se eliminan carpetas vacías, legacies sin datos y sesiones realmente huérfanas.
  const enabledIds = new Set((rows || []).map(r => r.profile_id));
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = `${SESSIONS_DIR}/${dir}`;
      if (!fs.statSync(dirPath).isDirectory()) continue;
      
      const files = fs.readdirSync(dirPath);
      
      // Carpetas vacías → limpiar
      if (files.length === 0) {
        log.warn({ profile: dir }, 'Limpiando directorio de sesión vacío');
        fs.rmSync(dirPath, { recursive: true, force: true });
        continue;
      }
      
      // Si el perfil está habilitado en la BD, NUNCA purgar sus credenciales
      if (enabledIds.has(dir)) continue;
      
      // Perfil NO está en la BD → verificar si tiene credenciales válidas antes de purgar
      const credsPath = `${dirPath}/creds.json`;
      if (fs.existsSync(credsPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
          // Si tiene account o me o signalIdentities, es una sesión REAL (no zombie)
          const hasRealData = !!(creds.account || creds.me || (creds.signalIdentities && creds.signalIdentities.length > 0));
          if (hasRealData) {
            log.info({ profile: dir, registered: creds.registered }, 'Sesión huérfana con datos reales — preservada (no está habilitada en BD)');
            continue;
          }
          if (creds.registered === false) {
            log.warn({ profile: dir }, 'Sesión zombie real (sin account ni señal) — purgando');
            fs.rmSync(dirPath, { recursive: true, force: true });
          }
        } catch (e) {
          // creds.json corrupto → limpiar
          log.warn({ profile: dir, err: e.message }, 'creds.json corrupto — purgando sesión');
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    }
  } catch(e) {
    log.error({ err: e.message }, 'Error limpiando sesiones zombies');
  }

  let started = 0;
  for (const row of rows || []) {
    const s = ensure(row.profile_id);
    // Solo auto-conectar sesiones ya vinculadas (con credenciales en disco);
    // las nuevas esperan a que el usuario pida 'connect' desde el panel
    if (s.hasCreds()) { await s.start(); started++; }
    else if (row.status !== 'disabled' && row.status !== 'logged_out') {
      await s.setSession({ status: 'logged_out' });
    }
  }
  log.info({ habilitadas: rows?.length || 0, conectando: started }, 'sesiones al arranque');

  db.channel('wa-server-sessions')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_wa_sessions' },
      payload => handleRow(payload.new).catch(e => log.error({ err: e.message }, 'handleRow falló')))
    .subscribe(st => log.info({ st }, 'realtime sesiones'));

  // Barrido de respaldo: acciones pedidas mientras Realtime estaba caído
  setInterval(async () => {
    const { data } = await db.from('jjp_wa_sessions').select('*').not('requested_action', 'is', null);
    for (const row of data || []) await handleRow(row).catch(() => {});
  }, SESSIONS_SWEEP_MS);

  startWatchdog();
}

// Vigilante: Baileys puede quedarse con la sesión "abierta" pero el socket
// muerto sin emitir 'close'. Antes eso dejaba el WhatsApp mudo hasta que
// alguien lo notara y reiniciara el servidor a mano.
// Intervalo: cada 90s. Umbral de muerte: 3 minutos sin señal de vida.
function startWatchdog() {
  const DEAD_THRESHOLD_MS = 180_000;  // 3 minutos sin señal → muerta
  setInterval(async () => {
    for (const s of sessions.values()) {
      if (s.stopped || !s.hasCreds()) continue;
      if (s.reconnectTimer) continue;  // ya hay un reintento programado
      if (s.startingSince && Date.now() - s.startingSince < 180_000) continue;
      if (working.has(s.profileId)) continue;

      // Si está conectada y el websocket está abierto → está sana, no tocar
      if (s.isConnected() && s.wsOpen()) {
        // Renovar lastEventAt para que no expire mientras esté conectada
        if (!s.lastEventAt) s.lastEventAt = Date.now();
        continue;
      }

      // Si tiene lastEventAt reciente (< DEAD_THRESHOLD), darle más tiempo
      if (s.lastEventAt && Date.now() - s.lastEventAt < DEAD_THRESHOLD_MS) continue;

      const min = Math.round((Date.now() - (s.lastEventAt || 0)) / 60000);
      log.warn({ profile: s.profileId, sinSenalMin: min }, 'sesión caída sin avisar — reconectando');
      
      working.add(s.profileId);
      try {
        await s.setSession({ status: 'disconnected', last_error: 'Reconectada por el vigilante' });
        await s.start();
      } catch (e) {
        log.error({ err: e.message, profile: s.profileId }, 'watchdog no pudo reconectar');
      } finally {
        working.delete(s.profileId);
      }
    }
  }, 90_000);  // cada 90 segundos (antes 60s era demasiado agresivo)
  log.info('vigilante de sesiones activo (revisa cada 90s, umbral de muerte: 3 min)');
}

function ensure(profileId) {
  if (!sessions.has(profileId)) sessions.set(profileId, new WaSession(profileId));
  return sessions.get(profileId);
}

async function handleRow(row) {
  if (!row?.profile_id) return;
  if (working.has(row.profile_id)) return;      // ya hay una acción de este perfil en curso
  working.add(row.profile_id);
  try {
    await execAction(row.profile_id, row);
  } catch (e) {
    log.error({ err: e.message, profile: row.profile_id }, 'acción falló');
  } finally {
    working.delete(row.profile_id);
  }
}

async function execAction(profileId, row) {
  const s = ensure(profileId);

  // Admin deshabilitó la sesión → detener
  if (!row.enabled) {
    if (!s.stopped) { log.info({ profile: row.profile_id }, 'sesión deshabilitada por admin'); await s.stop('disabled'); }
    else if (row.status !== 'disabled') await s.setSession({ status: 'disabled', qr_data: null, pairing_code: null });
    return;
  }

  const action = row.requested_action;
  if (!action) return;

  // Limpiar la petición ANTES de ejecutarla (evita re-disparos por los updates de estado)
  await db.from('jjp_wa_sessions')
    .update({ requested_action: null, requested_at: null })
    .eq('profile_id', row.profile_id);

  log.info({ profile: row.profile_id, action }, 'acción pedida desde el panel');
  if (action === 'connect') {
    s.pairingPhone = null;
    if (!s.stopped) await s.stop('starting');
    await s.start();
  } else if (action === 'request_pairing') {
    const phone = normVePhone(row.pairing_phone);
    if (!phone) { await s.setSession({ status: 'error', last_error: 'Teléfono de emparejamiento inválido' }); return; }
    if (!s.stopped) await s.stop('starting');
    s.pairingPhone = phone;
    await s.start();
  } else if (action === 'logout') {
    await s.logout();
  }
}
