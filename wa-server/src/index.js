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
import { startMixer } from './mixer.js';

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
      }))
    };
  }
);

process.on('SIGINT', () => { log.info('apagando…'); process.exit(0); });
process.on('unhandledRejection', e => log.error({ err: e?.message || e }, 'unhandledRejection'));

// Antes esto solo se registraba y el proceso seguía vivo en un estado
// indefinido: el panel decía 🟢 pero nada respondía. Ahora se sale con
// código 1 y START-SERVIDOR.bat relanza limpio (el 2 es "detener a propósito").
process.on('uncaughtException', e => {
  log.error({ err: e?.message, stack: e?.stack }, 'uncaughtException — reiniciando el servidor');
  setTimeout(() => process.exit(1), 300);   // deja que el log llegue al archivo
});
