import os from 'node:os';
import { db } from './supabase.js';
import { log } from './logger.js';

// Latido + control remoto del wa-server.
// El panel de admin ve 🟢/🔴 según qué tan fresco sea heartbeat_at, y puede
// pedir 'restart' / 'stop' escribiendo command en jjp_server_control.
// (Arrancar desde apagado NO se puede por web: eso lo hace run-forever.bat
//  en la PC de la tienda, o el arranque automático de Windows.)

const HEARTBEAT_MS = 20_000;   // cada cuánto late
const POLL_MS      = 10_000;   // respaldo si Realtime está caído

let modulesRef = {};
let liveFn = null;      // devuelve estado en vivo (p. ej. salud de cada WhatsApp)
let beatTimer = null;
let pollTimer = null;
let handling = false;

async function beat() {
  // El latido decía solo "el proceso vive". Ahora también dice si cada
  // WhatsApp está realmente sano, que es lo que le importa al panel.
  let extra = {};
  try { extra = (typeof liveFn === 'function' ? liveFn() : {}) || {}; } catch (e) { /* nunca frenar el latido */ }

  const { error } = await db.from('jjp_server_control').update({
    heartbeat_at: new Date().toISOString(),
    modules: { ...modulesRef, ...extra }
  }).eq('id', 1);
  if (error) log.warn({ err: error.message }, 'heartbeat falló');
}

async function runCommand(cmd) {
  if (handling) return;
  handling = true;
  // Limpiar el comando ANTES de ejecutarlo (evita re-disparos)
  await db.from('jjp_server_control').update({ command: null }).eq('id', 1);

  if (cmd === 'restart') {
    log.info('comando: REINICIAR — saliendo (run-forever.bat relanza)');
    await db.from('jjp_server_control').update({ modules: { restarting: true } }).eq('id', 1);
    process.exit(0);   // código 0 → el .bat/supervisor lo vuelve a levantar
  } else if (cmd === 'stop') {
    log.info('comando: DETENER — apagando el puente');
    await db.from('jjp_server_control').update({
      heartbeat_at: null, modules: { stopped: true }
    }).eq('id', 1);
    process.exit(2);   // código 2 → run-forever.bat NO relanza (parada intencional)
  }
  handling = false;
}

export function startHeartbeat(modules = {}, liveStatusFn = null) {
  modulesRef = modules;
  liveFn = liveStatusFn;

  db.from('jjp_server_control').update({
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    host: os.hostname(),
    modules: modulesRef,
    command: null
  }).eq('id', 1).then(({ error }) => {
    if (error) log.warn({ err: error.message }, 'no pude marcar arranque del server');
  });

  beatTimer = setInterval(() => beat().catch(() => {}), HEARTBEAT_MS);

  // Comandos en vivo
  db.channel('wa-server-control')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_server_control', filter: 'id=eq.1' },
      p => { if (p.new?.command) runCommand(p.new.command).catch(e => log.error({ err: e.message }, 'runCommand falló')); })
    .subscribe(st => log.info({ st }, 'realtime control'));

  // Respaldo: por si el Realtime se cae, revisar el comando periódicamente
  pollTimer = setInterval(async () => {
    const { data } = await db.from('jjp_server_control').select('command').eq('id', 1).maybeSingle();
    if (data?.command) await runCommand(data.command).catch(() => {});
  }, POLL_MS);

  log.info('heartbeat + control activos (jjp_server_control)');
}
