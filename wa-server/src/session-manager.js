import fs from 'node:fs';
import { db } from './supabase.js';
import { log } from './logger.js';
import { SESSIONS_DIR, SESSIONS_SWEEP_MS } from './config.js';
import { WaSession } from './wa-session.js';
import { normVePhone } from './phone.js';

// Nómina Sagrada de WhatsApp en JJ Paper (Exclusivamente 4 perfiles autorizados)
export const OFFICIAL_WA_PROFILES = new Set([
  'bddc57dc-5bf9-4a72-9e1c-751d07b03164', // Keyder Salazar (Admin)
  '07540d9c-4ed9-46d2-95ce-0a0200be6083', // Yovanni Araujo (004/006)
  '3c9b7ddd-4b98-45c6-a646-5c557a2bc043', // Marianela Ventas JJ (008)
  '68c29cd3-760a-4282-8214-4e7c60413ec5'  // ANDREINA JJ VENTAS (014)
]);

const sessions = new Map();
const working = new Set();

export function get(profileId) { return sessions.get(profileId); }
export function all() { return [...sessions.values()]; }

export async function boot() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  // 1. Asegurar que ÚNICAMENTE los 4 perfiles oficiales tengan fila habilitada en jjp_wa_sessions
  try {
    for (const pid of OFFICIAL_WA_PROFILES) {
      await db.from('jjp_wa_sessions').insert({ profile_id: pid, enabled: true }).catch(() => {});
      await db.from('jjp_wa_sessions').update({ enabled: true }).eq('profile_id', pid);
    }
    // Deshabilitar cualquier otra cuenta residual en la base de datos
    const { data: allRows } = await db.from('jjp_wa_sessions').select('profile_id');
    for (const r of allRows || []) {
      if (!OFFICIAL_WA_PROFILES.has(r.profile_id)) {
        await db.from('jjp_wa_sessions').update({ enabled: false, status: 'disabled', qr_data: null }).eq('profile_id', r.profile_id);
      }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Aviso sincronizando perfiles autorizados de WhatsApp');
  }

  // 2. Limpieza de directorios (los 4 perfiles oficiales son SAGRADOS e INTOCABLES)
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = `${SESSIONS_DIR}/${dir}`;
      if (!fs.statSync(dirPath).isDirectory()) continue;
      
      // Credenciales de los 4 vendedores oficiales NUNCA se purgan
      if (OFFICIAL_WA_PROFILES.has(dir)) continue;

      const files = fs.readdirSync(dirPath);
      if (files.length === 0) {
        log.warn({ profile: dir }, 'Limpiando directorio residual vacío');
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }
  } catch(e) {
    log.error({ err: e.message }, 'Error limpiando sesiones residuales');
  }

  // 3. Auto-conectar ÚNICAMENTE sesiones oficiales que ya tengan credenciales guardadas en disco
  const { data: rows } = await db.from('jjp_wa_sessions')
    .select('*')
    .in('profile_id', Array.from(OFFICIAL_WA_PROFILES))
    .eq('enabled', true);

  let started = 0;
  for (const row of rows || []) {
    const s = ensure(row.profile_id);
    if (s.hasCreds()) { 
      await s.start(); 
      started++; 
    } else {
      // Si este host no tiene credenciales locales y la fila en BD quedó con un QR viejo, limpiar
      if (row.status === 'pending_qr' || row.status === 'starting' || row.status === 'reconnecting') {
        log.info({ profile: row.profile_id }, 'Limpiando estado QR huérfano de arranque');
        await db.from('jjp_wa_sessions')
          .update({ status: 'disconnected', qr_data: null, pairing_code: null, last_error: null })
          .eq('profile_id', row.profile_id);
      }
    }
  }
  log.info({ autorizadas: OFFICIAL_WA_PROFILES.size, conectadasAlArranque: started }, 'sesiones oficiales JJ Paper activas al arranque');

  // 4. Suscripción a acciones bajo demanda
  db.channel('wa-server-sessions')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_wa_sessions' },
      payload => handleRow(payload.new).catch(e => log.error({ err: e.message }, 'handleRow falló')))
    .subscribe(st => log.info({ st }, 'realtime sesiones'));

  setInterval(async () => {
    const { data } = await db.from('jjp_wa_sessions')
      .select('*')
      .in('profile_id', Array.from(OFFICIAL_WA_PROFILES))
      .not('requested_action', 'is', null);
    for (const row of data || []) await handleRow(row).catch(() => {});
  }, SESSIONS_SWEEP_MS);

  startWatchdog();
}

// Vigilante pasivo y no-destructivo:
// NUNCA tumba sesiones vivas por falta de mensajes. WhatsApp maneja el keep-alive
// internamente vía WebSocket ping/pong cada 25 segundos.
// Solo reprograma reconexión suave si el socket se cerró físicamente y no hay reintento pendiente.
function startWatchdog() {
  setInterval(async () => {
    for (const s of sessions.values()) {
      if (s.stopped || !s.hasCreds()) continue;
      if (s.reconnectTimer) continue;
      if (working.has(s.profileId)) continue;

      // Si está conectado y el socket está abierto, está completamente sano (no tocar)
      if (s.isConnected() && s.wsOpen()) continue;

      // Solo si el socket está desconectado pero tiene credenciales guardadas, reconectar con backoff suave
      log.info({ profile: s.profileId }, 'Socket desconectado en reposo — reconexión suave programada');
      s.scheduleReconnect();
    }
  }, 60_000);
  log.info('vigilante pasivo activo (supervisión suave cada 60s, sin interrupción por inactividad)');
}

function ensure(profileId) {
  if (!sessions.has(profileId)) sessions.set(profileId, new WaSession(profileId));
  return sessions.get(profileId);
}

async function handleRow(row) {
  if (!row?.profile_id) return;
  if (!OFFICIAL_WA_PROFILES.has(row.profile_id)) return; // Ignorar perfiles no autorizados
  if (working.has(row.profile_id)) return;
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

  if (!row.enabled) {
    if (!s.stopped) { 
      log.info({ profile: row.profile_id }, 'sesión deshabilitada'); 
      await s.stop('disabled'); 
    }
    return;
  }

  const action = row.requested_action;
  if (!action) return;

  // Limpiar la petición antes de ejecutarla para evitar bucles
  await db.from('jjp_wa_sessions')
    .update({ requested_action: null, requested_at: null })
    .eq('profile_id', row.profile_id);

  log.info({ profile: row.profile_id, action }, 'acción solicitada por el usuario');

  if (action === 'connect') {
    // Si la sesión YA TIENE credenciales guardadas en disco, NUNCA pedir un nuevo QR
    if (s.hasCreds()) {
      log.info({ profile: row.profile_id }, 'Sesión ya vinculada — re-enganchando socket sin QR');
      if (!s.isConnected() || !s.wsOpen()) {
        await s.start();
      }
      return;
    }

    // Cuenta sin credenciales: generar QR bajo demanda para este vendedor exclusivamente
    s.pairingPhone = null;
    s.qrTimeouts = 0;
    s.reconnectMs = 2000;
    if (!s.stopped) await s.stop('starting');
    await s.start();
  } else if (action === 'request_pairing') {
    const phone = normVePhone(row.pairing_phone);
    if (!phone) { 
      await s.setSession({ status: 'error', last_error: 'Teléfono inválido', qr_data: null }); 
      return; 
    }
    s.qrTimeouts = 0;
    s.reconnectMs = 2000;
    if (!s.stopped) await s.stop('starting');
    s.pairingPhone = phone;
    await s.start();
  } else if (action === 'logout') {
    // El borrado de credenciales SOLO se ejecuta ante acción explícita de logout
    log.warn({ profile: row.profile_id }, 'Desvinculando cuenta explícitamente a petición del usuario');
    await s.logout();
  }
}
