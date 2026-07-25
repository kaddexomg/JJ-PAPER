import { db } from './supabase.js';
import { log } from './logger.js';

// Acciones efímeras de WhatsApp que NO son mensajes: reaccionar, marcar leído,
// "escribiendo…", observar la presencia del cliente (watch) y declararnos
// disponibles mientras el panel está abierto (online/offline). El panel inserta
// filas en jjp_wa_actions; aquí se ejecutan contra Baileys y se borran.
// (Presencia vieja no se reintenta.)

let manager = null;
let processing = false;

export function startWaActions(sessionManager) {
  manager = sessionManager;
  db.channel('wa-server-actions')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_wa_actions' },
      () => sweep().catch(e => log.error({ err: e.message }, 'wa actions sweep falló')))
    .subscribe(st => log.info({ st }, 'realtime wa-actions'));
  setInterval(() => sweep().catch(() => {}), 5_000);
  // WhatsApp vence la disponibilidad: se renueva mientras el panel siga abierto
  // y se retira cuando el usuario lo cierra (no aparecer en línea 24/7).
  setInterval(() => {
    for (const s of manager.all?.() || []) {
      try { s.tickPresence(); } catch (e) { /* una sesión no frena a las demás */ }
    }
  }, 60_000);
  sweep().catch(() => {});
}

async function sweep() {
  if (processing) return;
  processing = true;
  try {
    const { data: rows } = await db.from('jjp_wa_actions')
      .select('*').order('created_at', { ascending: true }).limit(50);
    for (const row of rows || []) await run(row);
  } finally {
    processing = false;
  }
}

async function run(row) {
  const session = manager.get(row.owner_id);
  const done = () => db.from('jjp_wa_actions').delete().eq('id', row.id);
  if (session?.isConnected()) {
    try { await session.doAction(row); }
    catch (e) { log.warn({ err: e.message, kind: row.kind }, 'acción WA falló'); }
  }
  await done();   // siempre limpiar (no acumular presencia vieja)
}
