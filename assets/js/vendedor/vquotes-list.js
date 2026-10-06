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
  confirmado_mixnet: '✅ En MixNet',
  mixnet_enviado: '📤 En MixNet',
  convertido: 'Convertido en venta',
  cancelado:  'Anulado',
  rechazado:  'Rechazado',
};

async function loadVQuotes(statusFilter = vQuotesFilter) {
  vQuotesFilter = statusFilter;
  let q = sb.from('jjp_quotes')
    .select('id,quote_number,client_name,phone,rif,email,city,estimated_total_usd,discount_pct,status,source,created_at,customer_id,seller_id,items,notes,exchange_rate')
    .order('created_at', { ascending: false });
  const sid = (typeof SELLER !== 'undefined' && SELLER?.id) ? SELLER.id : (window.SELLER?.id || CURRENT_PROFILE?.id);
  if (sid) {
    q = q.eq('seller_id', sid);
  }
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
        <button class="btn-p sm" onclick="viewVQuote('${q.id}')" title="Ver detalle">👁️ Ver</button>
        <a class="btn-o sm" href="cotizador.html?edit=${q.id}" title="Editar cotización">✏️</a>
        <a class="btn-o sm" href="pos.html?quote=${encodeURIComponent(q.quote_number || q.id)}" title="Pasar a Pedido">📋</a>
        ${q.status === 'confirmado_mixnet'
          ? `<span class="btn-o sm" style="background:#dbeafe;color:#1d4ed8;cursor:default" title="Ya confirmada para MixNet">✅</span>`
          : `<button class="btn-p sm" style="background:#1d4ed8;color:#fff" onclick="confirmVQuoteToMixnet('${q.id}')" title="Confirmar y enviar a MixNet">✅ MixNet</button>`}
        <button class="btn-send sm" onclick="sendMenuAbrir(event, vQuoteCtx('${q.id}'))"
                title="Enviar la cotización al cliente" aria-haspopup="menu">📤</button>
        <a class="btn-o sm" style="width:auto;padding:7px 10px" target="_blank"
           href="../comprobante.html?q=${encodeURIComponent(q.quote_number || '')}&print=1" title="Imprimir">🖨️</a>
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
        <div class="ord-field"><label>Cliente</label><p><strong>${escapeHTML(q.client_name)}</strong></p></div>
        <div class="ord-field"><label>RIF / CI</label><p id="vQModalRif"><strong>${escapeHTML(q.rif || '—')}</strong></p></div>
        <div class="ord-field"><label>Domicilio Fiscal</label><p id="vQModalAddr">${escapeHTML(q.address || '—')}</p></div>
        <div class="ord-field"><label>Teléfono</label><p id="vQModalPhone">${escapeHTML(q.phone || '—')}</p></div>
        ${q.notes ? `<div class="ord-field"><label>Notas</label><p>${escapeHTML(q.notes)}</p></div>` : ''}
      </div>
      <div>
        <div class="ord-field"><label>Estado</label><p><span class="status-badge st-${escapeHTML(q.status || '')}">${VQ_STATUS_LABEL[q.status] || q.status}</span></p></div>
        <div class="ord-field"><label>Ciudad</label><p id="vQModalCity">${escapeHTML(q.city || '—')}</p></div>
        <div class="ord-field"><label>Email</label><p id="vQModalEmail">${escapeHTML(q.email || '—')}</p></div>
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
      ${sendBotonHTML(`vQuoteCtx('${q.id}')`)}
      ${closed ? '' : `
        <a class="btn-o" style="width:auto;padding:9px 16px;text-decoration:none" href="cotizador.html?edit=${q.id}">✏️ Editar</a>
        <a class="btn-p" style="width:auto;padding:9px 16px;text-decoration:none;font-weight:700" href="pos.html?quote=${encodeURIComponent(q.quote_number || q.id)}">📋 Pasar a Pedido</a>
        <button class="btn-o" onclick="convertVQuote('${q.id}')" ${allPriced ? '' : 'disabled title="Todos los productos necesitan precio"'}
          style="${allPriced ? '' : 'opacity:.5;cursor:not-allowed'}">⚡ Venta directa</button>`}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(q.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Contactar</a>
    </div>`;

  document.getElementById('vQuoteModal').classList.add('op');

  // Resolver domicilio fiscal real y datos del cliente si faltan en la cotización
  (async () => {
    try {
      let cust = null;
      if (q.customer_id) {
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email').eq('id', q.customer_id).maybeSingle();
        if (data) cust = data;
      }
      if ((!cust || !cust.address) && q.rif) {
        const rawRif = String(q.rif).trim();
        const cleanRif = rawRif.replace(/[^a-zA-Z0-9]/g, '');
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email')
          .or(`rif.eq."${rawRif}",rif.eq."${cleanRif}"`)
          .limit(1);
        if (data?.[0]) cust = cust ? { ...data[0], ...cust, address: data[0].address || cust.address } : data[0];
      }
      if ((!cust || !cust.address) && q.client_name) {
        const qName = q.client_name.trim().slice(0, 18);
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email')
          .ilike('name', `%${qName}%`)
          .limit(1);
        if (data?.[0]) cust = cust ? { ...data[0], ...cust, address: data[0].address || cust.address } : data[0];
      }
      if (cust) {
        const addrEl  = document.getElementById('vQModalAddr');
        const cityEl  = document.getElementById('vQModalCity');
        const rifEl   = document.getElementById('vQModalRif');
        const phoneEl = document.getElementById('vQModalPhone');
        const emailEl = document.getElementById('vQModalEmail');
        if (addrEl && cust.address && (!q.address || q.address === '—')) addrEl.textContent = cust.address;
        if (cityEl && cust.city && (!q.city || q.city === '—')) cityEl.textContent = cust.city;
        if (rifEl && cust.rif && (!q.rif || q.rif === '—')) rifEl.innerHTML = `<strong>${escapeHTML(cust.rif)}</strong>`;
        if (phoneEl && cust.phone && (!q.phone || q.phone === '—')) phoneEl.textContent = cust.phone;
        if (emailEl && cust.email && (!q.email || q.email === '—')) emailEl.textContent = cust.email;
      }
    } catch (_) {}
  })();
}

function closeVQuoteModal() {
  document.getElementById('vQuoteModal')?.classList.remove('op');
}

/* Contexto para el hub de envío (send-hub.js): la cotización sale en PDF */
function vQuoteCtx(id) {
  const q = vQuotes.find(x => x.id === id) || {};
  const items = vqItems(q);
  return {
    nombre: q.client_name, telefono: q.phone, email: q.email,
    customerId: q.customer_id || null,
    quote: {
      order_number: q.quote_number, client_name: q.client_name, rif: q.rif,
      phone: q.phone, email: q.email, city: q.city, address: q.address,
      items, subtotal_usd: items.reduce((s, i) => s + (i.price_usd || 0) * i.qty, 0),
      total_usd: vqTotal(q), discount_pct: q.discount_pct,
      discount_status: Number(q.discount_pct) > 0 ? 'approved' : 'none',
      exchange_rate: q.exchange_rate, notes: q.notes,
      status: q.status, created_at: q.created_at,
    },
    docs: ['cotizacion', 'catalogo', 'lista'],
  };
}

async function updateVQuoteStatus(id, status) {
  if (status === 'confirmado_mixnet' && !confirm('¿Confirmar esta cotización para enviarla a MixNet?\n\nSe le asignará el número correlativo real de MixNet.')) { renderVQuotes(); return; }
  const { error } = await sb.from('jjp_quotes').update({ status }).eq('id', id);
  if (error) { showToast('No se pudo actualizar el estado', 'err'); return; }
  const q = vQuotes.find(x => x.id === id);
  if (q) q.status = status;
  showToast(status === 'cancelado' ? 'Cotización anulada' : (status === 'confirmado_mixnet' ? '✅ Cotización confirmada · se enviará a MixNet' : `Estado → ${VQ_STATUS_LABEL[status] || status}`));
  renderVQuotes();
}

// Confirmar cotización para su envío a MixNet (el agente de la Win7 asigna el correlativo real)
async function confirmVQuoteToMixnet(id) {
  const q = vQuotes.find(x => x.id === id);
  const label = q?.quote_number ? '#' + q.quote_number : 'esta cotización';
  if (!confirm(`¿Confirmar ${label} para enviarla a MixNet?`)) return;
  await updateVQuoteStatus(id, 'confirmado_mixnet');
}

/* ---------- Convertir cotización en venta ----------
   Lo resuelve la base de datos (jjp_convert_quote), la misma función que
   usa el admin. Con eso el pedido conserva la presentación de cada línea
   (variant_id) y el stock puede descontarse; antes esta copia la perdía y
   el inventario nunca bajaba. La venta nace en 'pendiente_pago' y, si la
   cotización traía descuento, queda SOLICITADO para que el admin lo apruebe. */
let vqConverting = false;
async function convertVQuote(id) {
  if (vqConverting) return;
  const q = vQuotes.find(x => x.id === id);
  if (!q) return;
  if (VQ_CLOSED.includes(q.status)) { showToast('Esta cotización ya está cerrada', 'warn'); return; }

  const pct = Number(q.discount_pct) || 0;
  const aviso = pct > 0
    ? `\n\nEl ${pct}% de descuento queda PENDIENTE de aprobación del admin: se cobra a precio lleno.`
    : '';
  if (!confirm(`¿Crear una venta a partir de la cotización ${q.quote_number}?${aviso}`)) return;

  vqConverting = true;
  const { data, error } = await sb.rpc('jjp_convert_quote', { p_quote: id });
  vqConverting = false;
  if (error) {
    console.error('convert quote:', error);
    showToast('No se pudo crear la venta: ' + error.message, 'err');
    return;
  }
  const order = Array.isArray(data) ? data[0] : data;

  q.status = 'convertido';
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
      <a class="btn-p" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=ambos&print=1"
         title="Imprime la factura y la orden de recibo de una sola vez">🖨️ Factura + Recibo</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura&print=1">📃 Solo factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo&print=1">📦 Solo recibo</a>
      <a class="btn-p" style="width:auto;padding:9px 16px" href="pedidos.html">🛒 Ver mis pedidos</a>
    </div>`;
  document.getElementById('vqDoneModal').classList.add('op');
}

function closeVqDone() {
  document.getElementById('vqDoneModal')?.classList.remove('op');
}
