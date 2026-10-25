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

// Media entrante: Baileys → buffer → Almacén KV en jjp_settings (o Storage si existiera). Devuelve { path, size } o null.
export async function uploadIncomingMedia(msg, sock, ownerId, chatId, mime) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: baileysLogger,
      reuploadRequest: sock.updateMediaMessage
    });
    const cleanMime = (mime || 'application/octet-stream').split(';')[0];
    const ext = extFromMime(mime);
    const path = `${ownerId}/${chatId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const dataUri = `data:${cleanMime};base64,${buffer.toString('base64')}`;

    const { error: kvErr } = await dbCore.from('jjp_settings').upsert({
      key: `storage:${MEDIA_BUCKET}:${path}`,
      value: dataUri
    }, { onConflict: 'key' });

    if (kvErr) {
      log.warn({ err: kvErr.message }, 'upload media entrante KV falló');
      return { path: dataUri, size: buffer.length };
    }
    return { path, size: buffer.length };
  } catch (e) {
    log.error({ err: e.message }, 'descarga de media entrante falló');
    return null;
  }
}

// Media saliente: Data URI / URL / KV en jjp_settings → buffer para sock.sendMessage
export async function downloadOutgoingMedia(mediaPath) {
  const clean = String(mediaPath || '').trim();
  if (!clean) throw new Error('mediaPath vacío');

  if (clean.startsWith('data:')) {
    const sep = clean.indexOf(';base64,');
    if (sep !== -1) return Buffer.from(clean.slice(sep + 8), 'base64');
  }

  if (/^https?:\/\//i.test(clean)) {
    const r = await fetch(clean, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Descarga HTTP ${r.status} para ${clean}`);
    return Buffer.from(await r.arrayBuffer());
  }

  const normKey = clean.replace(/^\/+/, '');
  const { data: kvRows } = await dbCore.from('jjp_settings')
    .select('value')
    .in('key', [`storage:${MEDIA_BUCKET}:${normKey}`, `storage:jjp-email-media:${normKey}`])
    .limit(1);

  if (kvRows && kvRows[0]?.value) {
    const val = String(kvRows[0].value);
    const sep = val.indexOf(';base64,');
    if (sep !== -1) return Buffer.from(val.slice(sep + 8), 'base64');
  }

  const { data, error } = await db.storage.from(MEDIA_BUCKET).download(normKey);
  if (!error && data) return Buffer.from(await data.arrayBuffer());

  throw new Error('descarga media saliente falló: ' + (error?.message || 'No encontrado en KV ni Storage'));
}
