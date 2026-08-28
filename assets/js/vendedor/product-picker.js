/**
 * JJ Paper — Selector Inteligente de Catálogo y Combos
 * assets/js/vendedor/product-picker.js
 */

window.ProductPicker = (() => {
  let activeOverlay = null;
  let currentItems = [];
  let selectedItem = null;
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
        <div class="pp-filters">
          <input type="text" class="pp-search" id="ppSearch" placeholder="Buscar por nombre, SKU o marca..." oninput="ProductPicker.onSearch(this.value)">
        </div>
        <div class="pp-body">
          <div class="pp-grid" id="ppGrid">
            <div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 20px;">Cargando catálogo...</div>
          </div>
        </div>
        <div class="pp-discount-section" id="ppDiscountSec">
          <span class="pp-discount-label">🏷️ Descuento especial de campaña (%):</span>
          <input type="number" id="ppDiscountInput" class="pp-discount-input" min="0" max="80" value="0" oninput="ProductPicker.onDiscountChange()">
          <span id="ppPricePreview" style="font-size: 13px; font-weight: 700; color: #16604A;"></span>
        </div>
        <div class="pp-footer">
          <button class="ce-btn-cancel" onclick="ProductPicker.close()">Cancelar</button>
          <button class="ce-btn-launch" id="ppConfirmBtn" onclick="ProductPicker.confirm()" disabled>Seleccionar y aplicar</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    activeOverlay = div;
  }

  async function open(options = {}) {
    initModal();
    const { mode = 'product', products = [], combos = [], onSelect } = options;
    onSelectCallback = onSelect;
    selectedItem = null;
    document.getElementById('ppConfirmBtn').disabled = true;
    document.getElementById('ppSearch').value = '';
    document.getElementById('ppDiscountInput').value = '0';
    document.getElementById('ppPricePreview').textContent = '';

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
    } else {
      titleEl.innerHTML = '📦 Seleccionar Producto del Catálogo';
      currentItems = (products || []).map(p => ({
        id: p.id,
        name: p.jjp_products?.name || p.name || p.variant_name || 'Producto',
        brand: p.jjp_brands?.name || '',
        price_usd: p.price_usd || p.base_price_usd || 0,
        image_url: p.jjp_products?.image_url || p.image_url || 'assets/img/no-img.svg',
        description: p.jjp_products?.description || '',
        sku: p.sku || '',
        raw: p,
        type: 'product'
      }));
    }

    renderGrid(currentItems);
    activeOverlay.classList.add('active');
  }

  function renderGrid(items) {
    const grid = document.getElementById('ppGrid');
    if (!items.length) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 20px;">No se encontraron artículos.</div>';
      return;
    }

    grid.innerHTML = items.map(it => `
      <div class="pp-card ${selectedItem?.id === it.id ? 'selected' : ''}" onclick="ProductPicker.selectItem('${it.id}')">
        <img class="pp-card-img" src="${it.image_url}" alt="${it.name}" onerror="this.src='../assets/img/logo.svg'">
        <div class="pp-card-name" title="${it.name}">${it.name}</div>
        ${it.brand ? `<div class="pp-card-brand">${it.brand}</div>` : ''}
        <div class="pp-card-price">$${Number(it.price_usd).toFixed(2)}</div>
      </div>
    `).join('');
  }

  function onSearch(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      renderGrid(currentItems);
      return;
    }
    const filtered = currentItems.filter(it => 
      it.name.toLowerCase().includes(q) || 
      (it.brand && it.brand.toLowerCase().includes(q)) ||
      (it.sku && it.sku.toLowerCase().includes(q))
    );
    renderGrid(filtered);
  }

  function selectItem(id) {
    selectedItem = currentItems.find(it => it.id === id);
    document.querySelectorAll('.pp-card').forEach(el => el.classList.remove('selected'));
    const all = Array.from(document.querySelectorAll('.pp-card'));
    const clicked = all.find(el => el.getAttribute('onclick')?.includes(id));
    if (clicked) clicked.classList.add('selected');
    document.getElementById('ppConfirmBtn').disabled = false;
    onDiscountChange();
  }

  function onDiscountChange() {
    if (!selectedItem) return;
    const disc = parseFloat(document.getElementById('ppDiscountInput').value) || 0;
    const base = Number(selectedItem.price_usd) || 0;
    const finalPrice = Math.max(0, base * (1 - (disc / 100)));
    const prevEl = document.getElementById('ppPricePreview');
    if (disc > 0) {
      prevEl.innerHTML = `Precio Promo: <strong>$${finalPrice.toFixed(2)}</strong> <span style="text-decoration: line-through; color: #94a3b8; font-size: 11px;">$${base.toFixed(2)}</span>`;
    } else {
      prevEl.innerHTML = `Precio: <strong>$${base.toFixed(2)}</strong>`;
    }
  }

  function confirm() {
    if (!selectedItem) return;
    const disc = parseFloat(document.getElementById('ppDiscountInput').value) || 0;
    const base = Number(selectedItem.price_usd) || 0;
    const finalPrice = Math.max(0, base * (1 - (disc / 100)));

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

  return { open, close, onSearch, selectItem, onDiscountChange, confirm };
})();
