import { log } from './logger.js';
import * as manager from './session-manager.js';
import { startOutbox } from './outbox.js';
import { startCampaigns } from './campaigns.js';
import { startInvoiceAlerts } from './invoices.js';
import { startRates } from './rates.js';

log.info('JJ Paper wa-server — puente WhatsApp ↔ Supabase');
log.info('Los QR y los chats se manejan desde el panel web (admin/whatsapp.html · vendedor/whatsapp.html)');

await manager.boot();
startOutbox(manager);
startCampaigns(manager);   // difusión masiva con throttle (vendedor/difusion.html)
startInvoiceAlerts(manager);   // recordatorios de facturas por pagar → WhatsApp del dueño
startRates();   // actualiza BCV + USDT/paralelo en jjp_settings cada hora

process.on('SIGINT', () => { log.info('apagando…'); process.exit(0); });
process.on('unhandledRejection', e => log.error({ err: e?.message || e }, 'unhandledRejection'));
process.on('uncaughtException', e => log.error({ err: e?.message, stack: e?.stack }, 'uncaughtException'));
