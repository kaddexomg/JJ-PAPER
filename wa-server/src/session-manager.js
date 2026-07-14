import fs from 'node:fs';
import { db } from './supabase.js';
import { log } from './logger.js';
import { SESSIONS_DIR, SESSIONS_SWEEP_MS } from './config.js';
import { WaSession } from './wa-session.js';
import { normVePhone } from './phone.js';

// Mapa profile_id → WaSession. El frontend "pide" acciones escribiendo
// requested_action en jjp_wa_sessions; aquí se ejecutan y se limpian.

const sessions = new Map();

export function get(profileId) { return sessions.get(profileId); }

export async function boot() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const { data: rows, error } = await db.from('jjp_wa_sessions').select('*').eq('enabled', true);
  if (error) { log.error({ error: error.message }, 'no pude leer jjp_wa_sessions'); return; }

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
}

function ensure(profileId) {
  if (!sessions.has(profileId)) sessions.set(profileId, new WaSession(profileId));
  return sessions.get(profileId);
}

async function handleRow(row) {
  if (!row?.profile_id) return;
  const s = ensure(row.profile_id);

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
