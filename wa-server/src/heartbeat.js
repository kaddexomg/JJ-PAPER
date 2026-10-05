import os from 'node:os';
import { execSync } from 'node:child_process';
import { db, dbCore } from './supabase.js';
import { log } from './logger.js';

// Latido + control remoto del wa-server.
// El panel de admin ve 🟢/🔴 según qué tan fresco sea heartbeat_at, y puede
// pedir 'restart' / 'stop' escribiendo command en jjp_server_control.
// (Arrancar desde apagado NO se puede por web: eso lo hace run-forever.bat
//  en la PC de la tienda, o el arranque automático de Windows.)

const HEARTBEAT_MS = 60_000;   // cada cuánto late
const POLL_MS      = 120_000;  // respaldo si Realtime está caído

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


function getTailscaleIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      if (/tailscale/i.test(name)) {
        for (const i of ifaces[name] || []) {
          if (i.family === 'IPv4' && !i.internal) return i.address;
        }
      }
    }
  } catch (_) {}
  return null;
}

let lastStatsData = null;
let lastStatsFetchTime = 0;
const STATS_BEAT_TTL = 300_000; // Recalcular métricas de Postgres cada 5 minutos

async function fetchStatsForBeat() {
  const now = Date.now();
  if (lastStatsData && (now - lastStatsFetchTime < STATS_BEAT_TTL)) return lastStatsData;
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
  const tsIp = getTailscaleIp();
  const lanInfo = {
    lan_ip: ip,
    lan_url: `http://${ip}:8787`,
    lan_https_url: `https://${ip}:8788`,
    tailscale_ip: tsIp,
    tailscale_url: tsIp ? `http://${tsIp}:8787` : null,
    tailscale_https_url: tsIp ? `https://${tsIp}:8788` : null
  };

  let mixerStatus = null;
  try {
    const { getMixerStatus } = await import('./mixer.js');
    mixerStatus = getMixerStatus();
  } catch (_) {}

  let gsmDevice = null;
  try {
    const { getDeviceStatus } = await import('./gsm.js');
    gsmDevice = await getDeviceStatus();
  } catch (_) {}

  const monitorStats = await fetchStatsForBeat();

  const now = new Date().toISOString();
  const payload = {
    heartbeat: now,
    heartbeat_at: now,
    status: serverStatus,
    host: os.hostname(),
    modules: {
      ...modulesRef,
      ...extra,
      ...lanInfo,
      ...(mixerStatus ? { mixer_status: mixerStatus } : {}),
      ...(gsmDevice ? { gsm_device: gsmDevice } : {}),
      ...(monitorStats ? { monitor_stats: monitorStats } : {})
    }
  };

  // 1. Actualizar Proyecto B (Comunicación - donde el frontend consulta jjp_server_control)
  const { error: errB } = await db.from('jjp_server_control').update(payload).eq('id', 1);
  if (errB) log.warn({ err: errB.message }, 'heartbeat falló en Proyecto B');

  // 2. Actualizar Proyecto A (Core - para mantener ambos proyectos sincronizados)
  try {
    const payloadCore = { ...payload };
    delete payloadCore.heartbeat;
    await dbCore.from('jjp_server_control').update(payloadCore).eq('id', 1);
  } catch (_) {}
}

async function runCommand(cmd) {
  if (handling) return;
  handling = true;
  // Limpiar el comando ANTES de ejecutarlo en ambos proyectos (evita re-disparos)
  await Promise.allSettled([
    db.from('jjp_server_control').update({ command: null }).eq('id', 1),
    dbCore.from('jjp_server_control').update({ command: null }).eq('id', 1)
  ]);

  if (cmd === 'sync_mixnet' || cmd === 'sync_catalog') {
    log.info('comando de sincronización manual de MixNet recibido vía Supabase');
    try {
      const { sweepMixnetProducts } = await import('./mixer.js');
      await sweepMixnetProducts();
      log.info('Sincronización manual de MixNet completada.');
    } catch (e) {
      log.warn({ err: e.message }, 'Error ejecutando sincronización manual de MixNet');
    }
    handling = false;
    return;
  }

  if (cmd === 'sync_gmail' || cmd === 'poll_gmail') {
    log.info('comando de sincronización forzada de Gmail recibido vía Supabase');
    try {
      const { pollInboundNow } = await import('./email.js');
      const count = await pollInboundNow();
      log.info({ count }, 'Sincronización manual de Gmail completada.');
    } catch (e) {
      log.warn({ err: e.message }, 'Error ejecutando sincronización manual de Gmail');
    }
    handling = false;
    return;
  }

  if (cmd === 'sync_gmail_starred' || (cmd && cmd.startsWith('sync_gmail_starred:'))) {
    const profileId = cmd.includes(':') ? cmd.split(':')[1].trim() : null;
    log.info({ profileId }, 'comando de sincronización de contactos destacados de Gmail recibido vía Supabase');
    try {
      const { syncGmailStarred } = await import('./email.js');
      const res = await syncGmailStarred(profileId);
      log.info({ count: res.syncedCount }, 'Sincronización de destacados de Gmail completada.');
      await db.from('jjp_server_control').update({
        command_res: { ok: true, count: res.syncedCount, at: new Date().toISOString() }
      }).eq('id', 1);
    } catch (e) {
      log.warn({ err: e.message }, 'Error ejecutando sincronización de destacados de Gmail');
      await db.from('jjp_server_control').update({
        command_res: { ok: false, error: e.message, at: new Date().toISOString() }
      }).eq('id', 1);
    }
    handling = false;
    return;
  }

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
    log.info({ cmd }, 'comando recibido — actualizando via git y reiniciando servicio');
    await db.from('jjp_server_control').update({ modules: { restarting: true } }).eq('id', 1);
    try {
      execSync('git pull origin main', { stdio: 'ignore', timeout: 20000 });
      log.info('git pull completado exitosamente antes de reiniciar.');
    } catch (e) {
      log.warn({ err: e.message }, 'git pull fallo o timed out, reiniciando igualmente');
    }
    process.exit(0);   // código 0 → el supervisor relanza
  } else if (cmd === 'stop') {
    log.info('comando: DETENER — apagando el puente');
    const stopPayload = {
      heartbeat: null,
      heartbeat_at: null,
      status: 'stopped',
      modules: { stopped: true }
    };
    await db.from('jjp_server_control').update(stopPayload).eq('id', 1);
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
  dbCore.from('jjp_server_control').update(startPayload).eq('id', 1).then(({ error }) => {
    if (error) log.warn({ err: error.message }, 'no pude marcar arranque del server en Proyecto A');
  });

  beatTimer = setInterval(() => beat().catch(() => {}), HEARTBEAT_MS);

  // Comandos en vivo (Escuchar en Proyecto B y Proyecto A)
  db.channel('wa-server-control-b')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_server_control', filter: 'id=eq.1' },
      p => { if (p.new?.command) runCommand(p.new.command).catch(e => log.error({ err: e.message }, 'runCommand B falló')); })
    .subscribe(st => log.info({ st }, 'realtime control B'));

  dbCore.channel('wa-server-control-a')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_server_control', filter: 'id=eq.1' },
      p => { if (p.new?.command) runCommand(p.new.command).catch(e => log.error({ err: e.message }, 'runCommand A falló')); })
    .subscribe(st => log.info({ st }, 'realtime control A'));

  // Respaldo: por si el Realtime se cae, revisar el comando periódicamente en ambos proyectos
  pollTimer = setInterval(async () => {
    try {
      const [{ data: dataB } = {}, { data: dataA } = {}] = await Promise.all([
        Promise.resolve(db.from('jjp_server_control').select('command').eq('id', 1).maybeSingle()).catch(() => ({ data: null })),
        Promise.resolve(dbCore.from('jjp_server_control').select('command').eq('id', 1).maybeSingle()).catch(() => ({ data: null }))
      ]);
      const cmd = dataB?.command || dataA?.command;
      if (cmd) await runCommand(cmd).catch(() => {});
    } catch (_) {}
  }, POLL_MS);

  log.info('heartbeat + control activos (jjp_server_control)');
}
