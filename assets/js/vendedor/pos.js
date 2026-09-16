/* ======================================================
   JJ Paper Vendedor — POS (toma de pedido rápida)
   ====================================================== */

let posProducts = [];
let posTicket   = {};      // key → { id, variant_id, name, brand, qty, unit, price_usd, stock }
let posCustomer = null;    // cliente elegido del CRM (o null si es nuevo)
let posSubmitting = false;
let posCursor = -1;        // índice del resultado resaltado por teclado
let posResultsList = [];   // lista de resultados actualmente renderizada

async function initPos() {
  const isAdmin = (SELLER?.role === 'admin' || CURRENT_PROFILE?.role === 'admin');
  const max = isAdmin ? 100 : (Number(SELLER?.max_discount_pct) || 0);
  document.getElementById('posDiscMax').textContent = isAdmin ? '(Admin)' : `(máx ${max}%)`;
  document.getElementById('posDisc').max = max;

  posProducts = await pfLoad();          // buscador universal (nombre/SKU/código/marca)
  posRenderResults(pfMatch(posProducts, ''));
  posPrefillAdd();                        // ?add=<id> desde Consultar stock
  pfPhoneBridge(posOnScan);               // teléfono → agrega al ticket en vivo

  // prefill de cliente si viene desde el CRM (?tel=... o ?cliente=<id>)
  const params = new URLSearchParams(location.search);
  const tel = params.get('tel');
  if (tel) {
    document.getElementById('posCliSearch').value = tel;
    posSearchCustomer();
  }
  const cliente = params.get('cliente');
  if (cliente) await posCargarCliente(cliente);

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
// código exacto (lector físico) agrega directo con el precio actualizado.
function posSearchKey(e) {
  if (document.querySelector('.pf-popup-mask')) return; // popup abierto: no interferir
  if (e.key === 'ArrowDown') { e.preventDefault(); posNav(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); posNav(-1); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (posCursor >= 0 && posCursor < posResultsList.length) { posPickIdx(); return; }
  const code = document.getElementById('posSearch').value.trim();
  const hit = pfFindByCode(posProducts, code);
  if (hit) {
    posAddResolved(hit.product, hit.variant);
    showToast('➕ ' + hit.product.name);
    document.getElementById('posSearch').value = '';
    posSearch();
  }
}

// Agrega el producto que llega por ?add=<id> (desde Consultar stock)
function posPrefillAdd() {
  const id = new URLSearchParams(location.search).get('add');
  if (!id) return;
  const p = posProducts.find(x => x.id === id);
  if (!p) return;
  const v = (p.jjp_product_variants || []).filter(x => x.active)[0] || null;
  posAddResolved(p, v);
}

// Escanear con la cámara del propio dispositivo
function posScanCam() {
  pfScanCamera(code => {
    const hit = pfFindByCode(posProducts, code);
    if (hit) { posAddResolved(hit.product, hit.variant); showToast('➕ ' + hit.product.name); }
    else { document.getElementById('posSearch').value = code; posSearch(); showToast('Código no está en el catálogo; búscalo manual', 'warn'); }
  });
}

// Código que llega del teléfono-escáner (puente) → agrega al ticket
function posOnScan(code) {
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddResolved(hit.product, hit.variant); showToast('📱➕ ' + hit.product.name); }
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

// Navegación por teclado sobre los resultados (↑/↓)
function posNav(dir) {
  const rows = (document.getElementById('posResults')?.querySelectorAll('.pos-result')) || [];
  if (!rows.length) return;
  posCursor = (posCursor + dir + rows.length) % rows.length;
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

// Agrega un producto y abre la mini-lista de precio (MixNet): A/B/C/D o precio propio
function posAddAndPick(p, variant) {
  const key = variant ? `${p.id}::${variant.id}` : p.id;
  posAddResolved(p, variant);
  pfPricePopup(posTicket[key]).then(choice => {
    const l = posTicket[key];
    if (l && choice) {
      if (choice.level) posSetPriceLevel(key, choice.level);
      else if (choice.custom) posUpdatePrice(key, String(choice.custom));
    }
    posRenderTicket();
    const se = document.getElementById('posSearch');
    if (se) { se.focus(); se.select(); }
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

function posDiscount() {
  const max = Number(SELLER.max_discount_pct) || 0;
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
    <div class="pos-line">
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
      <button class="qb" onclick="posQty('${k}',-1)">−</button>
      <strong style="min-width:22px;text-align:center">${l.qty}</strong>
      <button class="qb" onclick="posQty('${k}',1)">＋</button>
      <strong style="min-width:60px;text-align:right">${fmtPrice(l.price_usd * l.qty)}</strong>
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
function posSearchCustomer() {
  clearTimeout(posCliTimer);
  posCliTimer = setTimeout(async () => {
    const q = document.getElementById('posCliSearch').value.trim();
    const box = document.getElementById('posCliResults');
    posCustomer = null;
    if (q.length < 3) { box.innerHTML = ''; return; }
    const sellerObj = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (typeof CURRENT_PROFILE !== 'undefined' ? CURRENT_PROFILE : null);
    const sellerId = sellerObj?.id;

    let query = sb.from('jjp_customers')
      .select('id,name,phone,rif,city,total_orders,total_usd,seller_id')
      .or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, '') || q}%`);

    if (sellerId) {
      query = query.eq('seller_id', sellerId);
    }

    const { data } = await query.limit(5);
    if (!data?.length) { box.innerHTML = '<p style="font-size:12px;color:var(--gr);margin:4px 0">No está en tu clientela asignada — completa sus datos abajo.</p>'; return; }
    box.innerHTML = data.map(c => `
      <div class="pos-result" style="cursor:pointer" onclick='posPickCustomer(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
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
  btn.disabled = true; btn.textContent = 'Registrando...';

  const subtotal = lines.reduce((s, l) => s + l.price_usd * l.qty, 0);
  const d        = posDiscount();
  const rate     = getRate();
  // Descuento solicitado → se cobra a precio lleno hasta que el admin lo apruebe.
  const total    = +subtotal.toFixed(2);
  const payRef   = document.getElementById('posPayRef').value.trim() || null;

  const order = {
    order_number: genOrderNumber(),
    client_name: name,
    phone: tel,
    rif:  document.getElementById('posCliRif').value.trim()  || null,
    city: document.getElementById('posCliCity').value.trim() || null,
    items: lines.map(l => ({
      id: l.id, variant_id: l.variant_id, name: l.name, brand: l.brand, sku: l.sku || null,
      qty: l.qty, unit: l.unit, price_usd: l.price_usd,
      price_level: l.price_level || 'B',
      price_bs: posLineBs(l) || null,
      subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
    })),
    subtotal_usd: +subtotal.toFixed(2),
    discount_pct: d,
    discount_status: d > 0 ? 'pending' : 'none',
    discount_requested_by: d > 0 ? SELLER.id : null,
    total_usd: total,
    exchange_rate: rate,
    total_bs: +(total * rate).toFixed(2),
    payment_method: document.getElementById('posMethod').value,
    payment_ref: payRef,
    notes: document.getElementById('posNotes').value.trim() || null,
    seller_id: SELLER.id,
    source: 'pos',
    status: payRef ? 'verificando' : 'pendiente_pago',
  };

  const { error } = await sb.from('jjp_orders').insert(order);
  if (error) {
    console.error('pos insert:', error);
    showToast('No se pudo registrar la venta', 'err');
    posSubmitting = false;
    btn.disabled = false; btn.textContent = '✅ Registrar venta';
    return;
  }

  posShowDone(order);
  posSubmitting = false;
  btn.disabled = false; btn.textContent = '✅ Registrar venta';
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
  // El mensaje al cliente muestra el precio lleno (el descuento se confirma tras la aprobación del admin)
  const waMsg = `🛒 *PEDIDO ${o.order_number}* — JJ Paper\n\nHola ${o.client_name}, aquí está el resumen de tu compra:\n`
    + o.items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + `\n💰 *Total: ${fmtPrice(o.total_usd)}* (${fmtBsNum(o.total_bs)})`
    + `\n\n🔎 Rastrea tu pedido: ${location.origin}/rastreo.html?n=${encodeURIComponent(o.order_number)}`
    + `\n\nAtendido por: ${SELLER.name} — JJ Paper 📄`;

  const discNote = o.discount_pct > 0
    ? `<div class="co-done-row" style="color:var(--gm)"><span>Descuento ${o.discount_pct}%</span><strong>⏳ pendiente de aprobación del admin</strong></div>`
    : '';

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
      ${sendBotonHTML('posDoneCtx()')}
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
