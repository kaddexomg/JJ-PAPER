/* ======================================================
   JJ Paper Admin — Pedidos & Pagos
   ====================================================== */

let adminOrders = [];
let ordersPage  = 1;
const ORDERS_PER = 20;
let ordersFilter = '';

const ORDER_STATUSES = ['pendiente_pago', 'verificando', 'pagado', 'preparando', 'entregado', 'rechazado', 'cancelado'];
const STATUS_LABEL = {
  pendiente_pago: 'Pendiente de pago',
  verificando:    'Verificando pago',
  pagado:         'Pagado',
  preparando:     'Preparando',
  entregado:      'Entregado',
  rechazado:      'Rechazado',
  cancelado:      'Cancelado',
};
const METHOD_LABEL = {
  pago_movil: '📲 Pago Móvil', transferencia: '🏦 Transferencia', efectivo: '💵 Efectivo',
};

let adminSellers = [];   // vendedores activos (para atribuir pedidos)

async function loadOrders(statusFilter = ordersFilter) {
  ordersFilter = statusFilter;
  let q = sb.from('jjp_orders').select('*, jjp_profiles(name)').order('created_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const [{ data, error }, sellersRes] = await Promise.all([
    q,
    adminSellers.length ? Promise.resolve({ data: adminSellers })
      : sb.from('jjp_profiles').select('id,name').eq('role', 'vendedor').eq('active', true).order('name'),
  ]);
  if (error) { showToast('Error cargando pedidos', 'err'); return; }
  adminOrders  = data || [];
  adminSellers = sellersRes.data || [];
  ordersPage = 1;
  renderOrdersStats();
  renderOrdersTable();
}

function setOrdersFilter(status) {
  document.querySelectorAll('.of-chip').forEach(c => c.classList.toggle('on', c.dataset.s === status));
  loadOrders(status);
}

function renderOrdersStats() {
  // Quick counts over the currently-loaded set (or fetch separately when unfiltered)
  const box = document.getElementById('ordersStats');
  if (!box) return;
  // Always compute from a full fetch for accuracy
  sb.from('jjp_orders').select('status,total_usd').then(({ data }) => {
    const all = data || [];
    const sum = (arr) => arr.reduce((s, o) => s + Number(o.total_usd || 0), 0);
    const pend = all.filter(o => o.status === 'pendiente_pago' || o.status === 'verificando');
    const paid = all.filter(o => ['pagado', 'preparando', 'entregado'].includes(o.status));
    box.innerHTML = `
      <div class="ost"><span class="ost-n">${all.length}</span><span class="ost-l">Pedidos totales</span></div>
      <div class="ost warn"><span class="ost-n">${pend.length}</span><span class="ost-l">Por verificar</span></div>
      <div class="ost ok"><span class="ost-n">${paid.length}</span><span class="ost-l">Confirmados</span></div>
      <div class="ost money"><span class="ost-n">${fmtPrice(sum(paid))}</span><span class="ost-l">Ventas confirmadas</span></div>`;
  });
}

function renderOrdersTable() {
  const tbody = document.getElementById('ordersTableBody');
  const count = document.getElementById('ordersCount');
  if (!tbody) return;
  if (count) count.textContent = `${adminOrders.length} pedidos`;

  const start = (ordersPage - 1) * ORDERS_PER;
  const page  = adminOrders.slice(start, start + ORDERS_PER);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No hay pedidos</td></tr>`;
    renderOrdersPag();
    return;
  }

  tbody.innerHTML = page.map(o => {
    const receipt = o.receipt_url
      ? `<a href="${escapeHTML(o.receipt_url)}" target="_blank" class="td-receipt" title="Ver comprobante"><img src="${escapeHTML(o.receipt_url)}" alt="comprobante"></a>`
      : '<span style="color:#ccc;font-size:11px">—</span>';
    return `<tr>
      <td><strong>${escapeHTML(o.order_number)}</strong><div class="td-sub">${fmtDate(o.created_at)}</div></td>
      <td><div class="td-name">${escapeHTML(o.client_name)}</div><div class="td-sub">${escapeHTML(o.phone)}${o.jjp_profiles?.name ? ` · 🧑‍💼 ${escapeHTML(o.jjp_profiles.name)}` : ''}</div></td>
      <td>${METHOD_LABEL[o.payment_method] || o.payment_method}</td>
      <td>${receipt}</td>
      <td><strong>${fmtPrice(o.total_usd)}</strong><div class="td-sub">${fmtBsNum(o.total_bs)}</div>${o.discount_status === 'pending' ? `<div class="td-sub" style="color:#c08a00;font-weight:700">🏷️ desc. ${o.discount_pct}% por aprobar</div>` : ''}</td>
      <td>
        <select class="status-sel st-${o.status}" onchange="updateOrderStatus('${o.id}', this.value)">
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="viewOrder('${o.id}')">👁️ Ver</button>
          <a class="btn-wa sm" style="width:auto;padding:7px 10px" href="https://wa.me/${(o.phone||'').replace(/\D/g,'')}" target="_blank">💬</a>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderOrdersPag();
}

function renderOrdersPag() {
  const el    = document.getElementById('ordersPag');
  const pages = Math.ceil(adminOrders.length / ORDERS_PER);
  if (!el || pages <= 1) { if (el) el.innerHTML = ''; return; }
  let html = '';
  if (ordersPage > 1) html += `<button class="pg arrow" onclick="ordersGoPage(${ordersPage-1})">‹</button>`;
  for (let i = 1; i <= pages; i++)
    html += `<button class="pg${i === ordersPage ? ' on' : ''}" onclick="ordersGoPage(${i})">${i}</button>`;
  if (ordersPage < pages) html += `<button class="pg arrow" onclick="ordersGoPage(${ordersPage+1})">›</button>`;
  el.innerHTML = html;
}
function ordersGoPage(p) { ordersPage = p; renderOrdersTable(); }

async function updateOrderStatus(id, status) {
  const { error } = await sb.from('jjp_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('Error actualizando estado', 'err'); return; }
  const o = adminOrders.find(x => x.id === id);
  if (o) o.status = status;
  showToast(`Estado → ${STATUS_LABEL[status]}`);

  // Automatización de inventario: descuenta stock al confirmar el pago,
  // lo repone si un pedido ya descontado se rechaza o cancela.
  await syncOrderStock(id, status);

  renderOrdersStats();
  if (typeof refreshAdminBadges === 'function') refreshAdminBadges();
  // keep the select colour in sync
  const sel = document.querySelector(`select[onchange*="${id}"]`);
  if (sel) sel.className = `status-sel st-${status}`;
}

// Aprobar / rechazar el descuento solicitado por un vendedor (RPC valida que seas admin)
async function decideDiscount(id, approve) {
  if (!confirm(`¿${approve ? 'Aprobar' : 'Rechazar'} el descuento de este pedido?`)) return;
  const { data, error } = await sb.rpc('jjp_decide_discount', { p_order: id, p_approve: approve });
  if (error) { showToast('No se pudo procesar el descuento: ' + error.message, 'err'); return; }
  const row = Array.isArray(data) ? data[0] : data;
  const o = adminOrders.find(x => x.id === id);
  if (o && row) Object.assign(o, row);
  showToast(approve ? '✅ Descuento aprobado' : '✕ Descuento rechazado');
  renderOrdersTable();
  viewOrder(id);   // refresca el modal con los totales nuevos
}

async function syncOrderStock(id, status) {
  const o = adminOrders.find(x => x.id === id);
  try {
    if (['pagado', 'preparando', 'entregado'].includes(status)) {
      const { data, error } = await sb.rpc('jjp_apply_order_stock', { p_order_id: id });
      if (error) throw error;
      if (data === true) {
        if (o) o.stock_applied = true;
        showToast('📦 Stock descontado del inventario');
      }
    } else if (['rechazado', 'cancelado'].includes(status)) {
      const { data, error } = await sb.rpc('jjp_revert_order_stock', { p_order_id: id });
      if (error) throw error;
      if (data === true) {
        if (o) o.stock_applied = false;
        showToast('📦 Stock repuesto al inventario');
      }
    }
  } catch (e) {
    console.warn('stock sync error:', e);
    showToast('No se pudo ajustar el stock automáticamente', 'warn');
  }
}

function viewOrder(id) {
  const o = adminOrders.find(x => x.id === id);
  if (!o) return;
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
  const modal = document.getElementById('orderModal');
  const body  = document.getElementById('orderModalBody');
  const title = document.getElementById('orderModalTitle');
  if (!modal || !body) return;
  if (title) title.textContent = `Pedido ${o.order_number}`;

  const itemsRows = items.map(i => `<tr>
    <td>${escapeHTML(i.name)}${i.brand ? ` <small style="color:var(--gm);font-weight:700">(${escapeHTML(i.brand)})</small>` : ''}</td>
    <td style="text-align:center">${i.qty} ${escapeHTML(i.unit || '')}</td>
    <td style="text-align:right">${fmtPrice(i.price_usd)}</td>
    <td style="text-align:right"><strong>${fmtPrice(i.subtotal_usd ?? i.price_usd * i.qty)}</strong></td>
  </tr>`).join('');

  const receiptHTML = o.receipt_url
    ? `<a href="${escapeHTML(o.receipt_url)}" target="_blank"><img src="${escapeHTML(o.receipt_url)}" alt="Comprobante" class="ord-receipt-img"></a>`
    : `<p style="color:#aaa;font-size:13px">Sin comprobante adjunto.</p>`;

  body.innerHTML = `
  <div class="ord-grid">
    <div>
      <div class="ord-field"><label>Cliente</label><p>${escapeHTML(o.client_name)}</p></div>
      <div class="ord-field"><label>Teléfono</label><p>${escapeHTML(o.phone)}</p></div>
      <div class="ord-field"><label>RIF / CI</label><p>${escapeHTML(o.rif || '—')}</p></div>
      <div class="ord-field"><label>Email</label><p>${escapeHTML(o.email || '—')}</p></div>
      <div class="ord-field"><label>Ciudad</label><p>${escapeHTML(o.city || '—')}</p></div>
      <div class="ord-field"><label>Dirección</label><p>${escapeHTML(o.address || '—')}</p></div>
      ${o.notes ? `<div class="ord-field"><label>Notas</label><p>${escapeHTML(o.notes)}</p></div>` : ''}
    </div>
    <div>
      <div class="ord-field"><label>Método de pago</label><p>${METHOD_LABEL[o.payment_method] || o.payment_method}</p></div>
      ${o.payment_ref ? `<div class="ord-field"><label>Referencia</label><p>${escapeHTML(o.payment_ref)}</p></div>` : ''}
      <div class="ord-field"><label>Origen</label><p>${{ web: '🌐 Web', pos: '🛍️ POS vendedor', ref: '🔗 Link de vendedor' }[o.source] || o.source || '—'}</p></div>
      <div class="ord-field">
        <label>Vendedor asignado</label>
        <select class="fi" style="margin-top:4px" onchange="assignOrderSeller('${o.id}', this.value)">
          <option value="">— Sin vendedor —</option>
          ${adminSellers.map(s => `<option value="${s.id}" ${o.seller_id === s.id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="ord-field"><label>Comprobante</label>${receiptHTML}</div>
    </div>
  </div>

  <label class="fl" style="margin-top:18px">Productos</label>
  <table class="admin-table" style="margin-top:6px">
    <thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr></thead>
    <tbody>${itemsRows}</tbody>
    <tfoot>
      ${o.discount_pct > 0 ? `
      <tr><td colspan="3" style="text-align:right">Subtotal</td>
          <td style="text-align:right">${fmtPrice(o.subtotal_usd)}</td></tr>
      <tr><td colspan="3" style="text-align:right;color:var(--gm)">Descuento ${o.discount_pct}% ${o.discount_status === 'approved' ? '(aplicado)' : o.discount_status === 'pending' ? '(pendiente)' : '(rechazado)'}</td>
          <td style="text-align:right;color:var(--gm)">${o.discount_status === 'approved' ? '−' + fmtPrice(o.subtotal_usd - o.total_usd) : '—'}</td></tr>` : ''}
      <tr><td colspan="3" style="text-align:right;font-weight:700">Total${o.discount_status === 'pending' ? ' (a cobrar, sin descuento)' : ''}</td>
          <td style="text-align:right"><strong>${fmtPrice(o.total_usd)}</strong></td></tr>
      <tr><td colspan="3" style="text-align:right;color:var(--gm);font-weight:700">En bolívares (tasa ${Number(o.exchange_rate).toFixed(2)})</td>
          <td style="text-align:right;color:var(--gm)"><strong>${fmtBsNum(o.total_bs)}</strong></td></tr>
    </tfoot>
  </table>

  ${o.discount_status === 'pending' ? `
  <div style="margin-top:16px;padding:14px;border:1px solid #e8c96b;background:#fff8e6;border-radius:12px">
    <strong>🏷️ Descuento por aprobar: ${o.discount_pct}%</strong>
    <p style="font-size:13px;color:#555;margin:6px 0">Solicitado por el vendedor. Al aprobar, el total baja a <strong>${fmtPrice(o.subtotal_usd * (1 - o.discount_pct / 100))}</strong>.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-p" onclick="decideDiscount('${o.id}', true)">✅ Aprobar descuento</button>
      <button class="btn-danger" onclick="decideDiscount('${o.id}', false)">✕ Rechazar</button>
    </div>
  </div>` : o.discount_status === 'approved' ? `
  <div style="margin-top:12px;color:var(--gm);font-size:13px">✅ Descuento ${o.discount_pct}% aprobado.</div>` : ''}

  <div class="ord-actions">
    <div class="ord-status-set">
      <label class="fl">Cambiar estado</label>
      <select class="status-sel st-${o.status}" id="ordModalStatus" onchange="updateOrderStatus('${o.id}', this.value); this.className='status-sel st-'+this.value">
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
      </select>
    </div>
    <div class="ord-quick">
      <button class="bulk-btn green" onclick="updateOrderStatus('${o.id}','pagado'); document.getElementById('ordModalStatus').value='pagado'">✅ Confirmar pago</button>
      <button class="bulk-btn red" onclick="updateOrderStatus('${o.id}','rechazado'); document.getElementById('ordModalStatus').value='rechazado'">✕ Rechazar</button>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank" href="../comprobante.html?n=${encodeURIComponent(o.order_number)}">🧾 Comprobante</a>
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(o.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(`Hola ${o.client_name}, le escribimos de JJ Paper sobre su pedido ${o.order_number}.`)}">💬 Contactar</a>
    </div>
  </div>`;

  modal.classList.add('op');
}

function closeOrderModal() {
  document.getElementById('orderModal')?.classList.remove('op');
}

// Atribuir/quitar vendedor de un pedido (la comisión sigue al pedido)
async function assignOrderSeller(id, sellerId) {
  const { error } = await sb.from('jjp_orders')
    .update({ seller_id: sellerId || null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { showToast('No se pudo asignar el vendedor', 'err'); return; }
  const o = adminOrders.find(x => x.id === id);
  if (o) {
    o.seller_id = sellerId || null;
    o.jjp_profiles = sellerId ? { name: adminSellers.find(s => s.id === sellerId)?.name } : null;
  }
  showToast(sellerId ? 'Vendedor asignado ✔' : 'Pedido sin vendedor');
  renderOrdersTable();
}
