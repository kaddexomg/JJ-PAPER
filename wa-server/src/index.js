import { log } from './logger.js';
import * as manager from './session-manager.js';
import { startOutbox } from './outbox.js';

log.info('JJ Paper wa-server — puente WhatsApp ↔ Supabase');
log.info('Los QR y los chats se manejan desde el panel web (admin/whatsapp.html · vendedor/whatsapp.html)');

await manager.boot();
startOutbox(manager);

process.on('SIGINT', () => { log.info('apagando…'); process.exit(0); });
process.on('unhandledRejection', e => log.error({ err: e?.message || e }, 'unhandledRejection'));
process.on('uncaughtException', e => log.error({ err: e?.message, stack: e?.stack }, 'uncaughtException'));
