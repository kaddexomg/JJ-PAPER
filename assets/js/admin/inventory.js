/* ======================================================
   JJ Paper Admin — Inventario
   Vista plana de TODAS las variantes (producto · marca ·
   presentación) con edición rápida de stock, filtros y
   exportación CSV re-importable.
   ====================================================== */

let invRows     = [];
let invPage     = 1;
const INV_PER   = 50;
let invSearch   = '';
let invState    = '';   // '' | bajo | agotado | concontrol | sincontrol
let invBrandF   = '';

// ---- Carga (paginada — catálogos masivos superan el límite de 1000) ----

async function invFetchAll() {
  const out = [], CHUNK = 1000;
  const select = 'id,sku,barcode,variant_name,cost_usd,price_usd,margin_pct,stock,min_qty,active,brand_id,product_id,'
    + 'jjp_products(name,description,unit,emoji,tag,featured,active,image_url,min_qty,jjp_categories(slug,name)),'
    + 'jjp_brands(name)';
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb.from('jjp_product_variants')
      .select(select).order('created_at', { ascending: false })
      .range(from, from + CHUNK - 1);
    if (error) { showToast('Error cargando inventario', 'err'); console.error(error); break; }
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}

async function loadInventory() {
  const tbody = document.getElementById('invTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Cargando inventario...</td></tr>`;
  invRows = await invFetchAll();
  invPopulateBrandFilter();
  renderInventory();
}

function invPopulateBrandFilter() {
  const sel = document.getElementById('invBrandSel');
  if (!sel) return;
  const names = [...new Set(invRows.map(r => r.jjp_brands?.name).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todas las marcas</option>` +
    `<option value="__none__">Sin marca (genérica)</option>` +
    names.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
}

// ---- Filtro + resumen ----

function invLabel(r) {
  return [r.jjp_brands?.name, r.variant_name].filter(Boolean).join(' · ') || 'Genérica';
}

function invGetFiltered() {
  const q = normTxt(invSearch);
  return invRows.filter(r => {
    const stateOk =
      invState === ''            ? true :
      invState === 'agotado'     ? r.stock === 0 :
      invState === 'bajo'        ? (r.stock > 0 && r.stock <= 5) :
      invState === 'concontrol'  ? r.stock >= 0 :
      /* sincontrol */             r.stock < 0;
    const brandOk =
      invBrandF === ''         ? true :
      invBrandF === '__none__' ? !r.jjp_brands?.name :
      r.jjp_brands?.name === invBrandF;
    const qOk = !q
      || normTxt(r.jjp_products?.name).includes(q)
      || normTxt(r.jjp_brands?.name).includes(q)
      || normTxt(r.variant_name).includes(q)
      || normTxt(r.sku).includes(q)
      || normTxt(r.barcode).includes(q);
    return stateOk && brandOk && qOk;
  });
}

function invRenderStats() {
  const tot   = invRows.length;
  const ctrl  = invRows.filter(r => r.stock >= 0).length;
  const bajo  = invRows.filter(r => r.stock > 0 && r.stock <= 5).length;
  const agot  = invRows.filter(r => r.stock === 0).length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('inv-tot', tot); set('inv-ctrl', ctrl); set('inv-low', bajo); set('inv-out', agot);
}

// ---- Render tabla ----

function renderInventory() {
  invRenderStats();
  const tbody = document.getElementById('invTableBody');
  if (!tbody) return;

  const list  = invGetFiltered();
  const pages = Math.ceil(list.length / INV_PER) || 1;
  if (invPage > pages) invPage = pages;
  const page  = list.slice((invPage - 1) * INV_PER, invPage * INV_PER);

  const count = document.getElementById('invCount');
  if (count) count.textContent = `${list.length} variante${list.length !== 1 ? 's' : ''}`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Sin resultados</td></tr>`;
    renderInvPag(0);
    return;
  }

  tbody.innerHTML = page.map(r => {
    const p   = r.jjp_products || {};
    const img = p.image_url
      ? `<div class="td-img"><img src="${optImg(p.image_url, 120)}" alt="" loading="lazy" decoding="async"></div>`
      : `<div class="td-img">${p.emoji || '📦'}</div>`;
    const badge = r.stock < 0
      ? `<span class="badge badge-blue" title="Sin control de stock">∞</span>`
      : r.stock === 0
      ? `<span class="badge badge-red">Agotado</span>`
      : r.stock <= 5
      ? `<span class="badge badge-yellow">Bajo (${r.stock})</span>`
      : `<span class="badge badge-green">OK</span>`;

    const stockCtrl = r.stock < 0
      ? `<button class="btn-ghost sm" onclick="invToggleInf('${r.id}')" title="Activar control de stock">Activar control</button>`
      : `<div class="inv-stock-ctrl">
           <button class="qb" onclick="invAdjust('${r.id}',-1)">−</button>
           <input type="number" class="fi inv-stock-in" min="0" value="${r.stock}"
             onchange="invSetStock('${r.id}', this.value)">
           <button class="qb" onclick="invAdjust('${r.id}',1)">+</button>
           <button class="btn-ghost sm" onclick="invToggleInf('${r.id}')" title="Quitar control (∞)">∞</button>
         </div>`;

    return `<tr>
      <td>${img}</td>
      <td>
        <div class="td-name">${escapeHTML(p.name || '—')}</div>
        <div class="td-sub">${escapeHTML(p.jjp_categories?.name || '')}${!p.active || r.active === false ? ' · <span style="color:var(--danger)">inactivo</span>' : ''}</div>
      </td>
      <td class="td-brand">${escapeHTML(invLabel(r))}</td>
      <td style="font-size:12px">${escapeHTML(r.sku || '—')}</td>
      <td><strong>$${parseFloat(r.price_usd).toFixed(2)}</strong></td>
      <td style="text-align:center">${badge}</td>
      <td>${stockCtrl}</td>
      <td><button class="btn-p sm" title="Editar producto completo"
        onclick="location.href='productos.html'">✏️</button></td>
    </tr>`;
  }).join('');

  renderInvPag(pages);
}

function renderInvPag(pages) {
  const el = document.getElementById('invPag');
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  if (invPage > 1) html += `<button class="pg arrow" onclick="invGoPage(${invPage - 1})">‹</button>`;
  const win = 2;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - invPage) <= win)
      html += `<button class="pg${i === invPage ? ' on' : ''}" onclick="invGoPage(${i})">${i}</button>`;
    else if (i === invPage - win - 1 || i === invPage + win + 1)
      html += `<span style="color:var(--gr)">…</span>`;
  }
  if (invPage < pages) html += `<button class="pg arrow" onclick="invGoPage(${invPage + 1})">›</button>`;
  el.innerHTML = html;
}

function invGoPage(p) { invPage = p; renderInventory(); }

// ---- Filtros UI ----

let invTimer;
function invOnSearch(v) {
  clearTimeout(invTimer);
  invTimer = setTimeout(() => { invSearch = v; invPage = 1; renderInventory(); }, 250);
}
function invOnState(v)  { invState = v;  invPage = 1; renderInventory(); }
function invOnBrand(v)  { invBrandF = v; invPage = 1; renderInventory(); }

// ---- Edición de stock ----

async function invUpdateStock(id, newStock, reason = 'ajuste manual') {
  const row = invRows.find(r => r.id === id);
  if (!row) return;
  const prev = row.stock;
  row.stock = newStock;                       // optimista
  renderInventory();
  // RPC con razón → queda registrado en el kardex (jjp_stock_moves)
  let { error } = await sb.rpc('jjp_set_stock', { p_variant_id: id, p_stock: newStock, p_reason: reason });
  if (error) {
    // Fallback si el RPC no existe aún en esta base
    ({ error } = await sb.from('jjp_product_variants').update({ stock: newStock }).eq('id', id));
  }
  if (error) {
    row.stock = prev;
    renderInventory();
    showToast('Error guardando stock: ' + error.message, 'err');
  }
}

function invSetStock(id, value) {
  const n = parseInt(value);
  if (isNaN(n) || n < 0) { showToast('Stock inválido', 'warn'); renderInventory(); return; }
  invUpdateStock(id, n);
}

function invAdjust(id, delta) {
  const row = invRows.find(r => r.id === id);
  if (!row || row.stock < 0) return;
  invUpdateStock(id, Math.max(0, row.stock + delta));
}

// Alterna entre "sin control (∞)" y stock contado (arranca en 0)
function invToggleInf(id) {
  const row = invRows.find(r => r.id === id);
  if (!row) return;
  invUpdateStock(id, row.stock < 0 ? 0 : -1);
}

// ---- Kardex (jjp_stock_moves): historial de movimientos ----

let movRows = [], movSearch = '', movReason = '';

async function loadMoves() {
  const { data, error } = await sb.from('jjp_stock_moves')
    .select('*').order('created_at', { ascending: false }).limit(300);
  const tbody = document.getElementById('movTableBody');
  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Kardex no disponible (aplica la migración SQL).</td></tr>`;
    return;
  }
  movRows = data || [];
  renderMoves();
}

function movOnSearch(v) { movSearch = v; renderMoves(); }
function movOnReason(v) { movReason = v; renderMoves(); }

function movGetFiltered() {
  const q = normTxt(movSearch);
  return movRows.filter(m => {
    const rOk = !movReason || normTxt(m.reason).includes(movReason);
    const qOk = !q
      || normTxt(m.product_name).includes(q)
      || normTxt(m.brand_name).includes(q)
      || normTxt(m.variant_name).includes(q)
      || normTxt(m.sku).includes(q)
      || normTxt(m.ref).includes(q);
    return rOk && qOk;
  });
}

function movReasonBadge(reason) {
  const r = normTxt(reason);
  const cls = r.includes('venta') ? 'badge-green'
    : r.includes('reverso')       ? 'badge-yellow'
    : r.includes('conteo')        ? 'badge-blue'
    : 'badge-gray';
  return `<span class="badge ${cls}">${escapeHTML(reason || '—')}</span>`;
}

function renderMoves() {
  const tbody = document.getElementById('movTableBody');
  if (!tbody) return;
  const list = movGetFiltered().slice(0, 150);
  const count = document.getElementById('movCount');
  if (count) count.textContent = `${list.length} movimiento${list.length !== 1 ? 's' : ''}`;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Sin movimientos registrados todavía. Cada venta, conteo o ajuste quedará aquí.</td></tr>`;
    return;
  }
  const stockTxt = s => (s === null || s === undefined) ? '—' : (s < 0 ? '∞' : s);
  tbody.innerHTML = list.map(m => {
    const d = new Date(m.created_at);
    const fecha = d.toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit' }) + ' ' +
      d.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });
    const delta = m.delta > 0 ? `<strong style="color:var(--gd)">+${m.delta}</strong>`
      : m.delta < 0 ? `<strong style="color:var(--danger)">${m.delta}</strong>` : '·';
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${fecha}</td>
      <td><div class="td-name">${escapeHTML(m.product_name || '—')}</div>
        <div class="td-sub">SKU ${escapeHTML(m.sku || '—')}</div></td>
      <td class="td-brand">${escapeHTML([m.brand_name, m.variant_name].filter(Boolean).join(' · ') || 'Genérica')}</td>
      <td style="text-align:center">${delta}</td>
      <td style="text-align:center;font-size:13px">${stockTxt(m.stock_before)} → <strong>${stockTxt(m.stock_after)}</strong></td>
      <td>${movReasonBadge(m.reason)}</td>
      <td style="font-size:12px">${escapeHTML(m.ref || '—')}</td>
    </tr>`;
  }).join('');
}

// ---- Export CSV (compatible con la importación de Productos) ----

function invExportCSV() {
  const list = invGetFiltered();
  if (!list.length) { showToast('No hay filas para exportar', 'warn'); return; }
  const esc = s => {
    s = String(s ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = 'name,brand,variant,category_slug,sku,description,price_usd,cost_usd,margin_pct,unit_abbr,emoji,tag,featured,active,stock,min_qty';
  const lines = list.map(r => {
    const p = r.jjp_products || {};
    return [
      esc(p.name), esc(r.jjp_brands?.name || ''), esc(r.variant_name || ''),
      esc(p.jjp_categories?.slug || ''), esc(r.sku || ''), esc(p.description || ''),
      r.price_usd, r.cost_usd ?? '', r.margin_pct ?? '',
      esc(p.unit || ''), esc(p.emoji || ''), esc(p.tag || ''),
      p.featured ? 'true' : 'false', (r.active !== false && p.active !== false) ? 'true' : 'false',
      r.stock, r.min_qty ?? 1,
    ].join(',');
  });
  const blob = new Blob(['﻿' + headers + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const d    = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `jjpaper_inventario_${d}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`${list.length} variantes exportadas — edita el CSV y re-impórtalo en Productos`);
}
