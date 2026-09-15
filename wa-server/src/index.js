import net from 'node:net';
import { log } from './logger.js';
import * as manager from './session-manager.js';
import { startOutbox } from './outbox.js';
import { startCampaigns } from './campaigns.js';
import { startInvoiceAlerts } from './invoices.js';
import { startRates } from './rates.js';
import { startCountLan } from './count-lan.js';
import { startEmail } from './email.js';
import { startEmailCampaigns } from './email-campaigns.js';
import { startHeartbeat } from './heartbeat.js';
import { startWaActions } from './wa-actions.js';
import { startRetention } from './retention.js';
import { startMixer, getMixerStatus } from './mixer.js';

// Candado de Instancia Única (Mutex de Red Local 127.0.0.1:8786):
// Previene terminantemente la ejecución de dos instancias simultáneas de wa-server.
// Si ya hay un proceso corriendo, este nuevo proceso aborta de inmediato con código 3
// (detener limpio sin reiniciar en START-SERVIDOR.bat), evitando colisión de puertos
// y desincronización de WhatsApp ("Bad MAC").
const SINGLE_INSTANCE_PORT = 8786;
await new Promise((resolve, reject) => {
  const lockServer = net.createServer();
  lockServer.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn(`[CANDADO ACTIVO] Otra instancia de wa-server ya se encuentra ejecutándose en el sistema (puerto ${SINGLE_INSTANCE_PORT} ocupado).`);
      log.warn('Abortando esta instancia para proteger los sockets de WhatsApp y evitar colisiones.');
      process.exit(3);
    } else {
      log.error({ err: err.message }, 'Error al verificar candado de instancia única — abortando por seguridad');
      process.exit(3);  // cualquier error de candado → abortar (no correr sin protección)
    }
  });
  lockServer.listen(SINGLE_INSTANCE_PORT, '127.0.0.1', () => {
    log.info(`Candado de instancia única adquirido (127.0.0.1:${SINGLE_INSTANCE_PORT}) ✅`);
    resolve();
  });
});

// Desactivación preventiva de QuickEdit en consola de Windows:
// Previene que clics o selecciones del ratón en la ventana negra suspendan
// de forma síncrona la salida de stdout, congelando el bucle de eventos de Node.js.
if (process.platform === 'win32') {
  try {
    const { exec } = await import('node:child_process');
    exec('reg add "HKCU\\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1 & powershell -NoProfile -ExecutionPolicy Bypass -File disable-quickedit.ps1 >nul 2>&1', { stdio: 'ignore' }, () => {});
  } catch (_) {}
}

log.info('JJ Paper wa-server — puente WhatsApp ↔ Supabase');
log.info('Los QR y los chats se manejan desde el panel web (admin/whatsapp.html · vendedor/whatsapp.html)');

await manager.boot();
startOutbox(manager);
startWaActions(manager);   // reaccionar / marcar leído / "escribiendo…"
startCampaigns(manager);   // difusión masiva con throttle (vendedor/difusion.html)
startInvoiceAlerts(manager);   // recordatorios de facturas por pagar → WhatsApp del dueño
startRates();   // actualiza BCV + USDT/paralelo en jjp_settings cada hora
startCountLan();   // servidor de conteo OFFLINE por WiFi local (teléfono ↔ PC sin internet)
const emailOn = startEmail();   // envío + recepción de correos del CRM (Gmail API por usuario)
startEmailCampaigns();          // campañas de correo (seguimiento/captación) con throttle
startRetention();               // purga storage de correo/WA (adjuntos y html viejos → re-traíbles de Gmail)
startMixer();                   // exportador de pedidos local para el Mixer de facturación

// Latido + control remoto (panel de admin ve estado y puede reiniciar/detener).
// El segundo argumento informa la salud REAL de cada sesión de WhatsApp: antes
// el panel decía 🟢 aunque una sesión estuviera colgada.
startHeartbeat(
  { whatsapp: true, outbox: true, campaigns: true, invoices: true, rates: true, countLan: true, email: emailOn, mixer: true },
  () => {
    const sesiones = manager.all();
    return {
      waSesiones: sesiones.length,
      waSanas: sesiones.filter(s => s.isHealthy()).length,
      waDetalle: sesiones.map(s => ({
        perfil: s.profileId,
        sana: s.isHealthy(),
        minSinSenal: s.lastEventAt ? Math.round((Date.now() - s.lastEventAt) / 60000) : null
      })),
      mixer: getMixerStatus()
    };
  }
);

process.on('SIGINT', () => { log.info('apagando…'); process.exit(0); });

// Monitor de salud interno: auto-reinicio automático ante acumulación de errores
let errorCount = 0;
let lastErrorTime = Date.now();

function handleFatalOrRepeatedError(reason, isCritical = false) {
  const now = Date.now();
  if (now - lastErrorTime > 60_000) {
    errorCount = 1;
  } else {
    errorCount++;
  }
  lastErrorTime = now;

  const errMsg = reason?.message || String(reason || '');
  const isFatalType = isCritical || /EADDRINUSE|Bad MAC|Stream Errored|ECONNREFUSED|ENOTFOUND|WebSocket.*closed/i.test(errMsg);

  if (isFatalType || errorCount >= 4) {
    log.error({ err: errMsg, errorCount, fatal: isFatalType }, 'Auto-diagnóstico: detectado error crítico o repetitivo — reiniciando servidor automáticamente');
    try {
      import('./supabase.js').then(({ db: dbComm, dbCore }) => {
        const payload = {
          status: 'restarting',
          modules: { crashed: true, error: errMsg, restarted_at: new Date().toISOString() }
        };
        dbComm.from('jjp_server_control').update(payload).eq('id', 1).then(() => {}).catch(() => {});
        if (dbCore) dbCore.from('jjp_server_control').update(payload).eq('id', 1).then(() => {}).catch(() => {});
      }).catch(() => {});
    } catch (_) {}

    setTimeout(() => process.exit(1), 600);
  }
}

process.on('unhandledRejection', (e) => {
  log.error({ err: e?.message || e }, 'unhandledRejection');
  handleFatalOrRepeatedError(e, false);
});

process.on('uncaughtException', async (e) => {
  log.error({ err: e?.message, stack: e?.stack }, 'uncaughtException — reiniciando servidor automáticamente');
  handleFatalOrRepeatedError(e, true);
});
