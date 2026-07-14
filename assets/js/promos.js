/* ======================================================
   JJ Paper — Feed público de Promociones / Combos
   Requiere: config.js (sb, APP, escapeHTML, fmtPrice, fmtBs, openWA)
   ====================================================== */

let promosCache = [];

const PROMO_KIND_LABEL = { promo: '🔥 Oferta', combo: '🎁 Combo', anuncio: '📣 Anuncio' };
const PROMO_THEMES = ['green', 'gold', 'red', 'blue', 'dark'];

// Trae promos activas (RLS ya filtra active=true para el público)
async function loadPromos() {
  const { data, error } = await sb.from('jjp_promos').select('*')
    .order('featured', { ascending: false })
    .order('sort_order')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  promosCache = data.filter(promoIsLive);
  return promosCache;
}

// ¿Está dentro de su ventana de vigencia?
function promoIsLive(p) {
  const now = Date.now();
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return false;
  return true;
}

function promoThemeClass(t) {
  return PROMO_THEMES.includes(t) ? `pr-theme-${t}` : 'pr-theme-green';
}

// Texto de cuenta regresiva ("Termina en 2d 5h") o null
function promoCountdown(p) {
  if (!p.ends_at) return null;
  let ms = new Date(p.ends_at).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const txt = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { txt: `⏳ Termina en ${txt}`, urgent: ms < 86400000 };
}

// % de ahorro si hay precio anterior
function promoSavePct(p) {
  if (!p.price_usd || !p.old_price_usd || +p.old_price_usd <= +p.price_usd) return null;
  return Math.round((1 - p.price_usd / p.old_price_usd) * 100);
}

// Mensaje de WhatsApp por defecto para una promo
function promoWaMsg(p) {
  return p.wa_message || `Hola JJ Paper 👋, me interesa la promoción "${p.title}". ¿Sigue disponible?`;
}

// CTA: link propio o WhatsApp
function promoCtaHTML(p, cls = 'pr-cta') {
  const label = escapeHTML(p.cta_label || (p.cta_url ? 'Ver más' : 'Pedir por WhatsApp'));
  if (p.cta_url) {
    const ext = /^https?:/i.test(p.cta_url) && !p.cta_url.includes(location.host);
    return `<a class="${cls}" href="${escapeHTML(p.cta_url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label} →</a>`;
  }
  return `<a class="${cls} wa" href="https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(promoWaMsg(p))}" target="_blank" rel="noopener">💬 ${label}</a>`;
}

function promoPricesHTML(p) {
  if (!p.price_usd) return '';
  const save = promoSavePct(p);
  return `<div class="pr-prices">
    <span class="pr-price">${fmtPrice(p.price_usd)}</span>
    ${p.old_price_usd ? `<span class="pr-old">${fmtPrice(p.old_price_usd)}</span>` : ''}
    ${save ? `<span class="pr-save">-${save}%</span>` : ''}
    <span class="pr-bs">${fmtBs(p.price_usd)} (tasa BCV)</span>
  </div>`;
}

function promoMediaHTML(p, heroSize = false) {
  if (p.image_url) return `<img src="${escapeHTML(optImg(p.image_url, 800))}" alt="${escapeHTML(p.title)}" loading="lazy" decoding="async">`;
  return `<span class="pr-emoji">${escapeHTML(p.emoji || '🎉')}</span>`;
}

// ---------- Tarjeta ----------
function renderPromoCard(p) {
  const cd = promoCountdown(p);
  return `<article class="promo-card rv vi">
    <div class="pr-media ${promoThemeClass(p.theme)}">
      ${p.badge ? `<span class="pr-badge ${promoSavePct(p) ? 'hot' : ''}">${escapeHTML(p.badge)}</span>` : ''}
      <span class="pr-kind">${PROMO_KIND_LABEL[p.kind] || '🔥 Oferta'}</span>
      ${promoMediaHTML(p)}
    </div>
    <div class="pr-body">
      <h3 class="pr-title">${escapeHTML(p.title)}</h3>
      ${p.description ? `<p class="pr-desc">${escapeHTML(p.description)}</p>` : ''}
      ${promoPricesHTML(p)}
      ${cd ? `<span class="pr-count ${cd.urgent ? 'urgent' : ''}" data-pr-count="${p.id}">${cd.txt}</span>` : ''}
      ${promoCtaHTML(p)}
    </div>
  </article>`;
}

// ---------- Banner destacado (con carrusel si hay varios) ----------
let phTimer = null;

function renderPromoHero(containerId, feats) {
  const box = document.getElementById(containerId);
  if (!box || !feats.length) return;
  let idx = 0;

  const draw = () => {
    const p = feats[idx];
    const cd = promoCountdown(p);
    box.innerHTML = `
    <div class="promo-hero ${promoThemeClass(p.theme)}">
      <div class="ph-deco" style="width:280px;height:280px;top:-110px;right:-70px"></div>
      <div class="ph-deco" style="width:160px;height:160px;bottom:-70px;left:30%"></div>
      <div class="ph-txt">
        ${p.badge ? `<span class="ph-badge">${escapeHTML(p.badge)}</span>` : `<span class="ph-badge">${PROMO_KIND_LABEL[p.kind] || 'Oferta'}</span>`}
        <h3>${escapeHTML(p.title)}</h3>
        ${p.description ? `<p>${escapeHTML(p.description)}</p>` : ''}
        ${p.price_usd ? `<div class="ph-prices">
          <span class="ph-price">${fmtPrice(p.price_usd)}</span>
          ${p.old_price_usd ? `<span class="ph-old">${fmtPrice(p.old_price_usd)}</span>` : ''}
        </div>` : ''}
        ${cd ? `<span class="pr-count ${cd.urgent ? 'urgent' : ''}">${cd.txt}</span>` : ''}
        <div class="ph-acts">${promoCtaHTML(p, 'ph-cta')}</div>
      </div>
      <div class="ph-vis">${promoMediaHTML(p, true)}</div>
    </div>
    ${feats.length > 1 ? `<div class="ph-dots">${feats.map((_, i) =>
      `<button class="${i === idx ? 'on' : ''}" aria-label="Promo ${i + 1}" onclick="phGoto('${containerId}',${i})"></button>`).join('')}</div>` : ''}`;
  };

  // Rotación automática cada 6s
  clearInterval(phTimer);
  if (feats.length > 1) {
    phTimer = setInterval(() => { idx = (idx + 1) % feats.length; draw(); }, 6000);
  }
  box._phState = { feats, setIdx: i => { idx = i; draw(); } };
  draw();
}

function phGoto(containerId, i) {
  const box = document.getElementById(containerId);
  box?._phState?.setIdx(i);
  clearInterval(phTimer);
}

// ---------- Sección de promos en el home ----------
// Muestra la sección solo si hay promos vigentes.
async function renderHomePromos(sectionId, heroId, gridId, limit = 6) {
  const promos = await loadPromos();
  const section = document.getElementById(sectionId);
  if (!section) return;
  if (!promos.length) { section.style.display = 'none'; return; }

  section.style.display = '';
  const feats = promos.filter(p => p.featured);
  const rest  = promos.filter(p => !p.featured).slice(0, limit);

  if (feats.length) renderPromoHero(heroId, feats);
  const grid = document.getElementById(gridId);
  if (grid) {
    grid.innerHTML = rest.length ? rest.map(renderPromoCard).join('')
      : (feats.length ? '' : '');
    if (!rest.length) grid.style.display = 'none';
  }
  startPromoTicker();
}

// ---------- Feed completo (promociones.html) ----------
let promoFilter = 'all';

async function renderPromoFeed(heroId, gridId, filtersId) {
  await loadPromos();
  const feats = promosCache.filter(p => p.featured);
  if (feats.length) renderPromoHero(heroId, feats);
  drawPromoFilters(filtersId, gridId);
  drawPromoGrid(gridId);
  startPromoTicker();
}

function drawPromoFilters(filtersId, gridId) {
  const box = document.getElementById(filtersId);
  if (!box) return;
  const kinds = [
    ['all', '✨ Todas'], ['promo', '🔥 Ofertas'], ['combo', '🎁 Combos'], ['anuncio', '📣 Anuncios'],
  ];
  // Solo mostrar filtros con contenido (además de "Todas")
  const avail = kinds.filter(([k]) => k === 'all' || promosCache.some(p => p.kind === k));
  box.innerHTML = avail.map(([k, label]) =>
    `<button class="pr-chip ${promoFilter === k ? 'on' : ''}" onclick="setPromoFilter('${k}','${filtersId}','${gridId}')">${label}</button>`
  ).join('');
}

function setPromoFilter(k, filtersId, gridId) {
  promoFilter = k;
  drawPromoFilters(filtersId, gridId);
  drawPromoGrid(gridId);
}

function drawPromoGrid(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const list = promoFilter === 'all' ? promosCache : promosCache.filter(p => p.kind === promoFilter);
  if (!list.length) {
    grid.innerHTML = `<div class="pr-empty" style="grid-column:1/-1">
      <div class="pe-ico">🍃</div>
      <h3>No hay promociones por ahora</h3>
      <p>Vuelve pronto o escríbenos por WhatsApp para conocer nuestras ofertas al mayor.</p>
      <a class="btn-p" href="https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent('Hola JJ Paper, ¿tienen promociones o combos disponibles?')}" target="_blank" rel="noopener">💬 Preguntar por WhatsApp</a>
    </div>`;
    return;
  }
  grid.innerHTML = list.map(renderPromoCard).join('');
}

// ---------- Ticker: refresca las cuentas regresivas cada minuto ----------
let promoTicker = null;
function startPromoTicker() {
  clearInterval(promoTicker);
  promoTicker = setInterval(() => {
    document.querySelectorAll('[data-pr-count]').forEach(el => {
      const p = promosCache.find(x => x.id === el.dataset.prCount);
      const cd = p && promoCountdown(p);
      if (cd) { el.textContent = cd.txt; el.classList.toggle('urgent', cd.urgent); }
      else el.remove();
    });
  }, 60000);
}
