import { db } from './supabase.js';
import { log } from './logger.js';
import { OUTBOX_SWEEP_MS, MAX_RETRIES } from './config.js';
import { downloadOutgoingMedia } from './media.js';
import { touchChat, PREVIEW_BY_TYPE } from './chats.js';

// Cola de salientes: Realtime (INSERT pending) + barrido de respaldo cada 30s.
// Fase 2 (masivos): aquí va el throttling — espera configurable entre envíos.

let manager = null;
let processing = false;

export function startOutbox(sessionManager) {
  manager = sessionManager;

  db.channel('wa-server-outbox')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_wa_messages', filter: 'status=eq.pending' },
      () => sweep().catch(e => log.error({ err: e.message }, 'outbox sweep falló')))
    .subscribe(st => log.info({ st }, 'realtime outbox'));

  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'outbox sweep falló')), OUTBOX_SWEEP_MS);
  sweep().catch(() => {});
}

async function sweep() {
  if (processing) return;           // un despacho a la vez, en orden
  processing = true;
  try {
    const { data: rows, error } = await db.from('jjp_wa_messages')
      .select('*, jjp_wa_chats(jid)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);
    if (error) { log.error({ error: error.message }, 'select pendientes falló'); return; }
    for (const row of rows || []) await dispatch(row);
  } finally {
    processing = false;
  }
}

async function dispatch(row) {
  const session = manager.get(row.owner_id);
  if (!session?.isConnected()) return;   // queda pending hasta que la sesión conecte

  // Lock optimista: si otro ciclo ya lo tomó, no afecta filas
  const { data: locked } = await db.from('jjp_wa_messages')
    .update({ status: 'sending' })
    .eq('id', row.id).eq('status', 'pending')
    .select('id');
  if (!locked?.length) return;

  try {
    const content = await buildContent(row);
    // Cita (responder a un mensaje): stub mínimo que Baileys usa para el contextInfo
    const options = row.reply_to_wa_id ? {
      quoted: {
        key: { remoteJid: row.jjp_wa_chats.jid, id: row.reply_to_wa_id, fromMe: row.reply_from === 'me' },
        message: { conversation: row.reply_preview || '' }
      }
    } : undefined;
    const res = await session.send(row.jjp_wa_chats.jid, content, options);
    await db.from('jjp_wa_messages').update({
      status: 'sent',
      wa_msg_id: res?.key?.id || null,
      error: null,
      wa_timestamp: new Date().toISOString()
    }).eq('id', row.id);
    const preview = row.body || PREVIEW_BY_TYPE[row.type] || '';
    await touchChat(row.chat_id, preview, 'me', false);
    log.info({ id: row.id, type: row.type }, 'mensaje enviado');
  } catch (e) {
    const retries = (row.retry_count || 0) + 1;
    const failed = retries >= MAX_RETRIES;
    await db.from('jjp_wa_messages').update({
      status: failed ? 'failed' : 'pending',
      retry_count: retries,
      error: e.message
    }).eq('id', row.id);
    log.warn({ id: row.id, retries, failed, err: e.message }, 'envío falló');
  }
}

async function buildContent(row) {
  if (row.type === 'text') return { text: row.body || '' };
  const buffer = await downloadOutgoingMedia(row.media_path);
  const caption = row.body || undefined;
  switch (row.type) {
    case 'image': return { image: buffer, caption, mimetype: row.media_mime || undefined };
    case 'video': return { video: buffer, caption, mimetype: row.media_mime || undefined };
    case 'audio': {
      // Grabaciones del CRM (opus) salen como nota de voz (ptt); archivos mp3/m4a como audio normal
      const isVoice = /opus|ogg|webm/i.test(row.media_mime || '');
      return {
        audio: buffer,
        ptt: isVoice,
        mimetype: isVoice ? 'audio/ogg; codecs=opus' : (row.media_mime || 'audio/mpeg')
      };
    }
    case 'document': return {
      document: buffer, caption,
      mimetype: row.media_mime || 'application/octet-stream',
      fileName: row.media_filename || 'documento'
    };
    default: throw new Error('tipo no soportado para envío: ' + row.type);
  }
}
