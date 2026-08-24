/* ======================================================
   JJ Paper — Supabase Config & App Constants
   ====================================================== */

const SUPABASE_URL = 'https://czzvsqnmxtjzqzioknnn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enZzcW5teHRqenF6aW9rbm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzI5MzYsImV4cCI6MjEwMzE0ODkzNn0.OcwmkYAP0Ax2_UI3kXAg5C6T-mf4aIeEf__Nz7EAhbc';

// Supabase client (loaded via CDN in each HTML)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Cazador de retorno de OAuth (login con Google) ---------------------------
// Si Supabase, por su "Site URL", devuelve el token a una página pública en vez
// de al login, lo reenviamos a admin/login.html (conservando el #access_token)
// para que enrute por rol. NO da acceso a nada: login.html valida perfil+activo
// antes de entrar, y todas las páginas del panel exigen requireAuth. Corre ANTES
// de que supabase-js consuma el hash (misma vuelta síncrona).
(function routeOAuthToLogin() {
  try {
    const h = location.hash || '';
    if (!/[#&](access_token|error|error_description)=/.test(h)) return;
    const p = location.pathname;
    if (/\/(admin|vendedor)\//.test(p)) return;            // ya está en zona de login/panel
    const base = p.replace(/[^/]*$/, '');                  // carpeta actual (normalmente "/")
    location.replace(location.origin + base + 'admin/login.html' + location.search + h);
  } catch (e) { /* nunca bloquear la carga del sitio por esto */ }
})();

// App config
const APP = {
  WA_NUM:        '584121234567',
  WA_MSG:        'Hola JJ Paper, quisiera informacion sobre sus productos.',
  SITE_NAME:     'JJ Paper',
  STORAGE_URL:   `${SUPABASE_URL}/storage/v1/object/public/jjp-products/`,
  RECEIPTS_BUCKET: 'jjp-receipts',
  PER_PAGE:      12,
  CART_KEY:      'jjp_cart_v2',
  RATE_KEY:      'jjp_rate',     // sessionStorage key for exchange rate
  SETTINGS:      {},             // full settings map, populated by loadSettings()
};

// Load settings from Supabase, cache for session
async function loadSettings() {
  const cached = sessionStorage.getItem('jjp_settings');
  if (cached) {
    const map = JSON.parse(cached);
    applySettings(map);
    await ensureFreshRate();
    return map;
  }

  const { data, error } = await sb.from('jjp_settings').select('key,value');
  if (error || !data) return {};

  const map = {};
  data.forEach(r => { map[r.key] = r.value; });
  sessionStorage.setItem('jjp_settings', JSON.stringify(map));
  applySettings(map);
  await ensureFreshRate();
  return map;
}

// Expose settings on APP for the whole app
function applySettings(map) {
  APP.SETTINGS = map;
  if (map.exchange_rate) APP.EXCHANGE_RATE = parseFloat(map.exchange_rate);
  if (map.whatsapp_number) APP.WA_NUM = map.whatsapp_number;
  if (map.whatsapp_message) APP.WA_MSG = map.whatsapp_message;
  // Todos los enlaces marcados con data-wa-msg usan el número configurado
  document.querySelectorAll('[data-wa-msg]').forEach(el => {
    el.href = `https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(el.dataset.waMsg || APP.WA_MSG)}`;
  });
  // Keep injected footer/contact info in sync (nav.js)
  if (typeof refreshContactUI === 'function') refreshContactUI();
}

// Parse "DD/MM/YYYY HH:MM" (formato usado en rates_updated_at) → Date o null
function parseVeDate(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

// Si la tasa guardada tiene más de 3h, busca las tasas en vivo (dolarapi)
// y las usa para mostrar precios. No escribe en la base (el público no puede);
// el cron del servidor (cada hora) y el panel admin son quienes persisten.
async function ensureFreshRate() {
  try {
    // Preferir el timestamp ISO (UTC, sin ambigüedad de zona horaria);
    // el formato Caracas queda como fallback para datos viejos.
    const iso = APP.SETTINGS?.rates_updated_iso;
    const upd = iso ? new Date(iso) : parseVeDate(APP.SETTINGS?.rates_updated_at);
    const age = (upd && !isNaN(upd)) ? (Date.now() - upd.getTime()) : Infinity;
    if (age < 3 * 3600 * 1000) return;

    // Aplica tasas en vivo a la sesión: BCV (precios) y paralelo (costos/brecha)
    const applyLive = (r) => {
      if (r.bcv) APP.EXCHANGE_RATE = r.bcv;
      if (r.paralelo && APP.SETTINGS) {
        APP.SETTINGS.usdt_rate = String(Math.max(r.paralelo, r.bcv || 0));
      }
    };
    // Throttle: no consultar la API más de una vez por hora por sesión
    const cached = JSON.parse(sessionStorage.getItem('jjp_live_rate') || 'null');
    if (cached && Date.now() - cached.at < 3600 * 1000) {
      applyLive(cached);
      return;
    }
    const rates = await fetchRates();
    if (rates?.bcv) {
      applyLive(rates);
      sessionStorage.setItem('jjp_live_rate', JSON.stringify({ ...rates, at: Date.now() }));
    }
  } catch (e) { /* la tasa guardada sigue siendo el fallback */ }
}

/* ------------------------------------------------------
   Atribución de vendedor por link de referido (?ref=codigo)
   Se guarda 30 días: toda compra en ese lapso se atribuye.
   ------------------------------------------------------ */
const REF_KEY = 'jjp_ref';
const REF_TTL = 30 * 86400e3;   // 30 días

(function captureRef() {
  try {
    const code = new URLSearchParams(location.search).get('ref');
    if (code && /^[a-z0-9_-]{2,30}$/i.test(code)) {
      localStorage.setItem(REF_KEY, JSON.stringify({ code: code.toLowerCase(), at: Date.now() }));
    }
  } catch (e) {}
})();

// Código de referido vigente (o null si no hay / expiró)
function getRefCode() {
  try {
    const r = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (!r || Date.now() - r.at > REF_TTL) return null;
    return r.code;
  } catch (e) { return null; }
}

// Resuelve el seller_id del código vigente (RPC pública, cachea por sesión)
async function resolveRefSeller() {
  const code = getRefCode();
  if (!code) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem('jjp_ref_seller') || 'null');
    if (cached && cached.code === code) return cached.id;
    const { data } = await sb.rpc('jjp_seller_by_ref', { p_code: code });
    if (data) sessionStorage.setItem('jjp_ref_seller', JSON.stringify({ code, id: data }));
    return data || null;
  } catch (e) { return null; }
}

// Normaliza texto para búsquedas sin distinguir acentos/mayúsculas
function normTxt(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Current exchange rate (USD -> Bs) with sane fallback
// Tasa con la que se convierte USD → Bs.
// El vendedor puede fijar la suya (se carga en APP.SELLER_RATE desde sus
// ajustes en vcommon.js); si no, se usa la oficial (BCV) global del negocio.
function getRate() {
  if (APP.SELLER_RATE) return APP.SELLER_RATE;
  return APP.EXCHANGE_RATE || parseFloat(sessionStorage.getItem(APP.RATE_KEY)) || 40;
}

// Convert USD → Bs
function toBs(usd) {
  return (usd * getRate()).toFixed(2);
}

// Format price display
function fmtPrice(usd) {
  return `$${parseFloat(usd).toFixed(2)}`;
}
function fmtBs(usd) {
  return `Bs ${toBs(usd)}`;
}

// Product image: if image_url exists use it; else show emoji on colored bg
function productImgHTML(p, size = 56) {
  if (p.image_url) {
    return `<img src="${p.image_url}" alt="${p.name}" loading="lazy">`;
  }
  const ico = (typeof productIcon === 'function') ? productIcon(p) : (p.emoji || '📦');
  return `<span style="font-size:${size}px">${ico}</span>`;
}

/* ------------------------------------------------------
   Accesibilidad: manejo de foco para diálogos (modal/carrito)
   ------------------------------------------------------ */
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Atrapa Tab dentro de `container` y devuelve función para soltar el trap.
// Recuerda quién tenía el foco para restaurarlo al cerrar.
function trapFocus(container) {
  if (!container) return () => {};
  const prevActive = document.activeElement;
  // getClientRects() funciona con contenedores position:fixed (offsetParent daría null)
  const focusables = () => [...container.querySelectorAll(FOCUSABLE_SEL)]
    .filter(el => el.getClientRects().length > 0 || el === document.activeElement);

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);

  // Foco inicial al primer control del diálogo
  setTimeout(() => { focusables()[0]?.focus(); }, 30);

  return () => {
    container.removeEventListener('keydown', onKey);
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  };
}

// URL de OpenStreetMap embebido a partir de lat/lng (marcador centrado)
function osmEmbed(lat, lng, d = 0.004) {
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

// Enlace "abrir en OpenStreetMap" (para el botón Cómo llegar)
function osmLink(lat, lng, z = 16) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${z}/${lat}/${lng}`;
}

// Imagen de producto: URL directa de Supabase Storage.
// El deploy vive en Cloudflare Pages, donde /.netlify/images no existe (daba 404
// y rompía todas las imágenes en producción). Las imágenes ya se comprimen al
// subir, así que la URL original es suficiente. `width` se acepta por
// compatibilidad con los call sites pero no se usa.
function optImg(url, width) {
  if (!url) return url;
  return encodeURI(url);
}

// WhatsApp open
function openWA(msg) {
  window.open(`https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Date display helper
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// Format Bs with thousands separators (es-VE)
function fmtBsNum(bs) {
  return 'Bs ' + Number(bs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escape user/DB text before injecting into innerHTML (prevents XSS / broken markup)
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Generate a human-friendly order number: JJP-YYMMDD-XXXX
function genOrderNumber(prefix = 'JJP') {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ymd}-${rand}`;
}

/* ======================================================
   Tasas y lógica de precios
   - BCV: tasa oficial → cara al cliente (Bs = USD × BCV)
   - USDT/Binance: tasa a la que compran los distribuidores → costo real
   La brecha entre ambas se incorpora al precio, invisible al cliente.
   ====================================================== */

// Tasa BCV (la que ve el cliente) — es el exchange_rate
function getBcvRate() { return getRate(); }

// Tasa Binance/USDT (para el costo). Si no está configurada, usa la BCV (brecha 0).
function getUsdtRate() {
  const r = parseFloat(APP.SETTINGS?.usdt_rate);
  return (r && r > 0) ? r : getBcvRate();
}

// % de brecha entre Binance y BCV
function getGapPct() {
  const bcv = getBcvRate(), usdt = getUsdtRate();
  if (!bcv) return 0;
  return (usdt / bcv - 1) * 100;
}

// Tasa euro BCV (Bs por EUR). 0 si no está configurada.
function getEurRate() {
  const r = parseFloat(APP.SETTINGS?.rate_eur);
  return (r && r > 0) ? r : 0;
}

// Conversiones con el euro (vía Bs, todas las tasas son Bs/divisa):
//   USD → EUR: monto × BCV_usd / BCV_eur   (para cotizar en €)
//   EUR → USD: monto × BCV_eur / BCV_usd   (costos de proveedor en €)
function usdToEur(usd) {
  const eur = getEurRate(), bcv = getBcvRate();
  return (eur && bcv) ? Number(usd) * bcv / eur : null;
}
function eurToUsd(eurAmt) {
  const eur = getEurRate(), bcv = getBcvRate();
  return (eur && bcv) ? Number(eurAmt) * eur / bcv : null;
}
// Costo en EUR de proveedor → costo ajustado a "USD-BCV" (pasa por Binance igual
// que los costos en USDT: el € del proveedor se repone comprando divisa real).
function eurCostAdjustedUSD(costEur) {
  const usd = eurToUsd(costEur);
  return usd == null ? null : adjustedCostUSD(usd);
}

// Margen global por defecto (%)
function getDefaultMargin() {
  const m = parseFloat(APP.SETTINGS?.default_margin_pct);
  return isNaN(m) ? 0 : m;
}

// Costo ajustado a "USD-BCV": lo que realmente cuesta en el mundo BCV
function adjustedCostUSD(costUsd) {
  const bcv = getBcvRate();
  return bcv ? (Number(costUsd) * getUsdtRate() / bcv) : Number(costUsd);
}

// Precio de venta sugerido en USD = costo ajustado × (1 + margen)
function suggestedPriceUSD(costUsd, marginPct) {
  const m = (marginPct === '' || marginPct == null || isNaN(parseFloat(marginPct)))
    ? getDefaultMargin() : parseFloat(marginPct);
  const price = adjustedCostUSD(costUsd) * (1 + m / 100);
  return Math.round(price * 100) / 100;
}

// Margen real de un precio dado, sobre el costo ajustado (para diagnóstico)
function realMarginPct(priceUsd, costUsd) {
  const adj = adjustedCostUSD(costUsd);
  if (!adj) return null;
  return ((Number(priceUsd) - adj) / adj) * 100;
}

// Trae las 3 tasas: BCV (oficial, dolarapi), Binance P2P real (CriptoYa)
// y Monitor/paralelo (dolarapi). Devuelve { bcv, binance, monitor, paralelo } o null.
// "paralelo" queda como alias de binance por compatibilidad.
async function fetchRates() {
  const getJson = async (url) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
    finally { clearTimeout(t); }
  };
  try {
    const [dolar, cripto, euros] = await Promise.all([
      getJson('https://ve.dolarapi.com/v1/dolares'),
      getJson('https://criptoya.com/api/USDT/VES/1'),
      getJson('https://ve.dolarapi.com/v1/euros'),
    ]);
    const find = f => Number(dolar?.find?.(d => d.fuente === f)?.promedio) || null;
    const bcv = find('oficial'), monitor = find('paralelo');
    const eur = Number(euros?.find?.(d => d.fuente === 'oficial')?.promedio) || null;
    // Binance P2P: promedio ask/bid; si falla, mediana de otros P2P; si no, monitor.
    const mid = x => (x && x.ask > 0 && x.bid > 0) ? (x.ask + x.bid) / 2
              : (x?.ask > 0 ? x.ask : (x?.bid > 0 ? x.bid : null));
    let binance = mid(cripto?.binancep2p);
    if (!binance && cripto) {
      const o = ['bybitp2p', 'bitgetp2p', 'bingxp2p', 'okexp2p']
        .map(k => mid(cripto[k])).filter(Boolean).sort((a, b) => a - b);
      binance = o.length ? o[Math.floor(o.length / 2)] : null;
    }
    binance = binance || monitor;
    if (!bcv && !binance) return null;
    return { bcv, binance, monitor, eur, paralelo: binance };
  } catch (e) {
    console.warn('fetchRates error:', e);
    return null;
  }
}
