import os from 'node:os';
import { execSync } from 'node:child_process';
import { db, dbCore } from './supabase.js';
import { log } from './logger.js';

// Latido + control remoto del wa-server.
// El panel de admin ve 🟢/🔴 según qué tan fresco sea heartbeat_at, y puede
// pedir 'restart' / 'stop' escribiendo command en jjp_server_control.
// (Arrancar desde apagado NO se puede por web: eso lo hace run-forever.bat
//  en la PC de la tienda, o el arranque automático de Windows.)

const HEARTBEAT_MS = 30_000;   // cada cuánto late
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

  // Latido rápido primero: usa únicamente columnas reales del VPS (heartbeat_at, updated_at)
  const quick = new Date().toISOString();
  await dbCore.from('jjp_server_control').update({ heartbeat_at: quick, updated_at: quick }).eq('id', 1);

  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

  let gsmDevice = null;
  try {
    const { getDeviceStatus } = await import('./gsm.js');
    gsmDevice = await withTimeout(getDeviceStatus(), 5000);
  } catch (_) {}

  const monitorStats = await withTimeout(fetchStatsForBeat(), 8000);

  const now = new Date().toISOString();
  const { data: curRow } = await dbCore.from('jjp_server_control').select('modules').eq('id', 1).maybeSingle();
  const curMods = (curRow?.modules && typeof curRow.modules === 'object') ? curRow.modules : {};
  const payload = {
    heartbeat_at: now,
    updated_at: now,
    modules: {
      ...curMods,
      ...modulesRef,
      ...extra,
      ...lanInfo,
      status: serverStatus,
      host: os.hostname(),
      ...(mixerStatus ? { mixer_status: mixerStatus } : {}),
      ...(gsmDevice ? { gsm_device: gsmDevice } : {}),
      ...(monitorStats ? { monitor_stats: monitorStats } : {})
    }
  };
  const { error: errA } = await dbCore.from('jjp_server_control').update(payload).eq('id', 1);
  if (errA) log.warn({ err: errA.message }, 'heartbeat falló en VPS');
}

async function runCommand(cmd) {
  if (handling) return;
  handling = true;
  // Limpiar el comando ANTES de ejecutarlo en ambos proyectos (evita re-disparos)
  try {
    const { data: cur } = await dbCore.from('jjp_server_control').select('modules').eq('id', 1).maybeSingle();
    const mods = (cur?.modules && typeof cur.modules === 'object') ? { ...cur.modules, command: null } : { command: null };
    await dbCore.from('jjp_server_control').update({ modules: mods, updated_at: new Date().toISOString() }).eq('id', 1);
  } catch (_) {}

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

  if (cmd && (cmd.startsWith('search_images:') || cmd.startsWith('search_product_images:'))) {
    const rawRest = cmd.replace(/^search_images:|^search_product_images:/, '').trim();
    let reqId = null;
    let rawQuery = rawRest;
    if (rawRest.startsWith('req_')) {
      const parts = rawRest.split(':');
      reqId = parts[0];
      rawQuery = parts.slice(1).join(':').trim();
    }

    log.info({ rawQuery, reqId }, 'comando de búsqueda inteligente de imágenes recibido vía Supabase');
    try {
      const { searchProductImagesOnWeb } = await import('./product-images.js');
      const results = await searchProductImagesOnWeb(rawQuery);
      await db.from('jjp_server_control').update({
        command_res: { ok: true, type: 'search_images', reqId, query: rawQuery, results, at: new Date().toISOString() }
      }).eq('id', 1);
    } catch (e) {
      log.warn({ err: e.message }, 'Error en búsqueda inteligente de imágenes');
      await db.from('jjp_server_control').update({
        command_res: { ok: false, type: 'search_images', reqId, query: rawQuery, error: e.message, at: new Date().toISOString() }
      }).eq('id', 1);
    }
    handling = false;
    return;
  }

  if (cmd && cmd.startsWith('save_product_image:')) {
    log.info('comando de guardado de imagen de producto recibido vía Supabase');
    try {
      const payload = JSON.parse(cmd.replace(/^save_product_image:/, ''));
      const { saveProductImageToStorage } = await import('./product-images.js');
      const res = await saveProductImageToStorage(payload.product_id, payload.image_url);
      await db.from('jjp_server_control').update({
        command_res: { ok: true, type: 'save_product_image', ...res, at: new Date().toISOString() }
      }).eq('id', 1);
    } catch (e) {
      log.warn({ err: e.message }, 'Error guardando imagen de producto en Storage');
      await db.from('jjp_server_control').update({
        command_res: { ok: false, type: 'save_product_image', error: e.message, at: new Date().toISOString() }
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

  if (cmd && (cmd.startsWith('optimize:') || cmd === 'optimize_all' || cmd === 'vacuum_core' || cmd === 'vacuum_comm')) {
    const action = cmd.includes(':') ? cmd.split(':')[1].trim() : cmd;
    log.info({ action }, 'Comando de optimización PostgreSQL recibido vía Supabase');
    try {
      const { executeOptimization } = await import('./monitor.js');
      const optRes = await executeOptimization(action);
      await db.from('jjp_server_control').update({
        command_res: { ok: true, type: 'optimize', action, ...optRes, at: new Date().toISOString() }
      }).eq('id', 1);
      log.info({ action, optRes }, 'Optimización PostgreSQL completada con éxito.');
    } catch (e) {
      log.warn({ err: e.message, action }, 'Error ejecutando optimización PostgreSQL');
      await db.from('jjp_server_control').update({
        command_res: { ok: false, type: 'optimize', action, error: e.message, at: new Date().toISOString() }
      }).eq('id', 1);
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
    heartbeat_at: now,
    updated_at: now,
    modules: {
      ...modulesRef,
      ...lanInfo,
      started_at: now,
      status: 'online',
      host: os.hostname(),
      command: null
    }
  };
  dbCore.from('jjp_server_control').update(startPayload).eq('id', 1).then(({ error }) => {
    if (error) log.warn({ err: error.message }, 'no pude marcar arranque del server en VPS');
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

  // Revisar comando periódicamente desde modules JSONB en jjp_server_control
  pollTimer = setInterval(async () => {
    try {
      const { data: row } = await dbCore.from('jjp_server_control').select('modules').eq('id', 1).maybeSingle();
      const cmd = row?.modules?.command;
      if (cmd) await runCommand(cmd).catch(() => {});
    } catch (_) {}
  }, POLL_MS);

  log.info('heartbeat + control activos (jjp_server_control)');
}
