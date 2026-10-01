/**
 * JJ Paper — Selector Inteligente de Catálogo y Combos
 * assets/js/vendedor/product-picker.js
 *
 * Soporta selección individual (producto / combo) y multi-selección
 * para campañas de ofertas (hasta 15 artículos).
 */

window.ProductPicker = (() => {
  let activeOverlay = null;
  let currentItems = [];
  let selectedItem = null;
  let isMultiMode = false;
  let selectedMultiItems = new Map(); // id -> item
  let onSelectCallback = null;

  function initModal() {
    if (document.getElementById('ppOverlay')) return;

    const div = document.createElement('div');
    div.id = 'ppOverlay';
    div.className = 'product-picker-overlay';
    div.innerHTML = `
      <div class="product-picker-modal">
        <div class="pp-header">
          <div class="pp-title" id="ppTitle">📦 Seleccionar Producto</div>
          <button class="pp-close-btn" onclick="ProductPicker.close()">✕</button>
        </div>
        <div class="pp-filters" style="display:flex; gap:8px; align-items:center;">
          <input type="text" class="pp-search" id="ppSearch" placeholder="Buscar por nombre, SKU, marca o código (ej: artesco hb, report carta)..." oninput="ProductPicker.onSearch(this.value)" style="flex:1;">
          <button type="button" id="ppAiBtn" class="ce-var-btn" style="display:none; background:#f0fdf4; color:#15803d; border-color:#86efac; font-weight:700; white-space:nowrap; padding:8px 12px; cursor:pointer;" onclick="ProductPicker.triggerAiModal()">
            🤖 Pegar Lista con IA
          </button>
        </div>
        <div class="pp-body">
          <div class="pp-grid" id="ppGrid">
            <div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 20px;">Cargando catálogo...</div>
          </div>
        </div>
        <div class="pp-discount-section" id="ppDiscountSec" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; background:#f8fafc; padding:10px 14px; border-top:1px solid #e2e8f0;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; font-weight:700; color:#0f172a;">🏷️ Precio Oferta ($):</label>
            <input type="number" step="0.01" min="0" id="ppOfferPriceInput" placeholder="0.00" oninput="ProductPicker.onOfferPriceChange()" style="width:95px; padding:6px 10px; border:1.5px solid #10b981; border-radius:6px; font-weight:700; color:#065f46; font-size:14px; background:#fff;">
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; font-weight:700; color:#64748b;">o Descuento (%):</label>
            <input type="number" id="ppDiscountInput" class="pp-discount-input" min="0" max="90" value="0" oninput="ProductPicker.onDiscountChange()" style="width:65px; padding:6px 8px; border:1.5px solid #cbd5e1; border-radius:6px; font-weight:700; font-size:13px;">
          </div>
          <span id="ppPricePreview" style="font-size: 13px; font-weight: 700; color: #16604A; margin-left:auto;"></span>
        </div>
        <div class="pp-footer" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span id="ppMultiCount" style="display:none; font-weight:700; color:#166534; font-size:13px;">0 seleccionados</span>
          <div style="display:flex; gap:8px; margin-left:auto;">
            <button class="ce-btn-cancel" onclick="ProductPicker.close()">Cancelar</button>
            <button class="ce-btn-launch" id="ppConfirmBtn" onclick="ProductPicker.confirm()" disabled>Seleccionar y aplicar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    activeOverlay = div;
  }

  function triggerAiModal() {
    close();
    if (typeof CampaignEditor !== 'undefined' && CampaignEditor.openAiOfferBuilderModal) {
      CampaignEditor.openAiOfferBuilderModal();
    }
  }

  async function open(options = {}) {
    initModal();
    const { mode = 'product', products = [], combos = [], selectedList = [], onSelect } = options;
    onSelectCallback = onSelect;
    isMultiMode = (mode === 'multi');
    selectedItem = null;
    selectedMultiItems = new Map();

    document.getElementById('ppSearch').value = '';
    document.getElementById('ppDiscountInput').value = '0';
    document.getElementById('ppPricePreview').textContent = '';

    const multiCountEl = document.getElementById('ppMultiCount');
    const confirmBtn = document.getElementById('ppConfirmBtn');
    const aiBtn = document.getElementById('ppAiBtn');

    if (isMultiMode) {
      multiCountEl.style.display = 'inline-block';
      if (aiBtn) aiBtn.style.display = 'inline-block';
      if (Array.isArray(selectedList) && selectedList.length > 0) {
        selectedList.forEach(it => {
          if (it?.id) selectedMultiItems.set(it.id, it);
        });
      }
      multiCountEl.textContent = `${selectedMultiItems.size} seleccionados`;
      confirmBtn.disabled = selectedMultiItems.size === 0;
      confirmBtn.textContent = `Confirmar Selección (${selectedMultiItems.size})`;
    } else {
      multiCountEl.style.display = 'none';
      if (aiBtn) aiBtn.style.display = 'none';
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Seleccionar y aplicar';
    }

    const titleEl = document.getElementById('ppTitle');
    if (mode === 'combo') {
      titleEl.innerHTML = '🎁 Seleccionar Combo / Promoción';
      currentItems = (combos || []).map(c => ({
        id: c.id,
        name: c.title || c.name,
        brand: 'Combo JJ Paper',
        price_usd: c.price_usd || 0,
        image_url: c.image_url || 'assets/img/logo.svg',
        description: c.description || '',
        raw: c,
        type: 'combo'
      }));
    } else if (isMultiMode) {
      titleEl.innerHTML = '🔥 Seleccionar Ofertas Multi-Producto (Sin límite)';
      currentItems = [];
      (products || []).forEach(p => {
        const vs = p.jjp_product_variants || p.variants || [];
        const baseName = p.name || p.jjp_products?.name || p.variant_name || 'Producto';
        const baseBrand = p.brand || p.jjp_brands?.name || (vs[0]?.jjp_brands?.name) || '';
        const basePrice = p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : (vs[0]?.price_b || vs[0]?.price_usd || 0));
        const baseImg = p.image_url || p.jjp_products?.image_url || vs[0]?.image_url || 'assets/img/no-img.svg';
        const baseDesc = p.description || p.jjp_products?.description || '';
        const baseSku = p.sku || vs[0]?.sku || '';

        if (!vs.length || vs.length === 1) {
          const v = vs[0];
          const vName = v?.variant_name && v.variant_name !== 'Estándar' ? ` (${v.variant_name})` : '';
          currentItems.push({
            id: v?.id ? `${p.id}_${v.id}` : p.id,
            product_id: p.id,
            variant_id: v?.id || null,
            name: baseName + vName,
            brand: v?.jjp_brands?.name || baseBrand,
            price_usd: Number(v?.price_b || v?.price_usd || basePrice) || 0,
            image_url: v?.image_url || baseImg,
            description: baseDesc,
            sku: v?.sku || baseSku,
            unit: p.unit || 'unid',
            raw: p,
            type: 'product'
          });
        } else {
          vs.forEach(v => {
            const vName = v.variant_name && v.variant_name !== 'Estándar' ? ` (${v.variant_name})` : '';
            currentItems.push({
              id: `${p.id}_${v.id}`,
              product_id: p.id,
              variant_id: v.id,
              name: baseName + vName,
              brand: v.jjp_brands?.name || baseBrand,
              price_usd: Number(v.price_b || v.price_usd || basePrice) || 0,
              image_url: v.image_url || baseImg,
              description: baseDesc,
              sku: v.sku || baseSku,
              unit: p.unit || 'unid',
              raw: p,
              type: 'product'
            });
          });
        }
      });
    } else {
      titleEl.innerHTML = '📦 Seleccionar Producto del Catálogo';
      currentItems = [];
      (products || []).forEach(p => {
        const vs = p.jjp_product_variants || p.variants || [];
        const baseName = p.name || p.jjp_products?.name || p.variant_name || 'Producto';
        const baseBrand = p.brand || p.jjp_brands?.name || (vs[0]?.jjp_brands?.name) || '';
        const basePrice = p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : (vs[0]?.price_b || vs[0]?.price_usd || 0));
        const baseImg = p.image_url || p.jjp_products?.image_url || vs[0]?.image_url || 'assets/img/no-img.svg';
        const baseDesc = p.description || p.jjp_products?.description || '';
        const baseSku = p.sku || vs[0]?.sku || '';

        if (!vs.length || vs.length === 1) {
          const v = vs[0];
          const vName = v?.variant_name && v.variant_name !== 'Estándar' ? ` (${v.variant_name})` : '';
          currentItems.push({
            id: v?.id ? `${p.id}_${v.id}` : p.id,
            product_id: p.id,
            variant_id: v?.id || null,
            name: baseName + vName,
            brand: v?.jjp_brands?.name || baseBrand,
            price_usd: Number(v?.price_b || v?.price_usd || basePrice) || 0,
            image_url: v?.image_url || baseImg,
            description: baseDesc,
            sku: v?.sku || baseSku,
            unit: p.unit || 'unid',
            raw: p,
            type: 'product'
          });
        } else {
          vs.forEach(v => {
            const vName = v.variant_name && v.variant_name !== 'Estándar' ? ` (${v.variant_name})` : '';
            currentItems.push({
              id: `${p.id}_${v.id}`,
              product_id: p.id,
              variant_id: v.id,
              name: baseName + vName,
              brand: v.jjp_brands?.name || baseBrand,
              price_usd: Number(v.price_b || v.price_usd || basePrice) || 0,
              image_url: v.image_url || baseImg,
              description: baseDesc,
              sku: v.sku || baseSku,
              unit: p.unit || 'unid',
              raw: p,
              type: 'product'
            });
          });
        }
      });
    }

    renderGrid(currentItems);
    activeOverlay.classList.add('active');
  }

  function normalizeSearch(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();
  }

  function renderGrid(items) {
    const grid = document.getElementById('ppGrid');
    if (!items.length) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 20px;">No se encontraron artículos con esa búsqueda.</div>';
      return;
    }

    grid.innerHTML = items.map(it => {
      const isSelected = isMultiMode ? selectedMultiItems.has(it.id) : (selectedItem?.id === it.id);
      const clickFn = isMultiMode ? `ProductPicker.toggleMultiItem('${it.id}')` : `ProductPicker.selectItem('${it.id}')`;
      const badgeHTML = isMultiMode
        ? `<div class="pp-multi-badge" style="position:absolute; top:6px; right:6px; background:${isSelected ? '#166534' : '#e2e8f0'}; color:${isSelected ? '#ffffff' : '#64748b'}; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; box-shadow:0 1px 3px rgba(0,0,0,0.1);">${isSelected ? '✓' : '+'}</div>`
        : '';

      return `
        <div class="pp-card ${isSelected ? 'selected' : ''}" onclick="${clickFn}" style="position:relative; cursor:pointer;">
          ${badgeHTML}
          <img class="pp-card-img" src="${it.image_url}" alt="${it.name}" onerror="this.src='../assets/img/logo.svg'">
          <div class="pp-card-name" title="${it.name}">${it.name}</div>
          ${it.brand ? `<div class="pp-card-brand">${it.brand}</div>` : ''}
          <div class="pp-card-price">$${Number(it.price_usd).toFixed(2)}</div>
        </div>
      `;
    }).join('');
  }

  let searchDebounce = null;
  function onSearch(query) {
    const normQ = normalizeSearch(query);
    if (!normQ) {
      renderGrid(currentItems);
      return;
    }
    const words = normQ.split(/\s+/).filter(Boolean);
    const filtered = currentItems.filter(it => {
      const target = normalizeSearch(`${it.name} ${it.brand || ''} ${it.sku || ''} ${it.description || ''}`);
      return words.every(w => target.includes(w));
    });
    renderGrid(filtered);

    // Búsqueda ampliada remota en servidor si hay pocos resultados en memoria
    if (filtered.length < 5 && words.length > 0 && typeof sb !== 'undefined') {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(async () => {
        try {
          // Buscar por la palabra principal
          const mainWord = words[0];
          const { data: serverProds } = await sb.from('jjp_products')
            .select('id,sku,name,price_b,price_usd,image_url,description,stock,jjp_product_variants(id,sku,variant_name,price_b,price_usd,stock,jjp_brands(name))')
            .ilike('name', `%${mainWord}%`)
            .eq('active', true)
            .limit(30);

          if (serverProds && serverProds.length > 0) {
            const existingIds = new Set(currentItems.map(x => x.id));
            let addedCount = 0;

            serverProds.forEach(p => {
              const target = normalizeSearch(`${p.name} ${p.sku || ''} ${p.description || ''}`);
              if (words.every(w => target.includes(w))) {
                if (!existingIds.has(p.id)) {
                  const it = {
                    id: p.id,
                    product_id: p.id,
                    name: p.name,
                    brand: p.jjp_product_variants?.[0]?.jjp_brands?.name || '',
                    price_usd: p.price_b || p.price_usd || 0,
                    image_url: p.image_url || 'assets/img/logo.svg',
                    description: p.description || '',
                    sku: p.sku || '',
                    raw: p,
                    type: 'product'
                  };
                  currentItems.push(it);
                  filtered.push(it);
                  existingIds.add(p.id);
                  addedCount++;
                }
              }
            });

            if (addedCount > 0) {
              renderGrid(filtered);
            }
          }
        } catch (_) {}
      }, 200);
    }
  }

  function selectItem(id) {
    selectedItem = currentItems.find(it => it.id === id);
    document.querySelectorAll('.pp-card').forEach(el => el.classList.remove('selected'));
    const all = Array.from(document.querySelectorAll('.pp-card'));
    const clicked = all.find(el => el.getAttribute('onclick')?.includes(id));
    if (clicked) clicked.classList.add('selected');
    document.getElementById('ppConfirmBtn').disabled = false;

    const base = Number(selectedItem?.price_usd) || 0;
    const offerInp = document.getElementById('ppOfferPriceInput');
    const discInp = document.getElementById('ppDiscountInput');
    if (offerInp && (!offerInp.value || parseFloat(offerInp.value) === 0)) {
      offerInp.value = base.toFixed(2);
      if (discInp) discInp.value = '0';
    }
    if (offerInp && parseFloat(offerInp.value) > 0 && parseFloat(offerInp.value) !== base) {
      onOfferPriceChange();
    } else {
      onDiscountChange();
    }
  }

  function toggleMultiItem(id) {
    const it = currentItems.find(x => x.id === id);
    if (!it) return;

    const base = Number(it.price_usd) || 0;
    const offerInp = document.getElementById('ppOfferPriceInput');
    const discInp = document.getElementById('ppDiscountInput');
    const disc = parseFloat(discInp?.value) || 0;
    const offerVal = parseFloat(offerInp?.value);
    const finalPrice = (offerVal != null && !isNaN(offerVal) && offerVal > 0)
      ? offerVal
      : Math.max(0, base * (1 - (disc / 100)));
    const calculatedDisc = (base > 0 && finalPrice < base)
      ? Math.max(0, Math.min(99, Math.round(((base - finalPrice) / base) * 100)))
      : disc;

    if (selectedMultiItems.has(id)) {
      selectedMultiItems.delete(id);
    } else {
      selectedMultiItems.set(id, {
        ...it,
        discount_pct: calculatedDisc,
        final_price_usd: finalPrice
      });
    }

    const multiCountEl = document.getElementById('ppMultiCount');
    const confirmBtn = document.getElementById('ppConfirmBtn');
    if (multiCountEl) multiCountEl.textContent = `${selectedMultiItems.size} seleccionados`;
    if (confirmBtn) {
      confirmBtn.disabled = selectedMultiItems.size === 0;
      confirmBtn.textContent = `Confirmar Selección (${selectedMultiItems.size})`;
    }

    const searchVal = document.getElementById('ppSearch')?.value;
    onSearch(searchVal);
  }

  function onOfferPriceChange() {
    const offerInp = document.getElementById('ppOfferPriceInput');
    const discInp = document.getElementById('ppDiscountInput');
    const prevEl = document.getElementById('ppPricePreview');
    const offerPrice = parseFloat(offerInp?.value) || 0;

    if (isMultiMode) {
      for (const [id, it] of selectedMultiItems.entries()) {
        const base = Number(it.price_usd) || 0;
        const disc = (base > 0 && offerPrice < base && offerPrice > 0)
          ? Math.max(0, Math.min(99, Math.round(((base - offerPrice) / base) * 100)))
          : 0;
        selectedMultiItems.set(id, {
          ...it,
          discount_pct: disc,
          final_price_usd: offerPrice > 0 ? offerPrice : base
        });
      }
      if (discInp && offerPrice > 0) {
        discInp.value = '';
      }
      if (prevEl) {
        prevEl.innerHTML = offerPrice > 0
          ? `Precio oferta: <strong>$${offerPrice.toFixed(2)}</strong> aplicado a los ${selectedMultiItems.size} productos`
          : `Precios regulares de lista mayorista`;
      }
      return;
    }

    if (!selectedItem) return;
    const base = Number(selectedItem.price_usd) || 0;
    let disc = 0;
    if (base > 0 && offerPrice < base && offerPrice > 0) {
      disc = Math.max(0, Math.min(99, Math.round(((base - offerPrice) / base) * 100)));
    }
    if (discInp) discInp.value = disc;

    if (offerPrice > 0 && offerPrice < base) {
      prevEl.innerHTML = `Precio Promo: <strong>$${offerPrice.toFixed(2)}</strong> <span style="text-decoration: line-through; color: #94a3b8; font-size: 11px;">$${base.toFixed(2)}</span> <span style="color:#15803d; font-size:11px; font-weight:700;">(-${disc}%)</span>`;
    } else {
      prevEl.innerHTML = `Precio: <strong>$${(offerPrice || base).toFixed(2)}</strong>`;
    }
  }

  function onDiscountChange() {
    const disc = parseFloat(document.getElementById('ppDiscountInput').value) || 0;
    const offerInp = document.getElementById('ppOfferPriceInput');
    const prevEl = document.getElementById('ppPricePreview');

    if (isMultiMode) {
      for (const [id, it] of selectedMultiItems.entries()) {
        const base = Number(it.price_usd) || 0;
        const finalPrice = Math.max(0, base * (1 - (disc / 100)));
        selectedMultiItems.set(id, {
          ...it,
          discount_pct: disc,
          final_price_usd: finalPrice
        });
      }
      if (prevEl) {
        prevEl.innerHTML = disc > 0
          ? `Descuento global del <strong>${disc}%</strong> aplicado a los ${selectedMultiItems.size} productos`
          : `Precios regulares de lista mayorista`;
      }
      return;
    }

    if (!selectedItem) return;
    const base = Number(selectedItem.price_usd) || 0;
    const finalPrice = Math.max(0, base * (1 - (disc / 100)));
    if (offerInp) offerInp.value = finalPrice.toFixed(2);
    if (disc > 0) {
      prevEl.innerHTML = `Precio Promo: <strong>$${finalPrice.toFixed(2)}</strong> <span style="text-decoration: line-through; color: #94a3b8; font-size: 11px;">$${base.toFixed(2)}</span> <span style="color:#15803d; font-size:11px; font-weight:700;">(-${disc}%)</span>`;
    } else {
      prevEl.innerHTML = `Precio: <strong>$${base.toFixed(2)}</strong>`;
    }
  }

  function confirm() {
    if (isMultiMode) {
      if (selectedMultiItems.size === 0) return;
      if (typeof onSelectCallback === 'function') {
        onSelectCallback(Array.from(selectedMultiItems.values()));
      }
      close();
      return;
    }

    if (!selectedItem) return;
    const offerInp = document.getElementById('ppOfferPriceInput');
    const discInp = document.getElementById('ppDiscountInput');
    const base = Number(selectedItem.price_usd) || 0;
    const offerVal = parseFloat(offerInp?.value);
    const finalPrice = (offerVal != null && !isNaN(offerVal) && offerVal > 0)
      ? offerVal
      : Math.max(0, base * (1 - ((parseFloat(discInp?.value) || 0) / 100)));
    const disc = base > 0 ? Math.max(0, Math.min(99, Math.round(((base - finalPrice) / base) * 100))) : 0;

    if (typeof onSelectCallback === 'function') {
      onSelectCallback({
        ...selectedItem,
        discount_pct: disc,
        final_price_usd: finalPrice
      });
    }
    close();
  }

  function close() {
    if (activeOverlay) activeOverlay.classList.remove('active');
  }

  return { open, close, onSearch, selectItem, toggleMultiItem, onOfferPriceChange, onDiscountChange, confirm, triggerAiModal };
})();

