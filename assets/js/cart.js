/* ======================================================
   JJ Paper — Cart (localStorage persistent)
   ====================================================== */

let cart = {};

// Load from localStorage
function cartLoad() {
  try { cart = JSON.parse(localStorage.getItem(APP.CART_KEY) || '{}'); }
  catch { cart = {}; }
  cartUpdateBadge();
}

// Save to localStorage
function cartSave() {
  localStorage.setItem(APP.CART_KEY, JSON.stringify(cart));
}

// Add by ID (looks up in productMap from catalog.js — safe alternative to inline JSON)
// Si el producto tiene varias marcas (variantes), abre el modal para elegir.
function addCartById(id) {
  const p = (typeof productMap !== 'undefined' && productMap[id])
    || (typeof allProducts !== 'undefined' && allProducts.find(x => x.id === id));
  if (!p) return;
  if ((p.variants?.length || 0) > 1) { openProductModal(p.id); return; }
  addCart(p);
}

// Unidades ya en el carrito para un producto (sumando todas sus marcas)
function cartQtyForProduct(productId) {
  return Object.values(cart).reduce((s, i) =>
    s + (((i.product_id || i.id) === productId) ? i.qty : 0), 0);
}

// Add item (qty units at once; silent skips the toast)
// `variant` = fila de jjp_product_variants (marca concreta). Sin variante
// explícita usa la única del producto, o cae al nivel producto (legacy).
// Respeta stock disponible y cantidad mínima.
function addCart(product, qty = 1, silent = false, variant = null) {
  if (!variant && product.variants?.length === 1) variant = product.variants[0];
  if (!variant && (product.variants?.length || 0) > 1) {
    // Varias marcas: elegir en el modal; sin modal (páginas sin catálogo),
    // usar la variante más barata disponible
    if (typeof openProductModal === 'function') { openProductModal(product.id); return; }
    variant = product.variants.find(v => v.stock !== 0) || product.variants[0];
  }

  const id    = variant?.id || product.id;   // clave del carrito = variante
  // Etiqueta "Marca · Presentación" para carrito/pedidos
  const brand = [variant?.jjp_brands?.name, variant?.variant_name].filter(Boolean).join(' · ') || null;
  const price = (variant ? +variant.price_usd : +product.price_usd);
  const stock = variant ? variant.stock : product.stock;
  if (stock === 0) { showToast('Producto agotado', 'warn'); return; }

  const minQty = Math.max(1, (variant?.min_qty ?? product.min_qty) || 1);
  if (!cart[id]) {
    // store only the fields we need for cart/checkout (avoids stale joins)
    cart[id] = {
      id, product_id: product.id, variant_id: variant?.id || null,
      name: product.name, brand, price_usd: price,
      unit: product.unit, image_url: variant?.image_url || product.image_url || null,
      emoji: product.emoji || null, sku: variant?.sku || product.sku || null,
      stock: (typeof stock === 'number' && stock >= 0) ? stock : null,
      min_qty: minQty, qty: 0,
    };
    // Primer agregado: arranca en la cantidad mínima
    if (qty < minQty) {
      qty = minQty;
      if (!silent && minQty > 1) showToast(`Cantidad mínima: ${minQty}`, 'warn');
    }
  }

  const item = cart[id];
  let newQty = item.qty + qty;
  if (item.stock !== null && newQty > item.stock) {
    newQty = item.stock;
    showToast('Cantidad máxima disponible alcanzada', 'warn');
  }
  item.qty = newQty;
  cartSave();
  cartUpdateBadge();
  if (!silent) showToast(`${product.name}${brand ? ` (${brand})` : ''} agregado`);
  // Re-render grid if visible
  if (typeof renderProds === 'function') renderProds();
}

// Change quantity (delta = +1 or -1)
function updateCartQty(id, delta) {
  if (!cart[id]) return;
  const item = cart[id];
  let newQty = item.qty + delta;

  if (delta > 0 && item.stock != null && newQty > item.stock) {
    showToast('Cantidad máxima disponible alcanzada', 'warn');
    newQty = item.stock;
  }
  // Bajar de la cantidad mínima elimina el producto
  if (newQty <= 0 || (delta < 0 && newQty < (item.min_qty || 1))) {
    delete cart[id];
  } else {
    item.qty = newQty;
  }
  cartSave();
  cartUpdateBadge();
  if (typeof renderProds === 'function') renderProds();
  // Re-render drawer if open
  const drawer = document.getElementById('cart');
  if (drawer?.classList.contains('op')) renderCartDrawer();
}

// Remove
function removeCartItem(id) {
  delete cart[id];
  cartSave();
  cartUpdateBadge();
  renderCartDrawer();
  if (typeof renderProds === 'function') renderProds();
}

// Clear
function clearCart() {
  if (!Object.keys(cart).length) return;
  if (!confirm('¿Vaciar el carrito?')) return;
  cart = {};
  cartSave();
  cartUpdateBadge();
  renderCartDrawer();
  if (typeof renderProds === 'function') renderProds();
}

// Total USD
function cartTotal() {
  return Object.values(cart).reduce((s, i) => s + i.price_usd * i.qty, 0);
}

// Count
function cartCount() {
  return Object.values(cart).reduce((s, i) => s + i.qty, 0);
}

// Badge
function cartUpdateBadge() {
  const b = document.getElementById('cartBadge');
  if (b) b.textContent = cartCount();
}

// Drawer open/close
let _cartUntrap = null;
function openCart() {
  renderCartDrawer();
  const drawer = document.getElementById('cart');
  drawer?.classList.add('op');
  document.getElementById('cov')?.classList.add('sh');
  document.body.style.overflow = 'hidden';
  _cartUntrap = trapFocus(drawer);   // atrapa foco + recuerda opener
}
function closeCart() {
  document.getElementById('cart')?.classList.remove('op');
  document.getElementById('cov')?.classList.remove('sh');
  document.body.style.overflow = '';
  if (_cartUntrap) { _cartUntrap(); _cartUntrap = null; }   // suelta y restaura foco
}

// Cerrar carrito con ESC (paridad con el modal de producto)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('cart')?.classList.contains('op')) closeCart();
});

// Render drawer
function renderCartDrawer() {
  const body = document.getElementById('cartBody');
  const ft   = document.getElementById('cartFt');
  if (!body) return;

  const items = Object.values(cart);
  if (!items.length) {
    body.innerHTML = `<div class="c-empty">
      <div class="c-empty-ico">🛒</div><p>Tu carrito está vacío</p>
      <a class="btn-p sm" style="margin-top:14px" href="catalogo.html">Ver catálogo →</a>
    </div>`;
    if (ft) ft.style.display = 'none';
    return;
  }

  const total = cartTotal();
  body.innerHTML = items.map(i => {
    const sub = i.price_usd * i.qty;
    const nm  = escapeHTML(i.name);
    const imgHTML = i.image_url
      ? `<img src="${encodeURI(i.image_url)}" alt="${nm}" loading="lazy">`
      : i.emoji || '📦';
    return `<div class="c-item">
      <div class="ci-ico">${imgHTML}</div>
      <div class="ci-info">
        <div class="ci-name">${nm}</div>
        ${i.brand ? `<div class="ci-brand">${escapeHTML(i.brand)}</div>` : ''}
        <div class="ci-price">${fmtPrice(i.price_usd)}/${escapeHTML(i.unit || 'unid')}</div>
        <div class="ci-price-bs">${fmtBs(i.price_usd)}</div>
        <div class="ci-ctrl">
          <button class="qb" onclick="updateCartQty('${i.id}',-1)" aria-label="Quitar una unidad de ${nm}">−</button>
          <span class="qn" aria-label="Cantidad">${i.qty}</span>
          <button class="qb" onclick="updateCartQty('${i.id}',1)" aria-label="Agregar una unidad de ${nm}">+</button>
        </div>
      </div>
      <div class="ci-subtotal">${fmtPrice(sub)}</div>
      <button class="ci-del" onclick="removeCartItem('${i.id}')" title="Eliminar" aria-label="Eliminar ${nm} del carrito">✕</button>
    </div>`;
  }).join('');

  if (ft) {
    document.getElementById('cartTotal').textContent = fmtPrice(total);
    document.getElementById('cartTotalBs').textContent = fmtBs(total);
    ft.style.display = 'block';
  }
}

// Go to full on-site checkout page (carries the cart note along)
function goCheckout() {
  if (!Object.keys(cart).length) { showToast('Tu carrito está vacío', 'warn'); return; }
  const note = document.getElementById('cartNote')?.value || '';
  if (note) sessionStorage.setItem('jjp_checkout_note', note);
  window.location.href = 'checkout.html';
}

// Checkout → WhatsApp
function checkoutWA() {
  const items = Object.values(cart);
  if (!items.length) return;
  const note = document.getElementById('cartNote')?.value || '';
  let msg = '🛒 *Pedido JJ Paper*\n\n';
  let total = 0;
  items.forEach(i => {
    const sub = i.price_usd * i.qty;
    total += sub;
    msg += `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(sub)}\n`;
  });
  msg += `\n💰 *Total estimado: ${fmtPrice(total)}*`;
  msg += `\n💴 *Equivalente: ${fmtBs(total)}*`;
  if (note) msg += `\n\n📝 Nota: ${note}`;
  msg += '\n\n_Enviado desde JJ Paper Web_';
  openWA(msg);
}

// Inject drawer HTML into page
function injectCartDrawer() {
  const html = `
<div class="c-ov" id="cov" onclick="closeCart()"></div>
<div id="cart" role="dialog" aria-modal="true" aria-labelledby="cartHdTitle">
  <div class="c-hd">
    <h3 id="cartHdTitle">🛒 Mi Carrito</h3>
    <button class="c-cls" onclick="closeCart()" aria-label="Cerrar carrito">✕</button>
  </div>
  <div class="c-body" id="cartBody"></div>
  <div class="c-ft" id="cartFt" style="display:none">
    <div class="c-total-row">
      <span class="c-total-l">Total estimado</span>
      <span class="c-total-v" id="cartTotal">$0.00</span>
    </div>
    <div class="c-total-bs" id="cartTotalBs"></div>
    <div class="c-note">
      <label>📝 Nota para el pedido:</label>
      <textarea id="cartNote" placeholder="Pago, dirección, observaciones..."></textarea>
    </div>
    <button class="btn-p c-checkout" onclick="goCheckout()">✅ Completar pedido y pagar →</button>
    <button class="btn-wa" onclick="checkoutWA()">💬 Pedir por WhatsApp</button>
    <button class="btn-clc" onclick="clearCart()">🗑️ Vaciar carrito</button>
  </div>
</div>`;

  const placeholder = document.getElementById('cart-placeholder');
  if (placeholder) placeholder.outerHTML = html;
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  cartLoad();
  injectCartDrawer();
});
