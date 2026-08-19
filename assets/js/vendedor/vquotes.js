/* ======================================================
   JJ Paper Vendedor — Cotizador al mayor
   (reusa el buscador/ticket del POS con totales sin pago)
   ====================================================== */

let posProducts = [];
let posTicket   = {};

async function initQuoter() {
  posProducts = await pfLoad();          // buscador universal (nombre/SKU/código/marca)
  posRenderResults(pfMatch(posProducts, ''));
  const params = new URLSearchParams(location.search);
  const id = params.get('add');   // desde Consultar stock
  if (id) {
    const p = posProducts.find(x => x.id === id);
    if (p) posAddResolved(p, (p.jjp_product_variants || []).filter(x => x.active)[0] || null);
  }
  // Viene con el cliente ya elegido (desde el chat de WhatsApp, el correo
  // o la ficha del cliente): sus datos entran solos.
  const cliente = params.get('cliente');
  if (cliente) await quoteCargarCliente(cliente);
  pfPhoneBridge(posOnScan);   // teléfono → agrega a la cotización en vivo

  // Autocompletado de cliente en el campo Nombre (elige → rellena tel/RIF/ciudad)
  custAcBind({
    nameId: 'qCliName',
    boxId: 'qCliNameResults',
    onPick: quotePickCustomer,
  });
}

async function quoteCargarCliente(id) {
  const { data: c } = await sb.from('jjp_customers')
    .select('name,phone,rif,city').eq('id', id).maybeSingle();
  if (!c) { showToast('No se encontró ese cliente', 'warn'); return; }
  const set = (campo, v) => { const el = document.getElementById(campo); if (el && v) el.value = v; };
  set('qCliName', c.name); set('qCliTel', c.phone);
  set('qCliRif', c.rif);   set('qCliCity', c.city);
  showToast(`Cotizando para ${c.name}`);
}

function quotePickCustomer(c) {
  document.getElementById('qCliName').value = c.name || '';
  document.getElementById('qCliTel').value  = c.phone || '';
  document.getElementById('qCliRif').value  = c.rif || '';
  document.getElementById('qCliCity').value = c.city || '';
  document.getElementById('qCliNameResults').innerHTML =
    `<p style="font-size:12px;color:var(--gm);margin:8px 0">✔ Cliente frecuente seleccionado: <strong>${escapeHTML(c.name)}</strong></p>`;
  document.getElementById('qCliNameResults').style.display = 'block';
}

function posOnScan(code) {
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddResolved(hit.product, hit.variant); showToast('📱➕ ' + hit.product.name); }
  else showToast('📱 Código no está en el catálogo: ' + code, 'warn');
}
function posPhone() {
  const url = pfPhoneScanUrl();
  const a = document.getElementById('posPhoneUrl');
  if (a) { a.textContent = url; a.href = url; }
  const qr = document.getElementById('posPhoneQR');
  if (qr) qr.href = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url);
  document.getElementById('posPhoneModal')?.classList.add('op');
}
function closePosPhone() { document.getElementById('posPhoneModal')?.classList.remove('op'); }

/* --- buscador (mismo patrón del POS) --- */
function posSearch() {
  posRenderResults(pfMatch(posProducts, document.getElementById('posSearch').value.trim()));
}

function posSearchKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = document.getElementById('posSearch').value.trim();
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddResolved(hit.product, hit.variant); showToast('➕ ' + hit.product.name); document.getElementById('posSearch').value = ''; posSearch(); }
}
function posScanCam() {
  pfScanCamera(code => {
    const hit = pfFindByCode(posProducts, code);
    if (hit) { posAddResolved(hit.product, hit.variant); showToast('➕ ' + hit.product.name); }
    else { document.getElementById('posSearch').value = code; posSearch(); showToast('Código no está en el catálogo; búscalo manual', 'warn'); }
  });
}

function posRenderResults(list) {
  const box = document.getElementById('posResults');
  if (!list.length) { box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0">Sin resultados.</p>'; return; }
  box.innerHTML = list.map(p => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${optImg(p.image_url, 200)}" alt="" loading="lazy" decoding="async">`
      : `<span style="font-size:20px">${p.emoji || '📦'}</span>`;
    const vSel = variants.length
      ? `<select class="fi" id="pv-${p.id}" style="width:auto;font-size:12px;padding:5px 8px">
           ${variants.map(v => `<option value="${v.id}">${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')} · ${fmtPrice(v.price_usd)}</option>`).join('')}
         </select>` : '';
    return `<div class="pos-result">
      <div class="pr-img">${img}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${escapeHTML(p.name)}</div>
        <div style="font-size:11px;color:var(--gr)">${pfPriceHtml(p.price_usd)} /${escapeHTML(p.unit || 'unid')} · <span class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</span></div>
      </div>
      ${vSel}
      <button class="btn-p sm" onclick="posAdd('${p.id}')">＋</button>
    </div>`;
  }).join('');
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
  posAddResolved(p, variant);
}

function posAddResolved(p, variant) {
  const key = variant ? `${p.id}::${variant.id}` : p.id;
  if (posTicket[key]) posTicket[key].qty += 1;
  else posTicket[key] = {
    id: p.id, variant_id: variant?.id || null, name: p.name,
    sku: (variant?.sku || p.sku || null),   // sale como "Código" en el presupuesto
    brand: variant ? (variant.jjp_brands?.name || variant.variant_name || null) : null,
    unit: p.unit || 'unid',
    price_usd: Number(variant ? variant.price_usd : p.price_usd),
    qty: Math.max(1, Number(p.min_qty) || 1),
    stock: variant ? variant.stock : p.stock,
  };
  posRenderTicket();
}

function posQty(key, delta) {
  const l = posTicket[key];
  if (!l) return;
  l.qty += delta;
  if (l.qty <= 0) delete posTicket[key];
  posRenderTicket();
}

function posRenderTicket() {
  const box  = document.getElementById('posTicket');
  const tots = document.getElementById('posTotals');
  const lines = Object.entries(posTicket);
  if (!lines.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px">Agrega productos desde el buscador.</p>';
    tots.innerHTML = ''; return;
  }
  box.innerHTML = lines.map(([k, l]) => `
    <div class="pos-line">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escapeHTML(l.name)}${l.brand ? ` <small style="color:var(--gm)">(${escapeHTML(l.brand)})</small>` : ''}</div>
        <div style="font-size:11px;color:var(--gr);display:flex;align-items:center;gap:6px;margin-top:2px">
          <span>Precio:</span>
          <input type="number" step="0.01" class="fi" value="${l.price_usd}" style="width:75px;font-size:11px;padding:2px 4px;margin:0;height:24px" onchange="posUpdatePrice('${k}', this.value)" aria-label="Precio unitario de ${escapeHTML(l.name)}">
          <span>/${escapeHTML(l.unit)}</span>
        </div>
      </div>
      <button class="qb" onclick="posQty('${k}',-1)">−</button>
      <strong style="min-width:22px;text-align:center">${l.qty}</strong>
      <button class="qb" onclick="posQty('${k}',1)">＋</button>
      <strong style="min-width:60px;text-align:right">${fmtPrice(l.price_usd * l.qty)}</strong>
    </div>`).join('');

  const subtotal = lines.reduce((s, [, l]) => s + l.price_usd * l.qty, 0);
  const pct   = quoteDiscountPct();
  const total = subtotal * (1 - pct / 100);
  const rate  = getRate();
  tots.innerHTML = `
    ${pct > 0 ? `
      <div class="pos-tot"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
      <div class="pos-tot" style="color:var(--gm)"><span>Descuento ${pct}%</span><span>−${fmtPrice(subtotal - total)}</span></div>` : ''}
    <div class="pos-tot big"><span>Total estimado</span><span>${fmtPrice(total)}</span></div>
    ${sellerShowBs() ? `<div class="pos-tot" style="color:var(--gr)"><span>En bolívares (tasa ${rate.toFixed(2)})</span><span>${fmtBsNum(total * rate)}</span></div>` : ''}`;
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
  l.price_usd = +price.toFixed(2);
  posRenderTicket();
}

// % propuesto, acotado al máximo permitido al vendedor (jjp_profiles.max_discount_pct)
function quoteDiscountPct() {
  const el = document.getElementById('qDisc');
  if (!el) return 0;
  const max = Number(SELLER?.max_discount_pct) || 0;
  let pct = Math.max(0, Math.min(100, Number(el.value) || 0));
  if (max > 0 && pct > max) {
    pct = max; el.value = max;
    showToast(`Tu descuento máximo permitido es ${max}%`, 'warn');
  }
  const hint = document.getElementById('qDiscHint');
  if (hint) hint.textContent = max > 0
    ? `Máx. permitido: ${max}%. Al facturar, el admin lo confirma.`
    : 'Al facturar, el admin confirma el descuento.';
  return pct;
}

/* --- guardar cotización --- */
let qSubmitting = false;
async function quoteSubmit() {
  if (qSubmitting) return;
  const lines = Object.values(posTicket);
  const name  = document.getElementById('qCliName').value.trim();
  const tel   = document.getElementById('qCliTel').value.trim();
  if (!lines.length) { showToast('La cotización está vacía', 'warn'); return; }
  if (!name || !tel) { showToast('Nombre y teléfono del cliente son obligatorios', 'warn'); return; }

  qSubmitting = true;
  const btn = document.getElementById('qSubmitBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const subtotal = lines.reduce((s, l) => s + l.price_usd * l.qty, 0);
  const pct   = quoteDiscountPct();
  const total = +(subtotal * (1 - pct / 100)).toFixed(2);
  const quote = {
    quote_number: genOrderNumber('COT'),
    client_name: name,
    phone: tel,
    rif:  document.getElementById('qCliRif').value.trim()  || null,
    city: document.getElementById('qCliCity').value.trim() || null,
    items: lines.map(l => ({
      id: l.id, variant_id: l.variant_id, name: l.name, brand: l.brand, sku: l.sku || null,
      qty: l.qty, unit: l.unit, price_usd: l.price_usd,
      subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
    })),
    estimated_total_usd: total,
    discount_pct: pct,
    exchange_rate: getRate(),
    notes: document.getElementById('qNotes').value.trim() || null,
    status: 'pendiente',
    source: 'vendedor',
    seller_id: SELLER.id,
  };

  const { error } = await sb.from('jjp_quotes').insert(quote);
  if (error) {
    console.error('quote insert:', error);
    showToast('No se pudo guardar la cotización', 'err');
  } else {
    quoteShowDone(quote);
  }
  qSubmitting = false;
  btn.disabled = false; btn.textContent = '📋 Guardar cotización';
}

/* Contexto para el hub de envío: la cotización recién guardada.
   El presupuesto se manda en PDF, no como una lista de texto. */
let quoteLast = null;
function quoteDoneCtx() {
  const q = quoteLast || {};
  return {
    nombre: q.client_name, telefono: q.phone, email: q.email || null,
    quote: {
      order_number: q.quote_number, client_name: q.client_name, rif: q.rif,
      phone: q.phone, city: q.city, items: q.items || [],
      subtotal_usd: (q.items || []).reduce((s, i) => s + (i.subtotal_usd || 0), 0),
      total_usd: q.estimated_total_usd, discount_pct: q.discount_pct,
      discount_status: Number(q.discount_pct) > 0 ? 'approved' : 'none',
      exchange_rate: q.exchange_rate, notes: q.notes,
      status: q.status, created_at: new Date().toISOString(),
    },
    docs: ['cotizacion', 'catalogo', 'lista'],
  };
}

function quoteShowDone(q) {
  quoteLast = q;
  const subtotal = q.items.reduce((s, i) => s + i.subtotal_usd, 0);
  const discLines = q.discount_pct > 0
    ? `\n\nSubtotal: ${fmtPrice(subtotal)}\n🏷️ *Descuento ${q.discount_pct}%: −${fmtPrice(subtotal - q.estimated_total_usd)}*`
    : '';
  const waMsg = `📋 *COTIZACIÓN ${q.quote_number}* — JJ Paper\n\nHola ${q.client_name}, aquí está tu cotización:\n`
    + q.items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + discLines
    + `\n\n💰 *Total estimado: ${fmtPrice(q.estimated_total_usd)}* (${fmtBsNum(q.estimated_total_usd * q.exchange_rate)})`
    + `\n_Precios sujetos a cambio según tasa del día._`
    + (q.notes ? `\n\n📝 ${q.notes}` : '')
    + `\n\nAtendido por: ${SELLER.name} — JJ Paper 📄`;

  document.getElementById('qDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Cotización <strong>${escapeHTML(q.quote_number)}</strong> guardada para <strong>${escapeHTML(q.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      ${q.discount_pct > 0 ? `<div class="co-done-row"><span>Descuento propuesto</span><strong>${q.discount_pct}%</strong></div>` : ''}
      <div class="co-done-row"><span>Total estimado</span><strong>${fmtPrice(q.estimated_total_usd)}</strong></div>
      <div class="co-done-row"><span>Productos</span><strong>${q.items.length}</strong></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?q=${encodeURIComponent(q.quote_number)}&print=1">🖨️ Imprimir presupuesto</a>
      ${sendBotonHTML('quoteDoneCtx()')}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(q.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Solo el resumen</a>
      <button class="btn-p" onclick="quoteReset()">📋 Nueva cotización</button>
    </div>`;
  document.getElementById('qDoneModal').classList.add('op');
}

function quoteReset() {
  posTicket = {};
  posRenderTicket();
  ['qCliName', 'qCliTel', 'qCliRif', 'qCliCity', 'qNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('qCliNameResults').innerHTML = '';
  document.getElementById('qCliNameResults').style.display = 'none';
  const disc = document.getElementById('qDisc'); if (disc) disc.value = 0;
  document.getElementById('qDoneModal').classList.remove('op');
}
