/* ======================================================
   JJ Paper — Ficha Comercial de Venta de Calles (Street Sales)
   Diseño de Alto Impacto para Teléfono Móvil y Presentación al Cliente.
   Enfocado 100% en el producto, precio mayorista en USD y Bs (BCV),
   resolución de fotos con IA, pedido en 1 clic y venta cruzada.
   ====================================================== */

let modalQty     = 1;
let modalProduct = null;
let modalVariant = null;
let modalGallery = [];
let modalImgIdx  = -1;
let _modalUntrap = null;
let _modalFromQr = false;
let _modalScanQuery = '';

function injectProductModal() {
  if (document.getElementById('prodModal')) return;
  const html = `
<div class="modal-overlay" id="prodModal" onclick="closeProdModal(event)">
  <div class="pm-street-box" id="prodModalBox" role="dialog" aria-modal="true" aria-labelledby="prodModalTitle">
    <div class="pm-street-header">
      <div class="pm-street-tag">
        <span class="pm-st-dot"></span>
        <span class="pm-st-title" id="prodModalTitle">JJ PAPER · CATÁLOGO MAYORISTA OFICIAL</span>
      </div>
      <button type="button" class="pm-street-close" onclick="closeProdModal()" aria-label="Cerrar ficha de producto">✕</button>
    </div>
    <div id="prodModalBody"></div>
  </div>
</div>`;
  const placeholder = document.getElementById('prod-modal-placeholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }
}

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

  if (title) title.textContent = 'JJ PAPER · CATÁLOGO MAYORISTA';
  if (body) {
    body.innerHTML = `
      <div style="padding:40px 20px;text-align:center;">
        <div class="spin" style="width:36px;height:36px;margin:0 auto 16px;border-width:3px;border-color:#16604A;border-top-color:transparent;"></div>
        <div style="font-weight:800;font-size:15px;color:#0f172a;margin-bottom:4px;">Cargando Producto de Catálogo...</div>
        <div style="font-size:12px;color:#64748b;">Consultando precios mayoristas y disponibilidad oficial en vivo</div>
      </div>`;
  }
  if (modal) modal.classList.add('op');
  document.body.style.overflow = 'hidden';

  if (_modalUntrap) _modalUntrap();
  _modalUntrap = trapFocus(document.getElementById('prodModalBox'));

  let p = null;
  if (typeof productMap !== 'undefined' && productMap[productId]) {
    p = productMap[productId];
  } else if (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) {
    p = allProducts.find(x => x.id === productId);
  }

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
  const name   = escapeHTML(p.name);
  const unit   = escapeHTML(p.jjp_units?.name || p.unit || 'unid');
  const price  = v ? +v.price_usd : +p.price_usd;
  const stock  = v ? v.stock : p.stock;
  const minQty = Math.max(1, (v?.min_qty ?? p.min_qty) || 1);

  const imgUrl = (modalImgIdx >= 0 && modalGallery[modalImgIdx]) ||
                 v?.image_url || p.image_url;

  const hasOfficialPhoto = Boolean(imgUrl && imgUrl.trim() && !imgUrl.includes('fallback'));

  // Hero Imagen Centrada
  const imgHTML = hasOfficialPhoto
    ? `<img src="${optImg(imgUrl, 800)}" alt="${name}" decoding="async" style="width:100%;height:100%;object-fit:contain;padding:10px;">`
    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;"><span style="font-size:72px;">${p.emoji || '📦'}</span><span style="font-size:11px;font-weight:700;color:#64748b;margin-top:6px;">Fotografía Oficial en Proceso</span></div>`;

  // Miniaturas
  const thumbsHTML = modalGallery.length > 1
    ? `<div class="pm-thumbs" role="group" aria-label="Más imágenes del producto" style="display:flex;gap:8px;margin-top:10px;justify-content:center;flex-wrap:wrap;">
        ${modalGallery.map((u, i) => `
          <button class="pm-thumb${u === imgUrl ? ' on' : ''}"
            onclick="selectModalImg(${i})" aria-label="Ver imagen ${i + 1}" style="width:50px;height:50px;border-radius:8px;overflow:hidden;border:2px solid ${u === imgUrl ? '#16604A' : '#e2e8f0'};background:#fff;cursor:pointer;padding:2px;">
            <img src="${optImg(u, 160)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;">
          </button>`).join('')}
      </div>`
    : '';

  // Bloque para resolución de fotos con IA cuando falta la imagen
  const aiPhotoHtml = !hasOfficialPhoto ? `
    <div class="pm-ai-photo-card" id="pmAiPhotoBox_${p.id}" style="margin-top:10px;padding:10px 14px;background:#f8fafc;border:1.5px dashed #94a3b8;border-radius:10px;text-align:center;width:100%;">
      <div style="font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px;">📷 ¿Deseas ver la foto comercial oficial?</div>
      <button type="button" class="btn-action-primary" style="font-size:11.5px;padding:6px 14px;border-radius:8px;background:#16604A;color:#fff;border:0;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" onclick="pmSearchAiPhoto('${p.id}', '${escapeAttr(p.name)}')">
        <span>🧠</span> Ubicar Foto Real con IA (Fondo Blanco)
      </button>
      <div id="pmAiPhotoFeedback_${p.id}" style="margin-top:6px;font-size:11px;"></div>
    </div>
  ` : '';

  // Stock badge
  let stockBadge;
  if (stock === null || stock === undefined || stock < 0) {
    stockBadge = `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;">✔ Stock Disponible</span>`;
  } else if (stock === 0) {
    stockBadge = `<span style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;">✕ Agotado Temporalmente</span>`;
  } else if (stock <= 5) {
    stockBadge = `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;">⚠ Pocas Unidades</span>`;
  } else {
    stockBadge = `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;">✔ Stock Disponible</span>`;
  }
  const soldOut = stock === 0;

  // Tasa BCV Oficial
  const bcvRate = (typeof getRate === 'function') ? getRate().toFixed(2) : '886.23';

  // Opciones de variantes / marcas
  let variantsHTML = '';
  if (p.variants && p.variants.length > 1) {
    const hasPres = p.variants.some(x => x.variant_name);
    variantsHTML = `
      <div style="background:#f8fafc;padding:10px 12px;border-radius:12px;border:1px solid #e2e8f0;">
        <div style="font-size:11.5px;font-weight:800;color:#475569;margin-bottom:8px;">${hasPres ? 'OPCIONES DISPONIBLES:' : 'MARCAS EN STOCK:'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${p.variants.map(vv => {
            const bName = escapeHTML(vv.jjp_brands?.name || (vv.variant_name ? '' : 'Estándar'));
            const pres  = vv.variant_name ? escapeHTML(vv.variant_name) : '';
            const label = [bName, pres].filter(Boolean).join(' · ');
            const out   = vv.stock === 0;
            const on    = vv.id === v?.id;
            return `<button type="button" style="padding:6px 10px;border-radius:8px;font-size:11px;font-weight:700;border:1.5px solid ${on ? '#16604A' : '#cbd5e1'};background:${on ? '#f0fdf4' : '#fff'};color:${on ? '#16604A' : '#334155'};cursor:pointer;${out ? 'opacity:0.5;' : ''}"
              onclick="selectModalVariant('${vv.id}')">
              ${label} · <b>${fmtPrice(vv.price_usd)}</b>
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  const brandName = v?.jjp_brands?.name || (p.brand_id ? 'Marca Oficial' : '');

  // Renderizar la Ficha Comercial de Venta de Calles
  body.innerHTML = `
    <div class="pm-street-body">
      <!-- HERO: FOTO COMERCIAL CENTRADA -->
      <div class="pm-hero-media">
        <div class="pm-hero-photo-wrap${hasOfficialPhoto ? ' has-photo' : ' empty-photo'}" onclick="${hasOfficialPhoto ? 'openModalImgZoom()' : ''}">
          ${imgHTML}
          ${p.tag ? `<span style="position:absolute;top:10px;left:10px;background:#16604A;color:#fff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;">${escapeHTML(p.tag)}</span>` : ''}
          ${hasOfficialPhoto ? `<span class="pm-zoom-hint">🔍 Toca para ampliar</span>` : ''}
        </div>
        ${thumbsHTML}
        ${aiPhotoHtml}
      </div>

      <!-- INFORMACIÓN DEL PRODUCTO -->
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${_modalFromQr ? `<div class="pm-street-qr-badge">📲 Escaneado de Catálogo Físico Impreso</div>` : ''}

        <div class="pm-street-cat-brand">
          <span class="pm-brand-pill">${escapeHTML(brandName || 'JJ Paper Mayorista')}</span>
          <span class="pm-cat-pill">${escapeHTML(cat.name || 'Papelería')}</span>
          ${stockBadge}
        </div>

        <h1 class="pm-street-prod-title">${name}</h1>

        <!-- CAJA DE PRECIOS MAYORISTA DE CALLE -->
        <div class="pm-street-price-card">
          <div class="pm-spc-top">
            <span class="pm-spc-badge">PRECIO MAYORISTA OFICIAL</span>
            <span class="pm-spc-bcv">BCV Oficial: <b>Bs ${bcvRate} / $</b></span>
          </div>
          <div class="pm-spc-main">
            <div class="pm-spc-usd">${fmtPrice(price)}</div>
            <div class="pm-spc-bs">${fmtBs(price)}</div>
          </div>
          <div class="pm-spc-bottom">
            <span>📦 Empaque: <b>${unit}</b></span>
            ${minQty > 1 ? `<span class="pm-spc-unit-cost">Mínimo: ${minQty} ${unit}</span>` : ''}
          </div>
        </div>

        ${variantsHTML}

        <!-- CONTROLES DE VENTA EN CALLE -->
        <div class="pm-street-actions">
          <div class="pm-street-qty-row">
            <span style="font-size:12px;font-weight:700;color:#475569;">Cantidad a Despachar:</span>
            <div class="pm-street-stepper">
              <button type="button" class="pm-st-qb" onclick="modalChangeQty(-1)" ${soldOut ? 'disabled' : ''}>−</button>
              <span class="pm-st-qn" id="modalQtyDisplay">${modalQty}</span>
              <button type="button" class="pm-st-qb" onclick="modalChangeQty(1)" ${soldOut ? 'disabled' : ''}>+</button>
            </div>
            <div class="pm-street-subtotal" id="modalSubtotal"></div>
          </div>

          <!-- BOTÓN PRINCIPAL FACTURAR / WHATSAPP -->
          <button type="button" class="btn-street-wa" onclick="modalOrderWA()" ${soldOut ? 'disabled' : ''}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.351.226-.652.075s-1.272-.469-2.423-1.496c-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.151-.176.201-.301.301-.502.1-.2.05-.376-.025-.526-.075-.15-.678-1.635-.929-2.241-.244-.59-.492-.51-.678-.52-.176-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376s-1.054 1.029-1.054 2.509c0 1.48 1.079 2.909 1.229 3.11.15.2 2.122 3.24 5.141 4.544.718.31 1.279.495 1.716.634.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/></svg>
            <span>Facturar / Pedir por WhatsApp</span>
          </button>

          <!-- BOTONES SECUNDARIOS -->
          <div class="pm-street-btn-grid">
            <button type="button" class="btn-street-quote" onclick="modalRequestQuote()">
              <span>⚡ Cotizar en Sede</span>
            </button>
            <button type="button" class="btn-street-share" onclick="modalShare()">
              <span>📤 Compartir Ficha</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- SECCIÓN DE VENTA CRUZADA / RELACIONADOS EN CALLE -->
    <div class="pm-street-cross-sell" id="pmRelatedSection_${p.id}">
      <div class="pm-sxs-head">
        <span>🛍️ Complementa este pedido (Misma Categoría):</span>
      </div>
      <div class="pm-sxs-carousel" id="pmRelatedGrid_${p.id}">
        <div style="color:#64748b;font-size:12px;padding:8px;">Cargando productos sugeridos...</div>
      </div>
    </div>
  `;

  updateModalSubtotal();
  loadModalRelatedProducts(p);

  if (_modalFromQr && !hasOfficialPhoto) {
    setTimeout(() => {
      if (typeof window.pmSearchAiPhoto === 'function') {
        window.pmSearchAiPhoto(p.id, p.name, true);
      }
    }, 300);
  }
}

async function loadModalRelatedProducts(p) {
  const container = document.getElementById('pmRelatedGrid_' + p.id);
  if (!container) return;

  let related = [];
  if (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) {
    related = allProducts.filter(x => x.category_id === p.category_id && x.id !== p.id).slice(0, 5);
  }
  if (!related.length && typeof sb !== 'undefined') {
    try {
      const vSelect = typeof VARIANTS_SELECT !== 'undefined' ? VARIANTS_SELECT : 'jjp_product_variants(*)';
      const { data } = await sb.from('jjp_products')
        .select(`id,category_id,name,price_usd,image_url,emoji,unit,stock,min_qty,jjp_categories(name,slug,color),${vSelect}`)
        .eq('category_id', p.category_id)
        .neq('id', p.id)
        .eq('active', true)
        .limit(5);
      if (data && data.length) {
        related = data.map(normalizeProduct);
      }
    } catch (_) {}
  }

  if (!related.length) {
    container.innerHTML = '<div style="color:#64748b;font-size:11.5px;padding:6px;">No hay más productos sugeridos en esta categoría.</div>';
    return;
  }

  container.innerHTML = related.map(rp => {
    const rImg = rp.image_url
      ? `<img src="${optImg(rp.image_url, 180)}" alt="${escapeHTML(rp.name)}" style="width:100%;height:80px;object-fit:contain;background:#fff;border-radius:6px;margin-bottom:4px;">`
      : `<div style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;background:#f8fafc;border-radius:6px;font-size:28px;margin-bottom:4px;">${rp.emoji || '📦'}</div>`;
    const rPrice = rp._minPrice || rp.price_usd || 0;
    return `
      <div class="pm-sxs-card" onclick="openProductModal('${rp.id}', { fromQr: false })" title="Ver ${escapeHTML(rp.name)}">
        <div>
          ${rImg}
          <div style="font-size:11px;font-weight:700;color:#0f172a;line-height:1.2;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHTML(rp.name)}</div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:900;color:#065f46;">${fmtPrice(rPrice)}</div>
          <div style="font-size:10px;color:#166534;font-weight:600;">${fmtBs(rPrice)}</div>
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
  el.innerHTML = `Total: <b>${fmtPrice(sub)}</b> <span style="color:#166534;font-size:11px;">(${fmtBs(sub)})</span>`;
}

function closeProdModal(e) {
  if (e && e.target !== document.getElementById('prodModal')) return;
  const m = document.getElementById('prodModal');
  if (m) m.classList.remove('op');
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
  if (next > max) { showToast('Cantidad máxima en stock alcanzada', 'warn'); return; }
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
  const bcvRate = (typeof getRate === 'function') ? getRate().toFixed(2) : '886.23';

  let msg = _modalFromQr
    ? `📦 *Hola JJ Paper, estoy escaneando este producto del Catálogo Impreso (Venta de Calle):*\n\n`
    : `📦 *Hola JJ Paper, deseo facturar este producto mayorista:*\n\n`;

  msg += `• *Producto:* ${p.name}${brand ? ` (${brand})` : ''}\n` +
         (modalVariant?.sku || p.sku ? `• *SKU:* ${modalVariant?.sku || p.sku}\n` : '') +
         `• *Cantidad:* ${modalQty} ${unit}\n` +
         `• *Precio:* ${fmtPrice(subUsd)} · ${subBs}\n` +
         `• *Tasa Oficial BCV:* Bs ${bcvRate} / $\n` +
         `• *Ficha Oficial:* ${prodUrl}\n`;

  if (imgUrl && imgUrl.trim()) {
    msg += `• *Foto de producto:* ${imgUrl}\n`;
  }

  msg += `\n¿Tienen disponibilidad para despacho inmediato?`;
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
  const bcvRate = (typeof getRate === 'function') ? getRate().toFixed(2) : '886.23';

  const quoteMsg = `📋 *SOLICITUD DE COTIZACIÓN COMERCIAL*\n\n` +
                   `Estimado equipo de JJ Paper, solicito presupuesto para despacho:\n\n` +
                   `• *Producto:* ${p.name}${brand ? ` (${brand})` : ''}\n` +
                   `• *Cantidad:* ${modalQty} ${unit}\n` +
                   `• *Monto Estimado:* ${fmtPrice(subUsd)} (${subBs})\n` +
                   `• *Tasa BCV:* Bs ${bcvRate} / $\n` +
                   `• *Ficha:* ${prodUrl}\n\n` +
                   `Por favor indicar disponibilidad para entrega en sede.`;

  openWA(quoteMsg);
  showToast('Abriendo cotizador directo por WhatsApp... 💬', 'ok');
}

function modalShare() {
  if (!modalProduct) return;
  const url = `${location.origin}/producto.html?id=${encodeURIComponent(modalProduct.id)}`;
  if (navigator.share) {
    navigator.share({ title: modalProduct.name, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast('Enlace de ficha copiado al portapapeles 🔗'));
  } else {
    prompt('Copia el enlace para compartir:', url);
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
    <p class="ilb-hint">Toca para cerrar · Pellizca para zoom</p>`;
  document.body.appendChild(lb);

  const stage = lb.querySelector('.ilb-stage');
  const img   = lb.querySelector('#ilbImg');
  lb.querySelector('.ilb-close').addEventListener('click', closeImgLightbox);
  stage.addEventListener('click', e => { if (e.target === stage) closeImgLightbox(); });
  img.addEventListener('dblclick', () => stage.classList.toggle('zoomed'));
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
    fb.innerHTML = '<div style="color:#16604A;font-weight:700;">🧠 Buscando fotografía comercial real sobre fondo blanco...</div>';
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
        <div style="background:#fff;border:1.5px solid #10b981;border-radius:10px;padding:10px;margin-top:6px;box-shadow:0 2px 6px rgba(0,0,0,0.05);">
          <div style="font-size:11px;color:#166534;font-weight:800;margin-bottom:6px;">✅ Fotografía Comercial Oficial (Fondo Blanco)</div>
          <img src="${photoUrl}" alt="${productName}" style="width:130px;height:130px;object-fit:contain;margin:0 auto;display:block;border-radius:6px;background:#fff;">
          <button type="button" class="btn-action-primary" style="margin-top:8px;font-size:12px;padding:8px 12px;border-radius:8px;width:100%;font-weight:800;background:#16604A;color:#fff;border:0;cursor:pointer;" onclick="pmSaveOfficialPhoto('${productId}', '${photoUrl}')">
            💾 Guardar Foto Oficial en Catálogo JJ Paper
          </button>
        </div>
      `;
      if (typeof showToast === 'function') {
        showToast('📸 Foto comercial ubicada con éxito');
      }
    } else {
      if (fb) fb.innerHTML = '<div style="color:#b91c1c;padding:4px;">Foto en proceso de catálogo. Puedes asignar una imagen desde el panel.</div>';
    }
  } catch (e) {
    if (fb) fb.innerHTML = `<div style="color:#b91c1c;padding:4px;">Error: ${e.message}</div>`;
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
