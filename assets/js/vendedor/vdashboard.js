/* ======================================================
   JJ Paper Vendedor — Dashboard (ventas, meta, ranking)
   ====================================================== */

async function initSellerDashboard() {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: orders }, rank] = await Promise.all([
    // RLS: solo devuelve pedidos del vendedor logueado
    sb.from('jjp_orders')
      .select('order_number,client_name,total_usd,delivery_fee_usd,status,created_at')
      .order('created_at', { ascending: false }),
    sb.rpc('jjp_seller_ranking', { p_days: 30 }),
  ]);

  const all   = orders || [];
  const month = all.filter(o => new Date(o.created_at) >= monthStart);
  const paid  = month.filter(o => V_PAID.includes(o.status));
  const pend  = month.filter(o => ['pendiente_pago', 'verificando'].includes(o.status));
  const sales = paid.reduce((s, o) => s + Number(o.total_usd || 0), 0);
  // Comisión sobre productos: el envío no comisiona
  const commBase = paid.reduce((s, o) => s + Number(o.total_usd || 0) - Number(o.delivery_fee_usd || 0), 0);
  const comm  = commBase * (Number(SELLER.commission_pct) || 0) / 100;

  setV('v-sales',   fmtPrice(sales));
  setV('v-comm',    fmtPrice(comm));
  setV('v-orders',  month.length);
  setV('v-pending', pend.length);

  renderGoal(sales);
  renderRefLink();
  renderRanking(rank.data || []);
  renderSellerNotifs();
  renderRecentSellerOrders(all.slice(0, 6));
}

function setV(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function renderGoal(sales) {
  const goal = Number(SELLER.monthly_goal_usd) || 0;
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

function renderRanking(rows) {
  const box = document.getElementById('v-ranking');
  if (!box) return;
  if (!rows.length) { box.innerHTML = '<p style="color:#aaa;font-size:13px">Aún no hay datos del equipo.</p>'; return; }
  const medals = ['🥇', '🥈', '🥉'];
  box.innerHTML = rows.slice(0, 8).map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;
                border-bottom:1px solid #f2f2f2;${r.seller_id === SELLER.id ? 'font-weight:700;color:var(--gd)' : ''}">
      <span>${medals[i] || (i + 1) + '.'} ${escapeHTML(r.seller_name)}${r.seller_id === SELLER.id ? ' (tú)' : ''}</span>
      <span>${fmtPrice(r.total_usd)} <small style="color:var(--gr)">· ${r.orders_count} ped.</small></span>
    </div>`).join('');
}

async function renderSellerNotifs() {
  const box = document.getElementById('v-notifs');
  if (!box) return;
  const { data } = await sb.from('jjp_notifications')
    .select('*').order('created_at', { ascending: false }).limit(10);
  if (!data?.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:10px 16px">Sin notificaciones todavía.</p>';
    return;
  }
  box.innerHTML = data.map(n => `
    <div onclick="vOpenNotif('${n.id}')" style="display:flex;gap:10px;padding:10px 16px;cursor:pointer;
         border-bottom:1px solid #f0f0f0;${n.read ? 'opacity:.55' : 'background:#fbf7ef'}">
      <div style="flex:1">
        <div style="font-weight:${n.read ? '500' : '700'};font-size:13px">${escapeHTML(n.title)}</div>
        ${n.body ? `<div style="font-size:12px;color:var(--gr)">${escapeHTML(n.body)}</div>` : ''}
        <div style="font-size:11px;color:#bbb;margin-top:3px">${fmtDate(n.created_at)}</div>
      </div>
      ${n.read ? '' : '<span style="width:8px;height:8px;border-radius:50%;background:var(--gm);margin-top:6px"></span>'}
    </div>`).join('');
}

async function vOpenNotif(id) {
  await sb.from('jjp_notifications').update({ read: true }).eq('id', id);
  renderSellerNotifs();
  refreshSellerNotifBadge();
}

async function vMarkAllRead() {
  await sb.from('jjp_notifications').update({ read: true }).eq('read', false);
  renderSellerNotifs();
  refreshSellerNotifBadge();
}

function renderRecentSellerOrders(recent) {
  const tbody = document.getElementById('v-recent');
  if (!tbody) return;
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Aún no tienes pedidos. ¡Haz tu primera venta desde el POS! 🛍️</td></tr>';
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
