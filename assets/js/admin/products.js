/* ======================================================
   JJ Paper Admin — Products v3
   Variantes por marca (precio/costo/stock por marca) ·
   Bulk actions · CSV import masivo con upsert
   ====================================================== */

let adminProducts   = [];
let adminCategories = [];
let adminBrands     = [];
let adminUnitsDB    = [];
let editingId       = null;
let adminPage       = 1;
const ADMIN_PER     = 20;
let selectedIds     = new Set();
let adminPhotoFilter = 'all'; // 'all' | 'missing' | 'with'

function getFilteredAdminProducts() {
  if (adminPhotoFilter === 'missing') return adminProducts.filter(p => !p.image_url);
  if (adminPhotoFilter === 'with')    return adminProducts.filter(p => !!p.image_url);
  return adminProducts;
}

function setProdPhotoFilter(val) {
  adminPhotoFilter = val || 'all';
  adminPage = 1;
  renderAdminProdTable();
}

// Variantes del producto en edición: [{id?, brand_id, sku, cost_usd, price_usd, margin_pct, stock, active}]
let formVariants        = [];
let removedVariantIds   = [];

const VARIANTS_ADMIN_SELECT =
  'jjp_product_variants(id,brand_id,variant_name,sku,barcode,cost_usd,price_usd,margin_pct,stock,min_qty,active,sort_order,jjp_brands(name))';

// ---- Reference data loaders ----

async function loadAdminCategories() {
  const { data } = await sb.from('jjp_categories').select('id,name,slug').order('sort_order');
  adminCategories = data || [];
  populateSelect('prodCatSel',  adminCategories, 'id', 'name', '-- Categoria --');
  populateSelect('bulkCatSel',  adminCategories, 'id', 'name', '-- Categoria --');
}

async function loadAdminBrands() {
  const { data } = await sb.from('jjp_brands').select('id,name,slug,logo_url').eq('active', true).order('sort_order');
  adminBrands = data || [];
  populateSelect('bulkBrandSel', adminBrands, 'id', 'name', '-- Marca --');
}

async function loadAdminUnits() {
  const { data } = await sb.from('jjp_units').select('id,name,abbr').order('sort_order');
  adminUnitsDB = data || [];
  const withLabel = adminUnitsDB.map(u => ({ ...u, label: `${u.name} (${u.abbr})` }));
  populateSelect('prodUnitSel', withLabel, 'id', 'label', '-- Unidad --');
}

function populateSelect(id, items, valKey, labelKey, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i[valKey]}">${i[labelKey]}</option>`).join('');
}

// Trae todas las filas paginando (PostgREST limita a ~1000 por request)
async function fetchAllRows(table, select, applyFilters) {
  const out = [], CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    let q = sb.from(table).select(select).range(from, from + CHUNK - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    if (error) { console.error(error); break; }
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}

// ---- Load products ----

async function loadAdminProducts(search = '') {
  const rows = await fetchAllRows('jjp_products',
    `id,name,description,price_usd,unit,unit_id,emoji,image_url,tag,active,featured,essential,stock,min_qty,category_id,jjp_categories(name),${VARIANTS_ADMIN_SELECT}`,
    q => {
      q = q.order('created_at', { ascending: false });
      if (search && search.trim()) {
        const words = search.trim().split(/[\s,()\*\/+\-]+/).filter(w => w.length > 0);
        for (const w of words) {
          q = q.ilike('name', `%${w}%`);
        }
      }
      return q;
    });
  adminProducts = rows.map(p => {
    p.variants = (p.jjp_product_variants || [])
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
        || String(a.jjp_brands?.name || '').localeCompare(String(b.jjp_brands?.name || '')));
    return p;
  });
  selectedIds.clear();
  updateBulkToolbar();
  renderAdminProdTable();
}

// ---- Render table ----

function variantSummary(p) {
  const vs = p.variants || [];
  if (!vs.length) return { brands: '<span style="color:#ccc">—</span>', price: `$${parseFloat(p.price_usd).toFixed(2)}`, stock: p.stock === -1 ? '∞' : (p.stock ?? 0) };

  const names = vs.map(v =>
    [v.jjp_brands?.name, v.variant_name].filter(Boolean).join(' · ') || 'Genérica');
  const brands = names.length === 1
    ? names[0]
    : `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` <span class="badge badge-blue">+${names.length - 2}</span>` : ''}`;

  const active = vs.filter(v => v.active !== false);
  const prices = (active.length ? active : vs).map(v => +v.price_usd);
  const min = Math.min(...prices), max = Math.max(...prices);
  const price = min === max
    ? `$${min.toFixed(2)}`
    : `$${min.toFixed(2)}–$${max.toFixed(2)}`;

  const stock = active.some(v => v.stock == null || v.stock < 0)
    ? '<span title="Sin control">∞</span>'
    : active.reduce((s, v) => s + v.stock, 0);

  return { brands, price, stock, count: vs.length };
}

function renderAdminProdTable() {
  const tbody = document.getElementById('prodTableBody');
  if (!tbody) return;

  const list   = getFilteredAdminProducts();
  const start  = (adminPage - 1) * ADMIN_PER;
  const page   = list.slice(start, start + ADMIN_PER);
  const count  = document.getElementById('prodTableCount');
  const withPhotoCount = adminProducts.filter(p => !!p.image_url).length;
  const noPhotoCount   = adminProducts.length - withPhotoCount;
  if (count) {
    count.textContent = `${list.length} mostrados (${withPhotoCount} con foto · ${noPhotoCount} sin foto)`;
  }

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No hay productos para este filtro</td></tr>`;
    renderAdminProdPag();
    return;
  }

  const allSel = page.every(p => selectedIds.has(p.id));
  const chkAll = document.getElementById('chkAll');
  if (chkAll) chkAll.checked = allSel && page.length > 0;

  tbody.innerHTML = page.map(p => {
    const esc  = (p.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const fallbackEmoji = escapeHTML(p.emoji || '📦');
    const img = p.image_url
      ? `<div class="td-img" style="cursor:pointer" title="Clic para cambiar fotografía" onclick="prodGenerarFotoIA('${p.id}','${esc}')"><img src="${optImg(p.image_url, 120)}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='${fallbackEmoji}'"></div>`
      : `<div class="td-img" style="cursor:pointer;border:1px dashed #cbd5e1" title="Sin foto — Clic para buscar o subir foto" onclick="prodGenerarFotoIA('${p.id}','${esc}')">${p.emoji || '📦'}</div>`;

    const vsum = variantSummary(p);
    const skus = (p.variants || []).map(v => v.sku).filter(Boolean);

    return `<tr class="${selectedIds.has(p.id) ? 'row-sel' : ''}">
      <td class="td-chk"><input type="checkbox" class="row-chk" ${selectedIds.has(p.id) ? 'checked' : ''}
        onchange="toggleRowSel('${p.id}',this.checked)"></td>
      <td>${img}</td>
      <td>
        <div class="td-name">${p.name}</div>
        <div class="td-sub">${skus.length ? `SKU: ${skus.slice(0,2).join(', ')}${skus.length>2?'…':''} · ` : ''}${p.jjp_categories?.name || ''}</div>
      </td>
      <td class="td-brand">${vsum.brands}${vsum.count > 1 ? `<div class="td-sub">${vsum.count} variantes</div>` : ''}</td>
      <td><strong>${vsum.price}</strong></td>
      <td style="font-size:12px">${p.unit}</td>
      <td style="text-align:center;font-size:13px">${vsum.stock}</td>
      <td>
        <span class="badge ${p.active ? 'badge-green' : 'badge-red'}">${p.active ? 'Activo' : 'Inactivo'}</span>
        ${p.featured ? '<span class="badge badge-yellow" style="margin-left:4px" title="Destacado en inicio">⭐</span>' : ''}
        ${p.essential ? '<span class="badge badge-green" style="margin-left:4px" title="Esencial — primera página del catálogo">🔝</span>' : ''}
        ${p.tag ? `<span class="badge badge-blue" style="margin-top:3px;display:block">${p.tag}</span>` : ''}
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-s sm" style="background:${p.image_url ? '#334155' : '#065f46'};color:#fff;border-radius:4px;padding:3px 7px;font-size:11px;font-weight:700" onclick="prodGenerarFotoIA('${p.id}','${esc}')" title="${p.image_url ? 'Cambiar o mejorar foto del producto' : 'Buscar/generar foto con IA o subir'}">${p.image_url ? '📸 Foto' : '📸 +IA'}</button>
          <button class="btn-p sm" onclick="openEditProduct('${p.id}')">✏️</button>
          <button class="btn-send sm" onclick="fichaAbrir(event,'${p.id}')"
                  title="Enviar foto + reseña + enlace de compra al cliente">📤</button>
          <button class="btn-danger sm" onclick="deleteProduct('${p.id}','${esc}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderAdminProdPag();
}

function renderAdminProdPag() {
  const el    = document.getElementById('prodTablePag');
  const total = getFilteredAdminProducts().length;
  const pages = Math.ceil(total / ADMIN_PER);
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  if (adminPage > 1)       html += `<button class="pg arrow" onclick="adminProdGoPage(${adminPage-1})">‹</button>`;
  // Con catálogos masivos no listamos todas las páginas: ventana alrededor de la actual
  const win = 2;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - adminPage) <= win) {
      html += `<button class="pg${i === adminPage ? ' on' : ''}" onclick="adminProdGoPage(${i})">${i}</button>`;
    } else if (i === adminPage - win - 1 || i === adminPage + win + 1) {
      html += `<span style="color:var(--gr)">…</span>`;
    }
  }
  if (adminPage < pages)   html += `<button class="pg arrow" onclick="adminProdGoPage(${adminPage+1})">›</button>`;
  el.innerHTML = html;
}

function adminProdGoPage(p) { adminPage = p; renderAdminProdTable(); }

// ---- Selection ----

function toggleAllSel(checked) {
  const start = (adminPage - 1) * ADMIN_PER;
  adminProducts.slice(start, start + ADMIN_PER).forEach(p =>
    checked ? selectedIds.add(p.id) : selectedIds.delete(p.id)
  );
  renderAdminProdTable();
  updateBulkToolbar();
}

function toggleRowSel(id, checked) {
  checked ? selectedIds.add(id) : selectedIds.delete(id);
  updateBulkToolbar();
  const row = document.querySelector(`input[onchange*="${id}"]`)?.closest('tr');
  if (row) row.classList.toggle('row-sel', checked);
}

function updateBulkToolbar() {
  const bar   = document.getElementById('bulkToolbar');
  const count = document.getElementById('bulkCount');
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.classList.add('sh');
    if (count) count.textContent = `${selectedIds.size} seleccionado${selectedIds.size !== 1 ? 's' : ''}`;
  } else {
    bar.classList.remove('sh');
  }
}

// ---- Bulk actions ----

async function bulkActivate()   { await bulkUpdate({ active: true  }, 'Productos activados'); }
async function bulkDeactivate() { await bulkUpdate({ active: false }, 'Productos desactivados'); }
async function bulkFeatured()   { await bulkUpdate({ featured: true  }, 'Marcados como destacados'); }
async function bulkUnfeatured() { await bulkUpdate({ featured: false }, 'Quitados de destacados'); }
async function bulkEssential()  { await bulkUpdate({ essential: true  }, 'Marcados como esenciales'); }
async function bulkUnessential(){ await bulkUpdate({ essential: false }, 'Quitados de esenciales'); }

async function bulkChangeCategory() {
  const id = document.getElementById('bulkCatSel')?.value;
  if (!id) { showToast('Selecciona una categoria', 'warn'); return; }
  await bulkUpdate({ category_id: id }, 'Categoria actualizada');
}

// Asigna la marca a la variante única de cada producto seleccionado.
// Productos con varias marcas se saltan (se editan individualmente).
async function bulkChangeBrand() {
  const id = document.getElementById('bulkBrandSel')?.value;
  if (!id) { showToast('Selecciona una marca', 'warn'); return; }

  const prods  = adminProducts.filter(p => selectedIds.has(p.id));
  const single = prods.filter(p => (p.variants?.length || 0) <= 1);
  const multi  = prods.length - single.length;
  if (!single.length) { showToast('Los seleccionados tienen varias marcas; edítalos uno a uno', 'warn'); return; }

  let errors = 0;
  await Promise.all(single.map(async p => {
    const v = p.variants?.[0];
    const { error } = v
      ? await sb.from('jjp_product_variants').update({ brand_id: id }).eq('id', v.id)
      : await sb.from('jjp_product_variants').insert({ product_id: p.id, brand_id: id, price_usd: p.price_usd, stock: p.stock ?? -1 });
    if (error) errors++;
  }));

  showToast(errors ? `${errors} errores al asignar marca` :
    `Marca asignada a ${single.length} producto(s)${multi ? ` · ${multi} con varias marcas omitidos` : ''}`);
  selectedIds.clear();
  await loadAdminProducts();
}

// Ajuste % de precio: aplica sobre TODAS las variantes de los seleccionados
async function bulkAdjustPrice() {
  const pct = parseFloat(document.getElementById('bulkPricePct')?.value);
  if (isNaN(pct) || pct === 0) { showToast('Ingresa un porcentaje valido', 'warn'); return; }
  const variants = adminProducts.filter(p => selectedIds.has(p.id))
    .flatMap(p => p.variants || []);
  if (!variants.length) { showToast('Los seleccionados no tienen variantes', 'warn'); return; }
  const sign = pct > 0 ? '+' : '';
  if (!confirm(`¿Ajustar precio un ${sign}${pct}% a ${variants.length} variante(s) de ${selectedIds.size} producto(s)?`)) return;

  let errors = 0;
  await Promise.all(variants.map(async v => {
    const newPrice = Math.max(0.01, parseFloat((v.price_usd * (1 + pct / 100)).toFixed(2)));
    const { error } = await sb.from('jjp_product_variants').update({ price_usd: newPrice }).eq('id', v.id);
    if (error) errors++;
  }));

  if (errors) showToast(`${errors} errores al actualizar`, 'warn');
  else showToast(`Precios ajustados ${sign}${pct}%`);
  selectedIds.clear();
  await loadAdminProducts();
}

async function bulkDelete() {
  if (!confirm(`¿Eliminar ${selectedIds.size} productos (con todas sus marcas/variantes)? Esta accion es IRREVERSIBLE.`)) return;
  const { error } = await sb.from('jjp_products').delete().in('id', [...selectedIds]);
  if (error) { showToast('Error eliminando: ' + error.message, 'err'); return; }
  showToast(`${selectedIds.size} productos eliminados`);
  selectedIds.clear();
  await loadAdminProducts();
}

async function bulkUpdate(payload, msg = 'Actualizado') {
  const { error } = await sb.from('jjp_products').update(payload).in('id', [...selectedIds]);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(msg);
  selectedIds.clear();
  await loadAdminProducts();
}

// ============================================================
// Form (producto padre + editor de variantes por marca)
// ============================================================

function openNewProduct() {
  editingId = null;
  resetProdForm();
  formVariants = [{ brand_id: '', variant_name: '', sku: '', cost_usd: '', price_usd: '', margin_pct: '', stock: '', active: true }];
  removedVariantIds = [];
  renderVariantRows();
  document.getElementById('prodFormTitle').textContent = 'Nuevo Producto';
  document.getElementById('prodFormPanel').style.display = 'block';
  document.getElementById('prodFormPanel').scrollIntoView({ behavior: 'smooth' });
}

function openEditProduct(id) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('prodFormTitle').textContent = 'Editar Producto';
  document.getElementById('f-prod-name').value     = p.name;
  document.getElementById('f-prod-desc').value     = p.description || '';
  document.getElementById('f-prod-unit').value     = p.unit;
  document.getElementById('f-prod-emoji').value    = p.emoji      || '';
  document.getElementById('f-prod-tag').value      = p.tag        || '';
  document.getElementById('f-prod-minqty').value   = p.min_qty    || 1;
  document.getElementById('f-prod-active').checked    = p.active;
  document.getElementById('f-prod-featured').checked  = p.featured;
  document.getElementById('f-prod-essential').checked = !!p.essential;
  document.getElementById('prodCatSel').value      = p.category_id || '';
  document.getElementById('prodUnitSel').value     = p.unit_id    || '';

  formVariants = (p.variants || []).map(v => ({
    id: v.id, brand_id: v.brand_id || '', variant_name: v.variant_name || '', sku: v.sku || '',
    cost_usd: v.cost_usd ?? '', price_usd: v.price_usd,
    margin_pct: v.margin_pct ?? '', stock: (v.stock === -1 || v.stock == null) ? '' : v.stock,
    active: v.active !== false,
  }));
  if (!formVariants.length)
    formVariants = [{ brand_id: '', variant_name: '', sku: '', cost_usd: '', price_usd: p.price_usd, margin_pct: '', stock: '', active: true }];
  removedVariantIds = [];
  renderVariantRows();

  const preview    = document.getElementById('imgPreview');
  const previewImg = document.getElementById('imgPreviewEl');
  if (p.image_url && preview && previewImg) {
    previewImg.src = p.image_url;
    preview.classList.add('sh');
  } else if (preview) {
    preview.classList.remove('sh');
  }

  document.getElementById('prodFormPanel').style.display = 'block';
  document.getElementById('prodFormPanel').scrollIntoView({ behavior: 'smooth' });
}

// ---- Variants editor ----

function renderVariantRows() {
  const box = document.getElementById('variantRows');
  if (!box) return;

  const brandOpts = bid =>
    `<option value="">— Genérica (sin marca) —</option>` +
    adminBrands.map(b => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${b.name}</option>`).join('');

  box.innerHTML = formVariants.map((v, i) => `
    <div class="variant-row" data-i="${i}">
      <div class="v-brand-wrap">
        <img class="v-brand-logo" alt="" src="${brandLogo(v.brand_id)}"${brandLogo(v.brand_id) ? '' : ' style="display:none"'}>
        <select class="sort-sel v-brand${brandLogo(v.brand_id) ? ' has-logo' : ''}" onchange="formVariants[${i}].brand_id=this.value;updateVariantLogo(${i},this.value)">${brandOpts(v.brand_id)}</select>
      </div>
      <input type="text"   class="fi v-name"   placeholder="Presentación (color, tamaño...)" value="${(v.variant_name || '').replace(/"/g,'&quot;')}" oninput="formVariants[${i}].variant_name=this.value">
      <input type="text"   class="fi v-sku"    placeholder="SKU"      value="${(v.sku || '').replace(/"/g,'&quot;')}" oninput="formVariants[${i}].sku=this.value">
      <input type="number" class="fi v-cost"   placeholder="Costo $"  step="0.01" min="0" value="${v.cost_usd}" oninput="formVariants[${i}].cost_usd=this.value">
      <input type="number" class="fi v-price"  placeholder="Precio $ *" step="0.01" min="0" value="${v.price_usd}" oninput="formVariants[${i}].price_usd=this.value">
      <input type="number" class="fi v-margin" placeholder="Mg %"     step="0.5" value="${v.margin_pct}" oninput="formVariants[${i}].margin_pct=this.value" title="Margen % (vacío = global)">
      <button type="button" class="btn-ghost sm v-suggest" title="Calcular precio sugerido desde costo + margen + tasas" onclick="suggestVariantPrice(${i})">💡</button>
      <input type="number" class="fi v-stock"  placeholder="Stock ∞"  min="0" value="${v.stock}" oninput="formVariants[${i}].stock=this.value" title="Vacío = sin control (∞)">
      <label class="check-label v-active" title="Visible en catálogo"><input type="checkbox" ${v.active ? 'checked' : ''} onchange="formVariants[${i}].active=this.checked"> ✓</label>
      <button type="button" class="btn-danger sm" title="Quitar" onclick="removeVariantRow(${i})">✕</button>
    </div>`).join('');
}

// Logo de una marca por id (para la vista previa en el editor)
function brandLogo(bid) {
  return (adminBrands.find(b => b.id === bid) || {}).logo_url || '';
}

// Actualiza el logo mostrado al cambiar la marca de una variante
function updateVariantLogo(i, bid) {
  const wrap = document.querySelector(`.variant-row[data-i="${i}"]`);
  if (!wrap) return;
  const img = wrap.querySelector('.v-brand-logo');
  const sel = wrap.querySelector('.v-brand');
  const url = brandLogo(bid);
  if (url) { img.src = url; img.style.display = ''; sel.classList.add('has-logo'); }
  else     { img.style.display = 'none'; sel.classList.remove('has-logo'); }
}

function addVariantRow() {
  formVariants.push({ brand_id: '', variant_name: '', sku: '', cost_usd: '', price_usd: '', margin_pct: '', stock: '', active: true });
  renderVariantRows();
}

function removeVariantRow(i) {
  const v = formVariants[i];
  if (formVariants.length === 1) { showToast('El producto necesita al menos una variante', 'warn'); return; }
  if (v.id) {
    if (!confirm('¿Eliminar esta variante guardada? Se borra su stock/precio de esa marca.')) return;
    removedVariantIds.push(v.id);
  }
  formVariants.splice(i, 1);
  renderVariantRows();
}

// Precio sugerido por variante: costo × (Binance/BCV) × (1 + margen)
function suggestVariantPrice(i) {
  const v = formVariants[i];
  const cost = parseFloat(v.cost_usd);
  if (isNaN(cost) || cost <= 0) { showToast('Ingresa el costo de esa variante primero', 'warn'); return; }
  v.price_usd = suggestedPriceUSD(cost, v.margin_pct).toFixed(2);
  renderVariantRows();
  showToast(`Precio sugerido: $${v.price_usd} (brecha ${getGapPct().toFixed(1)}% + margen)`);
}

function resetProdForm() {
  document.getElementById('prodForm')?.reset();
  document.getElementById('imgPreview')?.classList.remove('sh');
  formVariants = [];
  removedVariantIds = [];
}

function cancelProdForm() {
  document.getElementById('prodFormPanel').style.display = 'none';
  editingId = null;
  resetProdForm();
}

async function saveProd() {
  const name = document.getElementById('f-prod-name')?.value.trim();
  if (!name) { showToast('Nombre requerido', 'warn'); return; }

  // Validar variantes
  const seen = new Set();
  for (const v of formVariants) {
    const price = parseFloat(v.price_usd);
    if (isNaN(price) || price < 0) { showToast('Cada variante necesita un precio válido', 'warn'); return; }
    const key = (v.brand_id || 'generic') + '|' + (v.variant_name || '').trim().toLowerCase();
    if (seen.has(key)) { showToast('Hay dos variantes con la misma marca y presentación', 'warn'); return; }
    seen.add(key);
  }

  // Unit text: prefer from select, fallback to text input
  const unitSelId  = document.getElementById('prodUnitSel')?.value;
  const unitObj    = adminUnitsDB.find(u => u.id === unitSelId);
  const unitText   = unitObj?.abbr || document.getElementById('f-prod-unit')?.value.trim() || 'unid';
  const minQty     = parseInt(document.getElementById('f-prod-minqty')?.value) || 1;

  const payload = {
    name,
    description: document.getElementById('f-prod-desc')?.value.trim()  || null,
    // price_usd/stock son resumen: el trigger de variantes los recalcula
    price_usd:   parseFloat(formVariants[0].price_usd),
    unit:        unitText,
    unit_id:     unitSelId || null,
    emoji:       document.getElementById('f-prod-emoji')?.value.trim() || '📦',
    tag:         document.getElementById('f-prod-tag')?.value.trim()   || null,
    min_qty:     minQty,
    category_id: document.getElementById('prodCatSel')?.value  || null,
    active:      document.getElementById('f-prod-active')?.checked  ?? true,
    featured:    document.getElementById('f-prod-featured')?.checked ?? false,
    essential:   document.getElementById('f-prod-essential')?.checked ?? false,
  };

  // Upload image (comprimida client-side a WebP cuadrado 520x520 fondo blanco estudio)
  const file = document.getElementById('f-prod-img')?.files?.[0];
  if (file) {
    try {
      payload.image_url = await convertImageToStudioWebpDataUri(file, 520);
    } catch (upErr) {
      showToast('Error al procesar imagen: ' + upErr.message, 'err');
    }
  }

  // 1) Guardar producto
  let productId = editingId, error;
  if (editingId) {
    ({ error } = await sb.from('jjp_products').update(payload).eq('id', editingId));
  } else {
    const res = await sb.from('jjp_products').insert(payload).select('id').single();
    error = res.error;
    productId = res.data?.id;
  }
  if (error || !productId) { showToast('Error: ' + (error?.message || 'sin id'), 'err'); return; }

  // Sincronizar imagen con variantes si se subió nueva foto
  if (payload.image_url && editingId) {
    try {
      await sb.from('jjp_product_variants').update({ image_url: payload.image_url }).eq('product_id', productId);
    } catch (_) {}
  }

  // 2) Guardar variantes (insert/update/delete)
  const vErrors = [];
  for (const v of formVariants) {
    const row = {
      product_id: productId,
      brand_id:   v.brand_id || null,
      variant_name: (v.variant_name || '').trim() || null,
      sku:        v.sku.trim() || null,
      cost_usd:   v.cost_usd !== '' ? parseFloat(v.cost_usd) : null,
      price_usd:  parseFloat(v.price_usd),
      margin_pct: v.margin_pct !== '' ? parseFloat(v.margin_pct) : null,
      stock:      v.stock !== '' ? parseInt(v.stock) : -1,
      min_qty:    minQty,
      active:     v.active !== false,
    };
    const { error: e } = v.id
      ? await sb.from('jjp_product_variants').update(row).eq('id', v.id)
      : await sb.from('jjp_product_variants').insert(row);
    if (e) vErrors.push(e.message);
  }
  if (removedVariantIds.length) {
    const { error: e } = await sb.from('jjp_product_variants').delete().in('id', removedVariantIds);
    if (e) vErrors.push(e.message);
  }

  if (vErrors.length) { showToast('Producto guardado, pero variantes con error: ' + vErrors[0], 'warn'); }
  else showToast(editingId ? '✅ Producto actualizado' : '✅ Producto creado');
  cancelProdForm();
  await loadAdminProducts();
}

async function deleteProduct(id, name) {
  if (!confirm(`¿Eliminar "${name}" con todas sus marcas/variantes?`)) return;
  const { error } = await sb.from('jjp_products').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Producto eliminado');
  await loadAdminProducts();
}

// ---- Image compression (client-side, antes de subir a Storage) ----
// Redimensiona a máx 1400px por lado y comprime a webp (fallback jpeg).
// Un JPG de cámara de varios MB queda en ~150-300KB sin pérdida visible.
async function compressImage(file, maxSide = 1400) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Fondo blanco: PNG con transparencia no debe quedar negro en jpeg
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const toBlob = type_q => new Promise(res => canvas.toBlob(res, type_q[0], type_q[1]));
    let blob = await toBlob(['image/webp', 0.82]);
    if (blob?.type === 'image/webp') return { blob, ext: 'webp' };
    blob = await toBlob(['image/jpeg', 0.85]);
    if (blob) return { blob, ext: 'jpg' };
  } catch (e) {
    console.warn('compressImage: fallback al archivo original', e);
  }
  // Último recurso: el archivo tal cual (p.ej. formato no decodificable)
  return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
}

// ---- Image preview ----

function onImgChange(input) {
  const file    = input.files?.[0];
  const preview = document.getElementById('imgPreview');
  const img     = document.getElementById('imgPreviewEl');
  if (file && preview && img) {
    img.src = URL.createObjectURL(file);
    preview.classList.add('sh');
  }
}

// ---- Search ----

let searchTimer;
function searchProds(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { adminPage = 1; loadAdminProducts(val); }, 400);
}

// ============================================================
// CSV Import v2 — masivo con variantes por marca
//   1 fila = 1 variante (producto + marca)
//   · Si el producto no existe (por nombre) se crea
//   · Si la marca no existe (por nombre) se crea
//   · Si producto+marca ya existe, ACTUALIZA precio/costo/stock
//     (sirve también para actualizar stock en masa re-importando)
// ============================================================

let csvParsedRows = [];

function openImportModal() {
  csvParsedRows = [];
  const modal = document.getElementById('importModal');
  if (modal) modal.classList.add('op');
  const fileEl = document.getElementById('importFile');
  if (fileEl) fileEl.value = '';
  const prev = document.getElementById('importPreview');
  if (prev) prev.innerHTML = `<p class="import-hint">Selecciona un archivo CSV para previsualizar los datos antes de importar.</p>`;
  const stat = document.getElementById('importStatus');
  if (stat) stat.textContent = '';
}

function closeImportModal() {
  document.getElementById('importModal')?.classList.remove('op');
}

function downloadCSVTemplate() {
  const headers = 'name,brand,variant,category_slug,sku,description,price_usd,cost_usd,margin_pct,unit_abbr,emoji,tag,featured,essential,active,stock,min_qty';
  const example = [
    '"Boligrafo punta fina",BIC,Azul,boligrafos,BOL-BIC-AZ,"Boligrafo tinta seca",0.45,0.22,,unid,🖊️,Popular,false,true,true,200,1',
    '"Boligrafo punta fina",BIC,Negro,boligrafos,BOL-BIC-NE,"Boligrafo tinta seca",0.45,0.22,,unid,🖊️,,false,true,true,150,1',
    '"Boligrafo punta fina",Kilométrico,Azul,boligrafos,BOL-KM-AZ,"Boligrafo tinta seca",0.40,0.18,,unid,🖊️,,false,false,true,300,1',
    '"Resma Carta 500h",Chamex,,papel,RES-CH,"Resma papel bond carta",5.80,4.10,,resma,📄,Al mayor,true,true,true,45,1',
  ].join('\n');
  const blob    = new Blob(['﻿' + headers + '\n' + example], { type: 'text/csv;charset=utf-8;' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = 'jjpaper_productos_plantilla.csv';
  a.click(); URL.revokeObjectURL(url);
}

function onImportFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => previewCSV(e.target.result);
  reader.readAsText(file, 'UTF-8');
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line + ',') {
    if (ch === '"' && !inQ) { inQ = true; continue; }
    if (ch === '"' && inQ)  { inQ = false; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return result;
}

function previewCSV(text) {
  const lines  = text.replace(/^﻿/, '').replace(/\r/g, '').trim().split('\n').filter(Boolean);
  if (lines.length < 2) {
    document.getElementById('importPreview').innerHTML = '<p style="color:var(--danger)">El archivo no tiene datos.</p>';
    return;
  }

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  csvParsedRows = [];
  const errors  = [];
  const seen    = new Set();   // producto+marca duplicado dentro del archivo

  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = parseCSVLine(line);
    const row  = {};
    headers.forEach((h, j) => row[h] = (cols[j] || '').trim());
    // alias de compatibilidad con la plantilla vieja
    if (!row.brand && row.brand_slug) row.brand = row.brand_slug;
    if (!row.variant && row.presentacion) row.variant = row.presentacion;

    if (!row.name)                        { errors.push(`Fila ${i + 2}: nombre requerido`); return; }
    if (isNaN(parseFloat(row.price_usd))) { errors.push(`Fila ${i + 2}: precio invalido`); return; }
    const key = normTxt(row.name) + '|' + normTxt(row.brand || '') + '|' + normTxt(row.variant || '');
    if (seen.has(key)) { errors.push(`Fila ${i + 2}: duplicado (${row.name} / ${row.brand || 'sin marca'} / ${row.variant || '—'})`); return; }
    seen.add(key);
    csvParsedRows.push(row);
  });

  const statEl = document.getElementById('importStatus');
  if (statEl) {
    statEl.innerHTML = errors.length
      ? `<span style="color:var(--danger)">⚠️ ${errors.slice(0,5).join('<br>')}${errors.length>5?`<br>... y ${errors.length-5} más`:''}` : '';
  }

  const prevEl = document.getElementById('importPreview');
  if (!prevEl) return;

  const uniqueProds  = new Set(csvParsedRows.map(r => normTxt(r.name))).size;
  const uniqueBrands = new Set(csvParsedRows.map(r => normTxt(r.brand || '')).values()).size;

  prevEl.innerHTML = `
    <p style="font-size:12px;color:var(--gr);margin-bottom:8px">
      <strong>${csvParsedRows.length}</strong> variantes (${uniqueProds} productos · ~${uniqueBrands} marcas) listas ·
      <strong>${errors.length}</strong> filas con error ignoradas
    </p>
    <div class="csv-preview-scroll">
      <table class="admin-table" style="font-size:11px">
        <thead><tr><th>Producto</th><th>Marca</th><th>Presentación</th><th>SKU</th><th>Categoria</th><th>Precio</th><th>Costo</th><th>Stock</th></tr></thead>
        <tbody>
          ${csvParsedRows.slice(0, 50).map(r => `<tr>
            <td>${r.name}</td>
            <td>${r.brand || '—'}</td>
            <td>${r.variant || '—'}</td>
            <td>${r.sku || '—'}</td>
            <td>${r.category_slug || '—'}</td>
            <td>$${parseFloat(r.price_usd).toFixed(2)}</td>
            <td>${r.cost_usd ? '$' + parseFloat(r.cost_usd).toFixed(2) : '—'}</td>
            <td>${r.stock || '∞'}</td>
          </tr>`).join('')}
          ${csvParsedRows.length > 50 ? `<tr><td colspan="8" style="text-align:center;color:var(--gr)">
            ... y ${csvParsedRows.length - 50} más</td></tr>` : ''}
        </tbody>
      </table>
    </div>`;
}

// Slug simple para marcas creadas al vuelo
function slugify(s) {
  return normTxt(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'marca';
}

async function importProducts() {
  if (!csvParsedRows.length) { showToast('Carga un CSV primero', 'warn'); return; }
  const btn    = document.getElementById('importBtn');
  const statEl = document.getElementById('importStatus');
  const say    = t => { if (statEl) statEl.textContent = t; };
  if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }

  try {
    const catMap  = Object.fromEntries(adminCategories.map(c => [c.slug, c.id]));
    const unitMap = Object.fromEntries(adminUnitsDB.map(u => [u.abbr, u]));

    // --- 1) Marcas: mapear por nombre/slug, crear las que falten ---
    say('Verificando marcas...');
    const brandRows = await fetchAllRows('jjp_brands', 'id,name,slug');
    const brandMap  = {};   // normTxt(name|slug) → id
    brandRows.forEach(b => { brandMap[normTxt(b.name)] = b.id; brandMap[normTxt(b.slug)] = b.id; });

    const newBrandNames = [...new Set(
      csvParsedRows.map(r => (r.brand || '').trim()).filter(b => b && !brandMap[normTxt(b)])
    )];
    if (newBrandNames.length) {
      say(`Creando ${newBrandNames.length} marcas nuevas...`);
      const { data: created, error: bErr } = await sb.from('jjp_brands')
        .insert(newBrandNames.map(n => ({ name: n, slug: slugify(n), active: true })))
        .select('id,name');
      if (bErr) throw new Error('creando marcas: ' + bErr.message);
      (created || []).forEach(b => { brandMap[normTxt(b.name)] = b.id; });
    }

    // --- 2) Productos existentes: mapear por nombre ---
    say('Verificando productos existentes...');
    const prodRows = await fetchAllRows('jjp_products', 'id,name');
    const prodMapByName = {};
    prodRows.forEach(p => { prodMapByName[normTxt(p.name)] = p.id; });

    // Agrupar filas por producto
    const groups = new Map();
    csvParsedRows.forEach(r => {
      const key = normTxt(r.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    // --- 3) Crear productos que no existen (en lotes) ---
    const toCreate = [...groups.entries()].filter(([key]) => !prodMapByName[key]);
    let createdProds = 0;
    const BATCH = 50;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH).map(([, rows]) => {
        const r = rows[0];
        const unitObj = unitMap[r.unit_abbr] || unitMap[r.unit] || null;
        return {
          name:        r.name,
          description: r.description || null,
          price_usd:   Math.min(...rows.map(x => parseFloat(x.price_usd))),
          unit:        unitObj?.abbr || r.unit_abbr || r.unit || 'unid',
          unit_id:     unitObj?.id   || null,
          emoji:       r.emoji       || '📦',
          tag:         r.tag         || null,
          featured:    r.featured === 'true' || r.featured === '1',
          essential:   r.essential === 'true' || r.essential === '1',
          active:      r.active !== 'false' && r.active !== '0',
          min_qty:     r.min_qty ? parseInt(r.min_qty) : 1,
          category_id: catMap[r.category_slug] || null,
        };
      });
      const { data: created, error } = await sb.from('jjp_products').insert(batch).select('id,name');
      if (error) throw new Error('creando productos: ' + error.message);
      (created || []).forEach(p => { prodMapByName[normTxt(p.name)] = p.id; });
      createdProds += created?.length || 0;
      say(`Creando productos ${Math.min(i + BATCH, toCreate.length)} / ${toCreate.length}...`);
    }

    // --- 4) Variantes existentes de los productos afectados ---
    say('Cargando variantes existentes...');
    const affectedIds = [...groups.keys()].map(k => prodMapByName[k]).filter(Boolean);
    const existVariants = [];
    for (let i = 0; i < affectedIds.length; i += 100) {
      const chunk = affectedIds.slice(i, i + 100);
      const { data } = await sb.from('jjp_product_variants')
        .select('id,product_id,brand_id,variant_name').in('product_id', chunk);
      existVariants.push(...(data || []));
    }
    const varKey = (pid, bid, vname) => pid + '|' + (bid || 'none') + '|' + normTxt(vname || '');
    const varMap = {};
    existVariants.forEach(v => { varMap[varKey(v.product_id, v.brand_id, v.variant_name)] = v.id; });

    // --- 5) Upsert de variantes ---
    const inserts = [], updates = [];
    let skipped = 0;
    csvParsedRows.forEach(r => {
      const pid = prodMapByName[normTxt(r.name)];
      if (!pid) { skipped++; return; }
      const bid = r.brand ? (brandMap[normTxt(r.brand)] || null) : null;
      const row = {
        product_id: pid,
        brand_id:   bid,
        variant_name: (r.variant || '').trim() || null,
        sku:        r.sku || null,
        barcode:    r.barcode || null,
        cost_usd:   r.cost_usd ? parseFloat(r.cost_usd) : null,
        price_usd:  parseFloat(r.price_usd),
        margin_pct: r.margin_pct ? parseFloat(r.margin_pct) : null,
        stock:      (r.stock !== '' && r.stock != null) ? parseInt(r.stock) : -1,
        min_qty:    r.min_qty ? parseInt(r.min_qty) : 1,
        active:     r.active !== 'false' && r.active !== '0',
      };
      const existingId = varMap[varKey(pid, bid, r.variant)];
      if (existingId) updates.push({ id: existingId, row });
      else inserts.push(row);
    });

    let imported = 0, errors = skipped;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const batch = inserts.slice(i, i + BATCH);
      const { error } = await sb.from('jjp_product_variants').insert(batch);
      if (error) { errors += batch.length; console.error(error); }
      else imported += batch.length;
      say(`Insertando variantes ${Math.min(i + BATCH, inserts.length)} / ${inserts.length}...`);
    }
    for (let i = 0; i < updates.length; i += 20) {
      const chunk = updates.slice(i, i + 20);
      await Promise.all(chunk.map(async u => {
        const { error } = await sb.from('jjp_product_variants').update(u.row).eq('id', u.id);
        if (error) { errors++; console.error(error); } else imported++;
      }));
      say(`Actualizando variantes ${Math.min(i + 20, updates.length)} / ${updates.length}...`);
    }

    showToast(errors
      ? `${imported} variantes importadas (${createdProds} productos nuevos) · ${errors} con error`
      : `✅ ${imported} variantes importadas · ${createdProds} productos nuevos · ${updates.length} actualizadas`);
    say('');
    if (imported > 0) { closeImportModal(); await loadAdminProducts(); }
  } catch (e) {
    console.error(e);
    showToast('Error en importación: ' + e.message, 'err');
    say('⚠️ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Importar productos'; }
  }
}

// ============================================================
// Pricing bulk — recalcular precios de variantes por costo+tasas
// ============================================================

// scope: 'selected' | 'all'. Solo variantes CON costo se actualizan.
async function recalcPrices(scope = 'all') {
  const source = scope === 'selected'
    ? adminProducts.filter(p => selectedIds.has(p.id))
    : adminProducts;
  const targets = source.flatMap(p => p.variants || []).filter(v => v.cost_usd && v.cost_usd > 0);

  if (!targets.length) {
    showToast('No hay variantes con costo para recalcular', 'warn'); return;
  }
  const gap = getGapPct();
  if (!confirm(`¿Recalcular el precio de ${targets.length} variante(s) según las tasas actuales?\n\n`
    + `Tasa BCV: ${getBcvRate()} · Binance: ${getUsdtRate()} (brecha ${gap.toFixed(1)}%)\n`
    + `Precio = costo × (Binance/BCV) × (1 + margen).`)) return;

  let ok = 0, err = 0;
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map(async v => {
      const newPrice = suggestedPriceUSD(v.cost_usd, v.margin_pct);
      const { error } = await sb.from('jjp_product_variants').update({ price_usd: newPrice }).eq('id', v.id);
      if (error) err++; else ok++;
    }));
  }

  showToast(err ? `${ok} actualizados · ${err} con error` : `✅ ${ok} precios recalculados`);
  selectedIds.clear();
  await loadAdminProducts();
}

/* ---------- ESTUDIO COGNITIVO DE FOTOS: Búsqueda Web + Fotografía IA + Subida/Pegado ---------- */
let _currentStudioProdId = null;
let _currentStudioSelectedImg = null;
let _studioPasteHandlerBound = false;

async function convertImageToStudioWebpDataUri(srcOrBlob, targetSize = 520) {
  let blob = null;

  if (srcOrBlob instanceof Blob) {
    blob = srcOrBlob;
  } else if (typeof srcOrBlob === 'string') {
    const s = srcOrBlob.trim();
    if (s.startsWith('data:') || s.startsWith('blob:')) {
      const r = await fetch(s);
      blob = await r.blob();
    } else if (/^https?:\/\//i.test(s)) {
      // Intentar 1) Proxy Cloudflare local/producción, 2) Proxy global wsrv.nl con conversión WebP y CORS, 3) Fetch directo
      const candidates = [
        `/api/search-images?proxy_url=${encodeURIComponent(s)}`,
        `https://wsrv.nl/?url=${encodeURIComponent(s)}&w=${targetSize}&h=${targetSize}&fit=contain&cbg=white&output=webp`,
        s
      ];
      for (const candidateUrl of candidates) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8500);
          const resp = await fetch(candidateUrl, { signal: ctrl.signal });
          clearTimeout(timer);
          if (resp.ok) {
            const ct = (resp.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('image') || candidateUrl.includes('wsrv.nl') || candidateUrl === s) {
              const b = await resp.blob();
              if (b && b.size > 400) {
                blob = b;
                break;
              }
            }
          }
        } catch (_) {}
      }
    }
  }

  if (!blob) {
    throw new Error('No se pudo descargar la imagen origen (protegida o inaccesible). Prueba otra opción o pégala con Ctrl+V.');
  }

  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = targetSize;
  cv.height = targetSize;
  const ctx = cv.getContext('2d');

  // Fondo blanco puro #FFFFFF de estudio para evitar recuadros negros en transparencias y uniformizar el catálogo impreso
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetSize, targetSize);

  const pad = Math.round(targetSize * 0.04); // 4% margen limpio de estudio
  const avail = targetSize - pad * 2;
  const scale = Math.min(avail / bmp.width, avail / bmp.height);
  const drawW = Math.round(bmp.width * scale);
  const drawH = Math.round(bmp.height * scale);
  const dx = Math.round((targetSize - drawW) / 2);
  const dy = Math.round((targetSize - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, dx, dy, drawW, drawH);
  bmp.close();

  let dataUri = cv.toDataURL('image/webp', 0.82);
  if (!dataUri.startsWith('data:image/webp')) {
    dataUri = cv.toDataURL('image/jpeg', 0.85);
  }
  return dataUri;
}

async function prodGenerarFotoIA(productId, prodName) {
  _currentStudioProdId = productId;
  _currentStudioSelectedImg = null;

  if (!_studioPasteHandlerBound) {
    _studioPasteHandlerBound = true;
    window.addEventListener('paste', async (e) => {
      const modalEl = document.getElementById('prodAiModal');
      if (!modalEl || modalEl.style.display === 'none') return;
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await prodStudioHandleLocalFile(file, 'Imagen pegada del portapapeles (Ctrl+V)');
            break;
          }
        }
      }
    });
  }

  let modal = document.getElementById('prodAiModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'prodAiModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(4px);';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:860px;width:100%;max-height:93vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);overflow:hidden;font-family:'Plus Jakarta Sans',sans-serif;">
      <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#f8fafc">
        <div>
          <h3 style="margin:0;font-size:16px;color:#0f172a;display:flex;align-items:center;gap:8px">
            <span>📸 Estudio Fotográfico de Producto (Web + IA + Subida Directa)</span>
            <span style="font-size:11px;font-weight:700;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px">WebP Optimizado BD</span>
          </h3>
          <p style="margin:4px 0 0;font-size:13px;color:#334155;font-weight:600" id="prodStudioTitle">${escapeHTML(prodName)}</p>
        </div>
        <button onclick="document.getElementById('prodAiModal').style.display='none'" style="border:none;background:none;font-size:20px;cursor:pointer;color:#64748b">✕</button>
      </div>

      <!-- Barra de búsqueda + IA -->
      <div style="padding:11px 20px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:240px;position:relative">
          <input type="text" id="prodStudioSearchInput" value="${escapeHTML(prodName)}"
                 onkeydown="if(event.key==='Enter')prodStudioEjecutarBusqueda()"
                 style="width:100%;padding:8px 12px 8px 32px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;outline:none"
                 placeholder="Escribe marca, producto, color o presentación (ej. Marcador Expo rojo pizarra)...">
          <span style="position:absolute;left:10px;top:9px;font-size:13px;color:#94a3b8">🔍</span>
        </div>
        <button type="button" style="padding:8px 12px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer"
                onclick="prodStudioOptimizarQueryIA()" id="btnOptQueryIA" title="Usa IA para traducir abreviaturas de inventario a nombre comercial claro">
          ✨ Optimizar nombre con IA
        </button>
        <button type="button" style="padding:8px 14px;background:#0f172a;color:#fff;border-radius:8px;border:none;font-size:12.5px;font-weight:700;cursor:pointer"
                onclick="prodStudioEjecutarBusqueda()">
          🌐 Buscar en Web
        </button>
      </div>

      <!-- Pestañas: 1) Fotos Reales Web, 2) Generar Packshot IA, 3) Subir / Pegar Ctrl+V -->
      <div style="padding:0 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div style="display:flex;gap:16px">
          <button type="button" id="tabWebBtn" onclick="prodStudioSwitchTab('web')"
                  style="padding:10px 4px;border:none;background:none;border-bottom:2.5px solid #065f46;color:#065f46;font-weight:700;font-size:12.5px;cursor:pointer">
            🌐 Catálogos Web (<span id="webPhotosCount">...</span>)
          </button>
          <button type="button" id="tabAiBtn" onclick="prodStudioSwitchTab('ai')"
                  style="padding:10px 4px;border:none;background:none;border-bottom:none;color:#64748b;font-weight:600;font-size:12.5px;cursor:pointer">
            🤖 Generar Packshot Estudio IA
          </button>
          <button type="button" id="tabUploadBtn" onclick="prodStudioSwitchTab('upload')"
                  style="padding:10px 4px;border:none;background:none;border-bottom:none;color:#64748b;font-weight:600;font-size:12.5px;cursor:pointer">
            📤 Subir de PC / Pegar (Ctrl+V)
          </button>
        </div>
        <div style="font-size:11px;color:#64748b">
          💡 Puedes presionar <strong>Ctrl + V</strong> en cualquier momento para pegar una foto copiada
        </div>
      </div>

      <!-- Contenedor de contenido -->
      <div style="flex:1;overflow-y:auto;padding:16px 20px;">
        <!-- TAB 1: Fotos Web -->
        <div id="panelWebPhotos">
          <div id="webLoadingSpinner" style="text-align:center;padding:36px 0;color:#64748b">
            <div style="font-size:28px;margin-bottom:8px">⏳</div>
            <div style="font-size:13px;font-weight:600">Buscando fotografías comerciales reales del producto...</div>
          </div>
          <div id="webPhotosGrid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:12px;"></div>
        </div>

        <!-- TAB 2: Packshot IA -->
        <div id="panelAiPhoto" style="display:none;text-align:center;padding:10px 0;">
          <div style="max-width:340px;margin:0 auto;border:2px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff">
            <img id="prodAiStandaloneImg" alt="Packshot IA" style="width:100%;height:280px;object-fit:contain;background:#fff;border-radius:8px">
          </div>
          <div style="margin-top:12px;display:flex;gap:10px;justify-content:center">
            <button type="button" onclick="prodStudioRegenerarIA()" style="padding:8px 16px;background:#0f172a;color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer">
              🔄 Generar otra toma IA
            </button>
          </div>
        </div>

        <!-- TAB 3: Subir desde PC / Pegar Ctrl+V / URL Directa -->
        <div id="panelUploadPhoto" style="display:none;padding:8px 0;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch">
            <div style="border:2px dashed #94a3b8;border-radius:12px;padding:24px;text-align:center;background:#f8fafc;cursor:pointer;display:flex;flex-direction:column;justify-content:center;align-items:center"
                 onclick="document.getElementById('studioLocalFileInput').click()">
              <input type="file" id="studioLocalFileInput" accept="image/*" style="display:none"
                     onchange="if(this.files[0])prodStudioHandleLocalFile(this.files[0], this.files[0].name)">
              <div style="font-size:34px;margin-bottom:8px">📁</div>
              <div style="font-size:13.5px;font-weight:700;color:#0f172a">Seleccionar imagen desde tu PC</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:4px">O presiona <strong>Ctrl + V</strong> para pegar una captura o imagen copiada</div>
              <div style="margin-top:12px">
                <label style="font-size:11px;color:#475569;display:block;margin-bottom:4px">¿Tienes el link directo de una imagen?</label>
                <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
                  <input type="url" id="studioDirectUrlInput" placeholder="https://.../foto.jpg" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;width:190px">
                  <button type="button" onclick="prodStudioAplicarUrlDirecta()" style="padding:6px 10px;background:#065f46;color:#fff;border:none;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer">Cargar</button>
                </div>
              </div>
            </div>
            <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:220px">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">Previsualización cuadrada 520×520 (Fondo Blanco)</div>
              <img id="studioUploadPreviewImg" style="max-width:190px;max-height:190px;object-fit:contain;border:1px solid #f1f5f9;border-radius:8px;display:none" alt="Preview">
              <div id="studioUploadEmptyHint" style="font-size:12px;color:#94a3b8;text-align:center;padding:30px 10px">Ninguna imagen local cargada todavía</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Barra de acción inferior -->
      <div style="padding:13px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:#475569;flex:1" id="studioSelectionStatus">
          Selecciona una fotografía, genera con IA o pega con <strong>Ctrl+V</strong> para asignarla al producto.
        </div>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn-ghost" style="padding:8px 16px" onclick="document.getElementById('prodAiModal').style.display='none'">
            Cancelar
          </button>
          <button type="button" id="studioSaveBtn" class="btn-p" style="padding:9px 20px;background:#065f46;color:#fff;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:13px"
                  disabled onclick="prodStudioGuardarSeleccion()">
            ✅ Optimizar a WebP y Guardar Foto
          </button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  // Iniciar búsqueda web automáticamente
  prodStudioEjecutarBusqueda();
}

function prodStudioSwitchTab(tab) {
  const panelWeb = document.getElementById('panelWebPhotos');
  const panelAi = document.getElementById('panelAiPhoto');
  const panelUp = document.getElementById('panelUploadPhoto');
  const tabWeb = document.getElementById('tabWebBtn');
  const tabAi = document.getElementById('tabAiBtn');
  const tabUp = document.getElementById('tabUploadBtn');

  if (panelWeb) panelWeb.style.display = tab === 'web' ? 'block' : 'none';
  if (panelAi)  panelAi.style.display  = tab === 'ai' ? 'block' : 'none';
  if (panelUp)  panelUp.style.display  = tab === 'upload' ? 'block' : 'none';

  [
    [tabWeb, tab === 'web'],
    [tabAi,  tab === 'ai'],
    [tabUp,  tab === 'upload']
  ].forEach(([btn, on]) => {
    if (!btn) return;
    btn.style.borderBottom = on ? '2.5px solid #065f46' : 'none';
    btn.style.color = on ? '#065f46' : '#64748b';
    btn.style.fontWeight = on ? '700' : '600';
  });

  if (tab === 'ai') {
    const aiImg = document.getElementById('prodAiStandaloneImg');
    if (aiImg && !aiImg.getAttribute('src')) {
      prodStudioGenerarFotoIA();
    }
  }
}

async function prodStudioOptimizarQueryIA() {
  const qInput = document.getElementById('prodStudioSearchInput');
  const btn = document.getElementById('btnOptQueryIA');
  const raw = (qInput?.value || '').trim();
  if (!raw) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Optimizando...'; }
  try {
    let optimized = raw
      .replace(/\bP\/G\b/gi, 'punta gruesa')
      .replace(/\bP\/F\b/gi, 'punta fina')
      .replace(/\bP\/M\b/gi, 'punta media')
      .replace(/\bT\/C\b/gi, 'tamaño carta')
      .replace(/\bT\/O\b/gi, 'tamaño oficio')
      .replace(/\bBOLIG\.?\b/gi, 'Boligrafo')
      .replace(/\bMARC\.?\b/gi, 'Marcador')
      .replace(/\bRESALT\.?\b/gi, 'Resaltador')
      .replace(/\bCARP\.?\b/gi, 'Carpeta')
      .replace(/\bSACAP\.?\b/gi, 'Sacapuntas')
      .replace(/\bPERF\.?\b/gi, 'Perforadora')
      .replace(/\bGRAP\.?\b/gi, 'Grapadora')
      .replace(/\bHJS\b/gi, 'hojas')
      .replace(/\b(STD|XUND|UND)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (window.GeminiClient) {
      const sys = 'Eres un experto en catálogos de papelería y útiles de oficina en Latinoamérica. Convierte el nombre abreviado de inventario en una consulta de búsqueda comercial limpia de 4 a 7 palabras en español (incluyendo tipo de artículo, marca, modelo/presentación y color) para buscar su fotografía de producto. Devuelve SOLO las palabras de búsqueda, sin comillas ni explicaciones.';
      const aiRes = await window.GeminiClient.callGemini({ prompt: raw, systemInstruction: sys, temperature: 0.1 });
      if (aiRes && aiRes.trim().length > 3 && !/error/i.test(aiRes)) {
        optimized = aiRes.replace(/["'`\n\r]/g, '').trim();
      }
    }

    if (qInput) qInput.value = optimized;
    prodStudioSwitchTab('web');
    await prodStudioEjecutarBusqueda();
  } catch (_) {
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Optimizar nombre con IA'; }
  }
}

async function prodStudioHandleLocalFile(fileOrBlob, label = 'Imagen local') {
  try {
    const dataUri = await convertImageToStudioWebpDataUri(fileOrBlob, 520);
    prodStudioSwitchTab('upload');
    const prev = document.getElementById('studioUploadPreviewImg');
    const hint = document.getElementById('studioUploadEmptyHint');
    if (prev) { prev.src = dataUri; prev.style.display = 'block'; }
    if (hint) { hint.style.display = 'none'; }
    prodStudioSelectImage(dataUri, null, label);
  } catch (err) {
    alert('No se pudo leer la imagen: ' + err.message);
  }
}

async function prodStudioAplicarUrlDirecta() {
  const inp = document.getElementById('studioDirectUrlInput');
  const url = (inp?.value || '').trim();
  if (!url) return;
  try {
    const dataUri = await convertImageToStudioWebpDataUri(url, 520);
    const prev = document.getElementById('studioUploadPreviewImg');
    const hint = document.getElementById('studioUploadEmptyHint');
    if (prev) { prev.src = dataUri; prev.style.display = 'block'; }
    if (hint) { hint.style.display = 'none'; }
    prodStudioSelectImage(dataUri, null, 'Imagen desde URL directa');
  } catch (err) {
    alert('Error al cargar URL: ' + err.message);
  }
}

async function prodStudioEjecutarBusqueda() {
  const qInput = document.getElementById('prodStudioSearchInput');
  const q = (qInput?.value || '').trim();
  if (!q) return;

  prodStudioSwitchTab('web');
  const spinner = document.getElementById('webLoadingSpinner');
  const grid = document.getElementById('webPhotosGrid');
  const countEl = document.getElementById('webPhotosCount');

  if (spinner) spinner.style.display = 'block';
  if (grid) grid.innerHTML = '';
  if (countEl) countEl.textContent = '...';

  let results = [];

  try {
    // 1. Consultar vía Cloudflare Pages Function (/api/search-images)
    try {
      const cfRes = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
      if (cfRes.ok) {
        const cfData = await cfRes.json();
        if (cfData.ok && Array.isArray(cfData.results) && cfData.results.length > 0) {
          results = cfData.results;
        }
      }
    } catch (err) {
      console.warn('Aviso en /api/search-images:', err);
    }

    if (spinner) spinner.style.display = 'none';

    if (!results || results.length === 0) {
      if (grid) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:28px;color:#475569;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
            <p style="margin:0 0 8px;font-size:14px;font-weight:700">No encontramos fotos web directas con "${escapeHTML(q)}".</p>
            <p style="margin:0 0 14px;font-size:12.5px;color:#64748b">Haz clic en <strong>✨ Optimizar nombre con IA</strong> arriba, usa la pestaña <strong>🤖 Generar Packshot Estudio IA</strong>, o pega una foto con <strong>Ctrl + V</strong>.</p>
            <div style="display:flex;gap:10px;justify-content:center">
              <button type="button" onclick="prodStudioOptimizarQueryIA()" style="padding:7px 14px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">✨ Optimizar Búsqueda con IA</button>
              <button type="button" onclick="prodStudioSwitchTab('ai')" style="padding:7px 14px;background:#0f172a;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">🤖 Generar Foto con IA</button>
            </div>
          </div>`;
      }
      if (countEl) countEl.textContent = '0';
      return;
    }

    if (countEl) countEl.textContent = results.length;

    grid.innerHTML = results.map((r, idx) => {
      const rawImg = r.image || r.thumbnail;
      const thumbSrc = `https://wsrv.nl/?url=${encodeURIComponent(r.thumbnail || rawImg)}&w=260&h=260&fit=contain&cbg=white&output=webp`;
      return `
      <div class="prod-img-card" id="studio-card-${idx}" style="cursor:pointer;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;transition:all .15s ease"
           onclick="prodStudioSelectImage('${escapeJsStr(rawImg)}', ${idx}, '${escapeJsStr(r.title)}')">
        <div style="width:100%;height:132px;background:#fff;display:flex;align-items:center;justify-content:center;padding:8px">
          <img src="${thumbSrc}" alt="${escapeHTML(r.title)}" style="max-width:100%;max-height:100%;object-fit:contain"
               onerror="if(this.src!=='${escapeJsStr(r.thumbnail || rawImg)}'){this.src='${escapeJsStr(r.thumbnail || rawImg)}';}else{this.parentElement.parentElement.style.display='none';}">
        </div>
        <div style="padding:7px 8px;border-top:1px solid #f1f5f9;font-size:11px;color:#334155;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHTML(r.title)}">
          ${escapeHTML(r.title)}
        </div>
      </div>`;
    }).join('');

    if (results[0]) {
      prodStudioSelectImage(results[0].image || results[0].thumbnail, 0, results[0].title);
    }
  } catch (err) {
    if (spinner) spinner.style.display = 'none';
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;color:#b91c1c;padding:20px;text-align:center">Aviso en búsqueda web: ${err.message}</div>`;
  }
}

function prodStudioSelectImage(imgUrl, idx = null, title = '') {
  _currentStudioSelectedImg = imgUrl;

  document.querySelectorAll('.prod-img-card').forEach(c => {
    c.style.borderColor = '#e2e8f0';
    c.style.boxShadow = 'none';
  });

  if (idx !== null) {
    const card = document.getElementById(`studio-card-${idx}`);
    if (card) {
      card.style.borderColor = '#065f46';
      card.style.boxShadow = '0 0 0 3px rgba(6,95,70,0.22)';
    }
  }

  const saveBtn = document.getElementById('studioSaveBtn');
  const statusEl = document.getElementById('studioSelectionStatus');
  if (saveBtn) saveBtn.disabled = false;
  if (statusEl) {
    statusEl.innerHTML = `✅ Seleccionada: <strong style="color:#0f172a">${escapeHTML(title || 'Fotografía lista')}</strong>`;
  }
}

async function prodStudioGenerarFotoIA() {
  const qInput = document.getElementById('prodStudioSearchInput');
  const prodName = (qInput?.value || '').trim();
  const imgEl = document.getElementById('prodAiStandaloneImg');
  const statusEl = document.getElementById('studioSelectionStatus');
  if (!imgEl) return;

  if (statusEl) statusEl.innerHTML = '🎨 Generando fotografía de estudio en fondo blanco con IA...';

  const isCaja = /\b(X\s*12|DOCENA|DOC|C\/12|CAJA|X\s*24|PACK|SURT|SET)\b/i.test(prodName);
  const isResma = /\b(RESMA|500\s*HJS|500\s*HOJAS|BOND)\b/i.test(prodName);

  let objectPrompt = `Commercial product photography of ${prodName}, authentic stationery office supply item, centered on pure solid white background #FFFFFF, studio lighting, sharp focus, 8k`;
  if (isCaja) {
    objectPrompt = `Commercial product photography of the authentic retail box packaging of ${prodName}, displaying clean brand typography, with one item placed next to the box, centered on pure solid white background #FFFFFF, studio photo, 8k`;
  } else if (isResma) {
    objectPrompt = `Commercial product photography of a factory sealed ream packaging of ${prodName}, authentic paper wrapper with printed branding, centered on pure solid white background #FFFFFF, studio light, 8k`;
  }

  try {
    if (window.GeminiClient) {
      const sys = `You are a commercial catalog photographer for an office supply company. Output a 1-sentence prompt in English for Flux describing the authentic commercial product photography on pure solid white background #FFFFFF. Never produce generic 3D renders.`;
      const aiPrompt = await window.GeminiClient.callGemini({ prompt: prodName, systemInstruction: sys, temperature: 0.1 });
      if (aiPrompt && aiPrompt.length > 10 && !aiPrompt.includes('Error')) {
        objectPrompt = aiPrompt.replace(/^["'`]|["'`]$/g, '').trim();
      }
    }
  } catch (_) {}

  const seed = Math.abs(hashCode(prodName + '_' + Date.now()));
  const aiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(objectPrompt.slice(0, 360))}?width=640&height=640&model=flux&nologo=true&seed=${seed}`;

  imgEl.src = aiUrl;
  imgEl.onload = () => {
    prodStudioSelectImage(aiUrl, null, `Packshot IA (${prodName})`);
  };
}

function prodStudioRegenerarIA() {
  prodStudioGenerarFotoIA();
}

async function prodStudioGuardarSeleccion() {
  if (!_currentStudioSelectedImg || !_currentStudioProdId) return;

  const btn = document.getElementById('studioSaveBtn');
  const statusEl = document.getElementById('studioSelectionStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Optimizando WebP y guardando… ⏳'; }
  if (statusEl) statusEl.textContent = 'Encuadrando en lienzo 520×520 fondo blanco, comprimiendo a WebP ligero y guardando en BD...';

  try {
    const webpDataUri = await convertImageToStudioWebpDataUri(_currentStudioSelectedImg, 520);

    const [resProd] = await Promise.all([
      sb.from('jjp_products').update({ image_url: webpDataUri }).eq('id', _currentStudioProdId),
      sb.from('jjp_product_variants').update({ image_url: webpDataUri }).eq('product_id', _currentStudioProdId)
    ]);

    if (resProd?.error) throw new Error(resProd.error.message);

    // Actualizar en memoria local inmediatamente para no requerir recarga pesada
    const targetProd = adminProducts.find(p => p.id === _currentStudioProdId);
    if (targetProd) {
      targetProd.image_url = webpDataUri;
      (targetProd.variants || []).forEach(v => { v.image_url = webpDataUri; });
    }

    // Invalidar caché de sessionStorage del catálogo público/impreso
    try {
      sessionStorage.removeItem('jjp_catalog_prods_v2');
    } catch (_) {}

    document.getElementById('prodAiModal').style.display = 'none';
    if (typeof showToast === 'function') {
      showToast('✅ Fotografía WebP optimizada y guardada en la base de datos', 'ok');
    }
    if (typeof renderAdminProdTable === 'function') {
      renderAdminProdTable();
    }
    if (typeof window._onStudioPhotoSaved === 'function') {
      window._onStudioPhotoSaved(_currentStudioProdId, webpDataUri);
    }
  } catch (e) {
    alert('Error al procesar o guardar foto: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Optimizar a WebP y Guardar Foto'; }
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function escapeJsStr(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
