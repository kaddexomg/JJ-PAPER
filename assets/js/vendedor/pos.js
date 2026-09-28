/* ======================================================
   JJ Paper Vendedor — POS (toma de pedido rápida)
   ====================================================== */

let posProducts = [];
let posTicket   = {};      // key → { id, variant_id, name, brand, qty, unit, price_usd, stock }
let posCustomer = null;    // cliente elegido del CRM (o null si es nuevo)
let posSubmitting = false;
let posCursor = -1;        // índice del resultado resaltado por teclado
let posResultsList = [];   // lista de resultados actualmente renderizada
let posLinkedQuoteId = null; // ID de cotización origen si la venta proviene de una cotización

async function initPos() {
  const isAdmin = (SELLER?.role === 'admin' || CURRENT_PROFILE?.role === 'admin');
  const max = isAdmin ? 100 : (Number(SELLER?.max_discount_pct) || 0);
  document.getElementById('posDiscMax').textContent = isAdmin ? '(Admin)' : `(máx ${max}%)`;
  document.getElementById('posDisc').max = max;

  posProducts = await pfLoad();          // buscador universal (nombre/SKU/código/marca)
  posRenderResults(pfMatch(posProducts, ''));
  posPrefillAdd();                        // ?add=<id> desde Consultar stock
  pfPhoneBridge(posOnScan);               // teléfono → agrega al ticket en vivo
  posInitCustomerKeys();                  // teclado ↑/↓/Enter en resultados de cliente
  posInitGlobalKeys();                    // atajos globales (F1, F2, F3, F4, F6, F7, F8, F9, F10, F11, Esc)
  posInitTabNav();                        // flujo secuencial ordenado con Tabulador

  // prefill de cliente si viene desde el CRM (?tel=... o ?cliente=<id>)
  const params = new URLSearchParams(location.search);
  const tel = params.get('tel');
  if (tel) {
    document.getElementById('posCliSearch').value = tel;
    posSearchCustomer();
  }
  const cliente = params.get('cliente');
  if (cliente) await posCargarCliente(cliente);

  // Carga directa de cotización si viene por URL (?quote=COT-... o ?cotizacion=...)
  const quoteParam = params.get('quote') || params.get('cotizacion');
  if (quoteParam) await posLoadQuote(quoteParam);

  // Autocompletado de cliente en el campo Nombre (elige → rellena tel/RIF/ciudad)
  custAcBind({
    nameId: 'posCliName',
    boxId: 'posCliNameResults',
    onPick: posPickCustomer,
    onChange: () => { posCustomer = null; },
  });
}

/* Llega con el cliente ya elegido desde el chat, el correo o la ficha:
   no hay que volver a escribir su nombre ni buscarlo. */
async function posCargarCliente(id) {
  const { data: c } = await sb.from('jjp_customers')
    .select('id,name,phone,rif,city,total_orders,total_usd').eq('id', id).maybeSingle();
  if (!c) { showToast('No se encontró ese cliente', 'warn'); return; }
  posPickCustomer(c);
}

/* ---------- Buscador de productos ---------- */
function posSearch() {
  posRenderResults(pfMatch(posProducts, document.getElementById('posSearch').value.trim()));
}

// Enter en el buscador: añade el resultado resaltado, o si el texto es un
// código exacto (lector físico) agrega abriendo la lista de precio A/B/C/D.
function posSearchKey(e) {
  if (document.querySelector('.pf-popup-mask')) return; // popup abierto: no interferir
  
  // Tabulador ordenado: salta limpiamente al siguiente campo del flujo de venta
  if (e.key === 'Tab') {
    e.preventDefault();
    posNavTab(e.shiftKey ? -1 : 1);
    return;
  }

  if (e.key === 'ArrowDown') { e.preventDefault(); posNav(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); posNav(-1); return; }
  if (e.key === 'PageDown') { e.preventDefault(); posNav(5); return; }
  if (e.key === 'PageUp') { e.preventDefault(); posNav(-5); return; }
  if (e.key === 'Home') { e.preventDefault(); posNavTo(0); return; }
  if (e.key === 'End') { e.preventDefault(); posNavTo(posResultsList.length - 1); return; }
  if (e.key === 'Escape') {
    const se = document.getElementById('posSearch');
    if (se && se.value.trim()) { se.value = ''; posSearch(); }
    else clearPos();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); posSubmit(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const se = document.getElementById('posSearch');
  const code = se.value.trim();
  if (!code) {
    // Si presiona Enter con buscador vacío, avanza al siguiente paso (cliente o ticket)
    posNavTab(1);
    return;
  }

  // 1. Intento por código exacto (código de barras o SKU de lector físico)
  const hit = pfFindByCode(posProducts, code);
  if (hit) {
    posAddAndPick(hit.product, hit.variant);
    showToast('➕ ' + hit.product.name);
    se.value = '';
    posSearch();
    return;
  }

  // 2. Si no hubo match exacto por código, busca en los resultados por nombre/tokens
  if (posCursor >= 0 && posCursor < posResultsList.length) {
    // El usuario ya había navegado a un elemento específico con las flechas, o le dio Enter por segunda vez
    posPickIdx();
    return;
  } else if (posResultsList.length > 0) {
    // Primera vez que presiona Enter después de escribir: sólo iluminar/seleccionar el primer resultado, sin agregarlo
    posNavTo(0);
    return;
  }

  // 3. Si no hay ningún resultado ni por código ni por nombre
  showToast('⚠️ No se encontró producto con ese código ni nombre', 'warn');
  se.select();
}

// Limpia el ticket actual (con confirmación si tiene líneas)
function clearPos() {
  if (posTicket && Object.keys(posTicket).length && !confirm('¿Vaciar el ticket actual?')) return;
  posTicket = {};
  posRenderTicket();
  const se = document.getElementById('posSearch');
  if (se) { se.value = ''; se.focus(); }
  posSearch();
}

// Agrega el producto que llega por ?add=<id> (desde Consultar stock)
function posPrefillAdd() {
  const id = new URLSearchParams(location.search).get('add');
  if (!id) return;
  const p = posProducts.find(x => x.id === id);
  if (!p) return;
  const v = (p.jjp_product_variants || []).filter(x => x.active)[0] || null;
  posAddAndPick(p, v);
}

// Escanear con la cámara del propio dispositivo
function posScanCam() {
  pfScanCamera(code => {
    const hit = pfFindByCode(posProducts, code);
    if (hit) { posAddAndPick(hit.product, hit.variant); showToast('➕ ' + hit.product.name); }
    else { document.getElementById('posSearch').value = code; posSearch(); showToast('Código no está en el catálogo; búscalo manual', 'warn'); }
  });
}

// Código que llega del teléfono-escáner (puente) → agrega al ticket con lista de precio
function posOnScan(code) {
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddAndPick(hit.product, hit.variant); showToast('📱➕ ' + hit.product.name); }
  else showToast('📱 Código no está en el catálogo: ' + code, 'warn');
}

// Modal para vincular el teléfono como pistola de código
function posPhone() {
  const url = pfPhoneScanUrl();
  const a = document.getElementById('posPhoneUrl');
  if (a) { a.textContent = url; a.href = url; }
  const qr = document.getElementById('posPhoneQR');
  if (qr) qr.href = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url);
  document.getElementById('posPhoneModal')?.classList.add('op');
}
function closePosPhone() { document.getElementById('posPhoneModal')?.classList.remove('op'); }

function posRenderResults(list) {
  const box = document.getElementById('posResults');
  if (!list.length) {
    posResultsList = []; posCursor = -1;
    box.innerHTML = '<p style="color:#aaa;font-size:13px;padding:12px;text-align:center">Sin resultados coincidentes.</p>'; return;
  }
  posResultsList = list; posCursor = -1;
  box.innerHTML = list.map((p, i) => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${optImg(p.image_url, 200)}" alt="" loading="lazy" decoding="async">`
      : `<span style="font-size:22px">${p.emoji || '📦'}</span>`;
    const vSel = variants.length
      ? `<select class="fi" id="pv-${p.id}" style="width:auto;font-size:12px;padding:4px 8px;margin-right:6px" onclick="event.stopPropagation()">
           ${variants.map(v => `<option value="${v.id}">${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')} · ${fmtPrice(v.price_usd)}</option>`).join('')}
         </select>` : '';
    return `<div class="pos-result" data-idx="${i}" onclick="posAdd('${p.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--theme-border-subtle, #e2e8f0);margin-bottom:6px;background:var(--theme-bg-surface-solid, #fff);transition:all .15s ease">
      <div class="pr-img" style="flex:none">${img}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--theme-text-main, #0f172a);line-height:1.3">${escapeHTML(p.name)}</div>
        <div style="font-size:11px;color:var(--theme-text-muted, #64748b);margin-top:2px">${pfPriceHtml(p.price_usd, p)} /${escapeHTML(p.unit || 'unid')} · <span class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</span></div>
      </div>
      <div style="display:flex;align-items:center;flex:none">
        ${vSel}
        <button type="button" class="btn-p sm" onclick="event.stopPropagation(); posAdd('${p.id}')" style="white-space:nowrap;padding:6px 12px;font-weight:700;background:var(--theme-accent, #16604a);color:#fff;border-radius:6px;display:inline-flex;align-items:center;gap:4px">Elegir Precio ➔</button>
      </div>
    </div>`;
  }).join('');
}

// Navegación por teclado sobre los resultados (↑/↓ / PgUp/PgDn / Home/End)
function posNav(dir) {
  const rows = (document.getElementById('posResults')?.querySelectorAll('.pos-result')) || [];
  if (!rows.length) return;
  posCursor = (posCursor + dir + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle('on', i === posCursor));
  rows[posCursor]?.scrollIntoView({ block: 'nearest' });
}

function posNavTo(idx) {
  const rows = (document.getElementById('posResults')?.querySelectorAll('.pos-result')) || [];
  if (!rows.length) return;
  if (idx < 0) idx = 0;
  if (idx >= rows.length) idx = rows.length - 1;
  posCursor = idx;
  rows.forEach((r, i) => r.classList.toggle('on', i === posCursor));
  rows[posCursor]?.scrollIntoView({ block: 'nearest' });
}

// Agrega el resultado seleccionado con el cursor (Enter)
function posPickIdx() {
  const p = posResultsList[posCursor];
  if (!p) return;
  const variants = (p.jjp_product_variants || []).filter(v => v.active);
  let variant = null;
  if (variants.length) {
    const vid = document.getElementById(`pv-${p.id}`)?.value;
    variant = variants.find(v => v.id === vid) || variants[0];
  }
  posAddAndPick(p, variant);
}

function posAdd(pid) {
  const p = posProducts.find(x => x.id === pid);
  if (!p) return;
  const variants = (p.jjp_product_variants || []).filter(v => v.active);
  let variant = null;
  if (variants.length) {
    const vid = document.getElementById(`pv-${pid}`)?.value;
    variant = variants.find(v => v.id === vid) || variants[0];
  }
  posAddAndPick(p, variant);
}

// Agrega un producto abriendo el selector de precio unificado (A/B/C/D y cantidad)
function posAddAndPick(p, variant) {
  if (!p) return;
  const key = variant ? `${p.id}::${variant.id}` : p.id;
  const src = variant || p;
  const existing = posTicket[key];

  let initialQty = existing ? existing.qty : Math.max(1, Number(p.min_qty) || 1);
  if (posSwapTargetKey && posTicket[posSwapTargetKey]) {
    initialQty = posTicket[posSwapTargetKey].qty;
  }

  const tempLine = {
    id: p.id,
    variant_id: variant?.id || null,
    name: p.name,
    sku: variant?.sku || p.sku || '',
    brand: variant ? (variant.jjp_brands?.name || variant.variant_name || null) : null,
    unit: p.unit || 'unid',
    price_usd: Number(src.price_usd || src.price_b || 0),
    price_level: existing?.price_level || 'B',
    price_a: Number(src.price_a) || 0,
    price_b: Number(src.price_b) || Number(src.price_usd) || 0,
    price_c_bs: Number(src.price_c_bs) || 0,
    price_d_bs: Number(src.price_d_bs) || 0,
    qty: initialQty,
    stock: variant ? variant.stock : p.stock,
  };

  pfOpenProductModal(tempLine).then(choice => {
    if (!choice) {
      if (posSwapTargetKey) {
        posSwapTargetKey = null; // abortó el reemplazo
      }
      const se = document.getElementById('posSearch');
      if (se) { se.focus(); se.select(); }
      return;
    }

    tempLine.price_level = choice.level;
    tempLine.price_usd = Number(choice.price_usd);
    tempLine.qty = Number(choice.qty);

    if (posSwapTargetKey) {
      if (key !== posSwapTargetKey) {
        const newTicket = {};
        for (const k in posTicket) {
          if (k === posSwapTargetKey) {
            newTicket[key] = tempLine;
          } else {
            newTicket[k] = posTicket[k];
          }
        }
        posTicket = newTicket;
      } else {
        // Mismo producto, solo actualiza
        posTicket[key] = tempLine;
      }
      posSwapTargetKey = null;
    } else {
      posTicket[key] = tempLine;
    }

    posRenderTicket();
    showToast(`✅ ${tempLine.name} agregado (Nivel ${tempLine.price_level} · x${tempLine.qty})`);

    const se = document.getElementById('posSearch');
    if (se) {
      se.value = '';
      if (typeof posSearch === 'function') posSearch();
      se.focus();
    }
  });
}

// Agrega un producto (con variante ya resuelta) al ticket


// Precio en bolívares de una línea del ticket: los niveles C/D cotizan directo
// en Bs (valor real del archivo MixNet), A/B usan la conversión del día.
function posLineBs(l) {
  const rate = getRate();
  if (l.price_level === 'C') return Number(l.price_c_bs) || 0;
  if (l.price_level === 'D') return Number(l.price_d_bs) || 0;
  return (Number(l.price_usd) || 0) * rate;
}

/// Cambia el nivel de precio de una línea: A/B en US$, C/D en Bs (default B).
function posSetPriceLevel(key, level) {
  const l = posTicket[key];
  if (!l || l.is_custom || !['A', 'B', 'C', 'D'].includes(level)) return;
  const rate = getRate();
  let usd = 0;
  if (level === 'A') usd = Number(l.price_a) || 0;
  else if (level === 'B') usd = Number(l.price_b) || Number(l.price_usd) || 0;   // precio efectivo (incluye precio personalizado del vendedor)
  else if (level === 'C') usd = (Number(l.price_c_bs) || 0) / rate;
  else if (level === 'D') usd = (Number(l.price_d_bs) || 0) / rate;
  if (!(usd > 0)) { showToast('Este producto no tiene precio ' + level, 'warn'); return; }
  l.price_level = level;
  l.price_usd = +usd.toFixed(2);
  posRenderTicket();
}

/* ---------- Ticket ---------- */
function posQty(key, delta) {
  const l = posTicket[key];
  if (!l) return;
  l.qty += delta;
  if (l.qty <= 0) delete posTicket[key];
  posRenderTicket();
}

function posSetQty(key, val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) {
    delete posTicket[key];
  } else {
    if (posTicket[key]) posTicket[key].qty = n;
  }
  posRenderTicket();
}

let posSwapTargetKey = null;

function posSwapLine(key) {
  posSwapTargetKey = key;
  const se = document.getElementById('posSearch');
  if (se) {
    se.value = '';
    se.focus();
    se.select();
  }
  if (typeof posSearch === 'function') {
    posSearch(); // Actualiza/limpia resultados
  }
  showToast('Busca y selecciona el producto para reemplazarlo', 'info');
}

function posRemoveLine(key) {
  delete posTicket[key];
  posRenderTicket();
}

function posDiscount() {
  const max = Number(SELLER?.max_discount_pct) || 0;
  let d = parseFloat(document.getElementById('posDisc').value) || 0;
  if (d < 0) d = 0;
  if (d > max) { d = max; document.getElementById('posDisc').value = max; }
  return d;
}

let posTicketCursor = -1;

function posRenderTicket() {
  const box  = document.getElementById('posTicket');
  const tots = document.getElementById('posTotals');
  const lines = Object.entries(posTicket);
  if (!lines.length) {
    posTicketCursor = -1;
    box.innerHTML = '<p style="color:#aaa;font-size:13px">Agrega productos desde el buscador.</p>';
    tots.innerHTML = '';
    return;
  }
  if (posTicketCursor >= lines.length) posTicketCursor = lines.length - 1;

  box.innerHTML = lines.map(([k, l], idx) => {
    const isCursor = (posTicketCursor === idx);
    const lvlBtn = (lv, lbl) => {
      const isAct = (l.price_level === lv);
      const bg = isAct ? 'var(--theme-accent, #16604a)' : 'var(--theme-item-bg, #f1f5f9)';
      const col = isAct ? '#ffffff' : 'var(--theme-text-muted, #475569)';
      const bdr = isAct ? 'var(--theme-accent, #16604a)' : 'var(--theme-border-subtle, #cbd5e1)';
      return `<button type="button" onclick="posSetPriceLevel('${k}','${lv}')" style="background:${bg};color:${col};border:1px solid ${bdr};border-radius:6px;padding:2px 7px;font-size:11px;font-weight:800;cursor:pointer;transition:all .1s" title="${lbl}">${lv}</button>`;
    };
    const isCustomBadge = l.is_custom ? '<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-weight:800;margin-left:4px">LIBRE</span>' : '';
    const levelSelector = l.is_custom ? '' : `
        <div style="font-size:11px;color:var(--theme-text-muted, #64748b);display:flex;align-items:center;gap:6px;margin-top:4px">
          <span style="font-weight:700;color:var(--theme-text-main, #334155)">Nivel:</span>
          <div style="display:flex;gap:3px">
            ${lvlBtn('A', 'Precio A (Detal / Menor)')}
            ${lvlBtn('B', 'Precio B (Mayorista Frecuente ⭐)')}
            ${lvlBtn('C', 'Precio C (Bs Oficial)')}
            ${lvlBtn('D', 'Precio D (Bs Mayor)')}
          </div>
        </div>`;
    const isDark = (document.documentElement.getAttribute('data-theme') === 'dark');
    const lineBg = isCursor ? (isDark ? 'rgba(16,185,129,0.16)' : '#f0fdf4') : 'var(--theme-bg-surface-solid, #ffffff)';
    const lineBdr = isCursor ? 'var(--theme-accent, #10b981)' : 'var(--theme-border-subtle, #e2e8f0)';
    return `
    <div class="pos-line" style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid ${lineBdr};border-radius:10px;background:${lineBg};margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.03);transition:all .12s ease">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:var(--theme-text-main, #0f172a);display:flex;align-items:center;gap:4px">
            <input type="text" class="fi ticket-nav-input" id="pos-name-in-${k}" data-ticket-field="name" data-ticket-idx="${idx}" data-ticket-key="${k}" value="${escapeHTML(l.name)}" style="font-weight:700;font-size:13px;color:var(--theme-text-main, #0f172a);padding:2px 6px;margin:0;flex:1;height:26px;border:1px solid transparent;background:transparent;border-radius:4px" onfocus="this.style.border='1px solid var(--theme-border-glass, #cbd5e1)';this.style.background='var(--theme-input-bg, #fff)'" onblur="this.style.border='1px solid transparent';this.style.background='transparent'" onchange="posUpdateName('${k}', this.value)" aria-label="Nombre del producto">
            ${l.brand ? `<small style="color:var(--theme-text-muted, #64748b);font-weight:600">(${escapeHTML(l.brand)})</small>` : ''}
            ${isCustomBadge}
          </div>
          ${levelSelector}
        </div>
        <div style="display:flex; gap:4px">
          <button type="button" onclick="posSwapLine('${k}')" title="Reemplazar este producto" style="padding:4px 6px;color:#0284c7;border:none;background:transparent;cursor:pointer;font-size:15px;border-radius:6px;transition:background .1s" onmouseover="this.style.background='rgba(2,132,199,0.1)'" onmouseout="this.style.background='transparent'">🔄</button>
          <button type="button" onclick="posRemoveLine('${k}')" title="Eliminar este producto" style="padding:4px 6px;color:#ef4444;border:none;background:transparent;cursor:pointer;font-size:15px;border-radius:6px;transition:background .1s" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='transparent'">🗑️</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:4px;border-top:1px dashed var(--theme-border-subtle, #f1f5f9);margin-top:2px">
        <div style="font-size:11px;color:var(--theme-text-muted, #64748b);display:flex;align-items:center;gap:4px">
          <span>Precio:</span>
          <span style="font-weight:700;color:var(--theme-text-main, #0f172a)">$</span>
          <input type="number" step="0.01" id="pos-price-in-${k}" data-ticket-field="price" data-ticket-idx="${idx}" data-ticket-key="${k}" class="fi ticket-nav-input" value="${l.price_usd}" style="width:72px;font-size:12px;font-weight:700;padding:2px 4px;margin:0;height:24px;border-radius:4px" onchange="posUpdatePrice('${k}', this.value)" aria-label="Precio unitario de ${escapeHTML(l.name)}">
          <span>/${escapeHTML(l.unit)}</span>
          <span style="color:var(--theme-accent, #047857);font-weight:600;margin-left:4px">≈ Bs ${fmtBsNum(posLineBs(l))}</span>
        </div>

        <div style="display:flex;align-items:center;gap:10px">
          <div style="display:flex;align-items:center;gap:3px">
            <button type="button" class="qb" onclick="posQty('${k}',-1)" title="Restar 1" style="width:24px;height:24px;border-radius:4px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);color:var(--theme-text-main, #0f172a);cursor:pointer;font-weight:700">−</button>
            <input type="number" min="1" id="pos-qty-in-${k}" data-ticket-field="qty" data-ticket-idx="${idx}" data-ticket-key="${k}" class="fi ticket-nav-input" value="${l.qty}" style="width:46px;height:24px;text-align:center;padding:2px 4px;margin:0;font-size:12px;font-weight:800;border-radius:4px" onchange="posSetQty('${k}', this.value)" onkeydown="if(event.key==='+'||event.key==='='){event.preventDefault();posQty('${k}',1);}else if(event.key==='-'||event.key==='_'){event.preventDefault();posQty('${k}',-1);}" aria-label="Cantidad">
            <button type="button" class="qb" onclick="posQty('${k}',1)" title="Sumar 1" style="width:24px;height:24px;border-radius:4px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);color:var(--theme-text-main, #0f172a);cursor:pointer;font-weight:700">＋</button>
          </div>
          <strong style="min-width:65px;text-align:right;font-size:14px;color:var(--theme-text-main, #0f172a)">${fmtPrice(l.price_usd * l.qty)}</strong>
        </div>
      </div>
    </div>`;
  }).join('');

  const subtotal = lines.reduce((s, [, l]) => s + l.price_usd * l.qty, 0);
  const d        = posDiscount();
  const rate     = getRate();
  tots.innerHTML = `
    <div style="background:var(--theme-bg-surface-solid, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--theme-text-muted, #475569)">
        <span>Subtotal</span>
        <strong style="color:var(--theme-text-main, #0f172a)">${fmtPrice(subtotal)}</strong>
      </div>
      ${d > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#166534">
          <span>Descuento (${d}%) solicitado</span>
          <span>⏳ pendiente aprobación</span>
        </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--theme-border-subtle, #cbd5e1);margin-top:2px">
        <span style="font-size:14px;font-weight:800;color:var(--theme-text-main, #0f172a)">Total a cobrar</span>
        <span style="font-size:19px;font-weight:900;color:var(--theme-accent, #16604a)">${fmtPrice(subtotal)}</span>
      </div>
      ${sellerShowBs() ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--theme-accent, #047857);font-weight:700">
          <span>En bolívares (tasa ${rate.toFixed(2)})</span>
          <span>Bs ${fmtBsNum(subtotal * rate)}</span>
        </div>` : ''}
      ${d > 0 ? `
        <div style="font-size:11px;color:var(--theme-text-muted, #64748b);text-align:right;margin-top:2px">
          Con descuento quedaría en: <strong>${fmtPrice(subtotal * (1 - d / 100))}</strong>
        </div>` : ''}
    </div>`;
}

function posUpdatePrice(key, val) {
  const price = parseFloat(val);
  if (isNaN(price) || price < 0) {
    showToast('Precio inválido', 'warn');
    posRenderTicket();
    return;
  }
  const l = posTicket[key];
  if (!l) return;
  l.price_level = 'M';   // precio digitado a mano
  l.price_usd = +price.toFixed(2);
  posRenderTicket();
}

function posUpdateName(key, newName) {
  if (posTicket[key] && newName.trim()) {
    posTicket[key].name = newName.trim();
  }
}

/* ---------- Cliente (CRM) ---------- */
let posCliTimer = null;
let posCliResults = [];
let posCliCursor = -1;

function posInitCustomerKeys() {
  const inp = document.getElementById('posCliSearch');
  if (!inp || inp.__jjKeys) return;
  inp.__jjKeys = true;
  inp.addEventListener('keydown', e => {
    if (document.querySelector('.pf-popup-mask')) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      posNavTab(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      document.getElementById('posCliResults').innerHTML = '';
      const se = document.getElementById('posSearch');
      if (se) se.focus();
      return;
    }
    const items = document.getElementById('posCliResults').querySelectorAll('.pos-result');
    if (!items.length) {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Si no hay resultados de búsqueda, avanza a posCliName para escribirlo manual
        const nameInp = document.getElementById('posCliName');
        if (nameInp) { nameInp.focus(); nameInp.select(); }
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      posCliCursor = Math.min(posCliCursor + 1, items.length - 1);
      paintCliCursor(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      posCliCursor = Math.max(posCliCursor - 1, 0);
      paintCliCursor(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetIdx = posCliCursor >= 0 ? posCliCursor : 0;
      const c = posCliResults[targetIdx];
      if (c) {
        posPickCustomer(c);
        const se = document.getElementById('posSearch');
        if (se) se.focus();
      }
    }
  });
}

function paintCliCursor(items) {
  items.forEach((el, i) => el.classList.toggle('on', i === posCliCursor));
  items[posCliCursor]?.scrollIntoView({ block: 'nearest' });
}

function posSearchCustomer() {
  clearTimeout(posCliTimer);
  posCliTimer = setTimeout(async () => {
    const q = document.getElementById('posCliSearch').value.trim();
    const box = document.getElementById('posCliResults');
    posCustomer = null;
    posCliCursor = -1;
    if (q.length < 3) { box.innerHTML = ''; posCliResults = []; return; }
    const sellerObj = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (typeof CURRENT_PROFILE !== 'undefined' ? CURRENT_PROFILE : null);
    const sellerId = sellerObj?.id;

    let query = sb.from('jjp_customers')
      .select('id,name,phone,rif,city,total_orders,total_usd,seller_id')
      .or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, '') || q}%`);

    if (sellerId) {
      query = query.eq('seller_id', sellerId);
    }

    const { data } = await query.limit(5);
    if (!data?.length) { box.innerHTML = '<p style="font-size:12px;color:var(--gr);margin:4px 0">No está en tu clientela asignada — completa sus datos abajo.</p>'; posCliResults = []; return; }
    posCliResults = data;
    box.innerHTML = data.map((c, i) => `
      <div class="pos-result" data-i="${i}" style="cursor:pointer" onclick='posPickCustomer(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escapeHTML(c.name)}</div>
          <div style="font-size:11px;color:var(--gr)">${escapeHTML(c.phone)} · ${c.total_orders} compras · ${fmtPrice(c.total_usd)}</div>
        </div>
        <span class="btn-o sm">Elegir</span>
      </div>`).join('');
  }, 300);
}

function posPickCustomer(c) {
  posCustomer = c;
  document.getElementById('posCliSearch').value = c.name || '';
  document.getElementById('posCliName').value = c.name || '';
  document.getElementById('posCliTel').value  = c.phone || '';
  document.getElementById('posCliRif').value  = c.rif || '';
  document.getElementById('posCliCity').value = c.city || '';
  document.getElementById('posCliResults').innerHTML =
    `<p style="font-size:12px;color:var(--gm);margin:4px 0">✔ Cliente frecuente seleccionado: <strong>${escapeHTML(c.name)}</strong></p>`;
}

function posSetConsumidorFinal() {
  posCustomer = null;
  const sEl = document.getElementById('posCliSearch');
  const nEl = document.getElementById('posCliName');
  const tEl = document.getElementById('posCliTel');
  const rEl = document.getElementById('posCliRif');
  const cEl = document.getElementById('posCliCity');
  if (sEl) sEl.value = 'Consumidor Final';
  if (nEl) nEl.value = 'Consumidor Final';
  if (tEl) tEl.value = '00000000000';
  if (rEl) rEl.value = 'V-00000000';
  if (cEl) cEl.value = 'Mostrador';
  const res = document.getElementById('posCliResults');
  if (res) res.innerHTML = '';
  const nameRes = document.getElementById('posCliNameResults');
  if (nameRes) nameRes.style.display = 'none';
  showToast('⚡ Cliente Mostrador / Consumidor Final aplicado');
}

/* ---------- Registrar venta ---------- */
async function posSubmit() {
  if (posSubmitting) return;
  const lines = Object.values(posTicket);
  const name  = document.getElementById('posCliName').value.trim();
  let tel     = document.getElementById('posCliTel').value.trim();
  if (!lines.length) { showToast('El ticket está vacío', 'warn'); return; }
  if (!name) { showToast('El nombre del cliente es obligatorio', 'warn'); return; }
  if (!tel) {
    tel = '00000000000'; // Default para mostrador / consumidor final
  }

  posSubmitting = true;
  const btn = document.getElementById('posSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    const subtotal = lines.reduce((s, l) => s + l.price_usd * l.qty, 0);
    const d        = posDiscount();
    const rate     = getRate();
    // Descuento solicitado → se cobra a precio lleno hasta que el admin lo apruebe.
    const total    = +subtotal.toFixed(2);
    const payRef   = document.getElementById('posPayRef')?.value.trim() || null;

    // Resolución segura del vendedor activo
    const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
      ? SELLER
      : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
          ? CURRENT_PROFILE
          : ((typeof window !== 'undefined' && window.SELLER) ? window.SELLER : null));
    const sellerId = activeSeller?.id || null;
    const isAdmin = (activeSeller?.role === 'admin');
    const dStatus = (d > 0) ? (isAdmin ? 'approved' : 'pending') : 'none';
    let orderNumber = null;
    if (typeof fetchNextDocSerial === 'function') {
      orderNumber = await fetchNextDocSerial('pedido');
    }
    if (!orderNumber || !/^\d{8}$/.test(String(orderNumber).trim())) {
      try {
        const { data: sData } = await sb.rpc('jjp_next_doc_serial', { p_type: 'pedido' });
        if (sData) orderNumber = String(sData).padStart(8, '0').slice(-8);
      } catch (_) {}
    }
    if (!orderNumber || !/^\d{8}$/.test(String(orderNumber).trim())) {
      orderNumber = String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
    }

    const order = {
      order_number: orderNumber,
      client_name: name,
      phone: tel,
      rif:  document.getElementById('posCliRif')?.value.trim()  || null,
      city: document.getElementById('posCliCity')?.value.trim() || null,
      items: lines.map(l => ({
        id: l.id || null, variant_id: l.variant_id || null, name: l.name, brand: l.brand, sku: l.sku || null,
        qty: l.qty, unit: l.unit, price_usd: l.price_usd,
        price_level: l.price_level || 'B',
        price_bs: posLineBs(l) || null,
        subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
        is_custom: !!l.is_custom,
      })),
      subtotal_usd: +subtotal.toFixed(2),
      discount_pct: d,
      discount_status: dStatus,
      discount_requested_by: d > 0 ? sellerId : null,
      total_usd: total,
      exchange_rate: rate,
      total_bs: +(total * rate).toFixed(2),
      payment_method: document.getElementById('posMethod')?.value || 'efectivo',
      payment_ref: payRef,
      notes: document.getElementById('posNotes')?.value.trim() || null,
      seller_id: sellerId,
      source: 'pos',
      status: payRef ? 'verificando' : 'pagado',
      quote_id: posLinkedQuoteId || null,
      customer_id: posCustomer?.id || null,
    };

    const { error } = await sb.from('jjp_orders').insert(order);
    if (error) {
      console.error('pos insert error:', error);
      showToast('No se pudo registrar la venta: ' + (error.message || 'Error en base de datos'), 'err');
      return;
    }

    // Si la venta provino de una cotización, marcar la cotización como convertida
    if (posLinkedQuoteId) {
      sb.from('jjp_quotes').update({ status: 'convertido' }).eq('id', posLinkedQuoteId).then(() => {}).catch(() => {});
      posLinkedQuoteId = null;
    }

    posShowDone(order);
  } catch (err) {
    console.error('Error al procesar la venta:', err);
    showToast('Error inesperado al registrar la venta', 'err');
  } finally {
    posSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '✅ Registrar venta'; }
  }
}

/* Contexto para el hub de envío: la venta recién registrada.
   Antes el único botón abría wa.me con texto pelado; ahora la factura
   sale en PDF por el CRM y queda en el historial del cliente. */
let posLastOrder = null;
function posDoneCtx() {
  const o = posLastOrder || {};
  return {
    nombre: o.client_name, telefono: o.phone, email: o.email || null,
    order: o, docs: ['factura', 'recibo', 'estado', 'catalogo', 'lista'],
  };
}

function posShowDone(o) {
  posLastOrder = o;

  const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
    ? SELLER
    : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
        ? CURRENT_PROFILE
        : ((typeof window !== 'undefined' && window.SELLER) ? window.SELLER : null));
  const sellerName = activeSeller?.name || 'JJ Paper';

  // El mensaje al cliente muestra el precio lleno (el descuento se confirma tras la aprobación del admin)
  const waMsg = `🛒 *PEDIDO ${o.order_number}* — JJ Paper\n\nHola ${o.client_name}, aquí está el resumen de tu compra:\n`
    + (o.items || []).map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + `\n💰 *Total: ${fmtPrice(o.total_usd)}* (${fmtBsNum(o.total_bs)})`
    + `\n\n🔎 Rastrea tu pedido: ${location.origin}/rastreo.html?n=${encodeURIComponent(o.order_number)}`
    + `\n\nAtendido por: ${sellerName} — JJ Paper 📄`;

  const discNote = o.discount_pct > 0
    ? `<div class="co-done-row" style="color:var(--gm)"><span>Descuento ${o.discount_pct}%</span><strong>⏳ pendiente de aprobación del admin</strong></div>`
    : '';

  let sendHubHtml = '';
  try {
    if (typeof sendBotonHTML === 'function') sendHubHtml = sendBotonHTML('posDoneCtx()');
  } catch (e) {
    console.warn('sendBotonHTML error:', e);
  }

  document.getElementById('posDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Pedido <strong>${escapeHTML(o.order_number)}</strong> registrado a nombre de <strong>${escapeHTML(o.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      <div class="co-done-row"><span>Total a cobrar</span><strong>${fmtPrice(o.total_usd)}</strong></div>
      <div class="co-done-row"><span>En bolívares</span><strong>${fmtBsNum(o.total_bs)}</strong></div>
      ${discNote}
      <div class="co-done-row"><span>Estado</span><strong>${o.status === 'verificando' ? 'Verificando pago' : 'Pendiente de pago'}</strong></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-p" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=ambos&print=1"
         title="Imprime la factura y la orden de recibo de una sola vez">🖨️ Factura + Recibo</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=factura&print=1">📃 Solo factura</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?n=${encodeURIComponent(o.order_number)}&t=recibo&print=1">📦 Solo recibo</a>
      ${sendHubHtml}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(o.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Solo el resumen</a>
      <button class="btn-p" onclick="posReset()">💰 Nueva venta</button>
    </div>`;
  document.getElementById('posDoneModal').classList.add('op');
}

function posReset() {
  posTicket = {}; posCustomer = null;
  posRenderTicket();
  ['posCliSearch', 'posCliName', 'posCliTel', 'posCliRif', 'posCliCity', 'posPayRef', 'posNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('posDisc').value = 0;
  document.getElementById('posCliResults').innerHTML = '';
  document.getElementById('posCliNameResults').innerHTML = '';
  document.getElementById('posCliNameResults').style.display = 'none';
  document.getElementById('posDoneModal').classList.remove('op');
}

/* ---------- Navegación Ordenada por Tabulador ---------- */
const POS_NAV_SEQUENCE = [
  'posSearch',
  'posCliSearch',
  'posCliName',
  'posCliTel',
  'posDisc',
  'posMethod',
  'posPayRef',
  'posSubmitBtn'
];

function posNavTab(dir = 1) {
  const curr = document.activeElement;
  const currId = curr?.id;
  let idx = POS_NAV_SEQUENCE.indexOf(currId);
  if (idx === -1) {
    idx = (dir > 0) ? -1 : 0;
  }
  let nextIdx = (idx + dir + POS_NAV_SEQUENCE.length) % POS_NAV_SEQUENCE.length;
  let target = document.getElementById(POS_NAV_SEQUENCE[nextIdx]);
  // Salta campos ocultos o deshabilitados
  let attempts = 0;
  while ((!target || target.disabled || target.offsetParent === null) && attempts < POS_NAV_SEQUENCE.length) {
    nextIdx = (nextIdx + dir + POS_NAV_SEQUENCE.length) % POS_NAV_SEQUENCE.length;
    target = document.getElementById(POS_NAV_SEQUENCE[nextIdx]);
    attempts++;
  }
  if (target) {
    target.focus();
    if (typeof target.select === 'function') target.select();
  }
}

function posInitTabNav() {
  POS_NAV_SEQUENCE.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.__jjTabBound) return;
    el.__jjTabBound = true;
    el.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        posNavTab(e.shiftKey ? -1 : 1);
      }
    });
  });
}

/* ---------- Control del Ticket con Teclado (F6 / Alt+T) ---------- */
function posFocusTicket() {
  const keys = Object.keys(posTicket);
  if (!keys.length) {
    showToast('El ticket está vacío. Agrega productos con F2', 'warn');
    return;
  }
  posTicketCursor = 0;
  posRenderTicket();
  const firstLine = document.querySelector('#posTicket .pos-line');
  if (firstLine) firstLine.scrollIntoView({ block: 'nearest' });
  showToast('📃 Modo ticket: ↑↓ navegar · +/- cantidad · A/B/C/D precio · Supr borrar · Esc salir');
}

/* ---------- Atajos de Teclado Globales del POS ---------- */
function posInitGlobalKeys() {
  if (window.__posGlobalKeysBound) return;
  window.__posGlobalKeysBound = true;

  // Interceptar Tab en los inputs clave del flujo para evitar saltar a botones irrelevantes
  window.addEventListener('keydown', e => {
    if (document.querySelector('.pf-popup-mask')) return; // popups de MixNet manejan sus teclas

    // Manejo de navegación en el ticket cuando posTicketCursor está activo
    if (posTicketCursor >= 0 && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      const keys = Object.keys(posTicket);
      if (keys.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          posTicketCursor = Math.min(posTicketCursor + 1, keys.length - 1);
          posRenderTicket();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          posTicketCursor = Math.max(posTicketCursor - 1, 0);
          posRenderTicket();
          return;
        }
        if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') {
          e.preventDefault();
          posQty(keys[posTicketCursor], 1);
          return;
        }
        if (e.key === '-' || e.key === 'ArrowLeft') {
          e.preventDefault();
          posQty(keys[posTicketCursor], -1);
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const targetKey = keys[posTicketCursor];
          posRemoveLine(targetKey);
          if (posTicketCursor >= Object.keys(posTicket).length) {
            posTicketCursor = Object.keys(posTicket).length - 1;
          }
          posRenderTicket();
          return;
        }
        const lvlKey = e.key.toUpperCase();
        if (['A', 'B', 'C', 'D'].includes(lvlKey)) {
          e.preventDefault();
          posSetPriceLevel(keys[posTicketCursor], lvlKey);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'F2') {
          e.preventDefault();
          posTicketCursor = -1;
          posRenderTicket();
          const se = document.getElementById('posSearch');
          if (se) { se.focus(); se.select(); }
          return;
        }
      }
    }

    // F1 o '?' (fuera de inputs): Ayuda visual de atajos
    if (e.key === 'F1' || (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
      e.preventDefault();
      posShowHelpModal();
      return;
    }

    // Escape universal: cerrar cualquier modal, popup o regresar al buscador
    if (e.key === 'Escape') {
      // 1. Modal de cotizaciones
      const quoteModal = document.getElementById('posLoadQuoteModalOvl');
      if (quoteModal && quoteModal.style.display !== 'none') {
        posCloseLoadQuoteModal();
        return;
      }
      // 2. Modal de atajos
      const helpModal = document.getElementById('posShortcutsHelpModal');
      // 2. Modales flotantes (cotizaciones, ítem libre, ayuda)
      const ciModal = document.getElementById('posCustomItemModal');
      if (ciModal && ciModal.style.display !== 'none') {
        posCloseCustomItemModal();
        return;
      }
      const quoteOvl = document.getElementById('posLoadQuoteModalOvl');
      if (quoteOvl && quoteOvl.style.display !== 'none') {
        posCloseLoadQuoteModal();
        return;
      }
      if (helpModal && helpModal.style.display !== 'none') {
        helpModal.style.display = 'none';
        return;
      }
      // 3. Modal de confirmación de venta
      const doneModal = document.getElementById('posDoneModal');
      if (doneModal && doneModal.classList.contains('op')) {
        posReset();
        return;
      }
      // 4. Modal de teléfono
      const phoneModal = document.getElementById('posPhoneModal');
      if (phoneModal && phoneModal.classList.contains('op')) {
        closePosPhone();
        return;
      }
      // 5. Cajas de autocompletado de cliente
      const cliBox = document.getElementById('posCliNameResults');
      if (cliBox && cliBox.style.display !== 'none') {
        cliBox.style.display = 'none';
        return;
      }
      const cliRes = document.getElementById('posCliResults');
      if (cliRes && cliRes.children.length > 0) {
        cliRes.innerHTML = '';
      }
      // 6. Si estaba editando el ticket con teclado, salir del modo ticket
      if (posTicketCursor >= 0) {
        posTicketCursor = -1;
        posRenderTicket();
        const se = document.getElementById('posSearch');
        if (se) { se.focus(); se.select(); }
        return;
      }
      // 7. Si está en búsqueda con texto, limpiarlo
      const se = document.getElementById('posSearch');
      if (document.activeElement === se && se.value.trim()) {
        se.value = '';
        posSearch();
        return;
      }
      // 8. Si está en otro campo, volver al buscador
      if (document.activeElement !== se && se) {
        se.focus();
        se.select();
        return;
      }
      // 9. Si el buscador ya está vacío y hay líneas, preguntar si desea vaciar ticket
      if (posTicket && Object.keys(posTicket).length > 0) {
        clearPos();
      }
      return;
    }

    // F2 o '/' (fuera de inputs): enfocar búsqueda de productos
    if (e.key === 'F2' || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
      e.preventDefault();
      posTicketCursor = -1;
      posRenderTicket();
      const se = document.getElementById('posSearch');
      if (se) { se.focus(); se.select(); }
      return;
    }

    // F3: enfocar búsqueda de cliente
    if (e.key === 'F3') {
      e.preventDefault();
      const cli = document.getElementById('posCliSearch') || document.getElementById('posCliName');
      if (cli) { cli.focus(); cli.select(); }
      return;
    }

    // F4: enfocar campo de descuento
    if (e.key === 'F4') {
      e.preventDefault();
      const disc = document.getElementById('posDisc');
      if (disc) { disc.focus(); disc.select(); }
      return;
    }

    // F6 o Alt+T: modo teclado sobre el ticket
    if (e.key === 'F6' || (e.key.toLowerCase() === 't' && e.altKey)) {
      e.preventDefault();
      posFocusTicket();
      return;
    }

    // F7 o Alt+L: limpiar/vaciar ticket
    if (e.key === 'F7' || (e.key.toLowerCase() === 'l' && e.altKey)) {
      e.preventDefault();
      clearPos();
      return;
    }

    // F8: enfocar selector de método de pago
    if (e.key === 'F8') {
      e.preventDefault();
      const pm = document.getElementById('posMethod');
      if (pm) pm.focus();
      return;
    }

    // F9 o Ctrl+Enter: registrar venta
    if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      posSubmit();
      return;
    }

    // F10 o Ctrl+P: Imprimir comprobante / factura de la última venta
    if (e.key === 'F10' || (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      if (posLastOrder && posLastOrder.order_number) {
        window.open(`../comprobante.html?n=${encodeURIComponent(posLastOrder.order_number)}&t=ambos&print=1`, '_blank');
        return;
      }
      if (Object.keys(posTicket).length > 0) {
        showToast('ℹ️ Registra la venta con F9 o Ctrl+Enter para imprimir la factura oficial', 'info');
      } else {
        showToast('⚠️ Agrega productos al ticket antes de imprimir', 'warn');
      }
      return;
    }

    // F11 o Alt+C: Cargar cotización
    if (e.key === 'F11' || (e.key.toLowerCase() === 'c' && e.altKey)) {
      e.preventDefault();
      posOpenLoadQuoteModal();
      return;
    }

    // F12 o Alt+I: Ítem Libre / Personalizado (flete, embalaje, servicios)
    if (e.key === 'F12' || (e.key.toLowerCase() === 'i' && e.altKey)) {
      e.preventDefault();
      posOpenCustomItemModal();
      return;
    }
  });
}

function posShowHelpModal() {
  let modal = document.getElementById('posShortcutsHelpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'posShortcutsHelpModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:600px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.25)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #e2e8f0;padding-bottom:12px">
          <h3 style="margin:0;font-size:18px;color:#0f172a;display:flex;align-items:center;gap:8px">⌨️ Control Total de Teclado del POS</h3>
          <button type="button" class="btn-g sm" onclick="document.getElementById('posShortcutsHelpModal').style.display='none'">✕ Esc</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;line-height:1.5;color:#334155">
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">📦 Catálogo y Búsqueda</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F2</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">/</kbd> Buscar producto</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↑</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↓</kbd> Moverse en resultados</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Enter</kbd> Código exacto o elegir</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Tab</kbd> Saltar al cliente / venta</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">📃 Edición del Ticket</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F6</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+T</kbd> Activar ticket</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↑↓</kbd> Navegar · <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">+ -</kbd> Cantidad</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">A</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">B</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">C</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">D</kbd> Nivel precio</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Supr</kbd> Borrar fila · <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F7</kbd> Vaciar</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">👤 Cliente y Condiciones</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F3</kbd> Buscar cliente CRM</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F4</kbd> Aplicar descuento %</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F8</kbd> Método de pago</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F11</kbd> / <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+C</kbd> Cargar cotiz.</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F12</kbd> / <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+I</kbd> Ítem Libre</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">🚀 Cierre e Impresión</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F9</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Ctrl+Enter</kbd> Registrar</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F10</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Ctrl+P</kbd> Imprimir</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Esc</kbd> Cerrar ventana / Parar</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F1</kbd> Ver esta ayuda</div>
          </div>
        </div>
        <div style="text-align:right;margin-top:16px">
          <button type="button" class="btn-p sm" onclick="document.getElementById('posShortcutsHelpModal').style.display='none'">¡Entendido! (Esc)</button>
        </div>
      </div>
    `;
    modal.onclick = () => { modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
}

/* ---------- Cargar Cotización en el POS ---------- */
async function posLoadQuote(val) {
  if (!val) return;
  const qStr = String(val).trim();
  const { data: q, error } = await sb.from('jjp_quotes')
    .select('*')
    .or(`quote_number.eq.${qStr},id.eq.${qStr}`)
    .maybeSingle();

  if (error || !q) {
    showToast('No se encontró la cotización ' + qStr, 'warn');
    return;
  }

  if (q.status === 'convertido' || q.status === 'cancelado') {
    alert(`No se puede cargar la cotización porque se encuentra en estado: ${q.status.toUpperCase()}`);
    return;
  }

  posLinkedQuoteId = q.id;

  // 1. Cargar datos del cliente
  const cliName = q.client_name || '';
  const searchEl = document.getElementById('posCliSearch');
  const nameEl = document.getElementById('posCliName');
  const telEl = document.getElementById('posCliTel');
  const rifEl = document.getElementById('posCliRif');
  const cityEl = document.getElementById('posCliCity');
  const resEl = document.getElementById('posCliResults');

  if (searchEl) searchEl.value = cliName;
  if (nameEl) nameEl.value = cliName;
  if (telEl) telEl.value = q.phone || '';
  if (rifEl) rifEl.value = q.rif || '';
  if (cityEl) cityEl.value = q.city || '';
  posCustomer = { name: cliName, phone: q.phone, rif: q.rif, city: q.city, id: q.customer_id || null };

  if (resEl) {
    resEl.innerHTML = `<p style="font-size:12px;color:var(--gm);margin:4px 0">📋 Cotización vinculada: <strong>${escapeHTML(q.quote_number)}</strong> (${escapeHTML(cliName)})</p>`;
  }

  // 2. Cargar productos en el ticket
  posTicket = {};
  const items = Array.isArray(q.items) ? q.items : [];
  for (const item of items) {
    const key = item.variant_id ? `${item.id}::${item.variant_id}` : String(item.id);
    posTicket[key] = {
      id: item.id,
      variant_id: item.variant_id || null,
      name: item.name,
      brand: item.brand || '',
      sku: item.sku || null,
      qty: Number(item.qty) || 1,
      unit: item.unit || 'UND',
      price_usd: Number(item.price_usd) || 0,
      price_level: item.price_level || 'B',
      price_a: item.price_a || item.price_usd || 0,
      price_c_bs: item.price_c_bs || null,
      price_d_bs: item.price_d_bs || null,
      stock: 999
    };
  }

  // 3. Descuento y notas
  if (q.discount_pct) {
    const discEl = document.getElementById('posDisc');
    if (discEl) discEl.value = q.discount_pct;
  }
  const notesEl = document.getElementById('posNotes');
  if (notesEl) {
    notesEl.value = `Cotización ${q.quote_number}${q.notes ? ' · ' + q.notes : ''}`;
  }

  posRenderTicket();
  showToast(`✅ Cotización ${q.quote_number} cargada con ${items.length} producto(s)`, 'ok');
}

async function posOpenLoadQuoteModal() {
  let ovl = document.getElementById('posLoadQuoteModalOvl');
  if (!ovl) {
    ovl = document.createElement('div');
    ovl.id = 'posLoadQuoteModalOvl';
    ovl.className = 'modal-overlay op';
    ovl.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:9999;';
    ovl.innerHTML = `
      <div class="modal-box" style="max-width:640px;width:95%;background:#fff;border-radius:14px;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px">
          <h3 style="margin:0;font-size:16px;color:#1e293b;display:flex;align-items:center;gap:8px">📋 Cargar Cotización en el Ticket</h3>
          <button type="button" class="btn-g sm" onclick="posCloseLoadQuoteModal()">✕ Cerrar</button>
        </div>
        <div style="margin-bottom:12px">
          <input type="text" id="posQuoteSearchInput" class="fi" placeholder="Escribe el N° de cotización (COT-...) o nombre del cliente" style="width:100%" oninput="posSearchQuotesLive()">
        </div>
        <div id="posQuotesModalList" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
          <p style="text-align:center;color:#94a3b8;font-size:13px;padding:12px">Cargando cotizaciones recientes…</p>
        </div>
      </div>
    `;
    ovl.onclick = posCloseLoadQuoteModal;
    document.body.appendChild(ovl);
  }
  ovl.style.display = 'flex';
  document.getElementById('posQuoteSearchInput').value = '';
  await posSearchQuotesLive();
}

function posCloseLoadQuoteModal() {
  const ovl = document.getElementById('posLoadQuoteModalOvl');
  if (ovl) ovl.style.display = 'none';
}

async function posSearchQuotesLive() {
  const box = document.getElementById('posQuotesModalList');
  if (!box) return;
  const qText = (document.getElementById('posQuoteSearchInput')?.value || '').trim();

  let query = sb.from('jjp_quotes')
    .select('id,quote_number,client_name,phone,estimated_total_usd,discount_pct,created_at,status,items')
    .in('status', ['pendiente', 'contactado'])
    .order('created_at', { ascending: false })
    .limit(12);

  if (qText) {
    query = query.or(`quote_number.ilike.%${qText}%,client_name.ilike.%${qText}%`);
  }

  const { data: list, error } = await query;
  if (error || !list?.length) {
    box.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:13px;padding:16px">No hay cotizaciones pendientes que coincidan.</p>';
    return;
  }

  box.innerHTML = list.map(q => {
    const total = Number(q.estimated_total_usd) || 0;
    const itemsCount = Array.isArray(q.items) ? q.items.length : 0;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:#0f172a">${escapeHTML(q.quote_number)} · <span style="font-weight:600;color:#334155">${escapeHTML(q.client_name)}</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${itemsCount} producto(s) · ${fmtPrice(total)} ${q.discount_pct > 0 ? `· Descuento: ${q.discount_pct}%` : ''} · Tel: ${escapeHTML(q.phone || '—')}</div>
        </div>
        <button type="button" class="btn-p sm" onclick="posPickQuoteFromModal('${q.id}')" style="white-space:nowrap;padding:6px 12px">💰 Cargar al POS</button>
      </div>
    `;
  }).join('');
}

async function posPickQuoteFromModal(id) {
  posCloseLoadQuoteModal();
  await posLoadQuote(id);
}

/* ======================================================
   ÍTEM PERSONALIZADO / LIBRE (Fletes, servicios, combos, etc.)
   ====================================================== */
function posOpenCustomItemModal() {
  let modal = document.getElementById('posCustomItemModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'posCustomItemModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:480px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.25)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
          <h3 style="margin:0;font-size:17px;color:#0f172a;display:flex;align-items:center;gap:8px">➕ Agregar Ítem Libre al Ticket</h3>
          <button type="button" class="btn-g sm" onclick="posCloseCustomItemModal()">✕ Cerrar</button>
        </div>
        <p style="font-size:12px;color:#64748b;margin:0 0 14px 0">Para fletes, embalajes, servicios especiales o productos no registrados en catálogo.</p>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label class="fl">Descripción / Concepto *</label>
            <input class="fi" id="posCiName" placeholder="Ej: Flete delivery express, Embalaje especial..." style="width:100%" onkeydown="if(event.key==='Enter')document.getElementById('posCiPriceUsd')?.focus()">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="fl">Cantidad *</label>
              <input class="fi" id="posCiQty" type="number" min="1" value="1" style="width:100%" onkeydown="if(event.key==='Enter')document.getElementById('posCiPriceUsd')?.focus()">
            </div>
            <div>
              <label class="fl">Unidad de Medida</label>
              <input class="fi" id="posCiUnit" value="serv" placeholder="serv, und, kg..." style="width:100%">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="fl">Precio en USD ($) *</label>
              <input class="fi" id="posCiPriceUsd" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%" oninput="posCiCalcFromUsd()" onkeydown="if(event.key==='Enter')posAddCustomItemToTicket()">
            </div>
            <div>
              <label class="fl">Precio en Bs (BCV)</label>
              <input class="fi" id="posCiPriceBs" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%" oninput="posCiCalcFromBs()" onkeydown="if(event.key==='Enter')posAddCustomItemToTicket()">
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button type="button" class="btn-o" onclick="posCloseCustomItemModal()">Cancelar</button>
            <button type="button" class="btn-p" onclick="posAddCustomItemToTicket()" style="background:#16604a;color:#fff">➕ Agregar al Ticket</button>
          </div>
        </div>
      </div>
    `;
    modal.onclick = posCloseCustomItemModal;
    document.body.appendChild(modal);
  }

  document.getElementById('posCiName').value = '';
  document.getElementById('posCiQty').value = '1';
  document.getElementById('posCiUnit').value = 'serv';
  document.getElementById('posCiPriceUsd').value = '';
  document.getElementById('posCiPriceBs').value = '';
  modal.classList.add('op');
  modal.style.display = 'flex';
  setTimeout(() => { document.getElementById('posCiName')?.focus(); }, 80);
}

function posCloseCustomItemModal() {
  const modal = document.getElementById('posCustomItemModal');
  if (modal) {
    modal.classList.remove('op');
    modal.style.display = 'none';
  }
}

function posCiCalcFromUsd() {
  const rate = getRate();
  const usd = parseFloat(document.getElementById('posCiPriceUsd')?.value) || 0;
  const bsEl = document.getElementById('posCiPriceBs');
  if (bsEl) bsEl.value = (usd > 0) ? (usd * rate).toFixed(2) : '';
}

function posCiCalcFromBs() {
  const rate = getRate();
  const bs = parseFloat(document.getElementById('posCiPriceBs')?.value) || 0;
  const usdEl = document.getElementById('posCiPriceUsd');
  if (usdEl) usdEl.value = (bs > 0 && rate > 0) ? (bs / rate).toFixed(2) : '';
}

function posAddCustomItemToTicket() {
  const name = document.getElementById('posCiName')?.value.trim();
  const qty = parseInt(document.getElementById('posCiQty')?.value, 10) || 1;
  const unit = document.getElementById('posCiUnit')?.value.trim() || 'und';
  const usd = parseFloat(document.getElementById('posCiPriceUsd')?.value);

  if (!name) {
    showToast('Ingresa la descripción del ítem libre', 'warn');
    document.getElementById('posCiName')?.focus();
    return;
  }
  if (isNaN(usd) || usd < 0) {
    showToast('Ingresa un precio válido en USD', 'warn');
    document.getElementById('posCiPriceUsd')?.focus();
    return;
  }

  const customKey = 'custom_' + Date.now();
  posTicket[customKey] = {
    id: null,
    variant_id: null,
    name: name,
    brand: 'LIBRE',
    qty: qty,
    unit: unit,
    price_usd: +usd.toFixed(2),
    price_level: 'M',
    stock: 9999,
    min_qty: 1,
    is_custom: true
  };

  posRenderTicket();
  posCloseCustomItemModal();
  showToast(`✅ "${name}" agregado al ticket`);
}

window.posOpenCustomItemModal = posOpenCustomItemModal;
window.posCloseCustomItemModal = posCloseCustomItemModal;
window.openCustomItemModal = posOpenCustomItemModal;
window.closeCustomItemModal = posCloseCustomItemModal;

