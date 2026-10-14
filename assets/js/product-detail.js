/* ======================================================
   JJ Paper — Product Detail Controller (producto.html)
   Carga instantánea, selector interactivo de variantes,
   galería fluida con soporte táctil y teclado,
   cálculo de tasa oficial en vivo y puente a WhatsApp/Cotización.
   ====================================================== */

let currentProduct = null;
let currentVariant = null;
let currentQty = 1;
let galleryImages = [];
let activeImgIndex = 0;
let relatedProducts = [];

const VARIANTS_SELECT = 'jjp_product_variants(id,brand_id,variant_name,sku,price_usd,price_a,price_b,price_c_bs,price_d_bs,stock,min_qty,image_url,active,sort_order,jjp_brands(name,logo_url))';

// Inicialización al cargar el DOM
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (typeof injectNav === 'function') injectNav('catalogo');
    if (typeof injectFooter === 'function') injectFooter();
  } catch (e) {
    console.warn('Nav/Footer warning:', e);
  }

  // Asegurar tasa de cambio actualizada
  if (typeof updateExchangeRate === 'function') {
    try { await updateExchangeRate(); } catch (_) {}
  }

  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');
  const productSku = params.get('sku');

  if (!productId && !productSku) {
    renderNotFound('No se especificó ningún producto.');
    return;
  }

  await loadProductData(productId, productSku);
  setupKeyboardNavigation();
});

// Carga de producto desde Supabase
async function loadProductData(id, sku) {
  const container = document.getElementById('productApp');
  if (!container) return;

  try {
    let query = sb.from('jjp_products')
      .select(`id,category_id,name,description,price_usd,price_a,price_b,price_c_bs,price_d_bs,unit,image_url,emoji,tag,active,featured,stock,min_qty,sku,jjp_categories(name,slug,color),jjp_units(name,abbr),${VARIANTS_SELECT}`);

    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('sku', sku);
    }

    const { data, error } = await query.single();
    if (error || !data) {
      renderNotFound('El producto solicitado no fue encontrado o está inactivo.');
      return;
    }

    normalizeProductDetails(data);
    currentProduct = data;

    // Variante por defecto: primera con stock, o primera activa
    currentVariant = currentProduct.variants.find(v => v.stock !== 0) || currentProduct.variants[0] || null;
    currentQty = Math.max(1, (currentVariant?.min_qty ?? currentProduct.min_qty) || 1);

    // Preparar galería (fotos de producto + fotos de variantes sin duplicados)
    const imgs = [currentProduct.image_url, ...currentProduct.variants.map(v => v.image_url)].filter(Boolean);
    galleryImages = [...new Set(imgs)];
    if (currentVariant?.image_url) {
      const idx = galleryImages.indexOf(currentVariant.image_url);
      activeImgIndex = idx >= 0 ? idx : 0;
    } else {
      activeImgIndex = 0;
    }

    renderProductView();
    updateMetaTags();
    loadRelatedProducts(currentProduct.category_id, currentProduct.id);

  } catch (err) {
    console.error('Error cargando producto:', err);
    renderNotFound('Ocurrió un error al cargar la información del producto.');
  }
}

// Normalización de datos y cálculo de precios
function normalizeProductDetails(p) {
  const vs = (p.jjp_product_variants || [])
    .filter(v => v.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
      || String(a.jjp_brands?.name || '').localeCompare(String(b.jjp_brands?.name || '')));
  p.variants = vs;

  p._brands = [...new Map(
    vs.filter(v => v.jjp_brands?.name).map(v => [v.jjp_brands.name, v.jjp_brands])
  ).values()];

  // Auto-detección de empaque/embalaje por ontología
  p._packaging = detectPackaging(p.name, p.unit, vs);
}

function detectPackaging(name, unit, variants) {
  const txt = (name + ' ' + (unit || '') + ' ' + variants.map(v => v.variant_name || '').join(' ')).toUpperCase();
  if (txt.includes('X12') || txt.includes('X 12') || txt.includes('DOCENA')) return 'Caja de 12 Unidades';
  if (txt.includes('X24') || txt.includes('X 24')) return 'Caja de 24 Unidades';
  if (txt.includes('X36') || txt.includes('X 36')) return 'Caja de 36 Unidades';
  if (txt.includes('X50') || txt.includes('X 50')) return 'Caja / Paq. de 50';
  if (txt.includes('X100') || txt.includes('X 100')) return 'Caja de 100 Unidades';
  if (txt.includes('RESMA')) return 'Resma de 500 Hojas';
  if (txt.includes('BLISTER')) return 'Blister Individual';
  if (txt.includes('BULTO')) return 'Bulto Distribuidor';
  if (txt.includes('ROLLO')) return 'Rollo Individual';
  if (txt.includes('ESTUCHE')) return 'Estuche Protector';
  return unit ? `Por ${unit}` : 'Unidad Mayorista';
}

// Renderizado principal de la vista
function renderProductView() {
  const p = currentProduct;
  const v = currentVariant;
  const cat = p.jjp_categories || { name: 'Papelería', color: '#16604A' };
  const unit = p.jjp_units?.name || p.unit || 'unid';
  
  // Precio activo (variante > base)
  const price = v 
    ? Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : v.price_a || 0))
    : Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : p.price_a || 0));

  const stock = v ? v.stock : p.stock;
  const minQty = Math.max(1, (v?.min_qty ?? p.min_qty) || 1);
  const sku = v?.sku || p.sku || 'JJ-PROD';

  // Stock status text & class
  let stockClass = 'ok';
  let stockText = '✔ Disponible';
  if (stock === 0) {
    stockClass = 'out';
    stockText = '✕ Agotado temporalmente';
  } else if (stock > 0 && stock <= 5) {
    stockClass = 'low';
    stockText = '⚠ Pocas unidades';
  }

  // Imagen activa
  const activeImg = galleryImages[activeImgIndex] || p.image_url || '';

  // Selector de variantes HTML
  let variantsHTML = '';
  if (p.variants.length > 1) {
    variantsHTML = `
      <div class="variants-section">
        <label class="section-label">Marca / Presentación:</label>
        <div class="variants-grid">
          ${p.variants.map((variant, idx) => {
            const isSel = (v && v.id === variant.id);
            const vPrice = Number(variant.price_b != null ? variant.price_b : (variant.price_usd != null ? variant.price_usd : variant.price_a || 0));
            const brandName = variant.jjp_brands?.name || 'JJ Paper';
            const vLabel = variant.variant_name ? `${brandName} · ${variant.variant_name}` : brandName;
            return `
              <button type="button" class="variant-btn ${isSel ? 'selected' : ''}" onclick="selectVariant('${variant.id}')">
                <span class="v-name">${escapeHTML(vLabel)}</span>
                <span class="v-price">${fmtPrice(vPrice)}</span>
                <span class="v-stock-hint">${variant.stock === 0 ? 'Agotado' : 'En stock'}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Miniaturas HTML
  let thumbsHTML = '';
  if (galleryImages.length > 1) {
    thumbsHTML = `
      <div class="prod-thumbs-track" role="tablist" aria-label="Miniaturas de imágenes">
        ${galleryImages.map((img, i) => `
          <div class="prod-thumb-item ${i === activeImgIndex ? 'active' : ''}" onclick="setGalleryImage(${i})" role="button" tabindex="0">
            <img src="${optImg(img, 120)}" alt="Miniatura ${i + 1}" loading="lazy">
          </div>
        `).join('')}
      </div>
    `;
  }

  const container = document.getElementById('productApp');
  container.innerHTML = `
    <!-- Migas de Pan -->
    <nav class="prod-breadcrumb" aria-label="Breadcrumb">
      <a href="catalogo.html">Catálogo</a>
      <span class="sep">/</span>
      <a href="catalogo.html?cat=${encodeURIComponent(cat.slug || '')}">${escapeHTML(cat.name)}</a>
      <span class="sep">/</span>
      <span class="current" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</span>
    </nav>

    <!-- Atajos de Teclado -->
    <div class="keyboard-hint">
      <span>Atajos:</span>
      <kbd>←</kbd><kbd>→</kbd> Fotos
      <kbd>W</kbd> WhatsApp
      <kbd>Q</kbd> Cotizar
      <kbd>C</kbd> Compartir
      <kbd>Esc</kbd> Catálogo
    </div>

    <!-- Ficha Principal -->
    <div class="product-main-container">
      <div class="product-grid-layout">
        
        <!-- Galería Izquierda -->
        <div class="prod-gallery-wrap">
          <div class="prod-stage" id="stageContainer" onclick="openZoomModal()">
            <div class="stage-badges">
              <span class="badge-tag cat">${escapeHTML(cat.name)}</span>
              ${p._packaging ? `<span class="badge-tag packaging">📦 ${escapeHTML(p._packaging)}</span>` : ''}
            </div>
            <span class="stage-stock ${stockClass}">${stockText}</span>
            
            ${galleryImages.length > 1 ? `
              <button class="stage-nav-arrow prev" onclick="cycleGallery(-1, event)" aria-label="Foto anterior">❮</button>
              <button class="stage-nav-arrow next" onclick="cycleGallery(1, event)" aria-label="Foto siguiente">❯</button>
            ` : ''}

            ${activeImg ? `
              <img id="mainStageImg" src="${optImg(activeImg, 800)}" alt="${escapeHTML(p.name)}" decoding="async">
            ` : `
              <span style="font-size:90px">${p.emoji || '📦'}</span>
            `}

            <span class="stage-zoom-hint">🔍 Toca para ampliar</span>
          </div>

          ${thumbsHTML}
        </div>

        <!-- Información Derecha -->
        <div class="prod-info-wrap">
          <div class="brand-chip-row">
            <div class="brand-chip">
              🏷️ ${escapeHTML(v?.jjp_brands?.name || p._brands[0]?.name || 'JJ Paper')}
            </div>
            <div class="sku-code">SKU: ${escapeHTML(sku)}</div>
          </div>

          <h1 class="prod-title">${escapeHTML(p.name)}</h1>

          <!-- Precio Destacado -->
          <div class="prod-price-box">
            <div class="price-row-main">
              <span class="price-usd-hero">${fmtPrice(price)}</span>
              <span class="price-unit-tag">/ ${escapeHTML(unit)}</span>
            </div>
            <div class="price-bs-row">
              <span>Bs ${toBs(price)}</span>
              <span class="rate-indicator">Tasa BCV: Bs ${getRate().toFixed(2)}/$</span>
            </div>
            <div class="min-order-alert">
              <span>📦 <strong>Condición mayorista:</strong> Pedido mínimo desde ${minQty} ${escapeHTML(unit)}</span>
            </div>
          </div>

          <!-- Variantes -->
          ${variantsHTML}

          <!-- Selector de Cantidad & Subtotal -->
          <div class="qty-stepper-wrap">
            <div class="qty-stepper">
              <button class="qty-btn" type="button" onclick="changeQty(-1)" aria-label="Reducir cantidad">−</button>
              <input type="number" class="qty-input" id="qtyInput" value="${currentQty}" min="${minQty}" onchange="setCustomQty(this.value)">
              <button class="qty-btn" type="button" onclick="changeQty(1)" aria-label="Aumentar cantidad">+</button>
            </div>
            <div class="subtotal-preview" id="subtotalDisplay">
              Total: <strong>${fmtPrice(price * currentQty)}</strong> (Bs ${toBs(price * currentQty)})
            </div>
          </div>

          <!-- Acciones de Compra -->
          <div class="prod-actions-row">
            <button type="button" class="btn-action-primary" onclick="orderViaWhatsApp()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.351.226-.652.075s-1.272-.469-2.423-1.496c-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.151-.176.201-.301.301-.502.1-.2.05-.376-.025-.526-.075-.15-.678-1.635-.929-2.241-.244-.59-.492-.51-.678-.52-.176-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376s-1.054 1.029-1.054 2.509c0 1.48 1.079 2.909 1.229 3.11.15.2 2.122 3.24 5.141 4.544.718.31 1.279.495 1.716.634.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/></svg>
              <span>Pedir por WhatsApp</span>
            </button>

            <button type="button" class="btn-action-quote" onclick="addToClientQuote(currentProduct, currentVariant, currentQty)" style="background:var(--gd,#16604A);color:#fff;font-weight:800;padding:12px;font-size:13.5px;border:none;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">
              <span>📋 + Agregar a mi Lista de Cotización Mayorista</span>
            </button>

            <div class="secondary-actions-cluster">
              <button type="button" class="btn-action-quote" onclick="openQuoteModal()">
                <span>⚡ Solicitar Cotización Formal</span>
              </button>
              <button type="button" class="btn-action-share" onclick="shareCurrentProduct()">
                <span>🔗 Compartir Ficha</span>
              </button>
            </div>
          </div>

          <!-- Beneficios Comerciales -->
          <div class="benefits-cards-grid">
            <div class="benefit-item">
              <span class="icon">🚚</span>
              <div>Despacho a nivel nacional (Transporte JJ / Agencias)</div>
            </div>
            <div class="benefit-item">
              <span class="icon">📄</span>
              <div>Factura Fiscal legal y RIF de empresa</div>
            </div>
            <div class="benefit-item">
              <span class="icon">💼</span>
              <div>Precios especiales por bulto cerrado</div>
            </div>
            <div class="benefit-item">
              <span class="icon">🛡️</span>
              <div>Garantía directa de distribuidor mayorista</div>
            </div>
          </div>

        </div>

      </div>
    </div>

    <!-- Descripción y Ficha Técnica -->
    <div class="prod-details-section">
      <div class="details-card">
        <div>
          <h3>📋 Descripción del Producto</h3>
          <div class="description-body">
            <p>${escapeHTML(p.description || 'Producto de alta rotación para papelerías, oficinas y comercios. Calidad premium garantizada.')}</p>
            <p>Este artículo cumple con los estándares exigidos para distribución y venta al mayor. Ideal para librerías, colegios, corporaciones y revendedores.</p>
          </div>
        </div>

        <div>
          <h3>📐 Ficha Técnica</h3>
          <table class="spec-table">
            <tbody>
              <tr><td class="label">Categoría:</td><td class="value">${escapeHTML(cat.name)}</td></tr>
              <tr><td class="label">Marca:</td><td class="value">${escapeHTML(v?.jjp_brands?.name || p._brands[0]?.name || 'JJ Paper')}</td></tr>
              <tr><td class="label">Presentación:</td><td class="value">${escapeHTML(p._packaging || 'Unidad')}</td></tr>
              <tr><td class="label">Código SKU:</td><td class="value">${escapeHTML(sku)}</td></tr>
              <tr><td class="label">Unidad de Venta:</td><td class="value">${escapeHTML(unit)}</td></tr>
              <tr><td class="label">Compra Mínima:</td><td class="value">${minQty} ${escapeHTML(unit)}</td></tr>
              <tr><td class="label">Disponibilidad:</td><td class="value">${stockText}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Productos Relacionados -->
    <div class="related-prods-section" id="relatedSection" style="display:none">
      <div class="related-header">
        <h3>También te puede interesar en ${escapeHTML(cat.name)}</h3>
        <a href="catalogo.html?cat=${encodeURIComponent(cat.slug || '')}">Ver todos →</a>
      </div>
      <div class="related-grid" id="relatedGrid"></div>
    </div>

    <!-- Barra Móvil Sticky -->
    <div class="mobile-sticky-bar" id="mobileStickyBar">
      <div class="msb-info">
        <img class="msb-thumb" src="${optImg(activeImg, 80)}" alt="">
        <div>
          <div class="msb-price-usd">${fmtPrice(price)}</div>
          <div class="msb-price-bs">Bs ${toBs(price)}</div>
        </div>
      </div>
      <button type="button" class="msb-btn" onclick="orderViaWhatsApp()">
        <span>💬 Pedir</span>
      </button>
    </div>
  `;
}

// Cambio de variantes
function selectVariant(variantId) {
  const v = currentProduct.variants.find(x => x.id === variantId);
  if (!v) return;
  currentVariant = v;
  
  if (v.image_url) {
    const idx = galleryImages.indexOf(v.image_url);
    if (idx >= 0) activeImgIndex = idx;
  }
  
  const minQty = Math.max(1, (v.min_qty ?? currentProduct.min_qty) || 1);
  if (currentQty < minQty) currentQty = minQty;

  renderProductView();
}

// Navegación de Galería
function setGalleryImage(index) {
  if (index < 0 || index >= galleryImages.length) return;
  activeImgIndex = index;
  const stageImg = document.getElementById('mainStageImg');
  if (stageImg) stageImg.src = optImg(galleryImages[activeImgIndex], 800);

  document.querySelectorAll('.prod-thumb-item').forEach((el, i) => {
    el.classList.toggle('active', i === activeImgIndex);
  });
}

function cycleGallery(delta, event) {
  if (event) event.stopPropagation();
  if (galleryImages.length <= 1) return;
  let next = activeImgIndex + delta;
  if (next < 0) next = galleryImages.length - 1;
  if (next >= galleryImages.length) next = 0;
  setGalleryImage(next);
}

// Cantidad y Subtotal
function changeQty(delta) {
  const minQty = Math.max(1, (currentVariant?.min_qty ?? currentProduct.min_qty) || 1);
  const next = currentQty + delta;
  if (next < minQty) return;
  currentQty = next;
  updateQtyDisplay();
}

function setCustomQty(val) {
  const minQty = Math.max(1, (currentVariant?.min_qty ?? currentProduct.min_qty) || 1);
  const parsed = parseInt(val, 10);
  currentQty = (!isNaN(parsed) && parsed >= minQty) ? parsed : minQty;
  updateQtyDisplay();
}

function updateQtyDisplay() {
  const input = document.getElementById('qtyInput');
  if (input) input.value = currentQty;

  const v = currentVariant;
  const p = currentProduct;
  const price = v 
    ? Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : v.price_a || 0))
    : Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : p.price_a || 0));

  const sub = document.getElementById('subtotalDisplay');
  if (sub) {
    sub.innerHTML = `Total: <strong>${fmtPrice(price * currentQty)}</strong> (Bs ${toBs(price * currentQty)})`;
  }
}

// Enviar Pedido vía WhatsApp
function orderViaWhatsApp() {
  const p = currentProduct;
  const v = currentVariant;
  if (!p) return;

  const price = v 
    ? Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : v.price_a || 0))
    : Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : p.price_a || 0));

  const totalUsd = price * currentQty;
  const totalBs = toBs(totalUsd);
  const unit = p.jjp_units?.name || p.unit || 'unid';
  const brandName = v?.jjp_brands?.name || p._brands[0]?.name || 'JJ Paper';
  const variantTxt = v?.variant_name ? `${brandName} (${v.variant_name})` : brandName;
  const activeImg = galleryImages[activeImgIndex] || p.image_url || '';
  const currentUrl = window.location.href;

  let msg = `👋 *Hola JJ Paper, deseo consultar/ordenar este producto:*\n\n` +
            `📦 *Producto:* ${p.name}\n` +
            `🏷️ *Marca/Presentación:* ${variantTxt}\n` +
            `🔢 *Cantidad:* ${currentQty} ${unit}\n` +
            `💰 *Precio Unit:* ${fmtPrice(price)} (Bs ${toBs(price)})\n` +
            `💵 *Total Estimado:* ${fmtPrice(totalUsd)} (Bs ${totalBs})\n` +
            `🔗 *Ficha Digital:* ${currentUrl}\n`;

  if (activeImg) {
    msg += `🖼️ *Foto Referencial:* ${activeImg}\n`;
  }

  msg += `\n¿Tienen disponibilidad inmediata para preparar el despacho?`;

  const waNum = APP.WA_NUM || '584121234567';
  const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
}

// Compartir Ficha
function shareCurrentProduct() {
  const title = currentProduct ? `${currentProduct.name} | JJ Paper` : 'Producto JJ Paper';
  const url = window.location.href;

  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Enlace copiado al portapapeles 🔗');
    });
  } else {
    prompt('Copia este enlace para compartir:', url);
  }
}

// Carga de productos similares / relacionados
async function loadRelatedProducts(categoryId, excludeId) {
  if (!categoryId) return;
  try {
    const { data } = await sb.from('jjp_products')
      .select(`id,name,price_usd,price_b,unit,image_url,emoji,${VARIANTS_SELECT}`)
      .eq('category_id', categoryId)
      .eq('active', true)
      .neq('id', excludeId)
      .limit(4);

    if (data && data.length > 0) {
      const section = document.getElementById('relatedSection');
      const grid = document.getElementById('relatedGrid');
      if (!section || !grid) return;

      grid.innerHTML = data.map(rp => {
        normalizeProductDetails(rp);
        const rpPrice = Number(rp.price_b != null ? rp.price_b : (rp.price_usd || 0));
        const rpImg = rp.image_url || rp.variants.find(v => v.image_url)?.image_url;
        return `
          <div class="pc" style="background:#fff;border-radius:12px;padding:12px;box-shadow:0 2px 10px rgba(0,0,0,0.04);border:1px solid #eee;cursor:pointer" onclick="location.href='producto.html?id=${rp.id}'">
            <div style="aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:#f9fbf9;border-radius:8px;overflow:hidden;margin-bottom:8px">
              ${rpImg ? `<img src="${optImg(rpImg, 300)}" alt="" style="max-width:85%;max-height:85%;object-fit:contain">` : `<span style="font-size:36px">📦</span>`}
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--gd,#16604A);height:32px;overflow:hidden">${escapeHTML(rp.name)}</div>
            <div style="font-size:14px;font-weight:800;color:#16604A;margin-top:4px">${fmtPrice(rpPrice)}</div>
          </div>
        `;
      }).join('');

      section.style.display = 'block';
    }
  } catch (e) {
    console.warn('Error loading related:', e);
  }
}

// Atajos de Teclado
function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Si el usuario está escribiendo en un input, ignorar
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (e.key === 'ArrowLeft') {
      cycleGallery(-1);
    } else if (e.key === 'ArrowRight') {
      cycleGallery(1);
    } else if (e.key === 'w' || e.key === 'W') {
      orderViaWhatsApp();
    } else if (e.key === 'q' || e.key === 'Q') {
      openQuoteModal();
    } else if (e.key === 'c' || e.key === 'C') {
      shareCurrentProduct();
    } else if (e.key === 'Escape') {
      const qm = document.getElementById('quoteModal');
      if (qm && qm.classList.contains('active')) {
        closeQuoteModal();
      } else {
        window.location.href = 'catalogo.html';
      }
    }
  });
}

// Modal de Cotización Directa
function openQuoteModal() {
  const modal = document.getElementById('quoteModal');
  if (!modal) return;
  const p = currentProduct;
  const v = currentVariant;
  const unit = p?.jjp_units?.name || p?.unit || 'unid';
  const brandName = v?.jjp_brands?.name || p?._brands[0]?.name || 'JJ Paper';
  const variantTxt = v?.variant_name ? `${brandName} (${v.variant_name})` : brandName;

  document.getElementById('qmSummary').textContent = 
    `Producto: ${p.name} · ${variantTxt} · Cantidad: ${currentQty} ${unit}`;
  modal.classList.add('active');
}

function closeQuoteModal() {
  const modal = document.getElementById('quoteModal');
  if (modal) modal.classList.remove('active');
}

async function submitQuoteForm(event) {
  event.preventDefault();
  const btn = document.getElementById('qmSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Enviando solicitud...';

  const p = currentProduct;
  const v = currentVariant;
  const companyName = document.getElementById('qmCompany').value.trim();
  const contactName = document.getElementById('qmContact').value.trim();
  const phone = document.getElementById('qmPhone').value.trim();
  const email = document.getElementById('qmEmail').value.trim();
  const notes = document.getElementById('qmNotes').value.trim();

  try {
    let sellerId = null;
    if (typeof resolveRefSeller === 'function') {
      sellerId = await resolveRefSeller();
    }

    const payload = {
      company_name: companyName,
      contact_name: contactName,
      phone_1: phone,
      email: email,
      status: 'solicito_cotizacion',
      source: 'web_producto',
      seller_id: sellerId,
      notes: `Solicitud de Cotización desde ficha de producto:\n` +
             `- Producto: ${p.name} (ID: ${p.id})\n` +
             `- Presentación/Marca: ${v?.variant_name || 'Estándar'}\n` +
             `- Cantidad requerida: ${currentQty}\n` +
             `- Comentarios: ${notes || 'Sin notas'}`
    };

    const { error } = await sb.from('jjp_prospects').insert(payload);
    if (error) throw error;

    showToast('¡Solicitud recibida! Un asesor comercial te contactará de inmediato.');
    closeQuoteModal();

  } catch (err) {
    console.error('Error guardando cotización:', err);
    alert('No pudimos guardar tu cotización automáticamente. Por favor envíala directamente por WhatsApp.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Solicitud Formal';
  }
}

// Lightbox de Zoom
function openZoomModal() {
  const activeImg = galleryImages[activeImgIndex] || currentProduct?.image_url;
  if (!activeImg) return;
  if (typeof openImgLightbox === 'function') {
    openImgLightbox(activeImg, currentProduct.name);
  }
}

// Actualizar Meta Tags Dinámicos (OpenGraph / Twitter)
function updateMetaTags() {
  if (!currentProduct) return;
  const p = currentProduct;
  const activeImg = galleryImages[activeImgIndex] || p.image_url || '';
  const price = currentVariant ? (currentVariant.price_b || currentVariant.price_usd) : (p.price_b || p.price_usd);
  const title = `${p.name} | JJ Paper Mayorista`;
  const desc = `${p.name} al mejor precio mayorista: ${fmtPrice(price)} (Bs ${toBs(price)}). Envíos a toda Venezuela.`;

  document.title = title;

  const setMeta = (prop, content) => {
    let el = document.querySelector(`meta[property="${prop}"]`) || document.querySelector(`meta[name="${prop}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(prop.startsWith('twitter:') ? 'name' : 'property', prop);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  setMeta('og:title', title);
  setMeta('og:description', desc);
  setMeta('og:image', activeImg);
  setMeta('og:url', window.location.href);
  setMeta('og:type', 'product');
  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', activeImg);
}

function renderNotFound(msg) {
  const container = document.getElementById('productApp');
  if (container) {
    container.innerHTML = `
      <div style="max-width:600px;margin:80px auto;text-align:center;padding:40px 20px;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.05)">
        <div style="font-size:60px;margin-bottom:16px">📦</div>
        <h2 style="color:var(--gd,#16604A);font-size:24px;margin-bottom:10px">Producto no disponible</h2>
        <p style="color:#666;font-size:14px;margin-bottom:24px">${escapeHTML(msg)}</p>
        <a href="catalogo.html" style="background:var(--gd,#16604A);color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700">Explorar el Catálogo</a>
      </div>
    `;
  }
}
