import { db } from './supabase.js';
import { log } from './logger.js';
import { OUTBOX_SWEEP_MS, MAX_RETRIES } from './config.js';
import { downloadOutgoingMedia } from './media.js';
import { touchChat, PREVIEW_BY_TYPE } from './chats.js';
import { recordLiveRequest } from './monitor.js';
import { syncCounts } from './campaigns.js';

// Cola de salientes: Realtime (INSERT pending) + barrido de respaldo cada 30s.
// Fase 2 (masivos): aquí va el throttling — espera configurable entre envíos.

let manager = null;
let processing = false;

// Caché de media en memoria (Cambio 1)
const mediaCache = new Map();
const CACHE_TTL = 12 * 60 * 60_000; // 12 horas

export function startOutbox(sessionManager) {
  manager = sessionManager;

  db.channel('wa-server-outbox')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_wa_messages', filter: 'status=eq.pending' },
      () => sweep().catch(e => log.error({ err: e.message }, 'outbox sweep falló')))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_wa_messages', filter: 'status=eq.pending' },
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
  let session = manager.get(row.owner_id);
  let usedFallback = false;
  if (!session?.isConnected()) {
    // Si la sesión del owner asignado no está conectada, usar cualquier sesión sana activa
    const fallback = manager.all().find(s => s.isHealthy());
    if (fallback) {
      session = fallback;
      usedFallback = true;
    } else {
      return;   // queda pending hasta que una sesión conecte
    }
  }

  const jid = row.jjp_wa_chats?.jid;
  if (!jid) {
    // Mensaje sin JID válido → marcar como failed para no bloquear la cola
    log.warn({ id: row.id }, 'mensaje sin JID de chat válido → marcado como failed');
    await db.from('jjp_wa_messages').update({
      status: 'failed',
      error: 'Chat sin JID de WhatsApp válido'
    }).eq('id', row.id);
    return;
  }

  // Backoff exponencial: si ya falló antes, esperar antes de reintentar
  const retries = row.retry_count || 0;
  if (retries > 0) {
    const backoffMs = Math.min(retries * 30_000, 180_000); // 30s, 60s, 90s... max 3min
    const retryAfter = new Date(row.updated_at || row.created_at).getTime() + backoffMs;
    if (Date.now() < retryAfter) return; // aún no es tiempo de reintentar
  }

  // Lock optimista: si otro ciclo ya lo tomó, no afecta filas
  const { data: locked } = await db.from('jjp_wa_messages')
    .update({ status: 'sending' })
    .eq('id', row.id).eq('status', 'pending')
    .select('id');
  if (!locked?.length) return;

  try {
    // Validar que el número tiene WhatsApp antes de enviar
    const phone = jid.replace(/@.*$/, '');
    try {
      const [exists] = await session.sock.onWhatsApp(jid);
      if (!exists?.exists) {
        await db.from('jjp_wa_messages').update({
          status: 'failed',
          error: `Número ${phone} no tiene WhatsApp activo`
        }).eq('id', row.id);

        const { data: ctList } = await db.from('jjp_wa_campaign_targets')
          .update({ status: 'skipped', error: `Número ${phone} no tiene WhatsApp activo` })
          .eq('message_id', row.id)
          .select('campaign_id');
        if (ctList?.length) {
          for (const ct of ctList) {
            await syncCounts(ct.campaign_id).catch(() => {});
          }
        }

        log.warn({ id: row.id, phone }, 'número sin WhatsApp → mensaje marcado como failed y target omitido');
        return;
      }
    } catch (valErr) {
      // Si la validación falla (timeout, etc.), intentar enviar de todos modos
      log.warn({ id: row.id, err: valErr.message }, 'validación onWhatsApp falló, intentando envío directo');
    }

    const content = await buildContent(row);
    // Cita (responder a un mensaje): stub mínimo que Baileys usa para el contextInfo
    const options = row.reply_to_wa_id ? {
      quoted: {
        key: { remoteJid: row.jjp_wa_chats.jid, id: row.reply_to_wa_id, fromMe: row.reply_from === 'me' },
        message: { conversation: row.reply_preview || '' }
      }
    } : undefined;
    const res = await session.send(row.jjp_wa_chats.jid, content, options);
    const updatePayload = {
      status: 'sent',
      wa_msg_id: res?.key?.id || null,
      error: null,
      wa_timestamp: new Date().toISOString()
    };
    // Si usamos sesión fallback, guardar quién realmente envió para que onReceipts funcione
    if (usedFallback) updatePayload.sent_by = session.profileId;
    await db.from('jjp_wa_messages').update(updatePayload).eq('id', row.id);

    // Sincronizar target de campaña a sent si este mensaje pertenece a una
    const { data: ctSentList } = await db.from('jjp_wa_campaign_targets')
      .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
      .eq('message_id', row.id)
      .select('campaign_id');
    if (ctSentList?.length) {
      for (const ct of ctSentList) {
        await syncCounts(ct.campaign_id).catch(() => {});
      }
    }

    const preview = row.body || PREVIEW_BY_TYPE[row.type] || '';
    await touchChat(row.chat_id, preview, 'me', false);
    recordLiveRequest({
      type: 'WA',
      method: 'OUTBOX',
      path: `jid:${row.jjp_wa_chats?.jid || 'chat'}`,
      status: 200,
      detail: `Mensaje WA despachado (${row.type})${usedFallback ? ' [vía sesión fallback]' : ''}`
    });
    log.info({ id: row.id, type: row.type, fallback: usedFallback }, 'mensaje enviado');
  } catch (e) {
    const newRetries = retries + 1;
    const failed = newRetries >= MAX_RETRIES;
    await db.from('jjp_wa_messages').update({
      status: failed ? 'failed' : 'pending',
      retry_count: newRetries,
      error: e.message
    }).eq('id', row.id);

    if (failed) {
      const { data: ctFailList } = await db.from('jjp_wa_campaign_targets')
        .update({ status: 'failed', error: e.message })
        .eq('message_id', row.id)
        .select('campaign_id');
      if (ctFailList?.length) {
        for (const ct of ctFailList) {
          await syncCounts(ct.campaign_id).catch(() => {});
        }
      }
    }

    log.warn({ id: row.id, retries: newRetries, failed, err: e.message }, 'envío falló');
  }
}

async function getCachedMedia(mediaPath) {
  const cached = mediaCache.get(mediaPath);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.buffer;
  
  const buffer = await downloadOutgoingMedia(mediaPath);
  mediaCache.set(mediaPath, { buffer, ts: Date.now() });
  
  // Limpiar entradas viejas (evitar memory leak)
  for (const [k, v] of mediaCache) {
    if (Date.now() - v.ts > CACHE_TTL) mediaCache.delete(k);
  }
  return buffer;
}

async function buildContent(row) {
  if (row.type === 'text') return { text: row.body || '' };
  const buffer = await getCachedMedia(row.media_path);
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
