/* ======================================================
   JJ Paper Vendedor — Mis pedidos
   (RLS garantiza que solo se ven los pedidos propios)
   ====================================================== */

let vOrders = [];
let vOrdersFilter = '';

const V_SOURCE_LABEL = { web: '🌐 Web', pos: '🛍️ POS', ref: '🔗 Referido' };

async function loadVOrders(statusFilter = vOrdersFilter) {
  vOrdersFilter = statusFilter;
  let q = sb.from('jjp_orders').select('*').order('created_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q;
  if (error) { showToast('Error cargando pedidos', 'err'); return; }
  vOrders = data || [];
  renderVOrders();
}

function setVOrdersFilter(status) {
  document.querySelectorAll('.of-chip').forEach(c => c.classList.toggle('on', c.dataset.s === status));
  loadVOrders(status);
}

function renderVOrders() {
  const tbody = document.getElementById('vOrdersBody');
  const count = document.getElementById('vOrdersCount');
  if (count) count.textContent = `${vOrders.length} pedidos`;
  if (!vOrders.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No tienes pedidos con este filtro.</td></tr>';
    return;
  }
  const commPct = Number(SELLER.commission_pct) || 0;
  tbody.innerHTML = vOrders.map(o => {
    const isPaid = V_PAID.includes(o.status);
    // La comisión es sobre los productos: el envío no comisiona
    const comm = isPaid ? (o.total_usd - Number(o.delivery_fee_usd || 0)) * commPct / 100 : 0;
    return `<tr>
      <td><strong>${escapeHTML(o.order_number)}</strong><div class="td-sub">${fmtDate(o.created_at)}</div></td>
      <td><div class="td-name">${escapeHTML(o.client_name)}</div><div class="td-sub">${escapeHTML(o.phone || '')}</div></td>
      <td>${V_SOURCE_LABEL[o.source] || o.source || '—'}</td>
      <td><strong>${fmtPrice(o.total_usd)}</strong>${o.discount_pct > 0 ? `<div class="td-sub">desc. ${o.discount_pct}%</div>` : ''}</td>
      <td>${isPaid ? `<strong style="color:var(--gm)">${fmtPrice(comm)}</strong>` : '<span style="color:#ccc;font-size:12px">al pagar</span>'}</td>
      <td><span class="status-badge st-${o.status}">${V_STATUS_LABEL[o.status] || o.status}</span></td>
      <td><div class="td-actions">
        <button class="btn-p sm" onclick="viewVOrder('${o.id}')">👁️ Ver</button>
        <button class="btn-send sm" onclick="sendMenuAbrir(event, vOrderCtx('${o.id}'))"
                title="Enviar factura, recibo o estado al cliente" aria-haspopup="menu">📤</button>
      </div></td>
    </tr>`;
  }).join('');
}

function viewVOrder(id) {
  const o = vOrders.find(x => x.id === id);
  if (!o) return;
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
  const modal = document.getElementById('vOrderModal');
  document.getElementById('vOrderModalTitle').textContent = `Pedido ${o.order_number}`;

  const rows = items.map(i => `<tr>
    <td>${escapeHTML(i.name)}${i.brand ? ` <small style="color:var(--gm)">(${escapeHTML(i.brand)})</small>` : ''}</td>
    <td style="text-align:center">${i.qty} ${escapeHTML(i.unit || '')}</td>
    <td style="text-align:right">${fmtPrice(i.price_usd)}</td>
    <td style="text-align:right"><strong>${fmtPrice(i.subtotal_usd ?? i.price_usd * i.qty)}</strong></td>
  </tr>`).join('');

  const canDeliver = o.status === 'preparando' || o.status === 'pagado';

  document.getElementById('vOrderModalBody').innerHTML = `
    <div class="ord-grid">
      <div>
        <div class="ord-field"><label>Cliente</label><p>${escapeHTML(o.client_name)}</p></div>
        <div class="ord-field"><label>Teléfono</label><p>${escapeHTML(o.phone || '—')}</p></div>
        <div class="ord-field"><label>Ciudad</label><p>${escapeHTML(o.city || '—')}</p></div>
        <div class="ord-field"><label>Entrega</label><p>${
          o.delivery_type === 'delivery'
            ? `🛵 Delivery${o.delivery_distance_km ? ` · ~${o.delivery_distance_km} km` : ''}${(o.delivery_lat && o.delivery_lng) ? ` · <a href="https://maps.google.com/?q=${o.delivery_lat},${o.delivery_lng}" target="_blank" rel="noopener" style="color:var(--gd);font-weight:700">📍 Ver punto</a>` : ''}`
            : o.delivery_type === 'retiro' ? '🏬 Retiro en tienda' : '—'
        }</p></div>
        ${o.notes ? `<div class="ord-field"><label>Notas</label><p>${escapeHTML(o.notes)}</p></div>` : ''}
      </div>
      <div>
        <div class="ord-field"><label>Estado</label><p><span class="status-badge st-${o.status}">${V_STATUS_LABEL[o.status] || o.status}</span></p></div>
        <div class="ord-field"><label>Origen</label><p>${V_SOURCE_LABEL[o.source] || o.source || '—'}</p></div>
        ${o.payment_ref ? `<div class="ord-field"><label>Ref. de pago</label><p>${escapeHTML(o.payment_ref)}</p></div>` : ''}
      </div>
    </div>
    <table class="admin-table" style="margin-top:12px">
      <thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${o.delivery_type === 'delivery' ? `
        <tr><td colspan="3" style="text-align:right;color:var(--gm)">Envío 🛵${o.delivery_fee_confirmed ? ' ✔' : ' (por confirmar)'}</td>
            <td style="text-align:right;color:var(--gm)">${Number(o.delivery_fee_usd) > 0 ? fmtPrice(o.delivery_fee_usd) : 'Gratis'}</td></tr>` : ''}
        <tr><td colspan="3" style="text-align:right;font-weight:700">Total</td>
            <td style="text-align:right"><strong>${fmtPrice(o.total_usd)}</strong></td></tr>
      </tfoot>
    </table>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px">
      ${canDeliver ? `<button class="bulk-btn green" onclick="markVDelivered('${o.id}')">📦 Marcar entregado</button>` : ''}
      <a class="btn-p" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=ambos&print=1"
         title="Imprime la factura y la orden de recibo de una sola vez">🖨️ Factura + Recibo</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank" href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura">🧾 Factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank" href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo">📦 Orden de recibo</a>
      ${sendBotonHTML(`vOrderCtx('${o.id}')`)}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(o.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${o.client_name}, le escribe ${SELLER?.name || ''} de JJ Paper sobre su pedido ${o.order_number}.`)}">💬 Contactar</a>
    </div>`;
  modal.classList.add('op');
}

/* Contexto para el hub de envío (send-hub.js) */
function vOrderCtx(id) {
  const o = vOrders.find(x => x.id === id) || {};
  return {
    nombre: o.client_name, telefono: o.phone, email: o.email,
    customerId: o.customer_id || null, order: o,
    docs: ['factura', 'recibo', 'estado', 'catalogo', 'lista'],
  };
}

// El vendedor solo puede marcar entrega; los pagos los confirma el admin.
async function markVDelivered(id) {
  const { error } = await sb.from('jjp_orders')
    .update({ status: 'entregado', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo actualizar', 'err'); return; }
  showToast('Pedido marcado como entregado ✔');
  closeVOrderModal();
  loadVOrders();
}

function closeVOrderModal() {
  document.getElementById('vOrderModal')?.classList.remove('op');
}
