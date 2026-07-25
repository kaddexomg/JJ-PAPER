/* ======================================================
   JJ Paper Vendedor — Mis cotizaciones
   Cierra el ciclo del vendedor: ver sus presupuestos guardados,
   reimprimirlos, anularlos y convertirlos en venta sin depender
   del admin. (RLS garantiza que solo ve los suyos.)

   NO toca inventario: la venta creada nace en 'pendiente_pago' y el
   stock lo sigue aplicando el admin al confirmar el pago, igual que
   una venta del POS.
   ====================================================== */

let vQuotes = [];
let vQuotesFilter = '';

// Estados de cotización que ya están cerrados (no se convierten)
const VQ_CLOSED = ['convertido', 'convertida', 'cancelado', 'rechazado'];

const VQ_STATUS_LABEL = {
  pendiente:  'Pendiente',
  contactado: 'Contactado',
  confirmado: 'Confirmado',
  convertido: 'Convertido en venta',
  cancelado:  'Anulado',
  rechazado:  'Rechazado',
};

async function loadVQuotes(statusFilter = vQuotesFilter) {
  vQuotesFilter = statusFilter;
  let q = sb.from('jjp_quotes').select('*').order('created_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q;
  if (error) { showToast('Error cargando cotizaciones', 'err'); return; }
  vQuotes = data || [];
  renderVQuotes();
}

function setVQuotesFilter(status) {
  document.querySelectorAll('.of-chip').forEach(c => c.classList.toggle('on', c.dataset.s === status));
  loadVQuotes(status);
}

function vqItems(q) {
  const items = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);
  return Array.isArray(items) ? items : [];
}

function vqItemName(i) { return i.name || i.product || '—'; }

// Total: usa el estimado guardado o lo recalcula de las líneas con precio
function vqTotal(q) {
  if (q.estimated_total_usd) return Number(q.estimated_total_usd);
  return vqItems(q).reduce((s, i) => s + (i.price_usd ? i.price_usd * i.qty : 0), 0);
}

function renderVQuotes() {
  const tbody = document.getElementById('vQuotesBody');
  const count = document.getElementById('vQuotesCount');
  if (!tbody) return;
  if (count) count.textContent = `${vQuotes.length} cotizaciones`;

  if (!vQuotes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No tienes cotizaciones con este filtro.</td></tr>';
    return;
  }

  tbody.innerHTML = vQuotes.map(q => {
    const items = vqItems(q);
    const preview = items.slice(0, 2).map(i => `${escapeHTML(vqItemName(i))} x${i.qty}`).join(', ')
      + (items.length > 2 ? '…' : '');
    const total = vqTotal(q);
    return `<tr>
      <td><strong>${escapeHTML(q.quote_number || '—')}</strong><div class="td-sub">${fmtDate(q.created_at)}</div></td>
      <td><div class="td-name">${escapeHTML(q.client_name)}</div><div class="td-sub">${escapeHTML(q.phone || '')}</div></td>
      <td style="max-width:170px;font-size:11px;color:var(--gr)">${preview}</td>
      <td>${total > 0 ? `<strong>${fmtPrice(total)}</strong>` : '<span style="color:#bbb">—</span>'}
        ${q.discount_pct > 0 ? `<div class="td-sub">desc. ${q.discount_pct}%</div>` : ''}</td>
      <td><span class="status-badge st-${escapeHTML(q.status || '')}">${VQ_STATUS_LABEL[q.status] || q.status}</span></td>
      <td><div class="td-actions">
        <button class="btn-p sm" onclick="viewVQuote('${q.id}')">👁️ Ver</button>
        <a class="btn-o sm" style="width:auto;padding:7px 10px" target="_blank"
           href="../comprobante.html?q=${encodeURIComponent(q.quote_number || '')}&print=1">🖨️</a>
      </div></td>
    </tr>`;
  }).join('');
}

function viewVQuote(id) {
  const q = vQuotes.find(x => x.id === id);
  if (!q) return;
  const items = vqItems(q);
  const rate  = Number(q.exchange_rate) || getRate();
  const total = vqTotal(q);
  const allPriced = items.length && items.every(i => i.price_usd);
  const closed = VQ_CLOSED.includes(q.status);

  document.getElementById('vQuoteModalTitle').textContent = `Cotización ${q.quote_number || ''}`;

  const rows = items.map(i => `<tr>
    <td>${escapeHTML(vqItemName(i))}${i.brand ? ` <small style="color:var(--gm)">(${escapeHTML(i.brand)})</small>` : ''}</td>
    <td style="text-align:center">${i.qty} ${escapeHTML(i.unit || '')}</td>
    <td style="text-align:right">${i.price_usd ? fmtPrice(i.price_usd) : '<span style="color:#bbb">por confirmar</span>'}</td>
    <td style="text-align:right">${i.price_usd ? `<strong>${fmtPrice(i.price_usd * i.qty)}</strong>` : '—'}</td>
  </tr>`).join('');

  const waMsg = `📋 *COTIZACIÓN ${q.quote_number}* — JJ Paper\n\nHola ${q.client_name}, le recuerdo su cotización:\n`
    + items.map(i => `• ${vqItemName(i)} x${i.qty}${i.price_usd ? ` = ${fmtPrice(i.price_usd * i.qty)}` : ''}`).join('\n')
    + (total > 0 ? `\n\n💰 *Total estimado: ${fmtPrice(total)}*` : '')
    + `\n\nAtendido por: ${SELLER?.name || ''} — JJ Paper 📄`;

  document.getElementById('vQuoteModalBody').innerHTML = `
    <div class="ord-grid">
      <div>
        <div class="ord-field"><label>Cliente</label><p>${escapeHTML(q.client_name)}</p></div>
        <div class="ord-field"><label>Teléfono</label><p>${escapeHTML(q.phone || '—')}</p></div>
        <div class="ord-field"><label>RIF / CI</label><p>${escapeHTML(q.rif || '—')}</p></div>
        ${q.notes ? `<div class="ord-field"><label>Notas</label><p>${escapeHTML(q.notes)}</p></div>` : ''}
      </div>
      <div>
        <div class="ord-field"><label>Estado</label><p><span class="status-badge st-${escapeHTML(q.status || '')}">${VQ_STATUS_LABEL[q.status] || q.status}</span></p></div>
        <div class="ord-field"><label>Ciudad</label><p>${escapeHTML(q.city || '—')}</p></div>
        <div class="ord-field"><label>Cambiar estado</label>
          <select class="fi" onchange="updateVQuoteStatus('${q.id}', this.value)" ${closed ? 'disabled' : ''}>
            ${['pendiente','contactado','confirmado','cancelado'].map(s =>
              `<option value="${s}" ${q.status === s ? 'selected' : ''}>${VQ_STATUS_LABEL[s]}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <table class="admin-table" style="margin-top:12px">
      <thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
      ${total > 0 ? `<tfoot>
        <tr><td colspan="3" style="text-align:right;font-weight:700">Total estimado</td>
            <td style="text-align:right"><strong>${fmtPrice(total)}</strong></td></tr>
        <tr><td colspan="3" style="text-align:right;color:var(--gm)">En bolívares (tasa ${rate.toFixed(2)})</td>
            <td style="text-align:right;color:var(--gm)"><strong>${fmtBsNum(total * rate)}</strong></td></tr>
      </tfoot>` : ''}
    </table>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px">
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?q=${encodeURIComponent(q.quote_number || '')}&print=1">🖨️ Imprimir presupuesto</a>
      ${closed ? '' : `<button class="btn-p" onclick="convertVQuote('${q.id}')" ${allPriced ? '' : 'disabled title="Todos los productos necesitan precio"'}
         style="${allPriced ? '' : 'opacity:.5;cursor:not-allowed'}">🛍️ Convertir en venta</button>`}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(q.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Contactar</a>
    </div>`;

  document.getElementById('vQuoteModal').classList.add('op');
}

function closeVQuoteModal() {
  document.getElementById('vQuoteModal')?.classList.remove('op');
}

async function updateVQuoteStatus(id, status) {
  const { error } = await sb.from('jjp_quotes').update({ status }).eq('id', id);
  if (error) { showToast('No se pudo actualizar el estado', 'err'); return; }
  const q = vQuotes.find(x => x.id === id);
  if (q) q.status = status;
  showToast(status === 'cancelado' ? 'Cotización anulada' : `Estado → ${VQ_STATUS_LABEL[status] || status}`);
  renderVQuotes();
}

/* ---------- Convertir cotización en venta ----------
   Crea el pedido igual que el POS: a precio lleno y en 'pendiente_pago'.
   Si la cotización traía descuento, queda SOLICITADO para que el admin lo
   apruebe (el guardián de la BD también fuerza precio lleno a no-admin).   */
let vqConverting = false;
async function convertVQuote(id) {
  if (vqConverting) return;
  const q = vQuotes.find(x => x.id === id);
  if (!q) return;
  if (VQ_CLOSED.includes(q.status)) { showToast('Esta cotización ya está cerrada', 'warn'); return; }

  const items = vqItems(q);
  if (!items.length || items.some(i => !i.price_usd)) {
    showToast('Todos los productos deben tener precio para convertir', 'warn');
    return;
  }

  const pct = Number(q.discount_pct) || 0;
  const aviso = pct > 0
    ? `\n\nEl ${pct}% de descuento queda PENDIENTE de aprobación del admin: se cobra a precio lleno.`
    : '';
  if (!confirm(`¿Crear una venta a partir de la cotización ${q.quote_number}?${aviso}`)) return;

  vqConverting = true;
  const subtotal = items.reduce((s, i) => s + i.price_usd * i.qty, 0);
  const total    = +subtotal.toFixed(2);      // precio lleno, como en el POS
  const rate     = getRate();

  const order = {
    order_number: genOrderNumber(),
    client_name: q.client_name,
    rif:   q.rif   || null,
    phone: q.phone,
    email: q.email || null,
    city:  q.city  || null,
    items: items.map(i => ({
      id: i.product_id || i.id || null,
      name: vqItemName(i), brand: i.brand || null,
      qty: i.qty, unit: i.unit || 'unid', price_usd: i.price_usd,
      subtotal_usd: +(i.price_usd * i.qty).toFixed(2),
    })),
    subtotal_usd: +subtotal.toFixed(2),
    total_usd: total,
    discount_pct: pct,
    discount_status: pct > 0 ? 'pending' : 'none',
    discount_requested_by: pct > 0 ? SELLER.id : null,
    exchange_rate: rate,
    total_bs: +(total * rate).toFixed(2),
    payment_method: 'efectivo',
    notes: `Generado desde cotización ${q.quote_number}`,
    seller_id: SELLER.id,
    source: 'pos',
    status: 'pendiente_pago',
  };

  const { error } = await sb.from('jjp_orders').insert(order);
  if (error) {
    console.error('convert quote:', error);
    showToast('No se pudo crear la venta', 'err');
    vqConverting = false;
    return;
  }

  await sb.from('jjp_quotes').update({ status: 'convertido' }).eq('id', id);
  q.status = 'convertido';
  vqConverting = false;
  closeVQuoteModal();
  renderVQuotes();
  showVQuoteConverted(order);
}

// Tras convertir: ofrece imprimir la factura / orden de recibo de la venta nueva
function showVQuoteConverted(o) {
  document.getElementById('vqDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Venta <strong>${escapeHTML(o.order_number)}</strong> creada para <strong>${escapeHTML(o.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      <div class="co-done-row"><span>Total a cobrar</span><strong>${fmtPrice(o.total_usd)}</strong></div>
      <div class="co-done-row"><span>En bolívares</span><strong>${fmtBsNum(o.total_bs)}</strong></div>
      ${o.discount_pct > 0 ? `<div class="co-done-row" style="color:var(--gm)"><span>Descuento ${o.discount_pct}%</span><strong>⏳ pendiente de aprobación</strong></div>` : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura&print=1">🧾 Imprimir factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo&print=1">📦 Orden de recibo</a>
      <a class="btn-p" style="width:auto;padding:9px 16px" href="pedidos.html">🛒 Ver mis pedidos</a>
    </div>`;
  document.getElementById('vqDoneModal').classList.add('op');
}

function closeVqDone() {
  document.getElementById('vqDoneModal')?.classList.remove('op');
}
