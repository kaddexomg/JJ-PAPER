/* ======================================================
   JJ Paper Admin — Dashboard & Analytics
   ====================================================== */

const PAID_STATUSES = ['pagado', 'preparando', 'entregado'];

async function initDashboard() {
  const [orders, products, quotes, reviews] = await Promise.all([
    sb.from('jjp_orders').select('order_number,client_name,total_usd,total_bs,status,payment_method,created_at').order('created_at', { ascending: false }),
    sb.from('jjp_products').select('id,name,stock,active,price_usd').eq('active', true),
    sb.from('jjp_quotes').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
    sb.from('jjp_reviews').select('id', { count: 'exact', head: true }).eq('approved', false),
  ]);

  const allOrders = orders.data || [];
  const prods     = products.data || [];

  renderDashStats(allOrders, prods, quotes.count || 0, reviews.count || 0);
  renderSalesChart(allOrders);
  renderStatusBreakdown(allOrders);
  renderRecentOrders(allOrders.slice(0, 6));
  renderLowStock(prods);
  loadNotifications();
  loadInvoicesWidget();
}

/* ---- Facturas de proveedor por vencer (Cuentas por Pagar) ----
   Reusa los helpers de admin/invoices.js (semáforo y fechas de Caracas),
   que index.html carga antes que este archivo. */
async function loadInvoicesWidget() {
  const box = document.getElementById('dashInvoices');
  if (!box) return;

  const { data, error } = await sb.from('jjp_supplier_invoices')
    .select('id,invoice_number,due_date,amount,amount_paid,currency,supplier_name,jjp_suppliers(name)')
    .eq('status', 'pendiente')
    .order('due_date', { ascending: true })
    .limit(5);

  if (error) { box.innerHTML = `<p style="color:#aaa;font-size:13px">No pude cargar las facturas</p>`; return; }
  if (!data?.length) {
    box.innerHTML = `<p style="color:#aaa;font-size:13px">✅ No tienes facturas pendientes de pago</p>`;
    return;
  }

  box.innerHTML = data.map(i => {
    const days = daysUntil(i.due_date);
    const bal  = Math.max(Number(i.amount || 0) - Number(i.amount_paid || 0), 0);
    const prov = i.jjp_suppliers?.name || i.supplier_name || 'Sin proveedor';
    const money = (i.currency === 'Bs' ? 'Bs ' : '$') + bal.toFixed(2);
    return `<div class="fac-sup-row">
      <div>
        <strong>${escapeHTML(prov)}</strong>
        <div class="fac-sub">${money}${i.invoice_number ? ' · #' + escapeHTML(i.invoice_number) : ''} · vence ${fmtDate(i.due_date + 'T00:00:00')}</div>
      </div>
      <span class="fac-chip ${urgencyClass(days)}">${escapeHTML(lapseText(days))}</span>
    </div>`;
  }).join('');
}

/* ---- Notificaciones internas (jjp_notifications) ---- */
async function loadNotifications() {
  const box = document.getElementById('notifList');
  if (!box) return;
  const { data, error } = await sb.from('jjp_notifications')
    .select('*').order('created_at', { ascending: false }).limit(15);
  if (error || !data) { box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:10px 16px">No se pudieron cargar.</p>'; return; }

  const unread = data.filter(n => !n.read).length;
  const badge  = document.getElementById('notifBadge');
  if (badge) {
    badge.style.display = unread ? 'inline-block' : 'none';
    badge.textContent = `${unread} nuevas`;
  }
  if (!data.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:10px 16px">Sin notificaciones todavía.</p>';
    return;
  }
  box.innerHTML = data.map(n => `
    <div onclick="openNotif('${n.id}', '${escapeHTML(n.link || '')}')"
         style="display:flex;gap:10px;align-items:flex-start;padding:10px 16px;cursor:pointer;
                border-bottom:1px solid #f0f0f0;${n.read ? 'opacity:.55' : 'background:#fbf7ef'}">
      <div style="flex:1">
        <div style="font-weight:${n.read ? '500' : '700'};font-size:13px">${escapeHTML(n.title)}</div>
        ${n.body ? `<div style="font-size:12px;color:var(--gr);margin-top:2px">${escapeHTML(n.body)}</div>` : ''}
        <div style="font-size:11px;color:#bbb;margin-top:3px">${fmtDate(n.created_at)}</div>
      </div>
      ${n.read ? '' : '<span style="width:8px;height:8px;border-radius:50%;background:var(--gm);margin-top:6px"></span>'}
    </div>`).join('');
}

async function openNotif(id, link) {
  await sb.from('jjp_notifications').update({ read: true }).eq('id', id);
  if (link) {
    // Los links guardados en BD son absolutos ("/admin/..."); los resolvemos
    // contra la raíz real del sitio para que funcionen en cualquier hosting.
    window.location.href = (typeof siteURL === 'function') ? siteURL(link) : link;
    return;
  }
  loadNotifications();
}

async function markAllNotifsRead() {
  await sb.from('jjp_notifications').update({ read: true }).eq('read', false);
  loadNotifications();
}

function renderDashStats(orders, prods, pendingQuotes, pendingReviews) {
  const paid    = orders.filter(o => PAID_STATUSES.includes(o.status));
  const toVerify = orders.filter(o => o.status === 'pendiente_pago' || o.status === 'verificando');
  const sales   = paid.reduce((s, o) => s + Number(o.total_usd || 0), 0);

  setText('stat-sales',    fmtPrice(sales));
  setText('stat-orders',   toVerify.length);
  setText('stat-products', prods.length);
  setText('stat-reviews',  pendingReviews);

  setText('stat-sales-sub',  `${paid.length} pedidos confirmados`);
  setText('stat-orders-sub', toVerify.length ? '¡Requieren tu atención!' : 'Todo al día ✔');
  setText('stat-quotes-extra', pendingQuotes);
}

// Simple CSS bar chart: sales (USD) per day, last 7 days
function renderSalesChart(orders) {
  const box = document.getElementById('salesChart');
  if (!box) return;

  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10),
                label: d.toLocaleDateString('es-VE', { weekday: 'short' }),
                total: 0 });
  }
  orders.filter(o => PAID_STATUSES.includes(o.status)).forEach(o => {
    const k = (o.created_at || '').slice(0, 10);
    const day = days.find(d => d.key === k);
    if (day) day.total += Number(o.total_usd || 0);
  });

  const max = Math.max(1, ...days.map(d => d.total));
  box.innerHTML = days.map(d => {
    const h = Math.round((d.total / max) * 100);
    return `<div class="bar-col">
      <div class="bar-val">${d.total ? '$' + d.total.toFixed(0) : ''}</div>
      <div class="bar" style="height:${Math.max(4, h)}%" title="${fmtPrice(d.total)}"></div>
      <div class="bar-lbl">${d.label}</div>
    </div>`;
  }).join('');
}

function renderStatusBreakdown(orders) {
  const box = document.getElementById('statusBreakdown');
  if (!box) return;
  const labels = {
    pendiente_pago: 'Pendiente pago', verificando: 'Verificando', pagado: 'Pagado',
    preparando: 'Preparando', entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado',
  };
  const counts = {};
  orders.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);
  const total = orders.length || 1;
  const order = Object.keys(labels).filter(k => counts[k]);
  if (!order.length) { box.innerHTML = '<p style="color:#aaa;font-size:13px">Aún no hay pedidos.</p>'; return; }
  box.innerHTML = order.map(k => {
    const pct = Math.round((counts[k] / total) * 100);
    return `<div class="sb-row">
      <div class="sb-top"><span>${labels[k]}</span><strong>${counts[k]}</strong></div>
      <div class="sb-track"><div class="sb-fill st-${k}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderRecentOrders(recent) {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;
  if (!recent.length) { tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Sin pedidos todavía</td></tr>`; return; }
  tbody.innerHTML = recent.map(o => `<tr>
    <td><strong>${escapeHTML(o.order_number)}</strong></td>
    <td>${escapeHTML(o.client_name)}</td>
    <td>${fmtPrice(o.total_usd)}</td>
    <td><span class="status-badge st-${o.status}">${(o.status||'').replace('_',' ')}</span></td>
    <td>${fmtDate(o.created_at)}</td>
  </tr>`).join('');
}

function renderLowStock(prods) {
  const box = document.getElementById('lowStock');
  if (!box) return;
  const low = prods
    .filter(p => p.stock !== null && p.stock >= 0 && p.stock <= 5)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 8);
  if (!low.length) { box.innerHTML = '<p style="color:var(--gm);font-size:13px">✔ Sin productos en bajo stock.</p>'; return; }
  box.innerHTML = low.map(p => `<div class="ls-row">
    <span class="ls-name">${escapeHTML(p.name)}</span>
    <span class="ls-qty ${p.stock === 0 ? 'out' : ''}">${p.stock === 0 ? 'Agotado' : p.stock + ' uds'}</span>
  </div>`).join('');
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
