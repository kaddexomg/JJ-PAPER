/* ======================================================
   JJ Paper — Checkout (pedido completo + pago en Bs + comprobante)
   ====================================================== */

let coMethod    = '';      // 'pago_movil' | 'transferencia' | 'efectivo'
let coReceipt   = null;    // File object
let coSubmitting = false;

// ---- Delivery state ----
let dlvType   = 'retiro';  // 'retiro' | 'delivery'
let dlvPoint  = null;      // { lat, lng } marcado por el cliente
let dlvMap    = null;      // instancia Leaflet (se crea al elegir delivery)
let dlvMarker = null;

// Distancia en línea recta (haversine) × 1.4: aproxima el recorrido real
// por calles sin depender de un servicio de rutas externo.
const DLV_ROAD_FACTOR = 1.4;

function dlvStoreCoords() {
  const s = APP.SETTINGS || {};
  const lat = parseFloat(s.map_lat), lng = parseFloat(s.map_lng);
  return (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null;
}

function dlvDistanceKm() {
  const store = dlvStoreCoords();
  if (!store || !dlvPoint) return null;
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(dlvPoint.lat - store.lat);
  const dLng = rad(dlvPoint.lng - store.lng);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(store.lat)) * Math.cos(rad(dlvPoint.lat)) * Math.sin(dLng / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a));
  return +(straight * DLV_ROAD_FACTOR).toFixed(1);
}

// Costo del envío: base + $/km, gratis desde delivery_free_over_usd (0 = nunca)
function coDeliveryFee(subtotal) {
  if (dlvType !== 'delivery' || !dlvPoint) return { fee: 0, km: null, free: false };
  const s = APP.SETTINGS || {};
  const km = dlvDistanceKm();
  if (km === null) return { fee: 0, km: null, free: false };
  const freeOver = parseFloat(s.delivery_free_over_usd) || 0;
  if (freeOver > 0 && subtotal >= freeOver) return { fee: 0, km, free: true };
  const base  = parseFloat(s.delivery_base_usd)   || 0;
  const perKm = parseFloat(s.delivery_per_km_usd) || 0;
  return { fee: +(base + perKm * km).toFixed(2), km, free: false };
}

// ---- Totals ----
function coTotals() {
  const items = Object.values(cart);
  const subtotal = items.reduce((s, i) => s + i.price_usd * i.qty, 0);
  const delivery = coDeliveryFee(subtotal);
  const total = subtotal + delivery.fee;
  const rate = getRate();
  return { items, subtotal, delivery, total, rate, bs: total * rate };
}

// ---- Render cart summary (editable) ----
function renderCheckoutItems() {
  const box   = document.getElementById('coItems');
  const empty = document.getElementById('coEmpty');
  const main  = document.getElementById('coMain');
  if (!box) return;

  const { items, subtotal, delivery, total, rate, bs } = coTotals();

  if (!items.length) {
    if (empty) empty.style.display = 'block';
    if (main)  main.style.display  = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (main)  main.style.display  = 'grid';

  box.innerHTML = items.map(i => {
    const nm  = escapeHTML(i.name);
    const sub = i.price_usd * i.qty;
    const img = i.image_url
      ? `<img src="${encodeURI(i.image_url)}" alt="${nm}" loading="lazy">`
      : `<span style="font-size:26px">${i.emoji || '📦'}</span>`;
    return `<div class="co-item">
      <div class="co-item-img">${img}</div>
      <div class="co-item-info">
        <div class="co-item-name">${nm}${i.brand ? ` <span class="co-item-brand">· ${escapeHTML(i.brand)}</span>` : ''}</div>
        <div class="co-item-price">${fmtPrice(i.price_usd)} <span>· ${fmtBs(i.price_usd)}</span> /${escapeHTML(i.unit || 'unid')}</div>
        <div class="co-item-ctrl">
          <button class="qb" onclick="coQty('${i.id}',-1)" aria-label="Quitar una unidad de ${nm}">−</button>
          <span class="qn" aria-label="Cantidad">${i.qty}</span>
          <button class="qb" onclick="coQty('${i.id}',1)" aria-label="Agregar una unidad de ${nm}">+</button>
          <button class="co-del" onclick="coRemove('${i.id}')" title="Quitar" aria-label="Quitar ${nm} del pedido">🗑️</button>
        </div>
      </div>
      <div class="co-item-sub">${fmtPrice(sub)}</div>
    </div>`;
  }).join('');

  // Totals
  document.getElementById('coSubUsd').textContent  = fmtPrice(subtotal);
  document.getElementById('coRate').textContent    = `Bs ${rate.toFixed(2)} / $`;
  document.getElementById('coTotalUsd').textContent = fmtPrice(total);
  document.getElementById('coTotalBs').textContent  = fmtBsNum(bs);

  // Línea de envío en el resumen
  const shipRow  = document.getElementById('coShipRow');
  const freeRow  = document.getElementById('coShipFreeRow');
  if (shipRow && freeRow) {
    const showFee  = dlvType === 'delivery' && dlvPoint && !delivery.free;
    const showFree = dlvType === 'delivery' && dlvPoint && delivery.free;
    shipRow.style.display = showFee ? 'flex' : 'none';
    freeRow.style.display = showFree ? 'flex' : 'none';
    if (showFee)  document.getElementById('coShipUsd').textContent = fmtPrice(delivery.fee);
    if (showFree) document.getElementById('coShipFreeLbl').textContent = `${delivery.km} km`;
  }
  dlvRenderQuote(subtotal, delivery);

  // Keep the Bs amounts in the payment panel in sync
  document.querySelectorAll('.co-pay-bs').forEach(el => el.textContent = fmtBsNum(bs));
}

function coQty(id, delta) {
  updateCartQty(id, delta);     // from cart.js (saves + badge)
  renderCheckoutItems();
}
function coRemove(id) {
  removeCartItem(id);           // from cart.js
  renderCheckoutItems();
}

// ---- Payment method selection ----
function selectPayment(method) {
  coMethod = method;
  document.querySelectorAll('.co-pm').forEach(el => {
    const on = el.dataset.m === method;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  document.getElementById('panel-pago_movil').style.display   = method === 'pago_movil'   ? 'block' : 'none';
  document.getElementById('panel-transferencia').style.display = method === 'transferencia' ? 'block' : 'none';
  document.getElementById('panel-efectivo').style.display     = method === 'efectivo'     ? 'block' : 'none';

  document.getElementById('coReceiptWrap').style.display =
    (method === 'pago_movil' || method === 'transferencia') ? 'block' : 'none';
}

// ---- Delivery UI ----
function selectDelivery(type) {
  dlvType = type;
  document.querySelectorAll('.co-dlv-opt').forEach(el => {
    const on = el.dataset.d === type;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.getElementById('coPickupPanel').style.display   = type === 'retiro'   ? 'block' : 'none';
  document.getElementById('coDeliveryPanel').style.display = type === 'delivery' ? 'block' : 'none';
  if (type === 'delivery') dlvInitMap();
  renderCheckoutItems();
}

function dlvInitMap() {
  if (!window.L) return;   // Leaflet no cargó: el pedido igual sale, sin cotización
  const center = dlvPoint || dlvStoreCoords() || { lat: 10.488, lng: -66.879 }; // fallback: Caracas
  if (!dlvMap) {
    dlvMap = L.map('dlvMap', { scrollWheelZoom: false }).setView([center.lat, center.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(dlvMap);
    const store = dlvStoreCoords();
    if (store) {
      L.marker([store.lat, store.lng], { icon: dlvIcon('🏬'), interactive: false })
        .addTo(dlvMap).bindTooltip('JJ Paper', { permanent: false });
    }
    dlvMap.on('click', e => dlvSetPoint(e.latlng.lat, e.latlng.lng));
  }
  // El contenedor estaba display:none al crear el mapa: recalcular tamaño
  setTimeout(() => dlvMap.invalidateSize(), 60);
}

// Pin sin imágenes (el CSS de Leaflet referencia PNGs que no vendoreamos)
function dlvIcon(emoji) {
  return L.divIcon({
    className: 'dlv-pin',
    html: `<span>${emoji}</span>`,
    iconSize: [34, 34], iconAnchor: [17, 30],
  });
}

function dlvSetPoint(lat, lng, { pan = false } = {}) {
  dlvPoint = { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
  if (dlvMap) {
    if (!dlvMarker) {
      dlvMarker = L.marker([lat, lng], { icon: dlvIcon('📍'), draggable: true }).addTo(dlvMap);
      dlvMarker.on('dragend', () => {
        const p = dlvMarker.getLatLng();
        dlvSetPoint(p.lat, p.lng);
      });
    } else {
      dlvMarker.setLatLng([lat, lng]);
    }
    if (pan) dlvMap.setView([lat, lng], Math.max(dlvMap.getZoom(), 15));
  }
  renderCheckoutItems();
}

function dlvUseMyLocation() {
  if (!navigator.geolocation) { showToast('Tu navegador no permite usar la ubicación', 'warn'); return; }
  showToast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    pos => dlvSetPoint(pos.coords.latitude, pos.coords.longitude, { pan: true }),
    ()  => showToast('No pudimos obtener tu ubicación. Marca el punto en el mapa.', 'warn'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function dlvSearchAddress() {
  const q = document.getElementById('dlvSearch')?.value.trim();
  if (!q) { showToast('Escribe una dirección para buscar', 'warn'); return; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ve&q=${encodeURIComponent(q)}`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    if (!data?.length) { showToast('No se encontró esa dirección. Marca el punto en el mapa.', 'warn'); return; }
    dlvSetPoint(+data[0].lat, +data[0].lon, { pan: true });
  } catch (e) {
    showToast('No se pudo buscar la dirección. Marca el punto en el mapa.', 'warn');
  }
}

function dlvRenderQuote(subtotal, delivery) {
  const box = document.getElementById('dlvQuote');
  if (!box) return;
  if (dlvType !== 'delivery' || !dlvPoint || delivery.km === null) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  document.getElementById('dlvKm').textContent = `${delivery.km} km`;
  document.getElementById('dlvFee').textContent = delivery.free
    ? '🎉 ¡Gratis!'
    : fmtPrice(delivery.fee);

  // Incentivo: cuánto falta para envío gratis
  const hint = document.getElementById('dlvHint');
  const freeOver = parseFloat(APP.SETTINGS?.delivery_free_over_usd) || 0;
  if (hint) {
    if (delivery.free) {
      hint.textContent = `Tu pedido supera ${fmtPrice(freeOver)}: el envío va por nuestra cuenta. 🎉`;
    } else if (freeOver > 0 && subtotal < freeOver) {
      hint.textContent = `💡 Agrega ${fmtPrice(freeOver - subtotal)} más y el envío es GRATIS. Un asesor confirma el costo junto con tu pago.`;
    } else {
      hint.textContent = 'El costo del envío se calcula por distancia desde la tienda y lo confirma un asesor junto con tu pago.';
    }
  }
}

// ---- Receipt file ----
function handleReceiptFile(input) {
  const file = input.files?.[0];
  const prev = document.getElementById('coReceiptPreview');
  if (!file) { coReceipt = null; if (prev) prev.innerHTML = ''; return; }

  if (file.size > 5 * 1024 * 1024) {
    showToast('La imagen supera 5 MB', 'warn');
    input.value = ''; coReceipt = null; return;
  }
  coReceipt = file;
  if (prev) {
    const url = URL.createObjectURL(file);
    prev.innerHTML = `<img src="${url}" alt="Comprobante"><span>✔ ${escapeHTML(file.name)}</span>`;
  }
}

// ---- Build order object ----
function buildOrder(orderNumber) {
  const { items, subtotal, delivery, total, rate, bs } = coTotals();
  return {
    order_number: orderNumber,
    client_name: document.getElementById('co-name').value.trim(),
    rif:   document.getElementById('co-rif').value.trim()   || null,
    phone: document.getElementById('co-tel').value.trim(),
    email: document.getElementById('co-email').value.trim() || null,
    city:  document.getElementById('co-city').value.trim()  || null,
    address: document.getElementById('co-address').value.trim() || null,
    items: items.map(i => ({
      id: i.product_id || i.id, variant_id: i.variant_id || null, sku: i.sku || null,
      name: i.name, brand: i.brand || null, qty: i.qty, unit: i.unit || 'unid',
      price_usd: i.price_usd, subtotal_usd: +(i.price_usd * i.qty).toFixed(2),
    })),
    subtotal_usd: +subtotal.toFixed(2),
    total_usd: +total.toFixed(2),
    exchange_rate: rate,
    total_bs: +bs.toFixed(2),
    // Delivery: el staff confirma o ajusta el costo en admin/pedidos
    delivery_type: dlvType,
    delivery_lat: dlvType === 'delivery' ? dlvPoint?.lat ?? null : null,
    delivery_lng: dlvType === 'delivery' ? dlvPoint?.lng ?? null : null,
    delivery_distance_km: dlvType === 'delivery' ? delivery.km : null,
    delivery_fee_usd: delivery.fee,
    payment_method: coMethod,
    payment_ref: document.getElementById('co-payref')?.value.trim() || null,
    notes: document.getElementById('co-notes').value.trim() || null,
    // Atribución de vendedor por link de referido (resuelto en initCheckout)
    seller_id: window.__refSellerId || null,
    source: window.__refSellerId ? 'ref' : 'web',
  };
}

// ---- Validation shared by both submit paths ----
function validateCheckout() {
  const name  = document.getElementById('co-name').value.trim();
  const tel   = document.getElementById('co-tel').value.trim();
  const email = document.getElementById('co-email').value.trim();
  if (!Object.keys(cart).length) { showToast('Tu carrito está vacío', 'warn'); return false; }
  if (!name) { showToast('Ingresa tu nombre o empresa', 'warn'); document.getElementById('co-name').focus(); return false; }
  if (!tel)  { showToast('Ingresa tu teléfono', 'warn'); document.getElementById('co-tel').focus(); return false; }

  // Teléfono venezolano: 04XX-XXXXXXX o +58 4XX..., acepta separadores comunes
  const telDigits = tel.replace(/\D/g, '');
  const telOk = /^(0?4\d{9}|584\d{9})$/.test(telDigits) || /^0?2\d{9}$/.test(telDigits);
  if (!telOk) {
    showToast('Revisa el teléfono (ej: 0412-1234567)', 'warn');
    document.getElementById('co-tel').focus(); return false;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    showToast('Revisa el correo electrónico', 'warn');
    document.getElementById('co-email').focus(); return false;
  }

  // Monto mínimo de pedido (configurable en jjp_settings.order_min_usd)
  const minOrder = parseFloat(APP.SETTINGS?.order_min_usd) || 0;
  const { subtotal } = coTotals();
  if (minOrder > 0 && subtotal < minOrder) {
    showToast(`El pedido mínimo es ${fmtPrice(minOrder)}`, 'warn');
    return false;
  }

  // Delivery exige el punto en el mapa (es lo que cotiza el envío)
  if (dlvType === 'delivery' && !dlvPoint) {
    showToast('Marca en el mapa el punto de entrega', 'warn');
    document.getElementById('coDeliveryBox')?.scrollIntoView({ behavior:'smooth' });
    return false;
  }

  if (!coMethod) { showToast('Selecciona un método de pago', 'warn');
    document.getElementById('coPayBox')?.scrollIntoView({ behavior:'smooth' }); return false; }
  return true;
}

// ---- Upload receipt, returns storage path or null ----
// El bucket jjp-receipts es PRIVADO: se guarda el path y el admin genera signed URLs.
async function uploadReceipt(orderNumber) {
  if (!coReceipt) return null;
  const ext  = (coReceipt.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
  const path = `${orderNumber}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(APP.RECEIPTS_BUCKET)
    .upload(path, coReceipt, { contentType: coReceipt.type, upsert: false });
  if (error) { console.warn('receipt upload error:', error); return null; }
  return path;
}

// ---- Primary submit: register order in Supabase ----
async function submitOrder() {
  if (coSubmitting || !validateCheckout()) return;

  // Require receipt for electronic payments (the whole point is verification)
  if ((coMethod === 'pago_movil' || coMethod === 'transferencia') && !coReceipt) {
    showToast('Sube el comprobante de pago (o usa "Enviar por WhatsApp")', 'warn');
    document.getElementById('coReceiptWrap')?.scrollIntoView({ behavior:'smooth' });
    return;
  }

  coSubmitting = true;
  const btn = document.getElementById('coSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }

  const orderNumber = genOrderNumber();
  const order = buildOrder(orderNumber);

  const receiptUrl = await uploadReceipt(orderNumber);
  order.receipt_url = receiptUrl;
  order.status = (coMethod === 'efectivo')
    ? 'pendiente_pago'
    : (receiptUrl ? 'verificando' : 'pendiente_pago');

  const { error } = await sb.from('jjp_orders').insert(order);
  if (error) {
    console.error('order insert error:', error);
    showToast('No se pudo registrar el pedido. Intenta de nuevo.', 'err');
    coSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar pedido'; }
    return;
  }

  showConfirmation(order);
}

// ---- Secondary path: send full order to WhatsApp (also saves it) ----
async function submitOrderWA() {
  // Mismo guard que submitOrder: doble clic aquí insertaba dos pedidos
  if (coSubmitting || !validateCheckout()) return;
  coSubmitting = true;
  const orderNumber = genOrderNumber();
  const order = buildOrder(orderNumber);

  const receiptUrl = await uploadReceipt(orderNumber);
  order.receipt_url = receiptUrl;
  order.status = 'pendiente_pago';
  // Best-effort save (don't block the WhatsApp handoff on errors)
  sb.from('jjp_orders').insert(order).then(({ error }) => {
    if (error) console.warn('order (WA) save error:', error);
  });

  openWA(buildWAMessage(order));
  showConfirmation(order, true);
}

function buildWAMessage(o) {
  const methodLabel = {
    pago_movil: 'Pago Móvil (Bs)', transferencia: 'Transferencia (Bs)', efectivo: 'Efectivo / Contra entrega',
  }[o.payment_method] || 'Por confirmar';

  let msg = `🛒 *PEDIDO ${o.order_number}*\n_JJ Paper · ${fmtDate(new Date().toISOString())}_\n\n`;
  msg += `*Cliente:* ${o.client_name}\n`;
  if (o.rif)   msg += `*RIF/CI:* ${o.rif}\n`;
  msg += `*Teléfono:* ${o.phone}\n`;
  if (o.city)    msg += `*Ciudad:* ${o.city}\n`;
  if (o.address) msg += `*Dirección:* ${o.address}\n`;
  if (o.delivery_type === 'delivery') {
    msg += `*Entrega:* 🛵 Delivery${o.delivery_distance_km ? ` (~${o.delivery_distance_km} km)` : ''}\n`;
    if (o.delivery_lat && o.delivery_lng) msg += `*Punto de entrega:* https://maps.google.com/?q=${o.delivery_lat},${o.delivery_lng}\n`;
  } else if (o.delivery_type === 'retiro') {
    msg += `*Entrega:* 🏬 Retiro en tienda\n`;
  }
  msg += `\n*Productos:*\n`;
  o.items.forEach(i => { msg += `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}\n`; });
  if (o.delivery_fee_usd > 0) msg += `\n🛵 *Envío: ${fmtPrice(o.delivery_fee_usd)}*`;
  else if (o.delivery_type === 'delivery') msg += `\n🛵 *Envío: GRATIS* 🎉`;
  msg += `\n💰 *Total: ${fmtPrice(o.total_usd)}*`;
  msg += `\n💴 *En bolívares: ${fmtBsNum(o.total_bs)}* (tasa ${o.exchange_rate.toFixed(2)})`;
  msg += `\n💳 *Pago:* ${methodLabel}`;
  if (o.receipt_url) msg += `\n🧾 Comprobante: ${o.receipt_url}`;
  if (o.notes) msg += `\n\n📝 *Nota:* ${o.notes}`;
  msg += `\n\n_Enviado desde JJPaper.com.ve_`;
  return msg;
}

// ---- Confirmation screen ----
function showConfirmation(o, viaWA = false) {
  const wrap = document.getElementById('checkoutWrap');
  const methodLabel = {
    pago_movil: 'Pago Móvil', transferencia: 'Transferencia bancaria', efectivo: 'Efectivo / Contra entrega',
  }[o.payment_method] || '';

  const statusMsg = o.payment_method === 'efectivo'
    ? 'Tu pedido fue registrado. Pagarás al recibir/retirar.'
    : (o.receipt_url
        ? 'Recibimos tu comprobante. Un asesor verificará el pago y confirmará tu pedido.'
        : 'Tu pedido fue registrado. Te falta enviar el comprobante de pago para confirmarlo.');

  wrap.innerHTML = `
  <div class="co-done">
    <div class="co-done-ico">✅</div>
    <h2>¡Pedido recibido!</h2>
    <p class="co-done-num">N° <strong>${escapeHTML(o.order_number)}</strong></p>
    <p class="co-done-msg">${statusMsg}</p>
    <div class="co-done-box">
      ${o.delivery_type === 'delivery' ? `<div class="co-done-row"><span>Entrega 🛵</span><strong>${o.delivery_fee_usd > 0 ? fmtPrice(o.delivery_fee_usd) : 'Envío gratis 🎉'}${o.delivery_distance_km ? ` · ~${o.delivery_distance_km} km` : ''}</strong></div>` : ''}
      ${o.delivery_type === 'retiro' ? `<div class="co-done-row"><span>Entrega</span><strong>🏬 Retiro en tienda</strong></div>` : ''}
      <div class="co-done-row"><span>Total</span><strong>${fmtPrice(o.total_usd)}</strong></div>
      <div class="co-done-row"><span>En bolívares</span><strong>${fmtBsNum(o.total_bs)}</strong></div>
      <div class="co-done-row"><span>Método de pago</span><strong>${methodLabel}</strong></div>
    </div>
    <p class="co-done-hint">📲 Guarda tu número de pedido. Puedes consultar su estado en cualquier momento en <a href="rastreo.html" style="color:var(--gd);font-weight:700">Rastrear pedido</a>.</p>
    <div class="co-done-acts">
      ${viaWA ? '' : `<button class="btn-wa" onclick="openWA(buildWAMessage(window.__lastOrder))">💬 Avisar por WhatsApp</button>`}
      <a class="btn-o" href="rastreo.html?n=${encodeURIComponent(o.order_number)}">🔎 Rastrear mi pedido</a>
      <a class="btn-p" href="catalogo.html">Seguir comprando →</a>
    </div>
  </div>`;

  window.__lastOrder = o;
  // Recordar el pedido en este navegador para el rastreo rápido
  try {
    const mine = JSON.parse(localStorage.getItem('jjp_my_orders') || '[]');
    mine.unshift({ n: o.order_number, tel: o.phone, at: Date.now() });
    localStorage.setItem('jjp_my_orders', JSON.stringify(mine.slice(0, 10)));
  } catch (e) {}
  // Clear the cart now that the order is placed
  cart = {};
  cartSave();
  cartUpdateBadge();
  sessionStorage.removeItem('jjp_checkout_note');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Pedir cotización (mismo carrito, sin pago) ----
let quoteSubmitting = false;
async function submitQuote() {
  if (quoteSubmitting) return;
  // Validación ligera: solo nombre + teléfono (la cotización no requiere pago)
  const name = document.getElementById('co-name').value.trim();
  const tel  = document.getElementById('co-tel').value.trim();
  if (!Object.keys(cart).length) { showToast('Tu carrito está vacío', 'warn'); return; }
  if (!name) { showToast('Ingresa tu nombre o empresa', 'warn'); document.getElementById('co-name').focus(); return; }
  if (!tel)  { showToast('Ingresa tu teléfono', 'warn'); document.getElementById('co-tel').focus(); return; }
  const telDigits = tel.replace(/\D/g, '');
  const telOk = /^(0?4\d{9}|584\d{9})$/.test(telDigits) || /^0?2\d{9}$/.test(telDigits);
  if (!telOk) { showToast('Revisa el teléfono (ej: 0412-1234567)', 'warn'); document.getElementById('co-tel').focus(); return; }

  quoteSubmitting = true;
  const btn = document.getElementById('coQuoteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  const { items, subtotal } = coTotals();
  const qItems = items.map(i => ({
    id: i.product_id || i.id, variant_id: i.variant_id || null, sku: i.sku || null,
    name: i.name, brand: i.brand || null, qty: i.qty, unit: i.unit || 'unid',
    price_usd: i.price_usd, subtotal_usd: +(i.price_usd * i.qty).toFixed(2),
  }));

  const { data, error } = await sb.rpc('jjp_create_quote', {
    p_client_name: name,
    p_phone: tel,
    p_items: qItems,
    p_rif:  document.getElementById('co-rif').value.trim()   || null,
    p_city: document.getElementById('co-city').value.trim()  || null,
    p_email: document.getElementById('co-email').value.trim() || null,
    p_notes: document.getElementById('co-notes').value.trim() || null,
    p_source: 'web',
    p_estimated_total_usd: +subtotal.toFixed(2),
  });

  const row = Array.isArray(data) ? data[0] : data;   // la RPC devuelve table(quote_number)
  if (error || !row?.quote_number) {
    console.error('quote rpc error:', error);
    showToast('No se pudo enviar la cotización. Intenta de nuevo.', 'err');
    quoteSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '📋 Pedir cotización'; }
    return;
  }
  showQuoteConfirmation(row.quote_number, name, tel, qItems, subtotal);
}

function showQuoteConfirmation(quoteNumber, name, tel, items, subtotal) {
  const wrap = document.getElementById('checkoutWrap');
  const waMsg = `📋 *COTIZACIÓN ${quoteNumber}* — JJ Paper\n\nHola, soy ${name}. Solicité esta cotización desde la web:\n`
    + items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty}`).join('\n')
    + `\n\n💰 Total estimado: ${fmtPrice(subtotal)}\nQuedo atento a la confirmación de precios. ¡Gracias!`;
  window.__lastQuoteWA = waMsg;

  wrap.innerHTML = `
  <div class="co-done">
    <div class="co-done-ico">📋</div>
    <h2>¡Cotización enviada!</h2>
    <p class="co-done-num">N° <strong>${escapeHTML(quoteNumber)}</strong></p>
    <p class="co-done-msg">Recibimos tu solicitud. Un asesor confirmará los precios y te enviará la pre-factura a la brevedad.</p>
    <div class="co-done-box">
      <div class="co-done-row"><span>Productos</span><strong>${items.length}</strong></div>
      <div class="co-done-row"><span>Total estimado</span><strong>${fmtPrice(subtotal)}</strong></div>
    </div>
    <p class="co-done-hint">📲 Guarda tu número. Puedes consultar el estado en <a href="rastreo.html" style="color:var(--gd);font-weight:700">Rastrear</a>.</p>
    <div class="co-done-acts">
      <button class="btn-wa" onclick="openWA(window.__lastQuoteWA)">💬 Enviar por WhatsApp</button>
      <a class="btn-o" href="rastreo.html?c=${encodeURIComponent(quoteNumber)}">🔎 Rastrear cotización</a>
      <a class="btn-p" href="catalogo.html">Seguir viendo →</a>
    </div>
  </div>`;

  // Recordar la cotización en este navegador (rastreo rápido)
  try {
    const mine = JSON.parse(localStorage.getItem('jjp_my_quotes') || '[]');
    mine.unshift({ n: quoteNumber, tel, at: Date.now() });
    localStorage.setItem('jjp_my_quotes', JSON.stringify(mine.slice(0, 10)));
  } catch (e) {}
  cart = {}; cartSave(); cartUpdateBadge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Render payment data from settings ----
function renderPaymentData() {
  const s = APP.SETTINGS || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
  set('pm-bank',  s.pago_movil_bank);
  set('pm-phone', s.pago_movil_phone);
  set('pm-ci',    s.pago_movil_ci);
  set('pm-name',  s.pago_movil_name);
  set('tr-bank',    s.transfer_bank);
  set('tr-account', s.transfer_account);
  set('tr-type',    s.transfer_type);
  set('tr-holder',  s.transfer_holder);
  set('tr-ci',      s.transfer_ci);
}

// Copy helper for payment fields
function coCopy(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard?.writeText(el.textContent.trim())
    .then(() => showToast('Copiado ✔'))
    .catch(() => {});
}

// ---- Init ----
async function initCheckout() {
  await loadSettings();
  renderPaymentData();

  // Dirección de la tienda en el panel de retiro
  const storeAddr = document.getElementById('dlvStoreAddr');
  if (storeAddr) storeAddr.textContent = APP.SETTINGS?.address || 'consulta con un asesor';

  renderCheckoutItems();

  // Si el cliente llegó por link de vendedor, la venta queda atribuida
  window.__refSellerId = await resolveRefSeller();

  // Carry note from the cart drawer if present
  const note = sessionStorage.getItem('jjp_checkout_note');
  if (note) { const el = document.getElementById('co-notes'); if (el) el.value = note; }
}
