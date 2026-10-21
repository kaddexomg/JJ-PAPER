
const DEFAULT_ROLE_PERMS = {
  admin: {
    can_view_all_sales: true, can_edit_prices: true, can_give_discount: true,
    can_manage_clients: true, can_access_billing: true, can_access_collections: true,
    can_sync_mixnet: true
  },
  supervisor: {
    can_view_all_sales: true, can_edit_prices: false, can_give_discount: true,
    can_manage_clients: true, can_access_billing: false, can_access_collections: true,
    can_sync_mixnet: true
  },
  vendedor: {
    can_view_all_sales: false, can_edit_prices: false, can_give_discount: true,
    can_manage_clients: true, can_access_billing: false, can_access_collections: false,
    can_sync_mixnet: false
  },
  facturacion: {
    can_view_all_sales: true, can_edit_prices: false, can_give_discount: false,
    can_manage_clients: false, can_access_billing: true, can_access_collections: false,
    can_sync_mixnet: true
  },
  cobranza: {
    can_view_all_sales: true, can_edit_prices: false, can_give_discount: false,
    can_manage_clients: true, can_access_billing: false, can_access_collections: true,
    can_sync_mixnet: false
  },
  cajero: {
    can_view_all_sales: false, can_edit_prices: false, can_give_discount: false,
    can_manage_clients: false, can_access_billing: true, can_access_collections: false,
    can_sync_mixnet: false
  }
};

function getPermissionsFromUI() {
  return {
    can_view_all_sales: !!document.getElementById('perm-view-all-sales')?.checked,
    can_edit_prices: !!document.getElementById('perm-edit-prices')?.checked,
    can_give_discount: !!document.getElementById('perm-give-discount')?.checked,
    can_manage_clients: !!document.getElementById('perm-manage-clients')?.checked,
    can_access_billing: !!document.getElementById('perm-billing')?.checked,
    can_access_collections: !!document.getElementById('perm-collections')?.checked,
    can_sync_mixnet: !!document.getElementById('perm-sync-mixnet')?.checked,
  };
}

function setPermissionsToUI(perms = {}) {
  const p = perms || {};
  if (document.getElementById('perm-view-all-sales')) document.getElementById('perm-view-all-sales').checked = !!p.can_view_all_sales;
  if (document.getElementById('perm-edit-prices')) document.getElementById('perm-edit-prices').checked = !!p.can_edit_prices;
  if (document.getElementById('perm-give-discount')) document.getElementById('perm-give-discount').checked = !!p.can_give_discount;
  if (document.getElementById('perm-manage-clients')) document.getElementById('perm-manage-clients').checked = !!p.can_manage_clients;
  if (document.getElementById('perm-billing')) document.getElementById('perm-billing').checked = !!p.can_access_billing;
  if (document.getElementById('perm-collections')) document.getElementById('perm-collections').checked = !!p.can_access_collections;
  if (document.getElementById('perm-sync-mixnet')) document.getElementById('perm-sync-mixnet').checked = !!p.can_sync_mixnet;
}

window.updateRolePermissions = function(role) {
  const defaults = DEFAULT_ROLE_PERMS[role] || DEFAULT_ROLE_PERMS.vendedor;
  setPermissionsToUI(defaults);
};

window.resetPermissionsToRole = function() {
  const r = document.getElementById('sl-role')?.value || 'vendedor';
  window.updateRolePermissions(r);
};

/* ======================================================
   JJ Paper Admin — Vendedores (perfiles, comisiones, metas)
   ====================================================== */

let sellers = [];
let sellerRanking = {};        // id → { total_usd, total_orders } del mes
let sellerCustomerCounts = {}; // id → count de clientes asignados
let sellerQuoteCounts = {};    // id → count de cotizaciones
let editingSellerId = null;

// Mapa oficial de vendedores MixNet ERP (3 dígitos)
const MIXNET_CODE_MAP = {
  '86b0ef8b-a41b-4385-a8f9-314a5052cb94': '001', // Mary Garcia
  'e6957754-de00-4088-8e54-affcaa172247': '002', // Luis Alarcon
  '07540d9c-4ed9-46d2-95ce-0a0200be6083': '004', // Yovanni Araujo
  '3c9b7ddd-4b98-45c6-a646-5c557a2bc043': '008', // Marianela Ventas JJ
  'bddc57dc-5bf9-4a72-9e1c-751d07b03164': '010', // Keyder Salazar
  '68c29cd3-760a-4282-8214-4e7c60413ec5': '014', // Andreina JJ Ventas
  '7eeb41f2-55e1-4e5e-b6c2-3da87582b51b': '025', // Ana Barajas
  '4d76dc4c-503a-48ca-9c98-f9ea3d2af755': '026', // JJ Paper 26
  '9201071b-ab77-4de3-90a4-a79c93c4213c': '032', // JJ Paper 32
  '485e3fde-f95d-4857-9175-147051a54748': '033'  // JJ Paper 33
};

function getStoredMixnetCodes() {
  try {
    return JSON.parse(localStorage.getItem('jjp_mixnet_seller_codes') || '{}');
  } catch (_) { return {}; }
}

function setStoredMixnetCode(id, code) {
  if (!id) return;
  try {
    const map = getStoredMixnetCodes();
    if (code) map[id] = code;
    else delete map[id];
    localStorage.setItem('jjp_mixnet_seller_codes', JSON.stringify(map));
  } catch (_) {}
}

function getSellerMixnetCode(id, name) {
  if (!id && !name) return '';
  const localMap = getStoredMixnetCodes();
  if (id && localMap[id]) return localMap[id];
  if (id && MIXNET_CODE_MAP[id]) return MIXNET_CODE_MAP[id];
  if (name) {
    const n = name.toLowerCase();
    if (n.includes('mary')) return '001';
    if (n.includes('alarcon') || n.includes('alarcón')) return '002';
    if (n.includes('yovanni') || n.includes('giovanni') || n.includes('araujo')) return '004';
    if (n.includes('marianela')) return '008';
    if (n.includes('keyder') || n.includes('salazar')) return '010';
    if (n.includes('andreina')) return '014';
    if (n.includes('barajas') || n.includes('ana')) return '025';
    if (n.includes('26')) return '026';
    if (n.includes('32')) return '032';
    if (n.includes('33')) return '033';
  }
  return '';
}

function selectRole(role) {
  const roleEl = document.getElementById('sl-role');
  if (roleEl && roleEl.value !== role) roleEl.value = role;
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === role);
  });
}
window.selectRole = selectRole;


async function loadSellers() {
  const [{ data, error }, rank, custs, quotes] = await Promise.all([
    sb.from('jjp_profiles').select('*').order('created_at'),
    sb.rpc('jjp_seller_ranking', { p_days: 30 }),
    sb.from('jjp_customers').select('seller_id'),
    sb.from('jjp_quotes').select('seller_id'),
  ]);

  if (error) { showToast('Error cargando vendedores', 'err'); return; }
  sellers = data || [];

  sellerRanking = {};
  (rank.data || []).forEach(r => {
    sellerRanking[r.seller_id] = {
      total_usd: Number(r.total_usd || 0),
      total_orders: Number(r.total_orders || r.orders_count || 0),
    };
  });

  sellerCustomerCounts = {};
  (custs.data || []).forEach(c => {
    if (c.seller_id) {
      sellerCustomerCounts[c.seller_id] = (sellerCustomerCounts[c.seller_id] || 0) + 1;
    }
  });

  sellerQuoteCounts = {};
  (quotes.data || []).forEach(q => {
    if (q.seller_id) {
      sellerQuoteCounts[q.seller_id] = (sellerQuoteCounts[q.seller_id] || 0) + 1;
    }
  });

  renderSellersSummary(rank.data || [], quotes.data || []);
  renderSellersTable();
}

function renderSellersSummary(rankData, quotesData) {
  let totalSalesUsd = 0;
  let totalOrders = 0;
  let topSeller = null;
  let topSellerSales = -1;

  rankData.forEach(r => {
    const usd = Number(r.total_usd || 0);
    const ords = Number(r.total_orders || r.orders_count || 0);
    totalSalesUsd += usd;
    totalOrders += ords;
    if (usd > topSellerSales) {
      topSellerSales = usd;
      topSeller = r.name;
    }
  });

  const rate = (typeof getRate === 'function') ? getRate() : 40;
  const totalSalesBs = totalSalesUsd * rate;

  const elSales = document.getElementById('stat-team-sales');
  const elSalesSub = document.getElementById('stat-team-sales-sub');
  const elOrders = document.getElementById('stat-team-orders');
  const elQuotes = document.getElementById('stat-team-quotes');
  const elLeader = document.getElementById('stat-team-leader');
  const elLeaderSub = document.getElementById('stat-team-leader-sub');

  if (elSales) elSales.textContent = fmtPrice(totalSalesUsd);
  if (elSalesSub) elSalesSub.textContent = `Bs ${totalSalesBs.toLocaleString('es-VE', { maximumFractionDigits: 2 })} (BCV)`;
  if (elOrders) elOrders.textContent = totalOrders.toLocaleString('es-VE');
  if (elQuotes) elQuotes.textContent = (quotesData.length || 0).toLocaleString('es-VE');
  if (elLeader) elLeader.textContent = topSeller || '—';
  if (elLeaderSub) elLeaderSub.textContent = topSeller ? `${fmtPrice(topSellerSales)} facturados` : 'Sin ventas registradas';
}

function renderSellersTable() {
  const tbody = document.getElementById('sellersTableBody');
  if (!tbody) return;
  const admins = sellers.filter(s => s.role === 'admin');
  const supers = sellers.filter(s => s.role === 'supervisor');
  const vends  = sellers.filter(s => s.role !== 'admin' && s.role !== 'supervisor');
  const rows = [...admins, ...supers, ...vends];

  const countParts = [];
  if (vends.length) countParts.push(`${vends.length} vendedor(es)`);
  if (supers.length) countParts.push(`${supers.length} supervisor(es)`);
  countParts.push(`${admins.length}/4 admin(s)`);
  document.getElementById('sellersCount').textContent = countParts.join(' · ');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Aún no hay vendedores. Crea el primero con el botón "＋ Nuevo vendedor".</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(s => {
    const stats = sellerRanking[s.id] || { total_usd: 0, total_orders: 0 };
    const ordersCount = stats.total_orders || 0;
    const clientCount = sellerCustomerCounts[s.id] || 0;
    const quoteCount  = sellerQuoteCounts[s.id] || 0;

    const goal  = Number(s.monthly_goal_usd) || 0;
    const pct   = goal > 0 ? Math.min(100, Math.round(stats.total_usd / goal * 100)) : null;
    const refLink = s.ref_code ? `${location.origin}/catalogo.html?ref=${encodeURIComponent(s.ref_code)}` : null;
    const mixCode = s.mixnet_code || getSellerMixnetCode(s.id, s.name);

    let roleBadge = '<span class="pill" style="background:#166534;color:#fff;margin-left:6px;font-size:11px">🧑‍💼 Vendedor</span>';
    if (s.role === 'admin') {
      roleBadge = '<span class="pill" style="background:#991b1b;color:#fff;margin-left:6px;font-size:11px;font-weight:700">🛡️ Admin</span>';
    } else if (s.role === 'supervisor') {
      roleBadge = '<span class="pill" style="background:#0284c7;color:#fff;margin-left:6px;font-size:11px;font-weight:700">🕵️ Supervisor</span>';
    }

    return `<tr style="${s.active ? '' : 'opacity:.5'}">
      <td>
        <div class="td-name">
          ${escapeHTML(s.name || '—')}
          ${roleBadge}
        </div>
        <div class="td-sub">${escapeHTML(s.phone || '')}</div>
        ${mixCode ? `<div style="margin-top:4px"><span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;font-size:11px;font-family:monospace;background:#0d3829;color:#a3e635;border:1px solid #235843">📁 MixNet: <strong>${escapeHTML(mixCode)}</strong></span></div>` : ''}
      </td>
      <td>
        ${s.ref_code
          ? `<code style="font-size:12px">${escapeHTML(s.ref_code)}</code>
             <button class="btn-o sm" title="Copiar link de venta" onclick="copySellerLink('${escapeHTML(refLink)}')">🔗</button>`
          : '<span style="color:#ccc">—</span>'}
      </td>
      <td>
        <strong>${fmtPrice(stats.total_usd)}</strong>
        <div class="td-sub">${ordersCount} pedidos (30d)</div>
      </td>
      <td>
        <div style="font-weight:700;color:var(--dark)">${clientCount} clientes</div>
        <div class="td-sub">${quoteCount} cotizaciones</div>
      </td>
      <td>
        ${goal > 0
          ? `<div style="min-width:90px"><strong>${pct}%</strong> de ${fmtPrice(goal)}
             <div style="background:#eee;border-radius:4px;height:6px;margin-top:4px"><div style="background:var(--gm);height:6px;border-radius:4px;width:${pct}%"></div></div></div>`
          : '<span style="color:#ccc">Sin meta</span>'}
      </td>
      <td>${Number(s.commission_pct)}%<div class="td-sub">desc. máx ${Number(s.max_discount_pct)}%</div></td>
      <td><span class="pill ${s.active ? 'ok' : ''}" style="${s.active ? '' : 'background:#fdd;color:#a33'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="openSellerModal('${s.id}')">✏️ Editar</button>
          <button class="btn-o sm" onclick="toggleSellerActive('${s.id}', ${!s.active})">${s.active ? '⏸️' : '▶️'}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function copySellerLink(link) {
  navigator.clipboard?.writeText(link).then(() => showToast('Link de venta copiado ✔'));
}

// ---- Crear / editar ----
function openSellerModal(id = null) {
  editingSellerId = id;
  const s = id ? sellers.find(x => x.id === id) : null;
  document.getElementById('sellerModalTitle').textContent = s ? `Editar: ${s.name}` : 'Nuevo vendedor';
  document.getElementById('sellerCredWrap').style.display = s ? 'none' : 'block';
  document.getElementById('sl-name').value  = s?.name || '';
  document.getElementById('sl-phone').value = s?.phone || '';
  document.getElementById('sl-email').value = '';
  document.getElementById('sl-pass').value  = '';
  
  const curRole = s?.role || 'vendedor';
  const roleEl = document.getElementById('sl-role');
  if (roleEl) roleEl.value = curRole;
  selectRole(curRole);

  const mixCode = s?.mixnet_code || getSellerMixnetCode(s?.id, s?.name);
  const mixEl = document.getElementById('sl-mixnet-code');
  if (mixEl) mixEl.value = mixCode || '';

  // Guarda de seguridad anti-lockout: notificar en modal si es el único admin activo
  const activeAdmins = sellers.filter(x => x.role === 'admin' && x.active);
  const isLastActiveAdmin = s && s.role === 'admin' && s.active && activeAdmins.length <= 1;
  const lockWarn = document.getElementById('sl-lock-warning');
  if (lockWarn) {
    lockWarn.style.display = isLastActiveAdmin ? 'block' : 'none';
  }

  document.getElementById('sl-ref').value   = s?.ref_code || '';
  document.getElementById('sl-comm').value  = s?.commission_pct ?? 5;
  document.getElementById('sl-disc').value  = s?.max_discount_pct ?? 10;
  document.getElementById('sl-goal').value  = s?.monthly_goal_usd ?? 0;
  document.getElementById('sellerModal').classList.add('op');
}
function closeSellerModal() {
  document.getElementById('sellerModal').classList.remove('op');
}

// Sugerir código de referido a partir del nombre
function suggestRefCode() {
  const el = document.getElementById('sl-ref');
  if (el.value.trim()) return;
  const name = document.getElementById('sl-name').value.trim();
  if (!name) return;
  el.value = normTxt(name.split(/\s+/)[0]).replace(/[^a-z0-9]/g, '') +
             Math.floor(10 + Math.random() * 90);
}

async function saveSeller() {
  const name  = document.getElementById('sl-name').value.trim();
  const phone = document.getElementById('sl-phone').value.trim() || null;
  const roleVal = document.getElementById('sl-role').value;
  const role  = ['admin', 'supervisor', 'vendedor'].includes(roleVal) ? roleVal : 'vendedor';
  const mixnetCode = document.getElementById('sl-mixnet-code')?.value || null;
  const ref   = document.getElementById('sl-ref').value.trim().toLowerCase() || null;
  const comm  = parseFloat(document.getElementById('sl-comm').value) || 0;
  const disc  = parseFloat(document.getElementById('sl-disc').value) || 0;
  const goal  = parseFloat(document.getElementById('sl-goal').value) || 0;
  if (!name) { showToast('Ingresa el nombre', 'warn'); return; }

  const btn = document.getElementById('sellerSaveBtn');

  // GUARDA DE SEGURIDAD ANTI-LOCKOUT
  if (editingSellerId) {
    const cur = sellers.find(x => x.id === editingSellerId);
    if (cur && cur.role === 'admin' && role !== 'admin') {
      const activeAdmins = sellers.filter(x => x.role === 'admin' && x.active);
      if (activeAdmins.length <= 1 && activeAdmins.some(a => a.id === editingSellerId)) {
        showToast('🛡️ Acción bloqueada (Anti-Lockout): No puedes degradar al último Administrador activo.', 'err', 6000);
        return;
      }
    }
  }

  const fields = {
    name, phone, role, ref_code: ref, commission_pct: comm,
    max_discount_pct: disc, monthly_goal_usd: goal, updated_at: new Date().toISOString(),
  };
  if (mixnetCode) fields.mixnet_code = mixnetCode;

  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    let savedId = editingSellerId;
    if (editingSellerId) {
      let { error } = await sb.from('jjp_profiles').update(fields).eq('id', editingSellerId);
      if (error && error.message && error.message.includes('mixnet_code')) {
        delete fields.mixnet_code;
        error = (await sb.from('jjp_profiles').update(fields).eq('id', editingSellerId)).error;
      }
      if (error) throw error;
    } else {
      // Crear usuario con un cliente secundario para NO pisar la sesión del admin
      const email = document.getElementById('sl-email').value.trim();
      const pass  = document.getElementById('sl-pass').value;
      if (!email || pass.length < 6) {
        showToast('Email y contraseña (mín. 6 caracteres) son obligatorios', 'warn');
        btn.disabled = false; btn.textContent = '💾 Guardar'; return;
      }
      const sb2 = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      const { data, error } = await sb2.auth.signUp({
        email, password: pass, options: { data: { name } },
      });
      if (error) throw error;
      const uid = data.user?.id;
      if (!uid) throw new Error('No se pudo crear el usuario');
      savedId = uid;
      // El trigger ya creó el perfil (inactivo); el admin lo completa y activa
      let { error: e2 } = await sb.from('jjp_profiles')
        .update({ ...fields, active: true }).eq('id', uid);
      if (e2 && e2.message && e2.message.includes('mixnet_code')) {
        delete fields.mixnet_code;
        e2 = (await sb.from('jjp_profiles').update({ ...fields, active: true }).eq('id', uid)).error;
      }
      if (e2) throw e2;
      if (!data.session) {
        showToast('Vendedor creado. Si la confirmación por email está activa, deberá confirmar su correo antes de entrar.', 'warn', 6000);
      }
    }
    setStoredMixnetCode(savedId, mixnetCode);
    showToast('Vendedor guardado ✔');
    closeSellerModal();
    await loadSellers();
  } catch (e) {
    console.error('saveSeller:', e);
    const msg = e.message?.includes('admin_limit')
      ? (e.message.includes('máximo') ? 'Límite alcanzado: máximo 4 administradores' : 'Debe quedar al menos un administrador activo')
      : e.message?.includes('duplicate') ? 'Ese código de referido ya existe' : 'Error guardando vendedor';
    showToast(msg, 'err');
  }
  btn.disabled = false; btn.textContent = '💾 Guardar';
}

async function toggleSellerActive(id, active) {
  // GUARDA DE SEGURIDAD ANTI-LOCKOUT
  if (!active) {
    const s = sellers.find(x => x.id === id);
    if (s && s.role === 'admin') {
      const activeAdmins = sellers.filter(x => x.role === 'admin' && x.active);
      if (activeAdmins.length <= 1 && activeAdmins.some(a => a.id === id)) {
        showToast('🛡️ Acción bloqueada (Anti-Lockout): No puedes desactivar al único Administrador activo del sistema.', 'err', 6000);
        return;
      }
    }
  }

  const { error } = await sb.from('jjp_profiles')
    .update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    showToast(error.message?.includes('admin_limit')
      ? 'Debe quedar al menos un administrador activo'
      : 'Error actualizando', 'err');
    return;
  }
  showToast(active ? 'Vendedor activado ✔' : 'Vendedor desactivado');
  await loadSellers();
}
