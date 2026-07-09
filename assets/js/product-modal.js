/* ======================================================
   JJ Paper — Product Detail Modal
   Con selector de marca (variantes): cada marca tiene su
   propio precio y stock.
   ====================================================== */

let modalQty     = 1;
let modalProduct = null;
let modalVariant = null;
let _modalUntrap = null;

function injectProductModal() {
  const html = `
<div class="modal-overlay" id="prodModal" onclick="closeProdModal(event)">
  <div class="modal-box" id="prodModalBox" role="dialog" aria-modal="true" aria-labelledby="prodModalTitle">
    <div class="modal-hd">
      <h3 id="prodModalTitle">Detalle del producto</h3>
      <button class="modal-close" onclick="closeProdModal()" aria-label="Cerrar detalle del producto">✕</button>
    </div>
    <div class="modal-body" id="prodModalBody"></div>
  </div>
</div>`;
  const placeholder = document.getElementById('prod-modal-placeholder');
  if (placeholder) placeholder.outerHTML = html;
}

async function openProductModal(productId) {
  const modal = document.getElementById('prodModal');
  const body  = document.getElementById('prodModalBody');
  const title = document.getElementById('prodModalTitle');

  // Show modal immediately with a loading state for snappy UX
  if (title) title.textContent = 'Cargando...';
  if (body)  body.innerHTML = `<div class="cat-loading"><div class="spin"></div>Cargando detalle...</div>`;
  modal?.classList.add('op');
  document.body.style.overflow = 'hidden';
  // Atrapa foco en el diálogo y recuerda el elemento que lo abrió
  if (_modalUntrap) _modalUntrap();
  _modalUntrap = trapFocus(document.getElementById('prodModalBox'));

  // Always fetch full row (with variants) so stock/prices are fresh
  let p = null;
  // Columnas explícitas: las columnas de costo no son legibles para anon
  const { data } = await sb.from('jjp_products')
    .select(`id,category_id,name,description,price_usd,unit,image_url,emoji,tag,active,featured,sort_order,brand_id,unit_id,sku,stock,min_qty,jjp_categories(name,slug,color),jjp_units(name,abbr),${VARIANTS_SELECT}`)
    .eq('id', productId)
    .single();
  p = data ? normalizeProduct(data)
    : (typeof productMap !== 'undefined' && productMap[productId]) ||
      allProducts?.find(x => x.id === productId);
  if (!p) { closeProdModal(); return; }
  if (p._minPrice === undefined) normalizeProduct(p);

  modalProduct = p;
  // Variante inicial: la que ya está en el carrito, o la primera disponible
  modalVariant = p.variants.find(v => cart[v.id]) ||
                 p.variants.find(v => v.stock !== 0) || p.variants[0] || null;
  modalQty = Math.max(1, (modalVariant?.min_qty ?? p.min_qty) || 1);

  if (title) title.textContent = p.name;
  renderModalBody();
}

function renderModalBody() {
  const body = document.getElementById('prodModalBody');
  const p    = modalProduct;
  if (!body || !p) return;

  const v      = modalVariant;
  const cat    = p.jjp_categories || {};
  const bg     = cat.color || '#f2f2f2';
  const name   = escapeHTML(p.name);
  const unit   = escapeHTML(p.jjp_units?.name || p.unit || 'unid');
  const price  = v ? +v.price_usd : +p.price_usd;
  const stock  = v ? v.stock : p.stock;
  const minQty = Math.max(1, (v?.min_qty ?? p.min_qty) || 1);
  const inCart = cart[(v?.id || p.id)]?.qty || 0;
  const imgUrl = v?.image_url || p.image_url;

  const imgHTML = imgUrl
    ? `<img src="${encodeURI(imgUrl)}" alt="${name}">`
    : `<span style="font-size:90px">${p.emoji || '📦'}</span>`;

  // Stock badge (de la variante seleccionada)
  let stockHTML;
  if (stock === null || stock === undefined || stock < 0) {
    stockHTML = `<span class="pm-stock ok">✔ Disponible</span>`;
  } else if (stock === 0) {
    stockHTML = `<span class="pm-stock out">✕ Agotado</span>`;
  } else if (stock <= 5) {
    stockHTML = `<span class="pm-stock low">⚠ Últimas ${stock} ${unit}</span>`;
  } else {
    stockHTML = `<span class="pm-stock ok">✔ En stock (${stock} ${unit})</span>`;
  }
  const soldOut = stock === 0;

  // Selector de marca/presentación (solo si hay más de una variante)
  let variantsHTML = '';
  if (p.variants.length > 1) {
    const hasPres = p.variants.some(x => x.variant_name);
    variantsHTML = `<div class="pm-variants">
      <div class="pm-variants-lbl">${hasPres ? 'Opciones disponibles:' : 'Marca:'}</div>
      <div class="pm-variants-list">
        ${p.variants.map(vv => {
          const bName = escapeHTML(vv.jjp_brands?.name || (vv.variant_name ? '' : 'Estándar'));
          const pres  = vv.variant_name ? escapeHTML(vv.variant_name) : '';
          const label = [bName, pres].filter(Boolean).join(' · ');
          const out   = vv.stock === 0;
          const on    = vv.id === v?.id;
          return `<button class="pm-var${on ? ' on' : ''}${out ? ' out' : ''}"
            onclick="selectModalVariant('${vv.id}')" ${out ? 'title="Agotado"' : ''}>
            ${vv.jjp_brands?.logo_url ? `<img src="${escapeHTML(vv.jjp_brands.logo_url)}" alt="${bName}" loading="lazy">` : ''}
            <span>${label}</span>
            <b>${fmtPrice(vv.price_usd)}</b>
            ${out ? '<em>Agotado</em>' : ''}
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  const metaBits = [];
  const brandName = v?.jjp_brands?.name;
  if (p.variants.length <= 1 && brandName)
    metaBits.push(`<span class="pm-meta-i"><b>Marca:</b> ${v.jjp_brands.logo_url ? `<img class="pm-brand-logo" src="${escapeHTML(v.jjp_brands.logo_url)}" alt="${escapeHTML(brandName)}" loading="lazy"> ` : ''}${escapeHTML(brandName)}</span>`);
  if (p.variants.length <= 1 && v?.variant_name)
    metaBits.push(`<span class="pm-meta-i"><b>Presentación:</b> ${escapeHTML(v.variant_name)}</span>`);
  if (v?.sku)     metaBits.push(`<span class="pm-meta-i"><b>SKU:</b> ${escapeHTML(v.sku)}</span>`);
  if (minQty > 1) metaBits.push(`<span class="pm-meta-i"><b>Mínimo:</b> ${minQty} ${unit}</span>`);

  body.innerHTML = `
<div class="prod-modal-grid">
  <div class="prod-modal-img" style="background:${bg}">
    ${imgHTML}
    ${p.tag ? `<span class="pm-tag">${escapeHTML(p.tag)}</span>` : ''}
  </div>
  <div class="prod-modal-info">
    <div class="prod-modal-cat">${escapeHTML(cat.name || '')}</div>
    <h2 class="prod-modal-name">${name}</h2>
    ${stockHTML}
    <p class="prod-modal-desc">${escapeHTML(p.description || 'Sin descripción disponible.')}</p>
    ${variantsHTML}
    ${metaBits.length ? `<div class="pm-meta">${metaBits.join('')}</div>` : ''}
    <div class="prod-modal-prices">
      <div class="prod-modal-usd">${fmtPrice(price)}</div>
      <div class="prod-modal-bs">${fmtBs(price)}</div>
      <div class="prod-modal-unit">por ${unit}</div>
    </div>
    <div class="prod-modal-actions">
      <div class="prod-modal-qty">
        <button class="qb" onclick="modalChangeQty(-1)" ${soldOut?'disabled':''} aria-label="Disminuir cantidad">−</button>
        <span class="qn" id="modalQtyDisplay" aria-live="polite" aria-label="Cantidad">${modalQty}</span>
        <button class="qb" onclick="modalChangeQty(1)" ${soldOut?'disabled':''} aria-label="Aumentar cantidad">+</button>
        <span class="pm-subtotal" id="modalSubtotal"></span>
      </div>
      ${inCart > 0 ? `<div class="pm-incart">🛒 Ya tienes ${inCart} en el carrito${brandName ? ` (${escapeHTML(brandName)})` : ''}</div>` : ''}
      <button class="prod-modal-add" onclick="modalAddToCart()" ${soldOut?'disabled':''}>
        ${soldOut ? 'Marca agotada' : '🛒 Agregar al carrito'}
      </button>
      <button class="btn-wa" onclick="modalOrderWA()">
        💬 Preguntar por WhatsApp
      </button>
    </div>
  </div>
</div>`;

  updateModalSubtotal();
}

function selectModalVariant(variantId) {
  const v = modalProduct?.variants.find(x => x.id === variantId);
  if (!v) return;
  modalVariant = v;
  modalQty = Math.max(1, (v.min_qty ?? modalProduct.min_qty) || 1);
  renderModalBody();
}

// Live subtotal under the qty stepper
function updateModalSubtotal() {
  const el = document.getElementById('modalSubtotal');
  if (!el || !modalProduct) return;
  const price = modalVariant ? +modalVariant.price_usd : +modalProduct.price_usd;
  const sub = price * modalQty;
  el.innerHTML = `${fmtPrice(sub)} <span style="color:var(--gr)">· ${fmtBs(sub)}</span>`;
}

function closeProdModal(e) {
  if (e && e.target !== document.getElementById('prodModal')) return;
  document.getElementById('prodModal')?.classList.remove('op');
  document.body.style.overflow = '';
  modalProduct = null;
  modalVariant = null;
  if (_modalUntrap) { _modalUntrap(); _modalUntrap = null; }   // suelta y restaura foco
}

function modalChangeQty(delta) {
  const min   = Math.max(1, (modalVariant?.min_qty ?? modalProduct?.min_qty) || 1);
  const stock = modalVariant ? modalVariant.stock : modalProduct?.stock;
  const max   = (typeof stock === 'number' && stock > 0) ? stock : Infinity;
  const next  = Math.max(min, modalQty + delta);
  if (next > max) { showToast(`Solo quedan ${max} disponibles`, 'warn'); return; }
  modalQty = next;
  const el = document.getElementById('modalQtyDisplay');
  if (el) el.textContent = modalQty;
  updateModalSubtotal();
}

function modalAddToCart() {
  if (!modalProduct) return;
  const stock = modalVariant ? modalVariant.stock : modalProduct.stock;
  if (stock === 0) return;
  addCart(modalProduct, modalQty, true, modalVariant);
  const brand = variantLabel(modalVariant);
  showToast(`${modalProduct.name}${brand ? ` (${brand})` : ''} (x${modalQty}) agregado`);
  closeProdModal();
}

function modalOrderWA() {
  if (!modalProduct) return;
  const p     = modalProduct;
  const brand = variantLabel(modalVariant);
  const price = modalVariant ? +modalVariant.price_usd : +p.price_usd;
  const msg   = `📦 Hola JJ Paper, estoy interesado en:\n• ${p.name}${brand ? ` (${brand})` : ''} x${modalQty}\n  Precio: ${fmtPrice(price * modalQty)}\n\n¿Tienen disponibilidad?`;
  openWA(msg);
}

// Close on ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeProdModal();
});

document.addEventListener('DOMContentLoaded', injectProductModal);
