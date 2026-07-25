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
// Acuses de entrega dibujados a mano (SVG). Antes eran emojis (🕓 ✓ ✓✓ ⚠️), que
// cada sistema pinta distinto, se ven gigantes y desalineados, y delatan que el
// panel es "casero". Estos heredan el color con currentColor, así el azul de
// "leído" y el rojo de "no se envió" salen del CSS.
const WA_SVG_RELOJ = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.7V8.2l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const WA_SVG_CHECK = '<svg viewBox="0 0 17 16" aria-hidden="true"><path d="M1.8 9.1l3.4 3.4L14.6 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WA_SVG_CHECK2 = '<svg viewBox="0 0 23 16" aria-hidden="true"><path d="M1.6 9.1l3.4 3.4L14.4 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.9 9.1l3.4 3.4L20.7 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WA_SVG_ALERTA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.4 11.4H1.6L8 1.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v3.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".85" fill="currentColor"/></svg>';

const WA_STATUS_TICK = {
  pending: WA_SVG_RELOJ, sending: WA_SVG_RELOJ, sent: WA_SVG_CHECK,
  delivered: WA_SVG_CHECK2, read: WA_SVG_CHECK2, failed: WA_SVG_ALERTA
};

// Texto para lectores de pantalla (el SVG solo no dice nada)
const WA_STATUS_LABEL = {
  pending: 'En cola', sending: 'Enviando', sent: 'Enviado',
  delivered: 'Entregado', read: 'Leído', failed: 'No se envió'
};

// Color de avatar estable a partir del nombre: el mismo cliente siempre sale
// del mismo color, como en WhatsApp (antes todos eran del mismo verde).
const WA_AVATAR_COLORS = [
  ['#16604A', '#1e8264'], ['#1565C0', '#3b8ede'], ['#6A1B9A', '#9440c4'],
  ['#C2185B', '#e2497f'], ['#00695C', '#0d9488'], ['#B8860B', '#C9A24B'],
  ['#4527A0', '#6f4fd8'], ['#AD5300', '#d97b1a']
];
function waAvatarColor(texto) {
  let h = 0;
  for (const ch of String(texto || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WA_AVATAR_COLORS[h % WA_AVATAR_COLORS.length];
}
function waAvatarStyle(texto) {
  const [a, b] = waAvatarColor(texto);
  return `background:linear-gradient(135deg,${a},${b})`;
}

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
