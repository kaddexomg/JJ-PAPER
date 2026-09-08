import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { db, dbCore } from './supabase.js';
import { log, baileysLogger } from './logger.js';
import { MEDIA_BUCKET } from './config.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg; codecs=opus': 'ogg', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'application/pdf': 'pdf'
};

export function extFromMime(mime, fallback = 'bin') {
  if (!mime) return fallback;
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const sub = mime.split('/')[1]?.split(';')[0];
  return sub || fallback;
}

// Media entrante: Baileys → buffer → Storage. Devuelve { path, size } o null.
export async function uploadIncomingMedia(msg, sock, ownerId, chatId, mime) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: baileysLogger,
      reuploadRequest: sock.updateMediaMessage
    });
    const ext = extFromMime(mime);
    const path = `${ownerId}/${chatId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const { error } = await db.storage.from(MEDIA_BUCKET)
      .upload(path, buffer, { contentType: (mime || 'application/octet-stream').split(';')[0] });
    if (error) { log.error({ error: error.message }, 'upload media entrante falló'); return null; }
    return { path, size: buffer.length };
  } catch (e) {
    log.error({ err: e.message }, 'descarga de media entrante falló');
    return null;
  }
}

// Media saliente: Storage → buffer para sock.sendMessage
export async function downloadOutgoingMedia(mediaPath) {
  // Probar en Proyecto B (jjp-wa-media)
  const { data, error } = await db.storage.from(MEDIA_BUCKET).download(mediaPath);
  if (!error && data) return Buffer.from(await data.arrayBuffer());

  // Fallback a Proyecto A (jjp-wa-media)
  const { data: d2, error: e2 } = await dbCore.storage.from(MEDIA_BUCKET).download(mediaPath);
  if (!e2 && d2) return Buffer.from(await d2.arrayBuffer());

  // Fallback a jjp-email-media
  const { data: d3, error: e3 } = await db.storage.from('jjp-email-media').download(mediaPath);
  if (!e3 && d3) return Buffer.from(await d3.arrayBuffer());

  throw new Error('descarga Storage falló: ' + (error?.message || e2?.message || e3?.message));
}
