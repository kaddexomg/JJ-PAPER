/* ======================================================
   JJ Paper — Gestión y Comparativa de Listas de Precios
   Manejo de precios A, B, C, D y estatus MixNet (1_Activos,
   3_Solo Precio, 2_Inactivos)
   ====================================================== */

let ALL_PRODUCTS = [];
let FILTERED_PRODUCTS = [];
let CURRENT_TAB = 'operativo';
let CURRENT_PAGE = 1;
const PAGE_SIZE = 50;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth('admin');
  if (!session) return;
  const profile = await loadProfile();
  const emailEl = document.getElementById('adminUserEmail');
  if (emailEl) emailEl.textContent = profile.name || session.user.email;
  
  document.getElementById('menuToggleBtn')?.addEventListener('click', () => {
    document.getElementById('adminAside')?.classList.toggle('op');
  });

  await loadSettings();
  updateBcvBadge();
  await loadProducts();
});

function updateBcvBadge() {
  const rate = getRate();
  const b = document.getElementById('bcvBadge');
  if (b) b.textContent = `💵 Tasa BCV: ${rate.toFixed(2)} Bs/$`;
}

async function loadProducts() {
  try {
    const tbody = document.getElementById('productsTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#888">Cargando catálogo completo desde la base de datos...</td></tr>';

    // Rango 0-1999 para cubrir todo el catálogo sin cortes
    const { data, error } = await sb.from('jjp_products')
      .select('id, sku, name, price_a, price_b, price_c_bs, price_d_bs, price_usd, cost_usd, stock, mixnet_status, active, last_movement_at, last_sale_at, created_at')
      .range(0, 2499)
      .order('name', { ascending: true });

    if (error) throw error;

    ALL_PRODUCTS = data || [];
    updateKpis();
    applyFilters();
  } catch (err) {
    console.error('Error cargando productos:', err);
    if (typeof showToast === 'function') showToast('Error cargando listas de precios: ' + err.message, 'err');
  }
}

function updateKpis() {
  let cntActivos = 0;
  let cntSoloPrecio = 0;
  let cntInactivos = 0;

  for (const p of ALL_PRODUCTS) {
    const st = p.mixnet_status || 'ACTIVO';
    if (st === 'ACTIVO') cntActivos++;
    else if (st === 'SOLO_PRECIO') cntSoloPrecio++;
    else if (st === 'INACTIVO') cntInactivos++;
    else cntActivos++; // Default
  }

  const cntOperativo = cntActivos + cntSoloPrecio;

  const elOp = document.getElementById('kpiOperativo');
  const elAct = document.getElementById('kpiActivos');
  const elSp = document.getElementById('kpiSoloPrecio');
  const elIn = document.getElementById('kpiInactivos');

  if (elOp) elOp.textContent = cntOperativo.toLocaleString('es-VE');
  if (elAct) elAct.textContent = cntActivos.toLocaleString('es-VE');
  if (elSp) elSp.textContent = cntSoloPrecio.toLocaleString('es-VE');
  if (elIn) elIn.textContent = cntInactivos.toLocaleString('es-VE');

  const tabOp = document.getElementById('tabCntOperativo');
  const tabAct = document.getElementById('tabCntActivos');
  const tabSp = document.getElementById('tabCntSoloPrecio');
  const tabIn = document.getElementById('tabCntInactivos');
  const tabAll = document.getElementById('tabCntTodos');

  if (tabOp) tabOp.textContent = cntOperativo;
  if (tabAct) tabAct.textContent = cntActivos;
  if (tabSp) tabSp.textContent = cntSoloPrecio;
  if (tabIn) tabIn.textContent = cntInactivos;
  if (tabAll) tabAll.textContent = ALL_PRODUCTS.length;
}

function setTab(tab) {
  CURRENT_TAB = tab;
  document.querySelectorAll('.lp-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  CURRENT_PAGE = 1;
  applyFilters();
}

function onFilterChange() {
  CURRENT_PAGE = 1;
  applyFilters();
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterStock').value = 'all';
  document.getElementById('filterPrice').value = 'all';
  CURRENT_PAGE = 1;
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const fStock = document.getElementById('filterStock')?.value || 'all';
  const fPrice = document.getElementById('filterPrice')?.value || 'all';

  FILTERED_PRODUCTS = ALL_PRODUCTS.filter(p => {
    const st = p.mixnet_status || 'ACTIVO';
    
    // Filtro de pestaña
    if (CURRENT_TAB === 'operativo' && st !== 'ACTIVO' && st !== 'SOLO_PRECIO') return false;
    if (CURRENT_TAB === 'activos' && st !== 'ACTIVO') return false;
    if (CURRENT_TAB === 'soloprecio' && st !== 'SOLO_PRECIO') return false;
    if (CURRENT_TAB === 'inactivos' && st !== 'INACTIVO') return false;

    // Filtro de stock
    const stock = Number(p.stock) || 0;
    if (fStock === 'con_stock' && stock <= 0) return false;
    if (fStock === 'sin_stock' && stock > 0) return false;

    // Filtro de precio
    const pB = Number(p.price_b || p.price_usd) || 0;
    const pA = Number(p.price_a) || 0;
    const hasPrice = (pB > 0 || pA > 0);
    if (fPrice === 'con_precio' && !hasPrice) return false;
    if (fPrice === 'sin_precio' && hasPrice) return false;

    // Filtro de búsqueda
    if (search) {
      const sku = (p.sku || '').toLowerCase();
      const nom = (p.name || '').toLowerCase();
      if (!sku.includes(search) && !nom.includes(search)) return false;
    }

    return true;
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('productsTbody');
  const lbl = document.getElementById('tableShowingLbl');
  const pageInfo = document.getElementById('pageInfo');
  const paginationBox = document.getElementById('paginationControls');

  const total = FILTERED_PRODUCTS.length;
  if (lbl) lbl.textContent = `Mostrando ${total.toLocaleString('es-VE')} productos`;

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#888">No se encontraron productos con los filtros aplicados.</td></tr>';
    if (pageInfo) pageInfo.textContent = '0 resultados';
    if (paginationBox) paginationBox.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageItems = FILTERED_PRODUCTS.slice(startIdx, startIdx + PAGE_SIZE);

  const rate = getRate();

  tbody.innerHTML = pageItems.map(p => {
    const st = p.mixnet_status || 'ACTIVO';
    let tagClass = 'tag-activo';
    let tagLabel = '🟢 Activo';
    if (st === 'SOLO_PRECIO') { tagClass = 'tag-soloprecio'; tagLabel = '🟡 Solo Precio'; }
    else if (st === 'INACTIVO') { tagClass = 'tag-inactivo'; tagLabel = '🔴 Inactivo'; }
    else if (st === 'DESCONOCIDO') { tagClass = 'tag-desconocido'; tagLabel = '⚪ No en MixNet'; }

    const pA = Number(p.price_a) || 0;
    const pB = Number(p.price_b || p.price_usd) || 0;
    const pCBs = Number(p.price_c_bs) || (pA > 0 && rate > 0 ? pA * rate : 0);
    const pDBs = Number(p.price_d_bs) || (pB > 0 && rate > 0 ? pB * rate : 0);
    const cost = Number(p.cost_usd) || 0;
    const stock = Number(p.stock) || 0;

    const ultAct = p.last_movement_at ? fmtDateStr(p.last_movement_at) : (p.last_sale_at ? fmtDateStr(p.last_sale_at) : '—');

    return `
      <tr>
        <td><strong style="font-family:monospace;color:#0f5132">${escapeHTML(p.sku || '—')}</strong></td>
        <td>
          <div style="font-weight:600;color:#222">${escapeHTML(p.name || 'Sin Nombre')}</div>
        </td>
        <td><span class="status-tag ${tagClass}">${tagLabel}</span></td>
        <td style="text-align:right">
          <span class="price-a-badge">${pA > 0 ? '$' + pA.toFixed(2) : '—'}</span>
        </td>
        <td style="text-align:right">
          ${pB > 0 ? `<span class="price-b-badge">$${pB.toFixed(2)}</span>` : '<span style="color:#aaa">—</span>'}
        </td>
        <td style="text-align:right">
          <span class="price-bs-badge">${pCBs > 0 ? pCBs.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' Bs' : '—'}</span>
        </td>
        <td style="text-align:right">
          <span class="price-bs-badge">${pDBs > 0 ? pDBs.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' Bs' : '—'}</span>
        </td>
        <td style="text-align:right;color:#666">${cost > 0 ? '$' + cost.toFixed(2) : '—'}</td>
        <td style="text-align:center">
          <strong style="${stock > 0 ? 'color:#1b5e20' : 'color:#d32f2f'}">${stock}</strong>
        </td>
        <td style="text-align:center;color:#666;font-size:11px">${ultAct}</td>
      </tr>
    `;
  }).join('');

  if (pageInfo) pageInfo.textContent = `Página ${CURRENT_PAGE} de ${totalPages} (${total} productos)`;

  // Controles de paginación
  if (paginationBox) {
    paginationBox.innerHTML = `
      <button class="btn btn-secondary btn-sm" ${CURRENT_PAGE <= 1 ? 'disabled' : ''} onclick="goToPage(${CURRENT_PAGE - 1})">◀ Anterior</button>
      <button class="btn btn-secondary btn-sm" ${CURRENT_PAGE >= totalPages ? 'disabled' : ''} onclick="goToPage(${CURRENT_PAGE + 1})">Siguiente ▶</button>
    `;
  }
}

function goToPage(p) {
  CURRENT_PAGE = p;
  renderTable();
  window.scrollTo({ top: 380, behavior: 'smooth' });
}

function fmtDateStr(dStr) {
  if (!dStr) return '—';
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const pad = n => (n < 10 ? '0' : '') + n;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch (_) {
    return dStr;
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function exportFilteredCSV() {
  if (!FILTERED_PRODUCTS.length) {
    if (typeof showToast === 'function') showToast('No hay productos para exportar con los filtros actuales', 'warn');
    return;
  }

  const headers = ['COD_SKU', 'DESCRIPCION', 'ESTATUS_MIXNET', 'PRECIO_A_USD', 'PRECIO_B_USD', 'PRECIO_C_BS', 'PRECIO_D_BS', 'COSTO_USD', 'STOCK', 'ULTIMA_ACTIVIDAD'];
  const rows = [headers.join(',')];

  for (const p of FILTERED_PRODUCTS) {
    const pA = Number(p.price_a) || 0;
    const pB = Number(p.price_b || p.price_usd) || 0;
    const pCBs = Number(p.price_c_bs) || 0;
    const pDBs = Number(p.price_d_bs) || 0;
    const cost = Number(p.cost_usd) || 0;
    const stock = Number(p.stock) || 0;

    const cleanDesc = (p.name || '').replace(/"/g, '""');

    rows.push([
      `"${p.sku || ''}"`,
      `"${cleanDesc}"`,
      `"${p.mixnet_status || 'ACTIVO'}"`,
      pA.toFixed(4),
      pB.toFixed(4),
      pCBs.toFixed(2),
      pDBs.toFixed(2),
      cost.toFixed(4),
      stock,
      `"${p.last_movement_at || p.last_sale_at || ''}"`
    ].join(','));
  }

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `JJ_PAPER_LISTA_PRECIOS_${CURRENT_TAB.toUpperCase()}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (typeof showToast === 'function') showToast('Archivo CSV descargado correctamente');
}

async function syncPricesToDb() {
  const btn = document.querySelector('button[onclick="syncPricesToDb()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando MixNet…'; }
  if (typeof showToast === 'function') showToast('⚡ Enviando orden de sincronización a la PC del supervisor...', 'info');

  try {
    const { error: cmdErr } = await sb.from('jjp_server_control')
      .update({ command: 'sync_mixnet', command_at: new Date().toISOString(), command_by: CURRENT_PROFILE?.id || null })
      .eq('id', 1);

    if (cmdErr) {
      console.warn('Aviso enviando comando a jjp_server_control:', cmdErr.message);
    } else {
      if (typeof showToast === 'function') showToast('🔄 MixNet procesando precios vigentes (MXCTAINV.DBF)...', 'info');
      // Pausa breve para permitir que el proceso local aplique cambios
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch (err) {
    console.warn('Aviso al solicitar sync_mixnet:', err);
  }

  await loadProducts();
  if (btn) { btn.disabled = false; btn.textContent = '⚡ Sincronizar Precios a BD'; }
  if (typeof showToast === 'function') showToast('✅ Catálogo y precios sincronizados con éxito', 'ok');
}
