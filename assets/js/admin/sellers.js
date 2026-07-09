/* ======================================================
   JJ Paper Admin — Vendedores (perfiles, comisiones, metas)
   ====================================================== */

let sellers = [];
let sellerRanking = {};   // id → { total_usd, orders_count } del mes
let editingSellerId = null;

async function loadSellers() {
  const [{ data, error }, rank] = await Promise.all([
    sb.from('jjp_profiles').select('*').order('created_at'),
    sb.rpc('jjp_seller_ranking', { p_days: 30 }),
  ]);
  if (error) { showToast('Error cargando vendedores', 'err'); return; }
  sellers = data || [];
  sellerRanking = {};
  (rank.data || []).forEach(r => { sellerRanking[r.seller_id] = r; });
  renderSellersTable();
}

function renderSellersTable() {
  const tbody = document.getElementById('sellersTableBody');
  if (!tbody) return;
  const admins = sellers.filter(s => s.role === 'admin');
  // Admins primero, luego vendedores (máx. 4 admins — lo impone la base de datos)
  const rows = [...admins, ...sellers.filter(s => s.role === 'vendedor')];

  document.getElementById('sellersCount').textContent =
    `${rows.length - admins.length} vendedores · ${admins.length}/4 admin(s)`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Aún no hay vendedores. Crea el primero con el botón "＋ Nuevo vendedor".</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(s => {
    const stats = sellerRanking[s.id] || { total_usd: 0, orders_count: 0 };
    const goal  = Number(s.monthly_goal_usd) || 0;
    const pct   = goal > 0 ? Math.min(100, Math.round(stats.total_usd / goal * 100)) : null;
    const refLink = s.ref_code ? `${location.origin}/catalogo.html?ref=${encodeURIComponent(s.ref_code)}` : null;
    return `<tr style="${s.active ? '' : 'opacity:.5'}">
      <td><div class="td-name">${escapeHTML(s.name || '—')}
        ${s.role === 'admin' ? '<span class="pill" style="background:var(--gm);color:#fff;margin-left:6px">Admin</span>' : ''}</div>
        <div class="td-sub">${escapeHTML(s.phone || '')}</div></td>
      <td>${s.ref_code
          ? `<code style="font-size:12px">${escapeHTML(s.ref_code)}</code>
             <button class="btn-o sm" title="Copiar link de venta" onclick="copySellerLink('${escapeHTML(refLink)}')">🔗</button>`
          : '<span style="color:#ccc">—</span>'}</td>
      <td><strong>${fmtPrice(stats.total_usd)}</strong><div class="td-sub">${stats.orders_count} pedidos (30d)</div></td>
      <td>${goal > 0
          ? `<div style="min-width:90px"><strong>${pct}%</strong> de ${fmtPrice(goal)}
             <div style="background:#eee;border-radius:4px;height:6px;margin-top:4px"><div style="background:var(--gm);height:6px;border-radius:4px;width:${pct}%"></div></div></div>`
          : '<span style="color:#ccc">Sin meta</span>'}</td>
      <td>${Number(s.commission_pct)}%<div class="td-sub">desc. máx ${Number(s.max_discount_pct)}%</div></td>
      <td><span class="pill ${s.active ? 'ok' : ''}" style="${s.active ? '' : 'background:#fdd;color:#a33'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="td-actions">
        <button class="btn-p sm" onclick="openSellerModal('${s.id}')">✏️ Editar</button>
        <button class="btn-o sm" onclick="toggleSellerActive('${s.id}', ${!s.active})">${s.active ? '⏸️' : '▶️'}</button>
      </div></td>
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
  document.getElementById('sl-role').value  = s?.role || 'vendedor';
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
  const role  = document.getElementById('sl-role').value === 'admin' ? 'admin' : 'vendedor';
  const ref   = document.getElementById('sl-ref').value.trim().toLowerCase() || null;
  const comm  = parseFloat(document.getElementById('sl-comm').value) || 0;
  const disc  = parseFloat(document.getElementById('sl-disc').value) || 0;
  const goal  = parseFloat(document.getElementById('sl-goal').value) || 0;
  if (!name) { showToast('Ingresa el nombre', 'warn'); return; }

  const fields = {
    name, phone, role, ref_code: ref, commission_pct: comm,
    max_discount_pct: disc, monthly_goal_usd: goal, updated_at: new Date().toISOString(),
  };

  const btn = document.getElementById('sellerSaveBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    if (editingSellerId) {
      const { error } = await sb.from('jjp_profiles').update(fields).eq('id', editingSellerId);
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
      // El trigger ya creó el perfil (inactivo); el admin lo completa y activa
      const { error: e2 } = await sb.from('jjp_profiles')
        .update({ ...fields, active: true }).eq('id', uid);
      if (e2) throw e2;
      if (!data.session) {
        showToast('Vendedor creado. Si la confirmación por email está activa, deberá confirmar su correo antes de entrar.', 'warn', 6000);
      }
    }
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
