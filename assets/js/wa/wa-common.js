/* ======================================================
   JJ Paper — CRM WhatsApp · helpers compartidos
   (requiere config.js: sb, escapeHTML, normTxt, showToast)
   ====================================================== */

// Normalización de teléfonos venezolanos — MISMA lógica que wa-server/src/phone.js
function normVePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('58') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '58' + d.slice(1);
  if (d.length === 10 && /^[24]/.test(d)) return '58' + d;
  return d;
}
function waPhoneToJid(p) { return normVePhone(p) + '@s.whatsapp.net'; }

// '584121234567' → '0412-1234567' para mostrar
function waPrettyPhone(p) {
  const d = normVePhone(p);
  if (d.startsWith('58') && d.length === 12) return '0' + d.slice(2, 5) + '-' + d.slice(5);
  return p || '';
}

const WA_TYPE_ICON = {
  image: '📷', video: '🎬', audio: '🎵', document: '📄', sticker: '🩵', unsupported: '❓'
};
const WA_TYPE_LABEL = {
  image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento',
  sticker: 'Sticker', unsupported: 'No soportado'
};
const WA_STATUS_TICK = {
  pending: '🕓', sending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠️'
};

const WA_SESSION_LABEL = {
  disabled: '⛔ Deshabilitada', starting: '⏳ Iniciando…',
  pending_qr: '📷 Esperando escaneo de QR', pending_pairing: '🔢 Esperando código',
  connected: '🟢 Conectado', disconnected: '🔴 Desconectado (¿wa-server apagado?)',
  logged_out: '⚪ Sin vincular', error: '⚠️ Error'
};

// URLs firmadas del bucket privado jjp-wa-media.
// La firma vale 1 h: la caché caduca ANTES (50 min) porque con el panel abierto
// todo el día las imágenes se rompían al vencer la URL guardada.
const WA_URL_TTL = 3600;                    // segundos que pedimos a Supabase
const WA_URL_CACHE_MS = 50 * 60 * 1000;     // margen de seguridad de la caché
const _waUrlCache = new Map();              // path → { p, at }

async function waSignedUrl(path) {
  if (!path) return null;
  const hit = _waUrlCache.get(path);
  if (hit && Date.now() - hit.at < WA_URL_CACHE_MS) return hit.p;
  const p = sb.storage.from('jjp-wa-media').createSignedUrl(path, WA_URL_TTL)
    .then(({ data, error }) => {
      if (error) { _waUrlCache.delete(path); return null; }
      return data.signedUrl;
    });
  _waUrlCache.set(path, { p, at: Date.now() });
  return p;
}

// Hora corta para burbujas y lista
function waTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function waDayLabel(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoy';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Tipo de mensaje según MIME del archivo adjunto
function waTypeFromMime(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
