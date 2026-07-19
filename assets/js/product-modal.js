/* ======================================================
   JJ Paper — Product Detail Modal
   Con selector de marca (variantes): cada marca tiene su
   propio precio y stock.
   ====================================================== */

let modalQty     = 1;
let modalProduct = null;
let modalVariant = null;
let modalGallery = [];    // urls de la galería (producto + variantes)
let modalImgIdx  = -1;    // miniatura elegida (-1 = imagen de la variante)
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
  // Galería: imagen del producto + imágenes propias de cada variante (sin repetir)
  modalGallery = [...new Set([p.image_url, ...p.variants.map(x => x.image_url)].filter(Boolean))];
  modalImgIdx  = -1;

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
  // Imagen mostrada: miniatura elegida > imagen de la variante > imagen del producto
  const imgUrl = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) ||
                 v?.image_url || p.image_url;

  const imgHTML = imgUrl
    ? `<img src="${optImg(imgUrl, 800)}" alt="${name}" decoding="async">`
    : `<span style="font-size:90px">${p.emoji || '📦'}</span>`;

  // Miniaturas (solo si hay más de una imagen distinta)
  const thumbsHTML = modalGallery.length > 1
    ? `<div class="pm-thumbs" role="group" aria-label="Más imágenes del producto">
        ${modalGallery.map((u, i) => `
          <button class="pm-thumb${u === imgUrl ? ' on' : ''}"
            onclick="selectModalImg(${i})" aria-label="Ver imagen ${i + 1}">
            <img src="${optImg(u, 160)}" alt="" loading="lazy" decoding="async">
          </button>`).join('')}
      </div>`
    : '';

  // Stock badge (de la variante seleccionada).
  // Semáforo, nunca la cantidad exacta: el stock real es información
  // interna (la competencia deduce rotación y proveedor con ella). El
  // tope de compra sí respeta el stock — ver modalChangeQty.
  let stockHTML;
  if (stock === null || stock === undefined || stock < 0) {
    stockHTML = `<span class="pm-stock ok">✔ Disponible</span>`;
  } else if (stock === 0) {
    stockHTML = `<span class="pm-stock out">✕ Agotado</span>`;
  } else if (stock <= 5) {
    stockHTML = `<span class="pm-stock low">⚠ Pocas unidades</span>`;
  } else {
    stockHTML = `<span class="pm-stock ok">✔ Disponible</span>`;
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
  // El SKU no se muestra al público: es el código con el que compramos.
  // Sigue siendo buscable — catalog.js indexa p._skus sin pintarlo.
  if (minQty > 1) metaBits.push(`<span class="pm-meta-i"><b>Mínimo:</b> ${minQty} ${unit}</span>`);

  body.innerHTML = `
<div class="prod-modal-grid">
  <div class="pm-media">
    <div class="prod-modal-img${imgUrl ? ' zoomable has-img' : ''}" style="background:${bg}" ${imgUrl ? 'onclick="openModalImgZoom()"' : ''}>
      ${imgHTML}
      ${p.tag ? `<span class="pm-tag">${escapeHTML(p.tag)}</span>` : ''}
      ${imgUrl ? `<button class="pm-zoom-btn" onclick="event.stopPropagation();openModalImgZoom()" aria-label="Ver imagen completa de ${name}">🔍 Ampliar</button>` : ''}
    </div>
    ${thumbsHTML}
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
      <div class="pm-act-grid">
        <button class="pm-buy" onclick="modalBuyNow()" ${soldOut?'disabled':''}>
          ⚡ Comprar ahora
        </button>
        <button class="prod-modal-add" onclick="modalAddToCart()" ${soldOut?'disabled':''}>
          ${soldOut ? 'Agotado' : '🛒 Agregar al carrito'}
        </button>
        <button class="pm-quote" onclick="modalQuoteWS()">
          📋 Cotizar al mayor
        </button>
        <button class="btn-wa" onclick="modalOrderWA()">
          💬 Consultar
        </button>
      </div>
      <div class="pm-links">
        <a class="pm-link" href="producto.html?id=${p.id}">📄 Ver ficha completa →</a>
        <button class="pm-link" onclick="modalShare()">🔗 Compartir</button>
      </div>
    </div>
  </div>
</div>`;

  updateModalSubtotal();
}

// Cambia la imagen mostrada desde las miniaturas (sin resetear variante/cantidad)
function selectModalImg(i) {
  if (!modalGallery[i]) return;
  modalImgIdx = i;
  renderModalBody();
}

function selectModalVariant(variantId) {
  const v = modalProduct?.variants.find(x => x.id === variantId);
  if (!v) return;
  modalVariant = v;
  modalImgIdx  = -1;   // vuelve a la imagen propia de la variante
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
  // Limita sin revelar el stock: el tope existe, el número no se dice.
  if (next > max) { showToast('Cantidad máxima disponible alcanzada', 'warn'); return; }
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

// Compra directa: agrega al carrito y va al checkout en un paso
function modalBuyNow() {
  if (!modalProduct) return;
  const stock = modalVariant ? modalVariant.stock : modalProduct.stock;
  if (stock === 0) return;
  addCart(modalProduct, modalQty, true, modalVariant);
  window.location.href = 'checkout.html';
}

// Cotización al mayor: abre pedidos.html con el producto prellenado
function modalQuoteWS() {
  if (!modalProduct) return;
  const qs = new URLSearchParams({ prod: modalProduct.name, qty: modalQty });
  window.location.href = `pedidos.html?${qs}`;
}

// Compartir: enlace a la ficha del producto (share nativo o copiar)
function modalShare() {
  if (!modalProduct) return;
  const url = new URL(`producto.html?id=${modalProduct.id}`, location.href).href;
  if (navigator.share) {
    navigator.share({ title: modalProduct.name, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado 🔗'));
  } else {
    prompt('Copia el enlace:', url);
  }
}

/* ======================================================
   Lightbox de imagen: vista completa a pantalla con zoom
   (doble toque / doble click alterna acercamiento).
   ====================================================== */
let _ilbUntrap = null;

function ensureImgLightbox() {
  if (document.getElementById('imgLightbox')) return;
  const lb = document.createElement('div');
  lb.id = 'imgLightbox';
  lb.className = 'img-lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Vista ampliada de la imagen del producto');
  lb.innerHTML = `
    <button class="ilb-close" aria-label="Cerrar vista ampliada">✕</button>
    <div class="ilb-stage"><img id="ilbImg" alt="" decoding="async"></div>
    <p class="ilb-hint">Doble toque para acercar · pellizca para zoom</p>`;
  document.body.appendChild(lb);

  const stage = lb.querySelector('.ilb-stage');
  const img   = lb.querySelector('#ilbImg');
  lb.querySelector('.ilb-close').addEventListener('click', closeImgLightbox);
  stage.addEventListener('click', e => { if (e.target === stage) closeImgLightbox(); });
  img.addEventListener('dblclick', () => stage.classList.toggle('zoomed'));
  // Doble toque en táctil (dblclick no siempre dispara en mobile)
  let lastTap = 0;
  img.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 320) { e.preventDefault(); stage.classList.toggle('zoomed'); }
    lastTap = now;
  });
}

function openImgLightbox(url, alt) {
  if (!url) return;
  ensureImgLightbox();
  const lb    = document.getElementById('imgLightbox');
  const stage = lb.querySelector('.ilb-stage');
  const img   = document.getElementById('ilbImg');
  stage.classList.remove('zoomed');
  img.src = encodeURI(url);
  img.alt = alt || 'Imagen del producto';
  lb.classList.add('op');
  document.body.style.overflow = 'hidden';
  if (_ilbUntrap) _ilbUntrap();
  _ilbUntrap = trapFocus(lb);
}

// Devuelve true si el lightbox estaba abierto (para encadenar con ESC)
function closeImgLightbox() {
  const lb = document.getElementById('imgLightbox');
  if (!lb?.classList.contains('op')) return false;
  lb.classList.remove('op');
  // Si el modal de producto sigue abierto, el body debe seguir sin scroll
  const modalOpen = document.getElementById('prodModal')?.classList.contains('op');
  document.body.style.overflow = modalOpen ? 'hidden' : '';
  if (_ilbUntrap) { _ilbUntrap(); _ilbUntrap = null; }
  return true;
}

// Abre el lightbox con la imagen visible (miniatura elegida > variante > producto)
function openModalImgZoom() {
  const url = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) ||
              modalVariant?.image_url || modalProduct?.image_url;
  if (url) openImgLightbox(url, modalProduct?.name);
}

// Close on ESC (el lightbox tiene prioridad sobre el modal)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (closeImgLightbox()) return;
  closeProdModal();
});

document.addEventListener('DOMContentLoaded', injectProductModal);
