/* ======================================================
   JJ Paper — Cotizador Mayorista / Drawer Multi-Producto
   Permite al cliente armar su lista de requerimientos (varios productos),
   calcular totales estimados en USD y Bs a tasa BCV y enviarla por
   WhatsApp o registrar la solicitud formal de cotización.
   ====================================================== */

const QUOTE_STORAGE_KEY = 'jjp_client_quote_list_v1';
let clientQuoteList = {};

// Cargar estado inicial
function loadClientQuoteList() {
  try {
    const raw = localStorage.getItem(QUOTE_STORAGE_KEY);
    clientQuoteList = raw ? JSON.parse(raw) : {};
  } catch (e) {
    clientQuoteList = {};
  }
}

function saveClientQuoteList() {
  try {
    localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(clientQuoteList));
  } catch (e) {}
  updateQuoteUI();
}

// Agregar producto a la lista de cotización
function addToClientQuote(product, variant = null, qty = null) {
  if (!product) return;
  loadClientQuoteList();

  const p = product;
  const v = variant || (p.variants && p.variants[0]) || null;
  const key = v ? `${p.id}_${v.id}` : p.id;
  
  const minQty = Math.max(1, (v?.min_qty ?? p.min_qty) || 1);
  const addQty = qty ? parseInt(qty, 10) : minQty;
  
  const price = v 
    ? Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : v.price_a || 0))
    : Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : p.price_a || 0));

  const brand = v?.jjp_brands?.name || p._brands?.[0]?.name || 'JJ Paper';
  const img = v?.image_url || p.image_url || '';
  const unit = p.jjp_units?.name || p.unit || 'unid';

  if (clientQuoteList[key]) {
    clientQuoteList[key].qty += addQty;
  } else {
    clientQuoteList[key] = {
      key,
      productId: p.id,
      variantId: v?.id || null,
      name: p.name,
      brand: brand,
      variantName: v?.variant_name || '',
      packaging: p._packaging || (unit ? `Por ${unit}` : 'Unidad'),
      unit: unit,
      price: price,
      qty: addQty,
      minQty: minQty,
      image: img,
      sku: v?.sku || p.sku || 'JJ-PROD'
    };
  }

  saveClientQuoteList();
  
  if (typeof showToast === 'function') {
    showToast(`➕ Añadido a tu lista de cotización: ${p.name}`, 'ok');
  }

  // Animación del botón flotante
  const pill = document.getElementById('quoteDrawerPill');
  if (pill) {
    pill.style.transform = 'scale(1.1)';
    setTimeout(() => { pill.style.transform = 'none'; }, 200);
  }
}

// Cambiar cantidad en el drawer
function updateQuoteDrawerQty(key, delta) {
  if (!clientQuoteList[key]) return;
  const item = clientQuoteList[key];
  const next = item.qty + delta;
  if (next < item.minQty) {
    removeFromClientQuote(key);
    return;
  }
  item.qty = next;
  saveClientQuoteList();
  renderQuoteDrawerItems();
}

function removeFromClientQuote(key) {
  if (!clientQuoteList[key]) return;
  delete clientQuoteList[key];
  saveClientQuoteList();
  renderQuoteDrawerItems();
}

function clearClientQuote() {
  if (!confirm('¿Deseas vaciar todos los productos de tu lista de cotización?')) return;
  clientQuoteList = {};
  saveClientQuoteList();
  renderQuoteDrawerItems();
}

// Cálculo de Totales
function getQuoteListTotals() {
  const items = Object.values(clientQuoteList);
  const totalUsd = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const rate = (typeof getRate === 'function') ? getRate() : 40;
  const totalBs = (totalUsd * rate).toFixed(2);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  return { items, totalUsd, totalBs, count, linesCount: items.length, rate };
}

// Actualizar píldora y UI
function updateQuoteUI() {
  const totals = getQuoteListTotals();
  const pill = document.getElementById('quoteDrawerPill');
  const countSpan = document.getElementById('qdPillCount');
  const totalSpan = document.getElementById('qdPillTotal');

  if (pill) {
    if (totals.linesCount > 0) {
      pill.style.display = 'flex';
      if (countSpan) countSpan.textContent = `${totals.linesCount} ${totals.linesCount === 1 ? 'producto' : 'productos'}`;
      if (totalSpan) totalSpan.textContent = `$${totals.totalUsd.toFixed(2)}`;
    } else {
      pill.style.display = 'none';
      closeQuoteDrawer();
    }
  }
}

// Abrir / Cerrar Drawer
function toggleQuoteDrawer(open = true) {
  const overlay = document.getElementById('quoteDrawerOverlay');
  if (!overlay) return;
  if (open) {
    loadClientQuoteList();
    renderQuoteDrawerItems();
    updateQuoteDrawerAdvisor();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  } else {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
}


// Actualiza el banner del asesor asignado en el drawer
async function updateQuoteDrawerAdvisor() {
  try {
    const banner = document.getElementById('qdAdvisorBanner');
    const nameEl = document.getElementById('qdAdvisorName');
    const codeEl = document.getElementById('qdAdvisorCode');
    if (!banner) return;
    const seller = (typeof getRefSellerInfo === 'function') ? await getRefSellerInfo() : null;
    if (seller && seller.name) {
      banner.style.display = 'flex';
      if (nameEl) nameEl.textContent = seller.name;
      if (codeEl) codeEl.textContent = 'Asesor: ' + (seller.code || seller.mixnet_code || '005');
    } else {
      banner.style.display = 'none';
    }
  } catch (_) {}
}

function closeQuoteDrawer() {
  toggleQuoteDrawer(false);
}

// Renderizado de ítems en el drawer
function renderQuoteDrawerItems() {
  const body = document.getElementById('qdBody');
  const footer = document.getElementById('qdFooter');
  if (!body) return;

  const totals = getQuoteListTotals();

  if (!totals.items.length) {
    body.innerHTML = `
      <div class="qd-empty">
        <div class="icon">📋</div>
        <p><strong>Tu lista de cotización está vacía.</strong></p>
        <p style="margin-top:6px;font-size:12px;color:#888;">Agrega productos desde el catálogo con el botón <strong>+ Cotizar</strong> para armar tu presupuesto mayorista.</p>
      </div>
    `;
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'flex';

  body.innerHTML = totals.items.map(item => {
    const subUsd = item.price * item.qty;
    const subBs = (subUsd * totals.rate).toFixed(2);
    const unitPriceBs = (item.price * totals.rate).toFixed(2);
    const vTxt = item.variantName ? `(${item.variantName})` : '';

    return `
      <div class="qd-item">
        <div class="qd-item-img">
          ${item.image ? `<img src="${item.image}" alt="">` : `<span style="font-size:24px">📦</span>`}
        </div>

        <div class="qd-item-info">
          <div class="qd-item-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
          <div class="qd-item-brand">${escapeHTML(item.brand)} ${escapeHTML(vTxt)}</div>
          <div class="qd-item-pkg">📦 ${escapeHTML(item.packaging)}</div>

          <div class="qd-item-controls">
            <div class="qd-stepper">
              <button type="button" onclick="updateQuoteDrawerQty('${item.key}', -1)">−</button>
              <span>${item.qty}</span>
              <button type="button" onclick="updateQuoteDrawerQty('${item.key}', 1)">+</button>
            </div>
            <span style="font-size:11px;color:#666">${escapeHTML(item.unit)}</span>
          </div>
        </div>

        <div class="qd-item-price-col">
          <button type="button" class="qd-del-btn" onclick="removeFromClientQuote('${item.key}')" title="Eliminar ítem">✕</button>
          <div class="qd-item-subtotal">$${subUsd.toFixed(2)}</div>
          <div class="qd-item-unitprice">Bs ${subBs}</div>
          <div class="qd-item-unitprice" style="font-size:9.5px;color:#888">$${item.price.toFixed(2)} c/u</div>
        </div>
      </div>
    `;
  }).join('');

  // Actualizar totales en el pie
  const totUsdEl = document.getElementById('qdTotalUsd');
  const totBsEl = document.getElementById('qdTotalBs');
  if (totUsdEl) totUsdEl.textContent = `$${totals.totalUsd.toFixed(2)}`;
  if (totBsEl) totBsEl.textContent = `Bs ${totals.totalBs}`;
}

// Enviar lista completa formateada estilo MixNet a WhatsApp (enrutada al asesor asignado)
async function sendClientQuoteListWA() {
  const totals = getQuoteListTotals();
  if (!totals.items.length) return;

  const seller = (typeof getRefSellerInfo === 'function') ? await getRefSellerInfo() : null;
  const sellerGreeting = seller?.name ? `Hola ${seller.name}` : 'Hola equipo JJ Paper';

  let msg = `📋 *SOLICITUD DE COTIZACIÓN MAYORISTA — JJ PAPER*\n\n` +
            `${sellerGreeting}, requiero cotización y confirmación de disponibilidad para la siguiente lista de requerimientos:\n\n`;

  totals.items.forEach((item, idx) => {
    const subUsd = (item.price * item.qty).toFixed(2);
    const subBs = (item.price * item.qty * totals.rate).toFixed(2);
    const vTxt = item.variantName ? ` (${item.brand} - ${item.variantName})` : ` (${item.brand})`;
    msg += `*${idx + 1}. ${item.name}*${vTxt}\n` +
           `   • Cantidad: *${item.qty} ${item.unit}* (Presentación: ${item.packaging})\n` +
           `   • Precio ref: ${item.price.toFixed(2)} c/u | Subtotal: *${subUsd}* (Bs ${subBs})\n\n`;
  });

  msg += `💰 *TOTAL ESTIMADO REFERENCIAL:* ${totals.totalUsd.toFixed(2)} (Bs ${totals.totalBs})\n` +
         `📊 *Tasa Oficial BCV:* Bs ${totals.rate.toFixed(2)}/USD\n`;

  if (seller?.code) {
    msg += `💼 *Asesor Asignado:* ${seller.name} (Código: ${seller.code})\n`;
  }
  msg += `\n*Nota:* Solicito revisión de precios por volumen o escala mayorista para mi empresa. Por favor confirmar disponibilidad para coordinar despacho.`;

  let rawPhone = seller?.phone || (typeof APP !== 'undefined' && APP.WA_NUM && APP.WA_NUM !== '584121234567' ? APP.WA_NUM : '584124676073');
  let cleanPhone = String(rawPhone).split('/')[0].replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '58' + cleanPhone.slice(1);
  if (!cleanPhone.startsWith('58')) cleanPhone = '58' + cleanPhone;
  if (cleanPhone.length < 10) cleanPhone = '584124676073';

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}


// Modal de Cotización Formal
function openFormalQuoteModal() {
  const modal = document.getElementById('formalQuoteModal');
  if (modal) modal.classList.add('open');
}

function closeFormalQuoteModal() {
  const modal = document.getElementById('formalQuoteModal');
  if (modal) modal.classList.remove('open');
}

async function submitFormalQuoteList(event) {
  event.preventDefault();
  const totals = getQuoteListTotals();
  if (!totals.items.length) return;

  const btn = document.getElementById('fqSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Generando cotización y PDF...';

  const contact = document.getElementById('fqContact').value.trim();
  const company = (document.getElementById('fqCompany')?.value || '').trim();
  const phone = document.getElementById('fqPhone').value.trim();
  const rif = 'V-00000000-0';
  const email = '';
  const city = 'Caracas';

  try {
    let seller = null;
    if (typeof getRefSellerInfo === 'function') {
      seller = await getRefSellerInfo();
    }
    let sellerId = seller?.id || null;
    if (!sellerId && typeof resolveRefSeller === 'function') {
      sellerId = await resolveRefSeller();
    }
    // Fallback al vendedor asignado predeterminado o general (005 Keyder / Jose Salazar)
    if (!sellerId) {
      sellerId = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164';
    }

    const rate = totals.rate || (typeof getRate === 'function' ? getRate() : 879.12);
    const quoteNum = 'COT-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000);

    const quoteItems = totals.items.map(it => ({
      id: it.productId,
      variant_id: it.variantId || null,
      sku: it.sku || 'JJ-PROD',
      name: it.name,
      brand: it.brand || 'Estándar',
      unit: it.unit || 'und',
      qty: it.qty,
      price_usd: Number(it.price.toFixed(2)),
      price_bs: Number((it.price * rate).toFixed(2)),
      subtotal_usd: Number((it.price * it.qty).toFixed(2)),
      is_custom: false
    }));

    const itemsSummary = totals.items.map((it, i) => 
      `${i+1}. ${it.name} (${it.brand}) x ${it.qty} ${it.unit} ($${(it.price * it.qty).toFixed(2)})`
    ).join('\n');

    // 1. REGISTRAR EN jjp_quotes (Para que aparezca de inmediato en Cotizaciones de Admin y Vendedor)
    const quotePayload = {
      quote_number: quoteNum,
      client_name: company || contact,
      rif: rif,
      phone: phone,
      email: email || null,
      city: city || 'Caracas',
      items: quoteItems,
      estimated_total_usd: Number(totals.totalUsd.toFixed(2)),
      exchange_rate: Number(rate.toFixed(4)),
      discount_pct: 0,
      status: 'pendiente',
      source: 'web_catalogo',
      seller_id: sellerId,
      notes: `Solicitud web desde catálogo - Asesor: ${seller?.name || 'Comercial'} (${seller?.code || '005'}) - ${contact} (${phone})`
    };

    const quoteRes = await sb.from('jjp_quotes').insert(quotePayload).select().maybeSingle();
    const createdQuote = quoteRes.data || quotePayload;

    // 2. REGISTRAR EN jjp_prospects (CRM)
    const prospectPayload = {
      company_name: company,
      contact_name: contact,
      phone_1: phone,
      email: email,
      city: city,
      status: 'solicito_cotizacion',
      source: 'lista_cotizador_web',
      seller_id: sellerId,
      notes: `COTIZACIÓN WEB ${quoteNum}:\n` +
             `Total Ítems: ${totals.items.length} líneas (${totals.count} unidades)\n` +
             `Monto Estimado: $${totals.totalUsd.toFixed(2)} (Bs ${totals.totalBs})\n\n` +
             `Ítems solicitados:\n${itemsSummary}`
    };
    await sb.from('jjp_prospects').insert(prospectPayload);

    // 3. REGISTRAR NOTIFICACIÓN INTERNA EN jjp_notifications
    try {
      await sb.from('jjp_notifications').insert({
        user_id: sellerId,
        type: 'nueva_cotizacion_web',
        title: `⚡ Nueva Cotización Web: ${quoteNum}`,
        body: `${company || contact} solicitó cotización de ${totals.items.length} productos por ${totals.totalUsd.toFixed(2)} (${phone}). Asesor: ${seller?.name || 'Comercial'} (${seller?.code || '005'}).`,
        link: '/vendedor/cotizador.html',
        read: false
      });
    } catch (notifErr) {
      console.warn('Fallo registrando notificación interna:', notifErr);
    }

    // El cliente NO descarga PDF: el asesor recibe la solicitud, evalúa descuentos por volumen y emite la cotización formal.
    let rawPhone = seller?.phone || (typeof APP !== 'undefined' && APP.WA_NUM && APP.WA_NUM !== '584121234567' ? APP.WA_NUM : '584124676073');
    let cleanPhone = String(rawPhone).split('/')[0].replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '58' + cleanPhone.slice(1);
    if (!cleanPhone.startsWith('58')) cleanPhone = '58' + cleanPhone;
    if (cleanPhone.length < 10) cleanPhone = '584124676073';
    const waNum = cleanPhone;
    const notifyMsg = `👋 ¡Hola ${seller?.name || 'JJ Paper'}! Acabo de registrar mi requerimiento de cotización *${quoteNum}* en su catálogo web.\n\n` +
                      `👤 *Contacto:* ${contact}${company ? ' (' + company + ')' : ''}\n` +
                      `📞 *Teléfono:* ${phone}\n` +
                      `📦 *Líneas Solicitadas:* ${totals.items.length} productos (${totals.totalUsd.toFixed(2)} referencial)\n\n` +
                      `Por favor evaluar mejores costos por volumen y disponibilidad para remitir cotización formal. ¡Muchas gracias!`;
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(notifyMsg)}`;

    // Mostrar pantalla de confirmación interactiva dentro del modal
    const formEl = document.querySelector('#formalQuoteModal .fq-body');
    if (formEl) {
      formEl.innerHTML = `
        <div style="text-align:center; padding:16px 8px;">
          <div style="font-size:38px; margin-bottom:6px;">✅</div>
          <h3 style="margin:0 0 6px 0; color:#16604A; font-size:17px; font-weight:700;">¡Requerimiento ${quoteNum} Enviado!</h3>
          <p style="margin:0 0 16px 0; font-size:12.5px; color:#475569; line-height:1.4;">
            Tu lista de <strong>${totals.items.length} productos</strong> fue remitida a tu asesor asignado (<strong>${escapeHTML(seller?.name || 'JJ Paper')}</strong>). Prepararemos tu cotización formal con mejores costos por volumen a Tasa Oficial BCV.
          </p>
          <a href="${waUrl}" target="_blank" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; box-sizing:border-box; padding:12px; background:#25D366; border:none; color:#fff; border-radius:8px; font-weight:700; text-decoration:none; font-size:14px; margin-bottom:10px; box-shadow:0 2px 6px rgba(37,211,102,0.3);">
            <span>📲 Abrir WhatsApp y Avisar a mi Asesor</span>
          </a>
          <button type="button" style="width:100%; padding:9px; border:1px solid #cbd5e1; background:#f8fafc; color:#475569; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer;" onclick="closeFormalQuoteModal(); clearClientQuote();">
            ✕ Cerrar y Seguir en el Catálogo
          </button>
        </div>
      `;
    }

    if (typeof showToast === 'function') {
      showToast(`✔ ¡Requerimiento ${quoteNum} enviado a tu asesor!`);
    }

  } catch (err) {
    console.error('Error al guardar cotización:', err);
    alert('No se pudo guardar automáticamente en el sistema. Puedes enviarla directamente haciendo clic en "Enviar Lista a WhatsApp".');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Solicitud Formal';
    }
  }
}

// Inyectar HTML del Drawer y Pill en la página
function injectQuoteDrawer() {
  if (document.getElementById('quoteDrawerOverlay')) return;

  const html = `
    <!-- Botón Flotante -->
    <a href="javascript:void(0)" class="quote-drawer-pill" id="quoteDrawerPill" onclick="toggleQuoteDrawer(true)" style="display:none" title="Ver mi lista de cotización">
      <span>📋 Mi Cotización</span>
      <span class="pill-badge" id="qdPillCount">0</span>
      <span class="pill-total" id="qdPillTotal">$0.00</span>
    </a>

    <!-- Overlay y Drawer -->
    <div class="quote-drawer-overlay" id="quoteDrawerOverlay" onclick="if(event.target===this)closeQuoteDrawer()">
      <div class="quote-drawer-panel" id="quoteDrawerPanel">
        <div class="qd-header">
          <h3>📋 Tu Lista de Cotización Mayorista</h3>
          <button type="button" class="qd-close" onclick="closeQuoteDrawer()" aria-label="Cerrar">✕</button>
        </div>

        <div class="qd-advisor-banner" id="qdAdvisorBanner" style="display:none;background:#ecfdf5;border-bottom:1px solid #a7f3d0;padding:8px 16px;font-size:12px;color:#065f46;display:flex;align-items:center;justify-content:space-between;">
          <span>💼 Asesor Asignado: <strong id="qdAdvisorName">JJ Paper</strong></span>
          <span style="font-size:10.5px;background:#10b981;color:#fff;padding:2px 7px;border-radius:4px;font-weight:700" id="qdAdvisorCode">005</span>
        </div>
        <div style="background:#fffbeb;border-bottom:1px solid #fef3c7;padding:8px 16px;font-size:11.5px;color:#92400e;line-height:1.4;">
          💡 <strong>Precios referenciales:</strong> El costo unitario se puede mejorar sustancialmente y aplicar descuentos adicionales por volumen corporativo al procesar la cotización con su asesor comercial.
        </div>

        <div class="qd-body" id="qdBody"></div>

        <div class="qd-footer" id="qdFooter" style="display:none">
          <div class="qd-total-box">
            <div class="qd-tot-label">Total Estimado:</div>
            <div>
              <div class="qd-tot-usd" id="qdTotalUsd">$0.00</div>
              <div class="qd-tot-bs" id="qdTotalBs">Bs 0.00</div>
            </div>
          </div>

          <div class="qd-actions-row">
            <button type="button" class="btn-qd-wa" onclick="sendClientQuoteListWA()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.351.226-.652.075s-1.272-.469-2.423-1.496c-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.151-.176.201-.301.301-.502.1-.2.05-.376-.025-.526-.075-.15-.678-1.635-.929-2.241-.244-.59-.492-.51-.678-.52-.176-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376s-1.054 1.029-1.054 2.509c0 1.48 1.079 2.909 1.229 3.11.15.2 2.122 3.24 5.141 4.544.718.31 1.279.495 1.716.634.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/></svg>
              <span>Enviar Lista Completa a WhatsApp</span>
            </button>
            <button type="button" class="btn-qd-formal" onclick="openFormalQuoteModal()">
              <span>⚡ Enviar Requerimiento a mi Asesor</span>
            </button>
            <button type="button" class="qd-clear-btn" onclick="clearClientQuote()">
              🗑️ Vaciar Lista
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Envío de Requerimiento al Asesor -->
    <div class="formal-quote-modal" id="formalQuoteModal" role="dialog" aria-modal="true">
      <div class="fq-card">
        <div class="fq-head">
          <h4>⚡ Enviar Requerimiento a mi Asesor</h4>
          <button type="button" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer" onclick="closeFormalQuoteModal()">✕</button>
        </div>
        <form class="fq-body" onsubmit="submitFormalQuoteList(event)">
          <div style="font-size:12px;color:#16604a;background:#ecfdf5;border:1px solid #a7f3d0;padding:10px 14px;border-radius:8px;line-height:1.5">
            📦 Envía tu lista seleccionada a tu asesor asignado. Evaluaremos tu pedido para ofrecerte <strong>mejores costos y descuentos por volumen</strong> a Tasa Oficial BCV.
          </div>
          <input type="text" class="fq-input" id="fqContact" required placeholder="Tu Nombre / Persona de Contacto *">
          <input type="text" class="fq-input" id="fqCompany" placeholder="Empresa, Negocio o Colegio (Opcional)">
          <input type="tel" class="fq-input" id="fqPhone" required placeholder="Número de WhatsApp o Teléfono *">
          <button type="submit" class="btn-qd-formal" id="fqSubmitBtn" style="padding:12px;font-size:14px;border-radius:8px">
            ⚡ Enviar Requerimiento a mi Asesor
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  loadClientQuoteList();
  updateQuoteUI();
}

document.addEventListener('DOMContentLoaded', injectQuoteDrawer);
