import os from 'node:os';
import { db, dbCore } from './supabase.js';
import { log } from './logger.js';

// Latido + control remoto del wa-server.
// El panel de admin ve 🟢/🔴 según qué tan fresco sea heartbeat_at, y puede
// pedir 'restart' / 'stop' escribiendo command en jjp_server_control.
// (Arrancar desde apagado NO se puede por web: eso lo hace run-forever.bat
//  en la PC de la tienda, o el arranque automático de Windows.)

const HEARTBEAT_MS = 30_000;   // cada cuánto late
const POLL_MS      = 30_000;   // respaldo si Realtime está caído

let modulesRef = {};
let liveFn = null;      // devuelve estado en vivo (p. ej. salud de cada WhatsApp)
let beatTimer = null;
let pollTimer = null;
let handling = false;

function getLanIp() {
  if (process.env.COUNT_LAN_IP) return process.env.COUNT_LAN_IP;
  const ifaces = os.networkInterfaces();
  const bad = /warp|vmware|virtualbox|hyper-?v|vethernet|loopback|tailscale|zerotier|docker|wsl|\btun\b|\btap\b|radmin|virtual/i;
  const cands = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (bad.test(name)) continue;
      cands.push(i.address);
    }
  }
  const rank = ip => ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  cands.sort((a, b) => rank(b) - rank(a));
  return cands[0] || '127.0.0.1';
}

let lastStatsData = null;
let lastStatsFetchTime = 0;

async function fetchStatsForBeat() {
  const now = Date.now();
  if (lastStatsData && (now - lastStatsFetchTime < 25_000)) return lastStatsData;
  try {
    const { getSystemHealthAndStats } = await import('./monitor.js');
    const s = await getSystemHealthAndStats(false);
    if (s && s.recentRequests && s.recentRequests.length > 20) {
      s.recentRequests = s.recentRequests.slice(0, 20);
    }
    lastStatsData = s;
    lastStatsFetchTime = now;
    return s;
  } catch (_) {
    return null;
  }
}

async function beat() {
  // El latido decía solo "el proceso vive". Ahora también dice si cada
  // WhatsApp está realmente sano, que es lo que le importa al panel.
  let extra = {};
  try { extra = (typeof liveFn === 'function' ? liveFn() : {}) || {}; } catch (e) { /* nunca frenar el latido */ }

  // Estado real: si no hay sesiones WA sanas, reportar 'degraded'
  const waSanas = extra.waSanas ?? 0;
  const waSesiones = extra.waSesiones ?? 0;
  let serverStatus = 'online';
  if (waSesiones > 0 && waSanas === 0) serverStatus = 'degraded';

  const ip = getLanIp();
  const lanInfo = {
    lan_ip: ip,
    lan_url: `http://${ip}:8787`,
    lan_https_url: `https://${ip}:8788`
  };

  const monitorStats = await fetchStatsForBeat();

  let gsmDevice = null;
  try {
    const { getDeviceStatus } = await import('./gsm.js');
    gsmDevice = await getDeviceStatus();
  } catch (_) {}

  const now = new Date().toISOString();
  const payload = {
    heartbeat: now,
    heartbeat_at: now,
    status: serverStatus,
    host: os.hostname(),
    modules: { ...modulesRef, ...extra, ...lanInfo, ...(gsmDevice ? { gsm_device: gsmDevice } : {}), ...(monitorStats ? { monitor_stats: monitorStats } : {}) }
  };

  // 1. Actualizar Proyecto B (Comunicación)
  const { error } = await db.from('jjp_server_control').update(payload).eq('id', 1);
  if (error) log.warn({ err: error.message }, 'heartbeat falló en Proyecto B');

  // 2. Latido dual a Proyecto A (Core) para compatibilidad total de navegadores
  try {
    await dbCore.from('jjp_server_control').update(payload).eq('id', 1);
  } catch (_) {}
}

async function runCommand(cmd) {
  if (handling) return;
  handling = true;
  // Limpiar el comando ANTES de ejecutarlo (evita re-disparos)
  await db.from('jjp_server_control').update({ command: null }).eq('id', 1);
  try { await dbCore.from('jjp_server_control').update({ command: null }).eq('id', 1); } catch (_) {}

  if (cmd && cmd.startsWith('call:')) {
    const phone = cmd.replace(/^call:/, '').trim();
    log.info({ phone }, 'comando de llamada GSM recibido vía Supabase');
    try {
      const { makeCall } = await import('./gsm.js');
      await makeCall(phone);
    } catch (e) {
      log.warn({ err: e.message }, 'Error ejecutando llamada remota GSM');
    }
    handling = false;
    return;
  }

  if (cmd === 'hangup') {
    log.info('comando de colgado GSM recibido vía Supabase');
    try {
      const { hangupCall } = await import('./gsm.js');
      await hangupCall();
    } catch (e) {
      log.warn({ err: e.message }, 'Error ejecutando colgado remoto GSM');
    }
    handling = false;
    return;
  }

  if (cmd === 'restart' || cmd === 'update' || cmd === 'pull') {
    log.info({ cmd }, 'comando recibido — saliendo para recargar (el supervisor sincroniza y relanza)');
    await db.from('jjp_server_control').update({ modules: { restarting: true } }).eq('id', 1);
    try { await dbCore.from('jjp_server_control').update({ modules: { restarting: true } }).eq('id', 1); } catch (_) {}
    process.exit(0);   // código 0 → el supervisor relanza con git pull
  } else if (cmd === 'stop') {
    log.info('comando: DETENER — apagando el puente');
    const stopPayload = {
      heartbeat: null,
      heartbeat_at: null,
      status: 'stopped',
      modules: { stopped: true }
    };
    await db.from('jjp_server_control').update(stopPayload).eq('id', 1);
    try { await dbCore.from('jjp_server_control').update(stopPayload).eq('id', 1); } catch (_) {}
    process.exit(2);   // código 2 → run-forever.bat NO relanza (parada intencional)
  }
  handling = false;
}

export function startHeartbeat(modules = {}, liveStatusFn = null) {
  modulesRef = modules;
  liveFn = liveStatusFn;

  const now = new Date().toISOString();
  const ip = getLanIp();
  const lanInfo = {
    lan_ip: ip,
    lan_url: `http://${ip}:8787`,
    lan_https_url: `https://${ip}:8788`
  };
  const startPayload = {
    started_at: now,
    heartbeat: now,
    heartbeat_at: now,
    status: 'online',
    host: os.hostname(),
    modules: { ...modulesRef, ...lanInfo },
    command: null
  };
  db.from('jjp_server_control').update(startPayload).eq('id', 1).then(({ error }) => {
    if (error) log.warn({ err: error.message }, 'no pude marcar arranque del server en Proyecto B');
  });
  try {
    dbCore.from('jjp_server_control').update(startPayload).eq('id', 1).then();
  } catch (_) {}

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
