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
  // jjp_orders tiene 3 FKs hacia jjp_profiles (seller + descuentos): hay que
  // nombrar la relación o PostgREST devuelve 300 PGRST201 (embed ambiguo).
  let q = sb.from('jjp_orders').select('*, jjp_profiles!jjp_orders_seller_id_fkey(name)').order('created_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const [{ data, error }, sellersRes] = await Promise.all([
    q,
    adminSellers.length ? Promise.resolve({ data: adminSellers })
      : sb.from('jjp_profiles').select('id,name').eq('role', 'vendedor').eq('active', true).order('name'),
  ]);
  if (error) { showToast('Error cargando pedidos', 'err'); return; }
  adminOrders  = data || [];
  adminSellers = sellersRes.data || [];
  await signReceipts(adminOrders);
  ordersPage = 1;
  renderOrdersStats();
  renderOrdersTable();
}

// El bucket jjp-receipts es privado: receipt_url puede ser una URL pública vieja
// o un path nuevo; en ambos casos se convierte a signed URL de 1 hora.
async function signReceipts(orders) {
  await Promise.all(orders.map(async o => {
    if (!o.receipt_url) return;
    const path = o.receipt_url.includes('/jjp-receipts/')
      ? o.receipt_url.split('/jjp-receipts/')[1]
      : o.receipt_url;
    const { data } = await sb.storage.from(APP.RECEIPTS_BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) o.receipt_url = data.signedUrl;
  }));
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
      <td><strong>${fmtPrice(o.total_usd)}</strong><div class="td-sub">${fmtBsNum(o.total_bs)}</div>${o.discount_status === 'pending' ? `<div class="td-sub" style="color:#c08a00;font-weight:700">🏷️ desc. ${o.discount_pct}% por aprobar</div>` : ''}${o.delivery_type === 'delivery' && !o.delivery_fee_confirmed ? `<div class="td-sub" style="color:#c08a00;font-weight:700">🛵 envío ${fmtPrice(o.delivery_fee_usd || 0)} por confirmar</div>` : o.delivery_type === 'delivery' ? `<div class="td-sub" style="color:var(--gm);font-weight:700">🛵 envío ${fmtPrice(o.delivery_fee_usd || 0)} ✔</div>` : ''}</td>
      <td>
        <select class="status-sel st-${o.status}" onchange="updateOrderStatus('${o.id}', this.value)">
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="viewOrder('${o.id}')">👁️ Ver</button>
          <button class="btn-send sm" onclick="sendMenuAbrir(event, ordCtx('${o.id}'))"
                  title="Enviar factura, recibo o estado al cliente" aria-haspopup="menu">📤</button>
          ${['rechazado','cancelado'].includes(o.status) ? `<button class="btn-danger sm" onclick="deleteOrder('${o.id}')" title="Eliminar definitivamente">🗑️</button>` : ''}
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
      // La RPC ahora informa qué líneas no pudo tocar (las que no traen
      // variante no se pueden descontar). Antes decía "listo" siempre y el
      // inventario quedaba mal sin que nadie se enterara.
      const faltantes = data?.faltantes || [];
      if (data?.ya) {
        /* el stock ya estaba aplicado: no hay nada que avisar */
      } else if (data?.ok) {
        if (o) o.stock_applied = true;
        showToast('📦 Stock descontado del inventario');
      } else {
        showToast(`⚠️ No se pudo descontar: ${faltantes.join(', ')}. ` +
                  'Esas líneas no tienen presentación asignada — ajústalas en inventario.', 'warn');
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
      <div class="ord-field"><label>Entrega</label><p>${
        o.delivery_type === 'delivery'
          ? `🛵 Delivery${o.delivery_distance_km ? ` · ~${o.delivery_distance_km} km` : ''}${(o.delivery_lat && o.delivery_lng) ? ` · <a href="https://maps.google.com/?q=${o.delivery_lat},${o.delivery_lng}" target="_blank" rel="noopener" style="color:var(--gd);font-weight:700">📍 Ver punto en el mapa</a>` : ''}`
          : o.delivery_type === 'retiro' ? '🏬 Retiro en tienda' : '—'
      }</p></div>
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
          <td style="text-align:right;color:var(--gm)">${o.discount_status === 'approved' ? '−' + fmtPrice(Number(o.subtotal_usd) * Number(o.discount_pct) / 100) : '—'}</td></tr>` : ''}
      ${o.delivery_type === 'delivery' ? `
      <tr><td colspan="3" style="text-align:right;color:var(--gm)">Envío 🛵${o.delivery_distance_km ? ` (~${o.delivery_distance_km} km)` : ''}${o.delivery_fee_confirmed ? ' ✔' : ' (por confirmar)'}</td>
          <td style="text-align:right;color:var(--gm)">${Number(o.delivery_fee_usd) > 0 ? fmtPrice(o.delivery_fee_usd) : 'Gratis'}</td></tr>` : ''}
      <tr><td colspan="3" style="text-align:right;font-weight:700">Total${o.discount_status === 'pending' ? ' (a cobrar, sin descuento)' : ''}</td>
          <td style="text-align:right"><strong>${fmtPrice(o.total_usd)}</strong></td></tr>
      <tr><td colspan="3" style="text-align:right;color:var(--gm);font-weight:700">En bolívares (tasa ${Number(o.exchange_rate).toFixed(2)})</td>
          <td style="text-align:right;color:var(--gm)"><strong>${fmtBsNum(o.total_bs)}</strong></td></tr>
    </tfoot>
  </table>

  ${o.delivery_type === 'delivery' && !o.delivery_fee_confirmed ? `
  <div style="margin-top:16px;padding:14px;border:1px solid #9cc9b8;background:#eef7f2;border-radius:12px">
    <strong>🛵 Envío por confirmar: ${Number(o.delivery_fee_usd) > 0 ? fmtPrice(o.delivery_fee_usd) : 'Gratis'}${o.delivery_distance_km ? ` (~${o.delivery_distance_km} km calculados por el cliente)` : ''}</strong>
    <p style="font-size:13px;color:#555;margin:6px 0">Revisa el punto en el mapa y confirma el costo. Si lo ajustas, el total del pedido se recalcula.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input type="number" class="fi" id="ordDlvFee" step="0.01" min="0" value="${Number(o.delivery_fee_usd || 0).toFixed(2)}" style="max-width:120px" aria-label="Costo del envío en dólares">
      <button class="btn-p" onclick="confirmDeliveryFee('${o.id}')">✅ Confirmar envío</button>
      <button class="btn-o" onclick="document.getElementById('ordDlvFee').value='0'; confirmDeliveryFee('${o.id}')" title="El envío queda en $0 y el total se recalcula">🆓 Dejarlo gratis</button>
    </div>
  </div>` : ''}

  ${o.discount_status === 'pending' ? `
  <div style="margin-top:16px;padding:14px;border:1px solid #e8c96b;background:#fff8e6;border-radius:12px">
    <strong>🏷️ Descuento por aprobar: ${o.discount_pct}%</strong>
    <p style="font-size:13px;color:#555;margin:6px 0">Solicitado por el vendedor. Al aprobar, el total baja a <strong>${fmtPrice(o.subtotal_usd * (1 - o.discount_pct / 100) + Number(o.delivery_fee_usd || 0))}</strong>.</p>
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
      ${['rechazado','cancelado'].includes(o.status) ? `<button class="bulk-btn red" onclick="deleteOrder('${o.id}')" title="Borra el pedido definitivamente de la lista">🗑️ Eliminar</button>` : ''}
      <a class="btn-p" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=ambos&print=1"
         title="Imprime la factura y la orden de recibo de una sola vez">🖨️ Factura + Recibo</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank" href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura">🧾 Factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank" href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo">📦 Orden de recibo</a>
      ${sendBotonHTML(`ordCtx('${o.id}')`)}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(o.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(`Hola ${o.client_name}, le escribimos de JJ Paper sobre su pedido ${o.order_number}.`)}">💬 Contactar</a>
    </div>
  </div>`;

  modal.classList.add('op');
}

function closeOrderModal() {
  document.getElementById('orderModal')?.classList.remove('op');
}

/* Contexto para el hub de envío (assets/js/send-hub.js): con esto el
   botón 📤 sabe a quién escribirle y qué documentos puede mandar. */
function ordCtx(id) {
  const o = adminOrders.find(x => x.id === id) || {};
  return {
    nombre: o.client_name, telefono: o.phone, email: o.email,
    customerId: o.customer_id || null, order: o,
    docs: ['factura', 'recibo', 'estado', 'catalogo', 'lista'],
  };
}

// Confirmar (o ajustar) el costo del envío: recalcula total_usd/total_bs
// restando el fee viejo y sumando el nuevo (respeta descuentos ya aplicados).
async function confirmDeliveryFee(id) {
  const o = adminOrders.find(x => x.id === id);
  if (!o) return;
  const newFee = parseFloat(document.getElementById('ordDlvFee')?.value);
  if (!isFinite(newFee) || newFee < 0) { showToast('Costo de envío inválido', 'warn'); return; }

  const oldFee   = Number(o.delivery_fee_usd || 0);
  const newTotal = +(Number(o.total_usd || 0) - oldFee + newFee).toFixed(2);
  const rate     = Number(o.exchange_rate || 0);
  const patch = {
    delivery_fee_usd: newFee,
    delivery_fee_confirmed: true,
    total_usd: newTotal,
    total_bs: rate > 0 ? +(newTotal * rate).toFixed(2) : o.total_bs,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('jjp_orders').update(patch).eq('id', id);
  if (error) { showToast('No se pudo confirmar el envío', 'err'); return; }
  Object.assign(o, patch);
  showToast(`🛵 Envío confirmado: ${fmtPrice(newFee)}`);
  renderOrdersTable();
  renderOrdersStats();
  viewOrder(id);   // refresca el modal con los totales nuevos
}

// Eliminar un pedido de verdad (solo rechazados/cancelados; la RPC valida
// que seas admin y repone stock si estaba descontado). Para pruebas viejas.
async function deleteOrder(id) {
  const o = adminOrders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`¿Eliminar DEFINITIVAMENTE el pedido ${o.order_number}?\n\nEsto lo borra de la lista y no se puede deshacer.`)) return;
  const { data, error } = await sb.rpc('jjp_delete_order', { p_order: id });
  if (error) { showToast('No se pudo eliminar: ' + error.message, 'err'); return; }
  if (data !== true) { showToast('El pedido ya no existe', 'warn'); }
  adminOrders = adminOrders.filter(x => x.id !== id);
  closeOrderModal();
  renderOrdersTable();
  renderOrdersStats();
  if (typeof refreshAdminBadges === 'function') refreshAdminBadges();
  showToast(`🗑️ Pedido ${o.order_number} eliminado`);
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
