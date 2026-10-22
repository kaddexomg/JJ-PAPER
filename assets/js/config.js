/* ======================================================
   JJ Paper — Supabase Config & App Constants
   ====================================================== */

const SUPABASE_URL = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Proyecto B — Comunicación (WhatsApp, Email, Difusión)
const SUPABASE_URL_COMM = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY_COMM = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Proyecto C — Storage e Inventario
const SUPABASE_URL_INV = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY_INV = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Supabase base clients
const _rawSbCore = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: false
  }
});
const _rawSbComm = _rawSbCore;
const _rawSbInv  = _rawSbCore;

// Tablas dedicadas a Proyecto B (Comunicación)
const COMM_TABLES = new Set([
  'jjp_wa_sessions', 'jjp_wa_chats', 'jjp_wa_messages', 'jjp_wa_actions',
  'jjp_wa_templates', 'jjp_wa_campaigns', 'jjp_wa_campaign_targets',
  'jjp_email_accounts', 'jjp_email_company', 'jjp_emails',
  'jjp_email_campaigns', 'jjp_email_campaign_targets', 'jjp_server_control'
]);

const COMM_RPCS = new Set([
  'jjp_wa_ensure_chat', 'jjp_wa_delete_chat', 'jjp_wa_purge_chats',
  'jjp_delete_campaign', 'jjp_delete_email_campaign'
]);

// Proxy transparente en `sb`: Enruta automáticamente a Proyecto B o C según la tabla/RPC
// sin romper absolutamente ningún código existente en los JS del frontend.
const sb = new Proxy(_rawSbCore, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      return function (tableName) {
        if (COMM_TABLES.has(tableName)) return _rawSbComm.from(tableName);
        return _rawSbCore.from(tableName);
      };
    }
    if (prop === 'rpc') {
      return function (fnName, params, options) {
        if (COMM_RPCS.has(fnName)) return _rawSbComm.rpc(fnName, params, options);
        return _rawSbCore.rpc(fnName, params, options);
      };
    }
    if (prop === 'channel') {
      return function (name, opts) {
        // Canales que escuchan eventos de WhatsApp, servidor local o email van a Comm
        if (name && (name.startsWith('wa-') || name.startsWith('difusion-') || name.startsWith('srv-') || name.includes('email'))) {
          return _rawSbComm.channel(name, opts);
        }
        return _rawSbCore.channel(name, opts);
      };
    }
    if (prop === 'storage') {
      return {
        from(bucketName) {
          if (bucketName === 'jjp-wa-media' || bucketName === 'jjp-email-media') {
            return _rawSbComm.storage.from(bucketName);
          }
          if (bucketName === 'jjp-products' || bucketName === 'jjp-receipts') {
            return _rawSbInv.storage.from(bucketName);
          }
          return _rawSbCore.storage.from(bucketName);
        },
        listBuckets: () => _rawSbComm.storage.listBuckets(),
        getBucket: (id) => _rawSbComm.storage.getBucket(id)
      };
    }
    const val = Reflect.get(target, prop, receiver);
    return typeof val === 'function' ? val.bind(target) : val;
  }
});

const sbCore = _rawSbCore;
const sbComm = _rawSbComm;
const sbInv  = _rawSbInv;

if (typeof window !== 'undefined') {
  window.sb = sb;
  window.sbCore = sbCore;
  window.sbComm = sbComm;
  window.sbInv = sbInv;
}

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
  STORAGE_URL_INV: `${SUPABASE_URL_INV}/storage/v1/object/public/jjp-products/`,
  RECEIPTS_BUCKET: 'jjp-receipts',
  PER_PAGE:      12,
  CART_KEY:      'jjp_cart_v2',
  RATE_KEY:      'jjp_rate',     // sessionStorage key for exchange rate
  SETTINGS:      {},             // full settings map, populated by loadSettings()
};

// Load settings from Supabase, cache with 15-minute TTL and background revalidation
async function loadSettings(force = false) {
  const cached = sessionStorage.getItem('jjp_settings') || localStorage.getItem('jjp_settings');
  const cachedAt = parseInt(sessionStorage.getItem('jjp_settings_at') || localStorage.getItem('jjp_settings_at') || '0', 10);
  const isFresh = (Date.now() - cachedAt) < 15 * 60 * 1000;

  if (cached && !force) {
    try {
      const map = JSON.parse(cached);
      applySettings(map);
      if (isFresh) {
        ensureFreshRate().catch(() => {});
        return map;
      }
    } catch (_) {}
  }

  try {
    const { data, error } = await sb.from('jjp_settings').select('key,value');
    if (!error && data) {
      const map = {};
      data.forEach(r => { map[r.key] = r.value; });
      try {
        const now = Date.now().toString();
        localStorage.setItem('jjp_settings', JSON.stringify(map));
        localStorage.setItem('jjp_settings_at', now);
        sessionStorage.setItem('jjp_settings', JSON.stringify(map));
        sessionStorage.setItem('jjp_settings_at', now);
      } catch (_) {}
      applySettings(map);
      ensureFreshRate().catch(() => {});
      return map;
    }
  } catch (e) {
    console.warn('loadSettings network warning:', e);
  }

  ensureFreshRate().catch(() => {});
  return {};
}

// Expose settings on APP for the whole app
function applySettings(map) {
  APP.SETTINGS = map;
  const rateVal = parseFloat(map.exchange_rate || map.rate_bcv || 0);
  if (rateVal > 0) {
    APP.EXCHANGE_RATE = rateVal;
    try { sessionStorage.setItem(APP.RATE_KEY, String(rateVal)); } catch (_) {}
  }
  if (map.whatsapp_number) APP.WA_NUM = map.whatsapp_number;
  if (map.whatsapp_message) APP.WA_MSG = map.whatsapp_message;
  // Todos los enlaces marcados con data-wa-msg usan el número configurado
  document.querySelectorAll('[data-wa-msg]').forEach(el => {
    el.href = `https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(el.dataset.waMsg || APP.WA_MSG)}`;
  });
  // Disparar evento de actualización de tasa para componentes reactivos
  try {
    window.dispatchEvent(new CustomEvent('jjp_rate_updated', { detail: { rate: getRate(), settings: map } }));
  } catch (_) {}
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
      if (r.bcv) {
        APP.EXCHANGE_RATE = r.bcv;
        try { sessionStorage.setItem(APP.RATE_KEY, String(r.bcv)); } catch (_) {}
        window.dispatchEvent(new CustomEvent('jjp_rate_updated', { detail: { rate: r.bcv, settings: APP.SETTINGS } }));
      }
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

// Obtención del correlativo oficial soberano MixNet (8 dígitos: ej. 00053494 / 00112771)
// MXNUMCOT / MXNUMPED son los dueños sagrados de la correlativa serial. Prohibido inventar números aleatorios.
async function fetchNextDocSerial(type = 'pedido') {
  const isCot = (type === 'cotizacion' || type === 'quote');
  const settingKey = isCot ? 'mixnet_next_quote_serial' : 'mixnet_next_order_serial';

  // 1. Intento LAN Bridge local directo (si la PC o el servidor de red están en la misma LAN)
  const lanHosts = ['http://localhost:8787', 'http://192.168.0.172:8787', 'http://192.168.0.185:8790'];
  for (const host of lanHosts) {
    try {
      const resp = await fetch(`${host}/lan/mixnet/next-serial?type=${isCot ? 'cotizacion' : 'pedido'}`, {
        signal: AbortSignal.timeout(600)
      });
      if (resp.ok) {
        const body = await resp.json();
        if (body?.ok && body.serial && /^\d{8}$/.test(String(body.serial).trim())) {
          return String(body.serial).trim();
        }
      }
    } catch (_) {}
  }

  // 2. Intento RPC atómica en Supabase Core
  try {
    const { data, error } = await sbCore.rpc('jjp_next_doc_serial', { p_type: isCot ? 'cotizacion' : 'pedido' });
    if (!error && data && /^\d{1,8}$/.test(String(data).trim())) {
      return String(data).padStart(8, '0').slice(-8);
    }
  } catch (e) {
    console.warn('RPC jjp_next_doc_serial fallo:', e);
  }

  // 3. Consulta de la tabla de ajustes sincronizada por el puente LAN (jjp_settings)
  try {
    const { data: sRow } = await sbCore.from('jjp_settings')
      .select('value')
      .eq('key', settingKey)
      .maybeSingle();
    if (sRow?.value && /^\d{1,8}$/.test(String(sRow.value).trim())) {
      return String(sRow.value).padStart(8, '0').slice(-8);
    }
  } catch (_) {}

  // 4. Último registro correlativo existente en la base de datos + 1
  try {
    const table = isCot ? 'jjp_quotes' : 'jjp_orders';
    const field = isCot ? 'quote_number' : 'order_number';
    const { data: lastRows } = await sbCore.from(table)
      .select(field)
      .order('created_at', { ascending: false })
      .limit(20);
    if (lastRows && lastRows.length > 0) {
      for (const r of lastRows) {
        const val = String(r[field] || '').trim();
        if (/^\d{8}$/.test(val)) {
          const nextVal = parseInt(val, 10) + 1;
          if (!isNaN(nextVal) && nextVal > 0) {
            return String(nextVal).padStart(8, '0').slice(-8);
          }
        }
      }
    }
  } catch (_) {}

  // NUNCA generar números aleatorios arbitrarios. Si no hay conexión o no se pudo
  // obtener el serial soberano de MixNet, retorna null para alertar al operador.
  console.error(`[MXNUM CRITICAL] No se pudo obtener el correlativo soberano de MixNet para ${type}.`);
  return null;
}

function genOrderNumber() {
  console.warn('genOrderNumber(): funcion obsoleta. Use fetchNextDocSerial()');
  return null;
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
