/* ======================================================
   JJ Paper Vendedor — Cotizador al mayor
   (reusa el buscador/ticket del POS con totales sin pago)
   ====================================================== */

let posProducts = [];
let posTicket   = {};

async function initQuoter() {
  const { data } = await sb.from('jjp_products')
    .select('id,name,price_usd,unit,emoji,image_url,stock,min_qty,jjp_product_variants(id,brand_id,variant_name,price_usd,stock,active,jjp_brands(name))')
    .eq('active', true).order('name');
  posProducts = data || [];
  posRenderResults(posProducts.slice(0, 30));
}

/* --- buscador (mismo patrón del POS) --- */
function posSearch() {
  const q = normTxt(document.getElementById('posSearch').value.trim());
  if (!q) { posRenderResults(posProducts.slice(0, 30)); return; }
  posRenderResults(posProducts.filter(p => normTxt(p.name).includes(q)).slice(0, 30));
}

function posRenderResults(list) {
  const box = document.getElementById('posResults');
  if (!list.length) { box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0">Sin resultados.</p>'; return; }
  box.innerHTML = list.map(p => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${encodeURI(p.image_url)}" alt="" loading="lazy">`
      : `<span style="font-size:20px">${p.emoji || '📦'}</span>`;
    const vSel = variants.length
      ? `<select class="fi" id="pv-${p.id}" style="width:auto;font-size:12px;padding:5px 8px">
           ${variants.map(v => `<option value="${v.id}">${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')} · ${fmtPrice(v.price_usd)}</option>`).join('')}
         </select>` : '';
    return `<div class="pos-result">
      <div class="pr-img">${img}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${escapeHTML(p.name)}</div>
        <div style="font-size:11px;color:var(--gr)">${fmtPrice(p.price_usd)} /${escapeHTML(p.unit || 'unid')}</div>
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
  let key = pid, variant = null;
  if (variants.length) {
    const vid = document.getElementById(`pv-${pid}`)?.value;
    variant = variants.find(v => v.id === vid) || variants[0];
    key = `${pid}::${variant.id}`;
  }
  if (posTicket[key]) posTicket[key].qty += 1;
  else posTicket[key] = {
    id: pid, variant_id: variant?.id || null, name: p.name,
    brand: variant ? (variant.jjp_brands?.name || variant.variant_name || null) : null,
    unit: p.unit || 'unid',
    price_usd: Number(variant ? variant.price_usd : p.price_usd),
    qty: Math.max(1, Number(p.min_qty) || 1),
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
        <div style="font-size:11px;color:var(--gr)">${fmtPrice(l.price_usd)} /${escapeHTML(l.unit)}</div>
      </div>
      <button class="qb" onclick="posQty('${k}',-1)">−</button>
      <strong style="min-width:22px;text-align:center">${l.qty}</strong>
      <button class="qb" onclick="posQty('${k}',1)">＋</button>
      <strong style="min-width:60px;text-align:right">${fmtPrice(l.price_usd * l.qty)}</strong>
    </div>`).join('');

  const total = lines.reduce((s, [, l]) => s + l.price_usd * l.qty, 0);
  const rate  = getRate();
  tots.innerHTML = `
    <div class="pos-tot big"><span>Total estimado</span><span>${fmtPrice(total)}</span></div>
    <div class="pos-tot" style="color:var(--gr)"><span>En bolívares (tasa ${rate.toFixed(2)})</span><span>${fmtBsNum(total * rate)}</span></div>`;
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

  const total = +lines.reduce((s, l) => s + l.price_usd * l.qty, 0).toFixed(2);
  const quote = {
    quote_number: genOrderNumber('COT'),
    client_name: name,
    phone: tel,
    rif:  document.getElementById('qCliRif').value.trim()  || null,
    city: document.getElementById('qCliCity').value.trim() || null,
    items: lines.map(l => ({
      id: l.id, variant_id: l.variant_id, name: l.name, brand: l.brand,
      qty: l.qty, unit: l.unit, price_usd: l.price_usd,
      subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
    })),
    estimated_total_usd: total,
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

function quoteShowDone(q) {
  const waMsg = `📋 *COTIZACIÓN ${q.quote_number}* — JJ Paper\n\nHola ${q.client_name}, aquí está tu cotización:\n`
    + q.items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + `\n\n💰 *Total estimado: ${fmtPrice(q.estimated_total_usd)}* (${fmtBsNum(q.estimated_total_usd * q.exchange_rate)})`
    + `\n_Precios sujetos a cambio según tasa del día._`
    + (q.notes ? `\n\n📝 ${q.notes}` : '')
    + `\n\nAtendido por: ${SELLER.name} — JJ Paper 📄`;

  document.getElementById('qDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Cotización <strong>${escapeHTML(q.quote_number)}</strong> guardada para <strong>${escapeHTML(q.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      <div class="co-done-row"><span>Total estimado</span><strong>${fmtPrice(q.estimated_total_usd)}</strong></div>
      <div class="co-done-row"><span>Productos</span><strong>${q.items.length}</strong></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(q.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Enviar al cliente</a>
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
  document.getElementById('qDoneModal').classList.remove('op');
}
