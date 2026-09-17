/* ======================================================
   JJ Paper Vendedor — POS (toma de pedido rápida)
   ====================================================== */

let posProducts = [];
let posTicket   = {};      // key → { id, variant_id, name, brand, qty, unit, price_usd, stock }
let posCustomer = null;    // cliente elegido del CRM (o null si es nuevo)
let posSubmitting = false;
let posCursor = -1;        // índice del resultado resaltado por teclado
let posResultsList = [];   // lista de resultados actualmente renderizada
let posLinkedQuoteId = null; // ID de cotización origen si la venta proviene de una cotización

async function initPos() {
  const isAdmin = (SELLER?.role === 'admin' || CURRENT_PROFILE?.role === 'admin');
  const max = isAdmin ? 100 : (Number(SELLER?.max_discount_pct) || 0);
  document.getElementById('posDiscMax').textContent = isAdmin ? '(Admin)' : `(máx ${max}%)`;
  document.getElementById('posDisc').max = max;

  posProducts = await pfLoad();          // buscador universal (nombre/SKU/código/marca)
  posRenderResults(pfMatch(posProducts, ''));
  posPrefillAdd();                        // ?add=<id> desde Consultar stock
  pfPhoneBridge(posOnScan);               // teléfono → agrega al ticket en vivo
  posInitCustomerKeys();                  // teclado ↑/↓/Enter en resultados de cliente
  posInitGlobalKeys();                    // atajos globales (F1, F2, F3, F4, F8, F9, Esc)

  // prefill de cliente si viene desde el CRM (?tel=... o ?cliente=<id>)
  const params = new URLSearchParams(location.search);
  const tel = params.get('tel');
  if (tel) {
    document.getElementById('posCliSearch').value = tel;
    posSearchCustomer();
  }
  const cliente = params.get('cliente');
  if (cliente) await posCargarCliente(cliente);

  // Carga directa de cotización si viene por URL (?quote=COT-... o ?cotizacion=...)
  const quoteParam = params.get('quote') || params.get('cotizacion');
  if (quoteParam) await posLoadQuote(quoteParam);

  // Autocompletado de cliente en el campo Nombre (elige → rellena tel/RIF/ciudad)
  custAcBind({
    nameId: 'posCliName',
    boxId: 'posCliNameResults',
    onPick: posPickCustomer,
    onChange: () => { posCustomer = null; },
  });
}

/* Llega con el cliente ya elegido desde el chat, el correo o la ficha:
   no hay que volver a escribir su nombre ni buscarlo. */
async function posCargarCliente(id) {
  const { data: c } = await sb.from('jjp_customers')
    .select('id,name,phone,rif,city,total_orders,total_usd').eq('id', id).maybeSingle();
  if (!c) { showToast('No se encontró ese cliente', 'warn'); return; }
  posPickCustomer(c);
}

/* ---------- Buscador de productos ---------- */
function posSearch() {
  posRenderResults(pfMatch(posProducts, document.getElementById('posSearch').value.trim()));
}

// Enter en el buscador: añade el resultado resaltado, o si el texto es un
// código exacto (lector físico) agrega abriendo la lista de precio A/B/C/D.
function posSearchKey(e) {
  if (document.querySelector('.pf-popup-mask')) return; // popup abierto: no interferir
  if (e.key === 'ArrowDown') { e.preventDefault(); posNav(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); posNav(-1); return; }
  if (e.key === 'PageDown') { e.preventDefault(); posNav(5); return; }
  if (e.key === 'PageUp') { e.preventDefault(); posNav(-5); return; }
  if (e.key === 'Home') { e.preventDefault(); posNavTo(0); return; }
  if (e.key === 'End') { e.preventDefault(); posNavTo(posResultsList.length - 1); return; }
  if (e.key === 'Escape') {
    const se = document.getElementById('posSearch');
    if (se && se.value.trim()) { se.value = ''; posSearch(); }
    else clearPos();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); posSubmit(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const code = document.getElementById('posSearch').value.trim();
  const hit = pfFindByCode(posProducts, code);
  if (hit) {
    posAddAndPick(hit.product, hit.variant);
    showToast('➕ ' + hit.product.name);
    document.getElementById('posSearch').value = '';
    posSearch();
    return;
  }

  const targetIdx = posCursor >= 0 ? posCursor : (posResultsList.length > 0 ? 0 : -1);
  if (targetIdx >= 0 && targetIdx < posResultsList.length) {
    posCursor = targetIdx;
    posPickIdx();
    return;
  }
}

// Limpia el ticket actual (con confirmación si tiene líneas)
function clearPos() {
  if (posTicket && Object.keys(posTicket).length && !confirm('¿Vaciar el ticket actual?')) return;
  posTicket = {};
  posRenderTicket();
  const se = document.getElementById('posSearch');
  if (se) { se.value = ''; se.focus(); }
  posSearch();
}

// Agrega el producto que llega por ?add=<id> (desde Consultar stock)
function posPrefillAdd() {
  const id = new URLSearchParams(location.search).get('add');
  if (!id) return;
  const p = posProducts.find(x => x.id === id);
  if (!p) return;
  const v = (p.jjp_product_variants || []).filter(x => x.active)[0] || null;
  posAddAndPick(p, v);
}

// Escanear con la cámara del propio dispositivo
function posScanCam() {
  pfScanCamera(code => {
    const hit = pfFindByCode(posProducts, code);
    if (hit) { posAddAndPick(hit.product, hit.variant); showToast('➕ ' + hit.product.name); }
    else { document.getElementById('posSearch').value = code; posSearch(); showToast('Código no está en el catálogo; búscalo manual', 'warn'); }
  });
}

// Código que llega del teléfono-escáner (puente) → agrega al ticket con lista de precio
function posOnScan(code) {
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddAndPick(hit.product, hit.variant); showToast('📱➕ ' + hit.product.name); }
  else showToast('📱 Código no está en el catálogo: ' + code, 'warn');
}

// Modal para vincular el teléfono como pistola de código
function posPhone() {
  const url = pfPhoneScanUrl();
  const a = document.getElementById('posPhoneUrl');
  if (a) { a.textContent = url; a.href = url; }
  const qr = document.getElementById('posPhoneQR');
  if (qr) qr.href = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url);
  document.getElementById('posPhoneModal')?.classList.add('op');
}
function closePosPhone() { document.getElementById('posPhoneModal')?.classList.remove('op'); }

function posRenderResults(list) {
  const box = document.getElementById('posResults');
  if (!list.length) {
    posResultsList = []; posCursor = -1;
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0">Sin resultados.</p>'; return;
  }
  posResultsList = list; posCursor = -1;
  box.innerHTML = list.map((p, i) => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${optImg(p.image_url, 200)}" alt="" loading="lazy" decoding="async">`
      : `<span style="font-size:20px">${p.emoji || '📦'}</span>`;
    const vSel = variants.length
      ? `<select class="fi" id="pv-${p.id}" style="width:auto;font-size:12px;padding:5px 8px">
           ${variants.map(v => `<option value="${v.id}">${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')} · ${fmtPrice(v.price_usd)}</option>`).join('')}
         </select>` : '';
    return `<div class="pos-result" data-idx="${i}">
      <div class="pr-img">${img}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${escapeHTML(p.name)}</div>
        <div style="font-size:11px;color:var(--gr)">${pfPriceHtml(p.price_usd, p)} /${escapeHTML(p.unit || 'unid')} · <span class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</span></div>
      </div>
      ${vSel}
      <button class="btn-p sm" onclick="posAdd('${p.id}')">＋</button>
    </div>`;
  }).join('');
}

// Navegación por teclado sobre los resultados (↑/↓ / PgUp/PgDn / Home/End)
function posNav(dir) {
  const rows = (document.getElementById('posResults')?.querySelectorAll('.pos-result')) || [];
  if (!rows.length) return;
  posCursor = (posCursor + dir + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle('on', i === posCursor));
  rows[posCursor]?.scrollIntoView({ block: 'nearest' });
}

function posNavTo(idx) {
  const rows = (document.getElementById('posResults')?.querySelectorAll('.pos-result')) || [];
  if (!rows.length) return;
  if (idx < 0) idx = 0;
  if (idx >= rows.length) idx = rows.length - 1;
  posCursor = idx;
  rows.forEach((r, i) => r.classList.toggle('on', i === posCursor));
  rows[posCursor]?.scrollIntoView({ block: 'nearest' });
}

// Agrega el resultado seleccionado con el cursor (Enter)
function posPickIdx() {
  const p = posResultsList[posCursor];
  if (!p) return;
  const variants = (p.jjp_product_variants || []).filter(v => v.active);
  let variant = null;
  if (variants.length) {
    const vid = document.getElementById(`pv-${p.id}`)?.value;
    variant = variants.find(v => v.id === vid) || variants[0];
  }
  posAddAndPick(p, variant);
}

function posAdd(pid) {
  const p = posProducts.find(x => x.id === pid);
  if (!p) return;
  const variants = (p.jjp_product_variants || []).filter(v => v.active);
  let variant = null;
  if (variants.length) {
    const vid = document.getElementById(`pv-${pid}`)?.value;
    variant = variants.find(v => v.id === vid) || variants[0];
  }
  posAddAndPick(p, variant);
}

// Agrega un producto y abre la mini-lista de precio (MixNet): A/B/C/D o precio propio,
// y luego la cantidad. Todo con teclado.
function posAddAndPick(p, variant) {
  const key = variant ? `${p.id}::${variant.id}` : p.id;
  const isNew = !posTicket[key];
  const prevQty = isNew ? 0 : posTicket[key].qty;
  const prevLevel = isNew ? null : posTicket[key].price_level;
  const prevUsd = isNew ? null : posTicket[key].price_usd;

  posAddResolved(p, variant);

  pfPricePopup(posTicket[key]).then(choice => {
    const l = posTicket[key];
    if (!l) { posRenderTicket(); return; }

    if (!choice) {
      if (isNew) {
        delete posTicket[key];
      } else {
        l.qty = prevQty;
        l.price_level = prevLevel;
        l.price_usd = prevUsd;
      }
      posRenderTicket();
      const se = document.getElementById('posSearch');
      if (se) { se.focus(); se.select(); }
      return;
    }

    if (choice.level) posSetPriceLevel(key, choice.level);
    else if (choice.custom) posUpdatePrice(key, String(choice.custom));

    // Siempre pide cantidad tras elegir el precio (captura en vivo de la toma).
    pfQtyPopup(l).then(qty => {
      if (qty && qty > 0) {
        l.qty = qty;
        posRenderTicket();
      } else if (!qty && isNew) {
        delete posTicket[key];
        posRenderTicket();
      }
      const se = document.getElementById('posSearch');
      if (se) {
        se.value = '';
        posSearch();
        se.focus();
      }
    });
  });
}

// Agrega un producto (con variante ya resuelta) al ticket
function posAddResolved(p, variant) {
  const key = variant ? `${p.id}::${variant.id}` : p.id;
  if (posTicket[key]) {
    posTicket[key].qty += 1;
  } else {
    const src = variant || p;
    posTicket[key] = {
      id: p.id,
      variant_id: variant?.id || null,
      name: p.name,
      sku: (variant?.sku || p.sku || null),   // sale como "Código" en la factura
      brand: variant ? (variant.jjp_brands?.name || variant.variant_name || null) : null,
      unit: p.unit || 'unid',
      price_usd: Number(src.price_usd),
      price_level: 'B',                        // A/B (US$) · C/D (Bs); default B
      price_a: Number(src.price_a) || 0,
      price_b: Number(src.price_b) || 0,
      price_c_bs: Number(src.price_c_bs) || 0,
      price_d_bs: Number(src.price_d_bs) || 0,
      qty: Math.max(1, Number(p.min_qty) || 1),
      stock: variant ? variant.stock : p.stock,
    };
  }
  posRenderTicket();
}

// Precio en bolívares de una línea del ticket: los niveles C/D cotizan directo
// en Bs (valor real del archivo MixNet), A/B usan la conversión del día.
function posLineBs(l) {
  const rate = getRate();
  if (l.price_level === 'C') return Number(l.price_c_bs) || 0;
  if (l.price_level === 'D') return Number(l.price_d_bs) || 0;
  return (Number(l.price_usd) || 0) * rate;
}

// Cambia el nivel de precio de una línea: A/B en US$, C/D en Bs (default B).
function posSetPriceLevel(key, level) {
  const l = posTicket[key];
  if (!l || !['A', 'B', 'C', 'D'].includes(level)) return;
  const rate = getRate();
  let usd = 0;
  if (level === 'A') usd = Number(l.price_a) || 0;
  else if (level === 'B') usd = Number(l.price_usd) || 0;   // precio efectivo (incluye precio personalizado del vendedor)
  else if (level === 'C') usd = (Number(l.price_c_bs) || 0) / rate;
  else if (level === 'D') usd = (Number(l.price_d_bs) || 0) / rate;
  if (!(usd > 0)) { showToast('Este producto no tiene precio ' + level, 'warn'); return; }
  l.price_level = level;
  l.price_usd = +usd.toFixed(2);
  posRenderTicket();
}

/* ---------- Ticket ---------- */
function posQty(key, delta) {
  const l = posTicket[key];
  if (!l) return;
  l.qty += delta;
  if (l.qty <= 0) delete posTicket[key];
  posRenderTicket();
}

function posSetQty(key, val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) {
    delete posTicket[key];
  } else {
    if (posTicket[key]) posTicket[key].qty = n;
  }
  posRenderTicket();
}

function posRemoveLine(key) {
  delete posTicket[key];
  posRenderTicket();
}

function posDiscount() {
  const max = Number(SELLER?.max_discount_pct) || 0;
  let d = parseFloat(document.getElementById('posDisc').value) || 0;
  if (d < 0) d = 0;
  if (d > max) { d = max; document.getElementById('posDisc').value = max; }
  return d;
}

function posRenderTicket() {
  const box  = document.getElementById('posTicket');
  const tots = document.getElementById('posTotals');
  const lines = Object.entries(posTicket);
  if (!lines.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px">Agrega productos desde el buscador.</p>';
    tots.innerHTML = '';
    return;
  }
  box.innerHTML = lines.map(([k, l]) => {
    const lvlBtn = (lv, lbl) => `<button type="button" class="pl${l.price_level === lv ? ' on' : ''}" onclick="posSetPriceLevel('${k}','${lv}')" title="${lbl}">${lv}</button>`;
    return `
    <div class="pos-line" style="display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px dashed #eee">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escapeHTML(l.name)}${l.brand ? ` <small style="color:var(--gm)">(${escapeHTML(l.brand)})</small>` : ''}</div>
        <div style="font-size:10px;color:var(--gr);display:flex;align-items:center;gap:5px;margin-top:2px">
          <span style="color:var(--gm)">Nivel</span>
          <span class="lvl-seg">${lvlBtn('A', 'Precio A (US$)')}${lvlBtn('B', 'Precio B (US$) — mayor frecuente')}${lvlBtn('C', 'Precio C (Bs)')}${lvlBtn('D', 'Precio D (Bs)')}</span>
        </div>
        <div style="font-size:11px;color:var(--gr);display:flex;align-items:center;gap:6px;margin-top:2px">
          <span>Precio:</span>
          <input type="number" step="0.01" class="fi" value="${l.price_usd}" style="width:75px;font-size:11px;padding:2px 4px;margin:0;height:24px" onchange="posUpdatePrice('${k}', this.value)" aria-label="Precio unitario de ${escapeHTML(l.name)}">
          <span>/${escapeHTML(l.unit)}</span>
          <span style="color:#8a6d1a">≈ Bs ${fmtBsNum(posLineBs(l))}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:3px">
        <button type="button" class="qb" onclick="posQty('${k}',-1)" title="Restar 1">−</button>
        <input type="number" min="1" class="fi" value="${l.qty}" style="width:48px;height:24px;text-align:center;padding:2px 4px;margin:0;font-size:12px;font-weight:700" onchange="posSetQty('${k}', this.value)" aria-label="Cantidad">
        <button type="button" class="qb" onclick="posQty('${k}',1)" title="Sumar 1">＋</button>
      </div>
      <strong style="min-width:55px;text-align:right">${fmtPrice(l.price_usd * l.qty)}</strong>
      <button type="button" class="btn-g sm" onclick="posRemoveLine('${k}')" title="Eliminar este producto del ticket" style="padding:2px 5px;color:#dc2626;border:none;background:transparent;cursor:pointer;font-size:14px;margin-left:4px">🗑️</button>
    </div>`;
  }).join('');

  const subtotal = lines.reduce((s, [, l]) => s + l.price_usd * l.qty, 0);
  const d        = posDiscount();
  const rate     = getRate();
  // El descuento NO se aplica hasta que el admin lo apruebe → se cobra a precio lleno
  tots.innerHTML = `
    <div class="pos-tot"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
    ${d > 0 ? `<div class="pos-tot" style="color:var(--gm)"><span>Descuento ${d}% (solicitado)</span><span>⏳ pendiente</span></div>` : ''}
    <div class="pos-tot big"><span>Total a cobrar</span><span>${fmtPrice(subtotal)}</span></div>
    ${sellerShowBs() ? `<div class="pos-tot" style="color:var(--gr)"><span>En bolívares (tasa ${rate.toFixed(2)})</span><span>${fmtBsNum(subtotal * rate)}</span></div>` : ''}
    ${d > 0 ? `<div class="pos-tot" style="color:var(--gr);font-size:11px"><span>Con el descuento quedaría</span><span>${fmtPrice(subtotal * (1 - d / 100))}</span></div>` : ''}`;
}

function posUpdatePrice(key, val) {
  const price = parseFloat(val);
  if (isNaN(price) || price < 0) {
    showToast('Precio inválido', 'warn');
    posRenderTicket();
    return;
  }
  const l = posTicket[key];
  if (!l) return;
  l.price_level = 'M';   // precio digitado a mano
  l.price_usd = +price.toFixed(2);
  posRenderTicket();
}

/* ---------- Cliente (CRM) ---------- */
let posCliTimer = null;
let posCliResults = [];
let posCliCursor = -1;

function posInitCustomerKeys() {
  const inp = document.getElementById('posCliSearch');
  if (!inp || inp.__jjKeys) return;
  inp.__jjKeys = true;
  inp.addEventListener('keydown', e => {
    if (document.querySelector('.pf-popup-mask')) return;
    if (e.key === 'Escape') {
      document.getElementById('posCliResults').innerHTML = '';
      const se = document.getElementById('posSearch');
      if (se) se.focus();
      return;
    }
    const items = document.getElementById('posCliResults').querySelectorAll('.pos-result');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      posCliCursor = Math.min(posCliCursor + 1, items.length - 1);
      paintCliCursor(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      posCliCursor = Math.max(posCliCursor - 1, 0);
      paintCliCursor(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetIdx = posCliCursor >= 0 ? posCliCursor : 0;
      const c = posCliResults[targetIdx];
      if (c) {
        posPickCustomer(c);
        const se = document.getElementById('posSearch');
        if (se) se.focus();
      }
    }
  });
}

function paintCliCursor(items) {
  items.forEach((el, i) => el.classList.toggle('on', i === posCliCursor));
  items[posCliCursor]?.scrollIntoView({ block: 'nearest' });
}

function posSearchCustomer() {
  clearTimeout(posCliTimer);
  posCliTimer = setTimeout(async () => {
    const q = document.getElementById('posCliSearch').value.trim();
    const box = document.getElementById('posCliResults');
    posCustomer = null;
    posCliCursor = -1;
    if (q.length < 3) { box.innerHTML = ''; posCliResults = []; return; }
    const sellerObj = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (typeof CURRENT_PROFILE !== 'undefined' ? CURRENT_PROFILE : null);
    const sellerId = sellerObj?.id;

    let query = sb.from('jjp_customers')
      .select('id,name,phone,rif,city,total_orders,total_usd,seller_id')
      .or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, '') || q}%`);

    if (sellerId) {
      query = query.eq('seller_id', sellerId);
    }

    const { data } = await query.limit(5);
    if (!data?.length) { box.innerHTML = '<p style="font-size:12px;color:var(--gr);margin:4px 0">No está en tu clientela asignada — completa sus datos abajo.</p>'; posCliResults = []; return; }
    posCliResults = data;
    box.innerHTML = data.map((c, i) => `
      <div class="pos-result" data-i="${i}" style="cursor:pointer" onclick='posPickCustomer(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escapeHTML(c.name)}</div>
          <div style="font-size:11px;color:var(--gr)">${escapeHTML(c.phone)} · ${c.total_orders} compras · ${fmtPrice(c.total_usd)}</div>
        </div>
        <span class="btn-o sm">Elegir</span>
      </div>`).join('');
  }, 300);
}

function posPickCustomer(c) {
  posCustomer = c;
  document.getElementById('posCliSearch').value = c.name || '';
  document.getElementById('posCliName').value = c.name || '';
  document.getElementById('posCliTel').value  = c.phone || '';
  document.getElementById('posCliRif').value  = c.rif || '';
  document.getElementById('posCliCity').value = c.city || '';
  document.getElementById('posCliResults').innerHTML =
    `<p style="font-size:12px;color:var(--gm);margin:4px 0">✔ Cliente frecuente seleccionado: <strong>${escapeHTML(c.name)}</strong></p>`;
}

/* ---------- Registrar venta ---------- */
async function posSubmit() {
  if (posSubmitting) return;
  const lines = Object.values(posTicket);
  const name  = document.getElementById('posCliName').value.trim();
  const tel   = document.getElementById('posCliTel').value.trim();
  if (!lines.length) { showToast('El ticket está vacío', 'warn'); return; }
  if (!name || !tel) { showToast('Nombre y teléfono del cliente son obligatorios', 'warn'); return; }

  posSubmitting = true;
  const btn = document.getElementById('posSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    const subtotal = lines.reduce((s, l) => s + l.price_usd * l.qty, 0);
    const d        = posDiscount();
    const rate     = getRate();
    // Descuento solicitado → se cobra a precio lleno hasta que el admin lo apruebe.
    const total    = +subtotal.toFixed(2);
    const payRef   = document.getElementById('posPayRef')?.value.trim() || null;

    // Resolución segura del vendedor activo
    const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
      ? SELLER
      : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
          ? CURRENT_PROFILE
          : ((typeof window !== 'undefined' && window.SELLER) ? window.SELLER : null));
    const sellerId = activeSeller?.id || null;
    const isAdmin = (activeSeller?.role === 'admin');
    const dStatus = (d > 0) ? (isAdmin ? 'approved' : 'pending') : 'none';

    const order = {
      order_number: genOrderNumber(),
      client_name: name,
      phone: tel,
      rif:  document.getElementById('posCliRif')?.value.trim()  || null,
      city: document.getElementById('posCliCity')?.value.trim() || null,
      items: lines.map(l => ({
        id: l.id, variant_id: l.variant_id, name: l.name, brand: l.brand, sku: l.sku || null,
        qty: l.qty, unit: l.unit, price_usd: l.price_usd,
        price_level: l.price_level || 'B',
        price_bs: posLineBs(l) || null,
        subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
      })),
      subtotal_usd: +subtotal.toFixed(2),
      discount_pct: d,
      discount_status: dStatus,
      discount_requested_by: d > 0 ? sellerId : null,
      total_usd: total,
      exchange_rate: rate,
      total_bs: +(total * rate).toFixed(2),
      payment_method: document.getElementById('posMethod')?.value || 'efectivo',
      payment_ref: payRef,
      notes: document.getElementById('posNotes')?.value.trim() || null,
      seller_id: sellerId,
      source: 'pos',
      status: payRef ? 'verificando' : 'pendiente_pago',
      quote_id: posLinkedQuoteId || null,
      customer_id: posCustomer?.id || null,
    };

    const { error } = await sb.from('jjp_orders').insert(order);
    if (error) {
      console.error('pos insert error:', error);
      showToast('No se pudo registrar la venta: ' + (error.message || 'Error en base de datos'), 'err');
      return;
    }

    // Si la venta provino de una cotización, marcar la cotización como convertida
    if (posLinkedQuoteId) {
      sb.from('jjp_quotes').update({ status: 'convertido' }).eq('id', posLinkedQuoteId).then(() => {}).catch(() => {});
      posLinkedQuoteId = null;
    }

    posShowDone(order);
  } catch (err) {
    console.error('Error al procesar la venta:', err);
    showToast('Error inesperado al registrar la venta', 'err');
  } finally {
    posSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '✅ Registrar venta'; }
  }
}

/* Contexto para el hub de envío: la venta recién registrada.
   Antes el único botón abría wa.me con texto pelado; ahora la factura
   sale en PDF por el CRM y queda en el historial del cliente. */
let posLastOrder = null;
function posDoneCtx() {
  const o = posLastOrder || {};
  return {
    nombre: o.client_name, telefono: o.phone, email: o.email || null,
    order: o, docs: ['factura', 'recibo', 'estado', 'catalogo', 'lista'],
  };
}

function posShowDone(o) {
  posLastOrder = o;

  const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
    ? SELLER
    : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
        ? CURRENT_PROFILE
        : ((typeof window !== 'undefined' && window.SELLER) ? window.SELLER : null));
  const sellerName = activeSeller?.name || 'JJ Paper';

  // El mensaje al cliente muestra el precio lleno (el descuento se confirma tras la aprobación del admin)
  const waMsg = `🛒 *PEDIDO ${o.order_number}* — JJ Paper\n\nHola ${o.client_name}, aquí está el resumen de tu compra:\n`
    + (o.items || []).map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + `\n💰 *Total: ${fmtPrice(o.total_usd)}* (${fmtBsNum(o.total_bs)})`
    + `\n\n🔎 Rastrea tu pedido: ${location.origin}/rastreo.html?n=${encodeURIComponent(o.order_number)}`
    + `\n\nAtendido por: ${sellerName} — JJ Paper 📄`;

  const discNote = o.discount_pct > 0
    ? `<div class="co-done-row" style="color:var(--gm)"><span>Descuento ${o.discount_pct}%</span><strong>⏳ pendiente de aprobación del admin</strong></div>`
    : '';

  let sendHubHtml = '';
  try {
    if (typeof sendBotonHTML === 'function') sendHubHtml = sendBotonHTML('posDoneCtx()');
  } catch (e) {
    console.warn('sendBotonHTML error:', e);
  }

  document.getElementById('posDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Pedido <strong>${escapeHTML(o.order_number)}</strong> registrado a nombre de <strong>${escapeHTML(o.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      <div class="co-done-row"><span>Total a cobrar</span><strong>${fmtPrice(o.total_usd)}</strong></div>
      <div class="co-done-row"><span>En bolívares</span><strong>${fmtBsNum(o.total_bs)}</strong></div>
      ${discNote}
      <div class="co-done-row"><span>Estado</span><strong>${o.status === 'verificando' ? 'Verificando pago' : 'Pendiente de pago'}</strong></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-p" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=ambos&print=1"
         title="Imprime la factura y la orden de recibo de una sola vez">🖨️ Factura + Recibo</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura&print=1">🧾 Solo factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo&print=1">📦 Solo recibo</a>
      ${sendHubHtml}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(o.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Solo el resumen</a>
      <button class="btn-p" onclick="posReset()">🛍️ Nueva venta</button>
    </div>`;
  document.getElementById('posDoneModal').classList.add('op');
}

function posReset() {
  posTicket = {}; posCustomer = null;
  posRenderTicket();
  ['posCliSearch', 'posCliName', 'posCliTel', 'posCliRif', 'posCliCity', 'posPayRef', 'posNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('posDisc').value = 0;
  document.getElementById('posCliResults').innerHTML = '';
  document.getElementById('posCliNameResults').innerHTML = '';
  document.getElementById('posCliNameResults').style.display = 'none';
  document.getElementById('posDoneModal').classList.remove('op');
}

/* ---------- Atajos de Teclado Globales del POS ---------- */
function posInitGlobalKeys() {
  if (window.__posGlobalKeysBound) return;
  window.__posGlobalKeysBound = true;

  window.addEventListener('keydown', e => {
    if (document.querySelector('.pf-popup-mask')) return; // popups modal manejan sus teclas

    // F1 o '?' (fuera de inputs): Ayuda visual de atajos
    if (e.key === 'F1' || (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
      e.preventDefault();
      posShowHelpModal();
      return;
    }

    // Escape: cerrar modal de ayuda, teléfono o volver al buscador
    if (e.key === 'Escape') {
      const helpModal = document.getElementById('posShortcutsHelpModal');
      if (helpModal && helpModal.style.display !== 'none') {
        helpModal.style.display = 'none';
        return;
      }
      const doneModal = document.getElementById('posDoneModal');
      if (doneModal && doneModal.classList.contains('op')) {
        posReset();
        return;
      }
      const phoneModal = document.getElementById('posPhoneModal');
      if (phoneModal && phoneModal.classList.contains('op')) {
        closePosPhone();
        return;
      }
      const se = document.getElementById('posSearch');
      if (document.activeElement !== se) {
        if (se) { se.focus(); se.select(); }
      }
      return;
    }

    // F2 o '/' (fuera de inputs): enfocar búsqueda de productos
    if (e.key === 'F2' || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
      e.preventDefault();
      const se = document.getElementById('posSearch');
      if (se) { se.focus(); se.select(); }
      return;
    }

    // F3: enfocar búsqueda de cliente
    if (e.key === 'F3') {
      e.preventDefault();
      const cli = document.getElementById('posCliSearch') || document.getElementById('posCliName');
      if (cli) { cli.focus(); cli.select(); }
      return;
    }

    // F4: enfocar campo de descuento
    if (e.key === 'F4') {
      e.preventDefault();
      const disc = document.getElementById('posDisc');
      if (disc) { disc.focus(); disc.select(); }
      return;
    }

    // F8: enfocar selector de método de pago
    if (e.key === 'F8') {
      e.preventDefault();
      const pm = document.getElementById('posMethod');
      if (pm) pm.focus();
      return;
    }

    // F9 o Ctrl+Enter: registrar venta
    if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      posSubmit();
      return;
    }
  });
}

function posShowHelpModal() {
  let modal = document.getElementById('posShortcutsHelpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'posShortcutsHelpModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:540px;background:#fff;border-radius:12px;padding:22px;box-shadow:0 12px 36px rgba(0,0,0,0.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #e2e8f0;padding-bottom:12px">
          <h3 style="margin:0;font-size:17px;color:#1e293b;display:flex;align-items:center;gap:8px">⌨️ Atajos de Teclado del POS</h3>
          <button type="button" class="btn-g sm" onclick="document.getElementById('posShortcutsHelpModal').style.display='none'">✕ Esc</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;line-height:1.5;color:#334155">
          <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:4px">📦 Catálogo y Búsqueda</b>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F2</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">/</kbd> Buscar producto</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↑</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↓</kbd> Moverse en resultados</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Enter</kbd> Elegir producto</div>
          </div>
          <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:4px">🏷️ Precios y Cantidad</b>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">A</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">B</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">C</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">D</kbd> Nivel directo</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Enter</kbd> Confirmar cantidad</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Esc</kbd> Cancelar selección</div>
          </div>
          <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:4px">👤 Cliente y Descuento</b>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F3</kbd> Buscar cliente</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F4</kbd> Aplicar descuento %</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F8</kbd> Método de pago</div>
          </div>
          <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:4px">🚀 Venta y Acciones</b>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F9</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Ctrl+Enter</kbd> Cobrar</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Esc</kbd> Limpiar / Vaciar</div>
            <div style="margin-top:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F1</kbd> Esta ayuda</div>
          </div>
        </div>
        <div style="text-align:right;margin-top:14px">
          <button type="button" class="btn-p sm" onclick="document.getElementById('posShortcutsHelpModal').style.display='none'">¡Entendido!</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
}

/* ---------- Cargar Cotización en el POS ---------- */
async function posLoadQuote(val) {
  if (!val) return;
  const qStr = String(val).trim();
  const { data: q, error } = await sb.from('jjp_quotes')
    .select('*')
    .or(`quote_number.eq.${qStr},id.eq.${qStr}`)
    .maybeSingle();

  if (error || !q) {
    showToast('No se encontró la cotización ' + qStr, 'warn');
    return;
  }

  if (q.status === 'convertido' || q.status === 'cancelado') {
    alert(`No se puede cargar la cotización porque se encuentra en estado: ${q.status.toUpperCase()}`);
    return;
  }

  posLinkedQuoteId = q.id;

  // 1. Cargar datos del cliente
  const cliName = q.client_name || '';
  const searchEl = document.getElementById('posCliSearch');
  const nameEl = document.getElementById('posCliName');
  const telEl = document.getElementById('posCliTel');
  const rifEl = document.getElementById('posCliRif');
  const cityEl = document.getElementById('posCliCity');
  const resEl = document.getElementById('posCliResults');

  if (searchEl) searchEl.value = cliName;
  if (nameEl) nameEl.value = cliName;
  if (telEl) telEl.value = q.phone || '';
  if (rifEl) rifEl.value = q.rif || '';
  if (cityEl) cityEl.value = q.city || '';
  posCustomer = { name: cliName, phone: q.phone, rif: q.rif, city: q.city, id: q.customer_id || null };

  if (resEl) {
    resEl.innerHTML = `<p style="font-size:12px;color:var(--gm);margin:4px 0">📋 Cotización vinculada: <strong>${escapeHTML(q.quote_number)}</strong> (${escapeHTML(cliName)})</p>`;
  }

  // 2. Cargar productos en el ticket
  posTicket = {};
  const items = Array.isArray(q.items) ? q.items : [];
  for (const item of items) {
    const key = item.variant_id ? `${item.id}::${item.variant_id}` : String(item.id);
    posTicket[key] = {
      id: item.id,
      variant_id: item.variant_id || null,
      name: item.name,
      brand: item.brand || '',
      sku: item.sku || null,
      qty: Number(item.qty) || 1,
      unit: item.unit || 'UND',
      price_usd: Number(item.price_usd) || 0,
      price_level: item.price_level || 'B',
      price_a: item.price_a || item.price_usd || 0,
      price_c_bs: item.price_c_bs || null,
      price_d_bs: item.price_d_bs || null,
      stock: 999
    };
  }

  // 3. Descuento y notas
  if (q.discount_pct) {
    const discEl = document.getElementById('posDisc');
    if (discEl) discEl.value = q.discount_pct;
  }
  const notesEl = document.getElementById('posNotes');
  if (notesEl) {
    notesEl.value = `Cotización ${q.quote_number}${q.notes ? ' · ' + q.notes : ''}`;
  }

  posRenderTicket();
  showToast(`✅ Cotización ${q.quote_number} cargada con ${items.length} producto(s)`, 'ok');
}

async function posOpenLoadQuoteModal() {
  let ovl = document.getElementById('posLoadQuoteModalOvl');
  if (!ovl) {
    ovl = document.createElement('div');
    ovl.id = 'posLoadQuoteModalOvl';
    ovl.className = 'modal-overlay op';
    ovl.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:9999;';
    ovl.innerHTML = `
      <div class="modal-box" style="max-width:640px;width:95%;background:#fff;border-radius:14px;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px">
          <h3 style="margin:0;font-size:16px;color:#1e293b;display:flex;align-items:center;gap:8px">📋 Cargar Cotización en el Ticket</h3>
          <button type="button" class="btn-g sm" onclick="posCloseLoadQuoteModal()">✕ Cerrar</button>
        </div>
        <div style="margin-bottom:12px">
          <input type="text" id="posQuoteSearchInput" class="fi" placeholder="Escribe el N° de cotización (COT-...) o nombre del cliente" style="width:100%" oninput="posSearchQuotesLive()">
        </div>
        <div id="posQuotesModalList" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
          <p style="text-align:center;color:#94a3b8;font-size:13px;padding:12px">Cargando cotizaciones recientes…</p>
        </div>
      </div>
    `;
    ovl.onclick = posCloseLoadQuoteModal;
    document.body.appendChild(ovl);
  }
  ovl.style.display = 'flex';
  document.getElementById('posQuoteSearchInput').value = '';
  await posSearchQuotesLive();
}

function posCloseLoadQuoteModal() {
  const ovl = document.getElementById('posLoadQuoteModalOvl');
  if (ovl) ovl.style.display = 'none';
}

async function posSearchQuotesLive() {
  const box = document.getElementById('posQuotesModalList');
  if (!box) return;
  const qText = (document.getElementById('posQuoteSearchInput')?.value || '').trim();

  let query = sb.from('jjp_quotes')
    .select('id,quote_number,client_name,phone,estimated_total_usd,discount_pct,created_at,status,items')
    .in('status', ['pendiente', 'contactado'])
    .order('created_at', { ascending: false })
    .limit(12);

  if (qText) {
    query = query.or(`quote_number.ilike.%${qText}%,client_name.ilike.%${qText}%`);
  }

  const { data: list, error } = await query;
  if (error || !list?.length) {
    box.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:13px;padding:16px">No hay cotizaciones pendientes que coincidan.</p>';
    return;
  }

  box.innerHTML = list.map(q => {
    const total = Number(q.estimated_total_usd) || 0;
    const itemsCount = Array.isArray(q.items) ? q.items.length : 0;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:#0f172a">${escapeHTML(q.quote_number)} · <span style="font-weight:600;color:#334155">${escapeHTML(q.client_name)}</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${itemsCount} producto(s) · ${fmtPrice(total)} ${q.discount_pct > 0 ? `· Descuento: ${q.discount_pct}%` : ''} · Tel: ${escapeHTML(q.phone || '—')}</div>
        </div>
        <button type="button" class="btn-p sm" onclick="posPickQuoteFromModal('${q.id}')" style="white-space:nowrap;padding:6px 12px">🛍️ Cargar al POS</button>
      </div>
    `;
  }).join('');
}

async function posPickQuoteFromModal(id) {
  posCloseLoadQuoteModal();
  await posLoadQuote(id);
}
