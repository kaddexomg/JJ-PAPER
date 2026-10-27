/* ======================================================
   JJ Paper — Product Detail Modal (Ficha Técnica Oficial)
   Con selector de marca (variantes), resolución de fotos con IA,
   interceptor de QR físico y productos relacionados.
   ====================================================== */

let modalQty     = 1;
let modalProduct = null;
let modalVariant = null;
let modalGallery = [];    // urls de la galería (producto + variantes)
let modalImgIdx  = -1;    // miniatura elegida (-1 = imagen de la variante)
let _modalUntrap = null;
let _modalFromQr = false;
let _modalScanQuery = '';

function injectProductModal() {
  if (document.getElementById('prodModal')) return;
  const html = `
<div class="modal-overlay" id="prodModal" onclick="closeProdModal(event)">
  <div class="modal-box" id="prodModalBox" role="dialog" aria-modal="true" aria-labelledby="prodModalTitle">
    <div class="modal-hd">
      <h3 id="prodModalTitle">Ficha Técnica Oficial del Producto</h3>
      <button class="modal-close" onclick="closeProdModal()" aria-label="Cerrar detalle del producto">✕</button>
    </div>
    <div class="modal-body" id="prodModalBody"></div>
  </div>
</div>`;
  const placeholder = document.getElementById('prod-modal-placeholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }
}

// Auto-inyección inmediata si el DOM ya está listo
if (typeof document !== 'undefined') {
  if (document.readyState !== 'loading') {
    injectProductModal();
  } else {
    document.addEventListener('DOMContentLoaded', injectProductModal);
  }
}

async function openProductModal(productId, opts = {}) {
  injectProductModal();
  const qp = new URLSearchParams(location.search);
  _modalFromQr = Boolean(opts?.fromQr || qp.get('buscar') || qp.get('from_qr') || qp.get('qr') === '1' || window.__IS_FROM_PHYSICAL_QR__);
  _modalScanQuery = opts?.searchQuery || qp.get('buscar') || window.__QR_TARGET__ || '';

  const modal = document.getElementById('prodModal');
  const body  = document.getElementById('prodModalBody');
  const title = document.getElementById('prodModalTitle');

  // Mostrar de inmediato estado de carga
  if (title) title.textContent = 'Cargando producto...';
  if (body)  body.innerHTML = `<div class="cat-loading"><div class="spin"></div>Cargando Ficha Técnica Oficial...</div>`;
  if (modal) modal.classList.add('op');
  document.body.style.overflow = 'hidden';

  if (_modalUntrap) _modalUntrap();
  _modalUntrap = trapFocus(document.getElementById('prodModalBox'));

  // Obtener producto de caché local o base de datos
  let p = null;
  if (typeof productMap !== 'undefined' && productMap[productId]) {
    p = productMap[productId];
  } else if (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) {
    p = allProducts.find(x => x.id === productId);
  }

  // Consulta detallada a PostgREST para asegurar variantes frescas
  if (typeof sb !== 'undefined') {
    try {
      const vSelect = typeof VARIANTS_SELECT !== 'undefined' ? VARIANTS_SELECT : 'jjp_product_variants(*)';
      const { data } = await sb.from('jjp_products')
        .select(`id,category_id,name,description,price_usd,unit,image_url,emoji,tag,active,featured,sort_order,brand_id,unit_id,sku,stock,min_qty,jjp_categories(name,slug,color),jjp_units(name,abbr),${vSelect}`)
        .eq('id', productId)
        .single();
      if (data) p = normalizeProduct(data);
    } catch (e) {
      console.warn('DB fetch in modal warning:', e);
    }
  }

  if (!p) { closeProdModal(); return; }
  if (p._minPrice === undefined && typeof normalizeProduct === 'function') normalizeProduct(p);

  modalProduct = p;
  modalVariant = (p.variants && p.variants.find(v => v.stock !== 0)) || (p.variants && p.variants[0]) || null;
  modalQty = Math.max(1, (modalVariant?.min_qty ?? p.min_qty) || 1);
  modalGallery = [...new Set([p.image_url, ...(p.variants || []).map(x => x.image_url)].filter(Boolean))];
  modalImgIdx  = -1;

  if (title) title.textContent = p.name;
  renderModalBody();
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  const imgUrl = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) ||
                 v?.image_url || p.image_url;

  const hasOfficialPhoto = Boolean(imgUrl && imgUrl.trim() && !imgUrl.includes('fallback'));

  const imgHTML = hasOfficialPhoto
    ? `<img src="${optImg(imgUrl, 800)}" alt="${name}" decoding="async">`
    : `<span style="font-size:90px">${p.emoji || '📦'}</span>`;

  // Miniaturas
  const thumbsHTML = modalGallery.length > 1
    ? `<div class="pm-thumbs" role="group" aria-label="Más imágenes del producto">
        ${modalGallery.map((u, i) => `
          <button class="pm-thumb${u === imgUrl ? ' on' : ''}"
            onclick="selectModalImg(${i})" aria-label="Ver imagen ${i + 1}">
            <img src="${optImg(u, 160)}" alt="" loading="lazy" decoding="async">
          </button>`).join('')}
      </div>`
    : '';

  // Bloque para resolución de fotos con IA cuando falta la imagen
  const aiPhotoHtml = !hasOfficialPhoto ? `
    <div class="pm-ai-photo-card" id="pmAiPhotoBox_${p.id}" style="margin-top:12px;padding:12px;background:#f8fafc;border:1.5px dashed #94a3b8;border-radius:10px;text-align:center">
      <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px">📷 Este artículo no cuenta con fotografía oficial</div>
      <button type="button" class="btn-action-primary" style="font-size:12px;padding:8px 14px;border-radius:6px;background:#16604A;color:#fff;border:0;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px" onclick="pmSearchAiPhoto('${p.id}', '${escapeAttr(p.name)}')">
        <span>🧠</span> Buscar Foto Real con IA (Fondo Blanco)
      </button>
      <div id="pmAiPhotoFeedback_${p.id}" style="margin-top:8px;font-size:11px"></div>
    </div>
  ` : '';

  // Stock badge
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

  // Selector de marca / variante
  let variantsHTML = '';
  if (p.variants && p.variants.length > 1) {
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
  if (p.variants && p.variants.length <= 1 && brandName)
    metaBits.push(`<span class="pm-meta-i"><b>Marca:</b> ${v.jjp_brands.logo_url ? `<img class="pm-brand-logo" src="${escapeHTML(v.jjp_brands.logo_url)}" alt="${escapeHTML(brandName)}" loading="lazy"> ` : ''}${escapeHTML(brandName)}</span>`);
  if (p.variants && p.variants.length <= 1 && v?.variant_name)
    metaBits.push(`<span class="pm-meta-i"><b>Presentación:</b> ${escapeHTML(v.variant_name)}</span>`);
  if (minQty > 1) metaBits.push(`<span class="pm-meta-i"><b>Mínimo:</b> ${minQty} ${unit}</span>`);

  body.innerHTML = `
<div class="prod-modal-grid">
  <div class="pm-media">
    <div class="prod-modal-img${hasOfficialPhoto ? ' zoomable has-img' : ''}" style="background:${bg}" ${hasOfficialPhoto ? 'onclick="openModalImgZoom()"' : ''}>
      ${imgHTML}
      ${p.tag ? `<span class="pm-tag">${escapeHTML(p.tag)}</span>` : ''}
      ${hasOfficialPhoto ? `<button class="pm-zoom-btn" onclick="event.stopPropagation();openModalImgZoom()" aria-label="Ver imagen completa de ${name}">🔍 Ampliar</button>` : ''}
    </div>
    ${thumbsHTML}
    ${aiPhotoHtml}
  </div>
  <div class="prod-modal-info">
    ${_modalFromQr ? `<div class="pm-qr-badge" style="display:inline-flex;align-items:center;gap:6px;background:#e8f5e9;color:#16604a;border:1.5px solid #a5d6a7;padding:5px 12px;border-radius:20px;font-size:11.5px;font-weight:800;margin-bottom:8px">📲 Escaneado desde el Catálogo Físico Impreso</div>` : ''}
    <div class="prod-modal-cat">${escapeHTML(cat.name || '')}</div>
    <h2 class="prod-modal-name">${name}</h2>
    ${stockHTML}
    <p class="prod-modal-desc">${escapeHTML(p.description || 'Artículo oficial de papelería y suministros JJ Paper.')}</p>
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
      <div class="pm-act-grid">
        <button class="btn-wa" onclick="modalOrderWA()" ${soldOut?'disabled':''} style="grid-column:1/-1;padding:14px;font-size:15px;font-weight:800">
          💬 Consultar y Pedir por WhatsApp
        </button>
        <button class="pm-quote" onclick="modalRequestQuote()" style="display:flex;align-items:center;justify-content:center;gap:6px;background:#065f46;color:#fff;border-color:#065f46;font-weight:700">
          ⚡ Cotizar este Producto
        </button>
        <button class="pm-quote" onclick="modalShare()" style="display:flex;align-items:center;justify-content:center;gap:6px">
          📋 Compartir Ficha
        </button>
        <a href="producto.html?id=${p.id}" class="pm-quote" style="display:flex;align-items:center;justify-content:center;gap:6px;grid-column:1/-1;text-decoration:none;background:#f0f7f3;color:#16604A;border:1.5px solid #c2dbcd;font-weight:700;padding:10px">
          🌐 Ver Ficha Web Completa →
        </a>
      </div>
    </div>
  </div>
</div>

<div class="pm-related-section" id="pmRelatedSection_${p.id}" style="margin-top:22px;border-top:1px solid #e2e8f0;padding-top:15px">
  <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:12px;display:flex;align-items:center;gap:6px">
    <span>✨ Productos Relacionados (${escapeHTML(cat.name || 'de la misma categoría')})</span>
  </div>
  <div class="pm-related-grid" id="pmRelatedGrid_${p.id}" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:10px">
    <div style="color:#64748b;font-size:12px">Cargando productos relacionados...</div>
  </div>
</div>
`;

  updateModalSubtotal();
  loadModalRelatedProducts(p);

  // Si proviene de escaneo QR y no tiene foto, disparar búsqueda automática de foto
  if (_modalFromQr && !hasOfficialPhoto) {
    setTimeout(() => {
      if (typeof window.pmSearchAiPhoto === 'function') {
        window.pmSearchAiPhoto(p.id, p.name, true);
      }
    }, 400);
  }
}

// Carga de productos relacionados dentro de la misma categoría
async function loadModalRelatedProducts(p) {
  const container = document.getElementById('pmRelatedGrid_' + p.id);
  if (!container) return;

  let related = [];
  if (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) {
    related = allProducts.filter(x => x.category_id === p.category_id && x.id !== p.id).slice(0, 4);
  }
  if (!related.length && typeof sb !== 'undefined') {
    try {
      const vSelect = typeof VARIANTS_SELECT !== 'undefined' ? VARIANTS_SELECT : 'jjp_product_variants(*)';
      const { data } = await sb.from('jjp_products')
        .select(`id,category_id,name,price_usd,image_url,emoji,unit,stock,min_qty,jjp_categories(name,slug,color),${vSelect}`)
        .eq('category_id', p.category_id)
        .neq('id', p.id)
        .eq('active', true)
        .limit(4);
      if (data && data.length) {
        related = data.map(normalizeProduct);
      }
    } catch (_) {}
  }

  if (!related.length) {
    container.innerHTML = '<div style="color:#64748b;font-size:11.5px;grid-column:1/-1">No hay más productos en esta categoría por ahora.</div>';
    return;
  }

  container.innerHTML = related.map(rp => {
    const rImg = rp.image_url
      ? `<img src="${optImg(rp.image_url, 200)}" alt="${escapeHTML(rp.name)}" style="width:100%;height:85px;object-fit:contain;border-radius:6px;background:#f8fafc;margin-bottom:6px">`
      : `<div style="width:100%;height:85px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;border-radius:6px;font-size:32px;margin-bottom:6px">${rp.emoji || '📦'}</div>`;
    const rPrice = rp._minPrice || rp.price_usd || 0;
    return `
      <div class="pm-related-card" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;transition:transform 0.15s,box-shadow 0.15s" onclick="openProductModal('${rp.id}', { fromQr: false })" title="Ver ${escapeHTML(rp.name)}">
        <div>
          ${rImg}
          <div style="font-size:11px;font-weight:700;color:#1e293b;line-height:1.25;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHTML(rp.name)}</div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:800;color:#16604a">${fmtPrice(rPrice)}</div>
          <div style="font-size:10px;color:#64748b">${fmtBs(rPrice)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function selectModalImg(i) {
  if (!modalGallery[i]) return;
  modalImgIdx = i;
  renderModalBody();
}

function selectModalVariant(variantId) {
  const v = modalProduct?.variants.find(x => x.id === variantId);
  if (!v) return;
  modalVariant = v;
  modalImgIdx  = -1;
  modalQty = Math.max(1, (v.min_qty ?? modalProduct.min_qty) || 1);
  renderModalBody();
}

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
  if (_modalUntrap) { _modalUntrap(); _modalUntrap = null; }
}

function modalChangeQty(delta) {
  const min   = Math.max(1, (modalVariant?.min_qty ?? modalProduct?.min_qty) || 1);
  const stock = modalVariant ? modalVariant.stock : modalProduct?.stock;
  const max   = (typeof stock === 'number' && stock > 0) ? stock : Infinity;
  const next  = Math.max(min, modalQty + delta);
  if (next > max) { showToast('Cantidad máxima disponible alcanzada', 'warn'); return; }
  modalQty = next;
  const el = document.getElementById('modalQtyDisplay');
  if (el) el.textContent = modalQty;
  updateModalSubtotal();
}

function modalOrderWA() {
  if (!modalProduct) return;
  const p     = modalProduct;
  const brand = (typeof variantLabel === 'function' && modalVariant) ? variantLabel(modalVariant) : '';
  const price = modalVariant ? +modalVariant.price_usd : +p.price_usd;
  const unit  = escapeHTML(p.jjp_units?.name || p.unit || 'unid');
  const subUsd = price * modalQty;
  const subBs  = fmtBs(subUsd);
  const prodUrl = `${location.origin}/producto.html?id=${encodeURIComponent(p.id)}`;
  const imgUrl = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) || modalVariant?.image_url || p.image_url;

  let msg = _modalFromQr
    ? `📦 *Hola JJ Paper, estoy escaneando este producto del Catálogo Impreso:*

`
    : `📦 *Hola JJ Paper, me interesa este producto:*

`;

  msg += `• *Producto:* ${p.name}${brand ? ` (${brand})` : ''}
` +
         (modalVariant?.sku || p.sku ? `• *Código/SKU:* ${modalVariant?.sku || p.sku}
` : '') +
         `• *Cantidad:* ${modalQty} ${unit}
` +
         `• *Precio:* ${fmtPrice(subUsd)} · ${subBs}
` +
         `• *Ficha Oficial:* ${prodUrl}
`;

  if (imgUrl && imgUrl.trim()) {
    msg += `• *Foto oficial:* ${imgUrl}
`;
  }

  msg += `
¿Tienen disponibilidad para despacho?`;
  openWA(msg);
}

function modalRequestQuote() {
  if (!modalProduct) return;
  const p = modalProduct;
  const brand = (typeof variantLabel === 'function' && modalVariant) ? variantLabel(modalVariant) : '';
  const price = modalVariant ? +modalVariant.price_usd : +p.price_usd;
  const unit  = p.jjp_units?.name || p.unit || 'unid';
  const subUsd = price * modalQty;
  const subBs  = fmtBs(subUsd);
  const prodUrl = `${location.origin}/producto.html?id=${encodeURIComponent(p.id)}`;

  const quoteMsg = `📋 *SOLICITUD DE COTIZACIÓN FORMAL*

` +
                   `Estimado equipo de JJ Paper, solicito presupuesto para:

` +
                   `• *Producto:* ${p.name}${brand ? ` (${brand})` : ''}
` +
                   (modalVariant?.sku || p.sku ? `• *SKU / Ref:* ${modalVariant?.sku || p.sku}
` : '') +
                   `• *Cantidad requerida:* ${modalQty} ${unit}
` +
                   `• *Monto estimado:* ${fmtPrice(subUsd)} (${subBs})
` +
                   `• *Ficha del producto:* ${prodUrl}

` +
                   `Por favor enviar cotización membretada con vigencia y condiciones de despacho a sede.`;

  openWA(quoteMsg);
  showToast('Abriendo cotizador directo por WhatsApp... 💬', 'ok');
}

function modalShare() {
  if (!modalProduct) return;
  const url = `${location.origin}/producto.html?id=${encodeURIComponent(modalProduct.id)}`;
  if (navigator.share) {
    navigator.share({ title: modalProduct.name, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado al portapapeles 🔗'));
  } else {
    prompt('Copia el enlace:', url);
  }
}

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

function closeImgLightbox() {
  const lb = document.getElementById('imgLightbox');
  if (!lb?.classList.contains('op')) return false;
  lb.classList.remove('op');
  const modalOpen = document.getElementById('prodModal')?.classList.contains('op');
  document.body.style.overflow = modalOpen ? 'hidden' : '';
  if (_ilbUntrap) { _ilbUntrap(); _ilbUntrap = null; }
  return true;
}

function openModalImgZoom() {
  const url = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) ||
              modalVariant?.image_url || modalProduct?.image_url;
  if (url) openImgLightbox(url, modalProduct?.name);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (closeImgLightbox()) return;
  closeProdModal();
});

/* ======================================================
   Resolución de Fotos con IA en Catálogo / Ficha Técnica
   ====================================================== */
window.pmSearchAiPhoto = async function(productId, productName, isAuto = false) {
  const box = document.getElementById('pmAiPhotoBox_' + productId);
  const fb = document.getElementById('pmAiPhotoFeedback_' + productId);
  if (!box) return;

  if (fb) {
    fb.innerHTML = '<div style="color:#16604A;font-weight:700">🧠 Buscando fotografía comercial real sobre fondo blanco...</div>';
  }

  try {
    if (!window.GeminiClient) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'assets/js/gemini-client.js?v=20261026_qr_live_v10';
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
      });
    }

    let photoUrl = null;
    if (window.GeminiClient && typeof window.GeminiClient.searchRealProductPhoto === 'function') {
      photoUrl = await window.GeminiClient.searchRealProductPhoto(productName);
    }
    if (!photoUrl && window.GeminiClient && typeof window.GeminiClient.generateProductStudioPhoto === 'function') {
      const gen = await window.GeminiClient.generateProductStudioPhoto({ product: { id: productId, name: productName } });
      photoUrl = gen?.imageUrl;
    }

    if (photoUrl) {
      box.innerHTML = `
        <div style="background:#fff;border:1.5px solid #10b981;border-radius:8px;padding:10px;margin-top:6px;box-shadow:0 2px 6px rgba(0,0,0,0.05)">
          <div style="font-size:11px;color:#166534;font-weight:800;margin-bottom:6px">✅ Fotografía Comercial Real (Fondo Blanco)</div>
          <img src="${photoUrl}" alt="${productName}" style="width:140px;height:140px;object-fit:contain;margin:0 auto;display:block;border-radius:6px;background:#fff">
          <button type="button" class="btn-action-primary" style="margin-top:10px;font-size:12px;padding:8px 12px;border-radius:6px;width:100%;font-weight:800;background:#16604A;color:#fff;border:0;cursor:pointer" onclick="pmSaveOfficialPhoto('${productId}', '${photoUrl}')">
            💾 Guardar Foto Oficial en Catálogo JJ Paper
          </button>
        </div>
      `;
      if (typeof showToast === 'function') {
        showToast('📸 Foto comercial ubicada con éxito');
      }
    } else {
      if (fb) fb.innerHTML = '<div style="color:#b91c1c;padding:4px">No se ubicó foto web directa. Puedes asignar una imagen desde el panel.</div>';
    }
  } catch (e) {
    if (fb) fb.innerHTML = `<div style="color:#b91c1c;padding:4px">Error: ${e.message}</div>`;
  }
};

window.pmSaveOfficialPhoto = async function(productId, photoUrl) {
  try {
    const { error } = await sb.from('jjp_products').update({ image_url: photoUrl }).eq('id', productId);
    if (error) throw error;
    if (modalProduct && modalProduct.id === productId) {
      modalProduct.image_url = photoUrl;
      modalGallery = [photoUrl];
      renderModalBody();
    }
    if (typeof showToast === 'function') {
      showToast('✅ Foto guardada oficialmente en el catálogo de JJ Paper', 'success');
    }
  } catch (err) {
    alert('Error guardando imagen: ' + err.message);
  }
};
