/* ======================================================
   JJ Paper Vendedor — Dashboard Personal Soberano
   (ventas personales, meta personal, desempeño comercial)
   ====================================================== */

function getActiveSeller() {
  if (typeof SELLER !== 'undefined' && SELLER) return SELLER;
  if (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) return CURRENT_PROFILE;
  if (typeof window !== 'undefined' && window.SELLER) return window.SELLER;
  return { id: null, name: 'JJ Paper', commission_pct: 0, monthly_goal_usd: 0 };
}

async function initSellerDashboard() {
  const seller = getActiveSeller();
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  // Consulta pedidos estrictamente del vendedor logueado
  let ordersQuery = sb.from('jjp_orders')
    .select('order_number,client_name,total_usd,delivery_fee_usd,status,created_at')
    .order('created_at', { ascending: false });

  if (seller?.id) {
    ordersQuery = ordersQuery.eq('seller_id', seller.id);
  }

  // Consulta cotizaciones del mes para este vendedor
  let quotesQuery = sb.from('jjp_quotes')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart.toISOString());
  if (seller?.id) {
    quotesQuery = quotesQuery.eq('seller_id', seller.id);
  }

  // Consulta clientes en la cartera del vendedor
  let custQuery = sb.from('jjp_customers')
    .select('id', { count: 'exact', head: true });
  if (seller?.id) {
    custQuery = custQuery.eq('seller_id', seller.id);
  }

  const [{ data: orders }, { count: monthQuotesCount }, { count: myCustCount }] = await Promise.all([
    ordersQuery,
    quotesQuery,
    custQuery
  ]);

  const all   = orders || [];
  const month = all.filter(o => new Date(o.created_at) >= monthStart);
  const paid  = month.filter(o => V_PAID.includes(o.status));
  const pend  = month.filter(o => ['pendiente_pago', 'verificando'].includes(o.status));
  const sales = paid.reduce((s, o) => s + Number(o.total_usd || 0), 0);
  
  // Comisión sobre productos: el envío no comisiona
  const commBase = paid.reduce((s, o) => s + Number(o.total_usd || 0) - Number(o.delivery_fee_usd || 0), 0);
  const comm  = commBase * (Number(seller.commission_pct) || 0) / 100;

  setV('v-sales',   fmtPrice(sales));
  setV('v-comm',    fmtPrice(comm));
  setV('v-orders',  month.length);
  setV('v-pending', pend.length);

  // Estadísticas comerciales personales (sin exponer ranking a terceros)
  const avgTicket = paid.length > 0 ? (sales / paid.length) : (all.length > 0 ? (sales / all.length) : 0);
  setV('v-stat-cust', `${myCustCount || 0} clientes`);
  setV('v-stat-quotes', `${monthQuotesCount || 0} emitidas`);
  setV('v-stat-avg', fmtPrice(avgTicket));

  renderGoal(sales);
  renderRefLink();
  renderSellerNotifs();
  renderRecentSellerOrders(all.slice(0, 8));
}

function setV(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function renderGoal(sales) {
  const seller = getActiveSeller();
  const goal = Number(seller.monthly_goal_usd) || 0;
  const lbl  = document.getElementById('v-goal-label');
  const bar  = document.getElementById('v-goal-bar');
  if (!goal) {
    if (lbl) lbl.textContent = 'Sin meta asignada — pídele una a tu administrador 😉';
    return;
  }
  const pct = Math.min(100, Math.round(sales / goal * 100));
  if (lbl) lbl.innerHTML = `<strong>${fmtPrice(sales)}</strong> de ${fmtPrice(goal)} · <strong>${pct}%</strong>${pct >= 100 ? ' 🎉 ¡Meta cumplida!' : ''}`;
  if (bar) bar.style.width = pct + '%';
}

function renderRefLink() {
  const box  = document.getElementById('v-reflink-box');
  if (!box) return;
  const link = sellerRefLink();
  if (!link) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px">No tienes código de referido asignado todavía. Pídeselo a tu administrador.</p>';
    return;
  }
  const waShare = `¡Hola! 👋 Te comparto el catálogo de JJ Paper con los mejores precios en papelería: ${link}`;
  box.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <input class="fi" value="${escapeHTML(link)}" readonly onclick="this.select()" style="font-size:12px">
      <button class="btn-p sm" onclick="navigator.clipboard.writeText('${escapeHTML(link)}').then(()=>showToast('Link copiado ✔'))">📋</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-wa sm" style="width:auto;padding:8px 14px" onclick="openWA(${JSON.stringify(waShare).replace(/"/g, '&quot;')})">💬 Compartir por WhatsApp</button>
      <a class="btn-o sm" target="_blank" href="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(link)}">🔳 Ver QR imprimible</a>
    </div>`;
}

// Lista de dominios y orígenes no comerciales para no contaminar notificaciones de ventas
const NON_COMMERCIAL_NOTIF_FILTER = [
  'linkedin', 'glassdoor', 'dazn', 'netflix', 'disney', 'okx', 'twitch',
  'coursera', 'apple', 'google', 'red hat', 'slate digital', 'adobe',
  'panini', 'ollama', 'weremoto', 'movistar', 'bancoplaza'
];

async function renderSellerNotifs() {
  const box = document.getElementById('v-notifs');
  if (!box) return;
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id || null;
  if (!sellerId) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:10px 16px">Sin notificaciones todavía.</p>';
    return;
  }

  const { data } = await sb.from('jjp_notifications')
    .select('*')
    .eq('user_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(30);

  // Filtramos notificaciones relevantes a ventas y clientes
  const validNotifs = (data || []).filter(n => {
    const title = (n.title || '').toLowerCase();
    const isSpamDomain = NON_COMMERCIAL_NOTIF_FILTER.some(d => title.includes(d));
    if (isSpamDomain) return false;
    return true;
  }).slice(0, 8);

  if (!validNotifs.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:10px 16px">Sin notificaciones comerciales pendientes.</p>';
    return;
  }

  box.innerHTML = validNotifs.map(n => `
    <div onclick="vOpenNotif('${n.id}')" style="display:flex;gap:10px;padding:10px 16px;cursor:pointer;
         border-bottom:1px solid #f0f0f0;${n.read ? 'opacity:.55' : 'background:#fbf7ef'}">
      <div style="flex:1">
        <div style="font-weight:${n.read ? '500' : '700'};font-size:13px">${escapeHTML(n.title)}</div>
        <div style="font-size:12px;color:var(--gm);margin-top:2px">${escapeHTML(n.body || '')}</div>
        <div style="font-size:10px;color:var(--gr);margin-top:4px">${fmtDate(n.created_at)}</div>
      </div>
    </div>
  `).join('');
}

async function vOpenNotif(id) {
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id || null;
  let q = sb.from('jjp_notifications').update({ read: true }).eq('id', id);
  if (sellerId) q = q.eq('user_id', sellerId);
  await q;
  renderSellerNotifs();
  refreshSellerNotifBadge();
}

async function vMarkAllRead() {
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id || null;
  if (!sellerId) return;
  await sb.from('jjp_notifications').update({ read: true }).eq('user_id', sellerId).eq('read', false);
  renderSellerNotifs();
  refreshSellerNotifBadge();
}

function renderRecentSellerOrders(recent) {
  const tbody = document.getElementById('v-recent');
  if (!tbody) return;
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Aún no tienes pedidos registrados en tu cartera. ¡Haz tu primera venta desde el POS! 🛍️</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(o => `<tr>
    <td><strong>${escapeHTML(o.order_number)}</strong></td>
    <td>${escapeHTML(o.client_name)}</td>
    <td>${fmtPrice(o.total_usd)}</td>
    <td><span class="status-badge st-${o.status}">${(V_STATUS_LABEL[o.status] || o.status)}</span></td>
    <td>${fmtDate(o.created_at)}</td>
  </tr>`).join('');
}
