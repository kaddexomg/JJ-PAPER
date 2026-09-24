/* ======================================================
   JJ Paper — Buscador universal de productos (reusable)
   Usado por POS, cotizador y consulta de existencias.
   Busca por nombre, SKU (producto/variante), código de barras y marca.
   Requiere: sb, normTxt, fmtPrice, toBs (de config.js).
   ====================================================== */

let PF_PRODUCTS = null;
const PF_CACHE_KEY  = 'jjp_pf_products_v2';
const PF_CACHE_TIME = 'jjp_pf_products_v2_time';
const PF_TTL        = 5 * 60 * 1000; // 5 minutos

async function pfLoad(force) {
  if (PF_PRODUCTS && !force) return PF_PRODUCTS;
  
  let allData = [];
  const now = Date.now();

  if (!force) {
    try {
      const cached = sessionStorage.getItem(PF_CACHE_KEY);
      const cachedTime = sessionStorage.getItem(PF_CACHE_TIME);
      if (cached && cachedTime && (now - parseInt(cachedTime, 10) < PF_TTL)) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          allData = parsed;
        }
      }
    } catch (_) {}
  }

  if (!allData.length) {
    let from = 0;
    const step = 999;
    while (true) {
      const { data, error } = await sb.from('jjp_products')
        .select('id,name,sku,price_usd,price_a,price_b,price_c_bs,price_d_bs,mixnet_status,unit,emoji,image_url,stock,min_qty,jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,price_a,price_b,price_c_bs,price_d_bs,stock,min_qty,active,jjp_brands(name))')
        .eq('active', true).range(from, from + step).order('name');
      if (error) { 
        if (typeof showToast === 'function') showToast('Error cargando productos', 'err'); 
        return PF_PRODUCTS || []; 
      }
      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length <= step) break;
      from += step + 1;
    }

    if (allData.length > 0) {
      try {
        sessionStorage.setItem(PF_CACHE_KEY, JSON.stringify(allData));
        sessionStorage.setItem(PF_CACHE_TIME, String(now));
      } catch (_) {}
    }
  }
  
  let products = JSON.parse(JSON.stringify(allData));
  
  // Cargar precios personalizados del vendedor si está logueado
  const sellerId = (typeof SELLER !== 'undefined' && SELLER?.id) || (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id);
  if (sellerId) {
    try {
      const { data: sellerPrices, error: spError } = await sb.from('jjp_seller_prices')
        .select('product_id,variant_id,price_usd')
        .eq('seller_id', sellerId);
      
      if (!spError && sellerPrices && sellerPrices.length > 0) {
        // Crear mapa para búsquedas rápidas
        const customPrices = {};
        sellerPrices.forEach(sp => {
          const key = sp.variant_id ? `v::${sp.variant_id}` : `p::${sp.product_id}`;
          customPrices[key] = sp.price_usd;
        });
        
        // Aplicar precios personalizados sobre el catálogo en memoria
        products.forEach(p => {
          const pKey = `p::${p.id}`;
          if (customPrices[pKey] !== undefined) {
            p.price_usd = customPrices[pKey];
          }
          if (p.jjp_product_variants) {
            p.jjp_product_variants.forEach(v => {
              const vKey = `v::${v.id}`;
              if (customPrices[vKey] !== undefined) {
                v.price_usd = customPrices[vKey];
              }
            });
          }
        });
      }
    } catch (err) {
      console.error('Error aplicando precios personalizados:', err);
    }
  }

  PF_PRODUCTS = products;
  return PF_PRODUCTS;
}

function pfNorm(s) { return typeof normTxt === 'function' ? normTxt(String(s || '')) : String(s || '').toLowerCase(); }

// Filtra por nombre / sku / código / marca con búsqueda inteligente multi-token
function pfMatch(list, term) {
  if (!term || !term.trim()) return (list || []).slice(0, 40);
  const normTerm = pfNorm(term);
  const tokens = normTerm.split(/[\s,()\*\/+\-]+/).filter(t => t.length > 0);
  if (tokens.length === 0) return (list || []).slice(0, 40);

  const lc = String(term || '').trim().toLowerCase();
  const scored = [];

  for (const p of (list || [])) {
    const vars = p.jjp_product_variants || [];
    const varText = vars.map(v => `${v.sku || ''} ${v.barcode || ''} ${v.variant_name || ''} ${v.jjp_brands?.name || ''}`).join(' ');
    const fullText = pfNorm(`${p.name || ''} ${p.sku || ''} ${p.description || ''} ${varText}`);

    // Tokens coincidentes en el producto
    const matchingTokens = tokens.filter(tok => {
      // Para cualquier longitud, permitimos coincidencia parcial para que filtre a medida que teclean
      return fullText.includes(tok);
    });

    const matchCount = matchingTokens.length;
    const matchRatio = matchCount / tokens.length;

    // 1. Coincidencia completa: todos los tokens están presentes en el producto
    if (matchRatio === 1) {
      let score = 200;
      const normName = pfNorm(p.name || '');
      
      // Coincidencia exacta o empieza con el término principal
      if (normName === normTerm) score += 1000;
      else if (normName.startsWith(normTerm)) score += 600;
      else if (normName.includes(normTerm)) score += 300;
      
      // Bono por palabras individuales que coinciden al inicio de una palabra en el nombre
      tokens.forEach(tok => {
        if (new RegExp('(^|\\s)' + tok, 'i').test(normName)) {
          score += 50;
        }
      });
      
      if (fullText.includes(normTerm)) score += 150; // Frase exacta consecutiva en cualquier lado
      if ((p.sku || '').toLowerCase() === lc) score += 500; // Coincidencia exacta de SKU
      if ((p.stock || 0) > 0) score += 50; // Prioridad si hay stock
      scored.push({ p, score });
    }
    // 2. Coincidencia parcial para búsquedas de 3 o más palabras (tolera medidas o palabras extra)
    // Ej. si el usuario busca "plastico 44*66 carnet", coincide "plastico" y "carnet"
    else if (tokens.length >= 3 && matchCount >= 2) {
      const significantMatches = matchingTokens.filter(t => t.length >= 3).length;
      if (significantMatches >= 2) {
        let score = (matchCount * 40) + (matchRatio * 50);
        if ((p.stock || 0) > 0) score += 20;
        scored.push({ p, score });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.p).slice(0, 40);
}

// Match EXACTO por código de barras o SKU (para escaneo). Devuelve {product, variant} o null.
function pfFindByCode(list, code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  for (const p of list || []) {
    for (const v of (p.jjp_product_variants || [])) {
      if (v.active && ((v.barcode || '').toLowerCase() === c || (v.sku || '').toLowerCase() === c))
        return { product: p, variant: v };
    }
    if ((p.sku || '').toLowerCase() === c) return { product: p, variant: null };
  }
  return null;
}

// Nivel de existencia → clase de color
function pfStockClass(stock, min) {
  const s = Number(stock), m = Number(min) || 0;
  if (!Number.isFinite(s)) return '';
  if (s <= 0) return 'pf-out';
  if (s <= m || s <= 3) return 'pf-low';
  return 'pf-ok';
}
function pfStockLabel(stock) {
  const s = Number(stock);
  if (!Number.isFinite(s)) return 'stock —';
  if (s <= 0) return '⛔ sin stock';
  return `stock ${s}`;
}

// Precio USD + Bs a tasa viva (visualización multinivel: A/B en US$, C/D en Bs)
function pfPriceHtml(usd, p) {
  const pA = Number(p?.price_a) || 0;
  const pB = Number(p?.price_b || usd) || 0;
  const pC = Number(p?.price_c_bs) || 0;
  const pD = Number(p?.price_d_bs) || 0;
  const mainUsd = pB > 0 ? pB : (pA > 0 ? pA : Number(usd) || 0);
  const bs = (typeof toBs === 'function') ? toBs(mainUsd) : null;
  const bsStr = bs ? ` · Bs ${Number(bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : '';
  const cdStr = (pC > 0 && pD > 0)
    ? ` <span style="font-size:10px;color:#8a6d1a">· C: Bs ${pC.toLocaleString('es-VE', { maximumFractionDigits: 2 })} · D: Bs ${pD.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>`
    : '';

  if (pA > 0 && pB > 0 && Math.abs(pA - pB) > 0.005) {
    return `⭐ <strong style="color:#0f5132">$${pB.toFixed(2)}</strong> <span style="font-size:10px;color:#666">(B)</span> · <span style="color:#555">$${pA.toFixed(2)}</span> <span style="font-size:10px;color:#666">(A)</span>${bsStr}${cdStr}`;
  }
  return `${fmtPrice(mainUsd)}${bsStr}${cdStr}`;
}

/* ---------- Puente teléfono → PC (teléfono como pistola de código) ---------- */
// El POS/cotizador de la PC llama a esto; cada código que el teléfono manda
// (tabla jjp_pos_scans, vía Realtime) dispara onCode(code). RLS ya limita a lo
// del propio vendedor. NO afecta inventario ni conteo.
function pfPhoneBridge(onCode) {
  const owner = (typeof SELLER !== 'undefined' && SELLER?.id) || (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id) || 'me';
  // Rescata escaneos recientes que llegaron antes de abrir la caja
  sb.from('jjp_pos_scans').select('id,code').eq('consumed', false)
    .gte('created_at', new Date(Date.now() - 120000).toISOString())
    .order('created_at', { ascending: true })
    .then(({ data }) => (data || []).forEach(r => { onCode(r.code); sb.from('jjp_pos_scans').update({ consumed: true }).eq('id', r.id); }));

  return sb.channel('pos-scan-' + owner)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_pos_scans' },
      p => { onCode(p.new.code); sb.from('jjp_pos_scans').update({ consumed: true }).eq('id', p.new.id); })
    .subscribe();
}

// URL de la página del teléfono-escáner (para el QR / enlace en la PC)
function pfPhoneScanUrl() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'scan.html';
}

/* ---------- Escaneo con cámara (API nativa BarcodeDetector) ---------- */
async function pfScanCamera(onCode) {
  if (!('BarcodeDetector' in window)) {
    if (typeof showToast === 'function') showToast('Este navegador no lee código por cámara. Usa un lector físico.', 'warn', 5000);
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { if (typeof showToast === 'function') showToast('No se pudo abrir la cámara (permisos)', 'err'); return; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
  overlay.innerHTML = `<video autoplay playsinline muted style="max-width:100%;max-height:80vh"></video>
    <p style="color:#fff;margin-top:12px;font-size:14px">Apunta al código de barras…</p>
    <button style="margin-top:12px;padding:10px 20px;border-radius:8px;border:none;background:#fff;font-size:15px;cursor:pointer">Cancelar</button>`;
  document.body.appendChild(overlay);
  const video = overlay.querySelector('video');
  video.srcObject = stream;

  let stop = false;
  const cleanup = () => { stop = true; stream.getTracks().forEach(t => t.stop()); overlay.remove(); };
  overlay.querySelector('button').onclick = cleanup;

  const detector = new window.BarcodeDetector();
  const tick = async () => {
    if (stop) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        cleanup();
        onCode(value);
        return;
      }
    } catch (e) { /* frame sin código */ }
    requestAnimationFrame(tick);
  };
  video.onloadedmetadata = () => tick();
}

/* ---------- Selector Unificado de Precio y Cantidad (Moderno, Rápido y Visual) ----------
   Reemplaza la secuencia de popups con un único diálogo moderno, limpio y profesional:
   - Muestra de inmediato todos los niveles de precio disponibles (A, B, C, D) y opción manual.
   - Muestra precios en USD ($) y conversión oficial en Bs (BCV).
   - Permite ajustar la cantidad en la misma pantalla (+ / - / input directo).
   - Calcula el subtotal en vivo en USD y Bs.
   - Confirma con Enter o clic en "Agregar al Ticket", o cancela con Esc.
   Devuelve Promise<{ level, price_usd, qty } | null>.
*/
function pfOpenProductModal(l) {
  return new Promise(resolve => {
    document.querySelectorAll('.pf-product-modal-mask, .pf-popup-mask').forEach(m => m.remove());

    const _n = v => Number(v || 0);
    const rate = (typeof getRate === 'function') ? _n(getRate()) : (_n(window.RATE) || 1);

    const pA = _n(l.price_a);
    const pB = _n(l.price_b || l.price_usd);
    const pC_bs = _n(l.price_c_bs);
    const pD_bs = _n(l.price_d_bs);

    const pC_usd = (rate > 0 && pC_bs > 0) ? +(pC_bs / rate).toFixed(2) : 0;
    const pD_usd = (rate > 0 && pD_bs > 0) ? +(pD_bs / rate).toFixed(2) : 0;

    let activeLevel = l.price_level || (pB > 0 ? 'B' : (pA > 0 ? 'A' : 'B'));
    let customUsd = (activeLevel === 'M') ? _n(l.price_usd) : null;
    let qty = Math.max(1, Math.round(_n(l.qty) || 1));

    const priceCards = [
      {
        k: 'B',
        letter: 'B',
        title: 'Mayor Frecuente ⭐',
        subtitle: 'Recomendado',
        usd: pB,
        bs: pB * rate,
        available: pB > 0
      },
      {
        k: 'A',
        letter: 'A',
        title: 'Detal / Detal',
        subtitle: 'Precio Estándar',
        usd: pA,
        bs: pA * rate,
        available: pA > 0
      },
      {
        k: 'C',
        letter: 'C',
        title: 'Precio C (Bs)',
        subtitle: 'Fijado en Bs',
        usd: pC_usd,
        bs: pC_bs,
        available: pC_bs > 0
      },
      {
        k: 'D',
        letter: 'D',
        title: 'Precio D (Bs Mayor)',
        subtitle: 'Mayor en Bs',
        usd: pD_usd,
        bs: pD_bs,
        available: pD_bs > 0
      },
      {
        k: 'M',
        letter: 'M',
        title: 'Precio Propio',
        subtitle: 'Digitar monto libre',
        usd: customUsd || 0,
        bs: (customUsd || 0) * rate,
        available: true
      }
    ];

    if (!priceCards.find(c => c.k === activeLevel && c.available)) {
      const firstAvail = priceCards.find(c => c.available);
      if (firstAvail) activeLevel = firstAvail.k;
    }

    const mask = document.createElement('div');
    mask.className = 'pf-product-modal-mask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .15s ease;';

    const stockNum = Number(l.stock) || 0;
    const stockBadge = stockNum > 0
      ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">✔ Stock: ${stockNum} ${escapeHTML(l.unit || 'unid')}</span>`
      : `<span style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">⚠ Sin Stock / Pedido</span>`;

    mask.innerHTML = `
      <div class="pf-product-modal-box" style="background:var(--theme-bg-surface-solid, #ffffff);border-radius:18px;width:100%;max-width:490px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;border:1px solid var(--theme-border-subtle, #cbd5e1);display:flex;flex-direction:column;animation:scaleUp .15s ease;" onclick="event.stopPropagation()">
        
        <!-- Cabecera -->
        <div style="background:var(--theme-bg-surface-solid, #f8fafc);padding:16px 20px;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:10px;font-weight:800;color:var(--theme-accent, #16604a);background:var(--theme-accent-soft, #ecfdf5);padding:2px 6px;border-radius:4px;border:1px solid var(--theme-border-accent, #a7f3d0)">SELECCIÓN DE PRECIO</span>
              ${stockBadge}
            </div>
            <h3 style="margin:0;font-size:16px;font-weight:800;color:var(--theme-text-main, #0f172a);line-height:1.3;white-space:normal">${escapeHTML(l.name)}</h3>
            <div style="font-size:12px;color:var(--theme-text-muted, #64748b);margin-top:2px">${l.brand ? `<strong style="color:var(--theme-text-main, #334155)">${escapeHTML(l.brand)}</strong> · ` : ''}Unidad: <strong>${escapeHTML(l.unit || 'unid')}</strong>${l.sku ? ` · SKU: ${escapeHTML(l.sku)}` : ''}</div>
          </div>
          <button type="button" id="pfModalCloseBtn" style="border:none;background:var(--theme-item-bg, #e2e8f0);color:var(--theme-text-muted, #475569);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>
        </div>

        <!-- Cuerpo -->
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;max-height:75vh;overflow-y:auto">
          
          <!-- Sección 1: Niveles de Precio -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <label style="font-size:12px;font-weight:700;color:var(--theme-text-main, #334155);margin:0">1. Selecciona el Nivel de Precio:</label>
              <span style="font-size:11px;color:var(--theme-text-muted, #64748b)">Pulsa <b>A, B, C, D</b> o <b>M</b></span>
            </div>
            <!-- Grid de 4 niveles estándar A, B, C, D -->
            <div id="pfPriceCardsBox" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
            <!-- Tarjeta limpia y destacada para Nivel M (Precio Personalizado) -->
            <div id="pfCustomCardContainer" style="margin-top:8px"></div>
          </div>

          <!-- Sección 2: Cantidad -->
          <div style="background:var(--theme-bg-surface-solid, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <label style="font-size:12px;font-weight:700;color:var(--theme-text-main, #334155);display:block">2. Cantidad (${escapeHTML(l.unit || 'unid')}):</label>
              <span style="font-size:11px;color:var(--theme-text-muted, #64748b)">Usa + / - o escribe la cantidad</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <button type="button" id="pfQtyMinusBtn" style="width:38px;height:38px;border-radius:8px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);font-size:18px;font-weight:700;color:var(--theme-text-main, #0f172a);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .1s">−</button>
              <input type="number" min="1" step="1" id="pfQtyInput" value="${qty}" style="width:65px;height:38px;border-radius:8px;border:2px solid var(--theme-accent, #16604a);background:var(--theme-input-bg, #fff);text-align:center;font-size:16px;font-weight:800;color:var(--theme-text-main, #0f172a);outline:none">
              <button type="button" id="pfQtyPlusBtn" style="width:38px;height:38px;border-radius:8px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);font-size:18px;font-weight:700;color:var(--theme-text-main, #0f172a);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .1s">＋</button>
            </div>
          </div>

          <!-- Sección 3: Subtotal en vivo -->
          <div style="background:var(--theme-accent-soft, #ecfdf5);border:1px solid var(--theme-border-accent, #a7f3d0);border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <span style="font-size:10px;font-weight:800;color:var(--theme-accent, #166534);text-transform:uppercase;letter-spacing:0.5px">Subtotal de esta línea</span>
              <div id="pfLiveTotalUsd" style="font-size:18px;font-weight:900;color:var(--theme-accent, #065f46)">$0.00 USD</div>
            </div>
            <div id="pfLiveTotalBs" style="text-align:right;font-size:13px;font-weight:700;color:var(--theme-accent, #047857)">≈ Bs 0.00</div>
          </div>

        </div>

        <!-- Acciones Footer -->
        <div style="background:var(--theme-bg-surface-solid, #f8fafc);padding:14px 20px;border-top:1px solid var(--theme-border-subtle, #e2e8f0);display:flex;gap:10px;justify-content:flex-end;align-items:center">
          <button type="button" id="pfModalCancelBtn" class="btn-o" style="padding:9px 16px;font-size:13px;border-radius:8px">Cancelar (Esc)</button>
          <button type="button" id="pfModalConfirmBtn" class="btn-p" style="padding:10px 22px;font-size:14px;font-weight:800;border-radius:8px;background:var(--theme-accent, #16604a);color:#fff;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(22,96,74,0.25)">➕ Agregar al Ticket (Enter)</button>
        </div>

      </div>
    `;

    document.body.appendChild(mask);

    const cardsBox = mask.querySelector('#pfPriceCardsBox');
    const customContainer = mask.querySelector('#pfCustomCardContainer');
    const qtyIn = mask.querySelector('#pfQtyInput');
    const minusBtn = mask.querySelector('#pfQtyMinusBtn');
    const plusBtn = mask.querySelector('#pfQtyPlusBtn');
    const liveUsd = mask.querySelector('#pfLiveTotalUsd');
    const liveBs = mask.querySelector('#pfLiveTotalBs');
    const confirmBtn = mask.querySelector('#pfModalConfirmBtn');
    const cancelBtn = mask.querySelector('#pfModalCancelBtn');
    const closeBtn = mask.querySelector('#pfModalCloseBtn');

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', handleKey, true);
      mask.remove();
      resolve(result);
    };

    const getActivePriceUsd = () => {
      if (activeLevel === 'M') {
        const inp = mask.querySelector('#pfCustomPriceInput');
        const v = inp ? parseFloat(inp.value) : (customUsd || 0);
        return (!isNaN(v) && v >= 0) ? v : 0;
      }
      const card = priceCards.find(c => c.k === activeLevel);
      return card ? card.usd : 0;
    };

    const updateCalculations = () => {
      const q = Math.max(1, parseInt(qtyIn.value, 10) || 1);
      const unitUsd = getActivePriceUsd();
      const subtotalUsd = unitUsd * q;
      const subtotalBs = subtotalUsd * rate;
      liveUsd.textContent = `$${subtotalUsd.toFixed(2)} USD`;
      liveBs.textContent = `≈ Bs ${subtotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const renderCards = () => {
      // 1. Niveles estándar A, B, C, D
      const stdCards = priceCards.filter(c => c.k !== 'M');
      cardsBox.innerHTML = stdCards.map(c => {
        const isSel = (c.k === activeLevel);
        const cardBg = isSel ? 'var(--theme-accent-soft, #ecfdf5)' : 'var(--theme-bg-surface-solid, #ffffff)';
        const cardBorder = isSel ? '2px solid var(--theme-accent, #10b981)' : '1px solid var(--theme-border-subtle, #cbd5e1)';
        const opacity = c.available ? '1' : '0.4';
        const pointer = c.available ? 'pointer' : 'not-allowed';
        const check = isSel ? '<span style="color:var(--theme-accent, #10b981);font-weight:900;font-size:13px">✔ Activo</span>' : '';
        const bsTxt = (!isSel && c.bs > 0)
          ? `<span style="font-size:11px;color:var(--theme-accent, #047857);font-weight:600">≈ Bs ${c.bs.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>`
          : `<span style="font-size:11px;color:var(--theme-text-muted, #64748b)">${c.subtitle}</span>`;

        return `
          <div class="pf-price-card" data-k="${c.k}" style="background:${cardBg};border:${cardBorder};border-radius:10px;padding:9px 12px;cursor:${pointer};opacity:${opacity};display:flex;flex-direction:column;gap:2px;position:relative;transition:all .12s;box-shadow:${isSel ? '0 4px 12px rgba(16,185,129,0.18)' : 'none'}">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:10px;font-weight:800;color:${isSel ? 'var(--theme-accent, #16604a)' : 'var(--theme-text-muted, #475569)'};background:${isSel ? 'var(--theme-accent-soft, #d1fae5)' : 'var(--theme-item-bg, #f1f5f9)'};padding:1px 6px;border-radius:4px">NIVEL ${c.letter}</span>
              ${check}
            </div>
            <div style="margin-top:2px"><span style="font-size:16px;font-weight:900;color:var(--theme-text-main, #0f172a)">$${c.usd.toFixed(2)}</span></div>
            <div>${bsTxt}</div>
          </div>
        `;
      }).join('');

      // 2. Nivel M: Precio Personalizado (Tarjeta ancha destacada)
      const isCustomSel = (activeLevel === 'M');
      customContainer.innerHTML = `
        <div class="pf-price-card" data-k="M" style="background:${isCustomSel ? 'var(--theme-accent-soft, #ecfdf5)' : 'var(--theme-bg-surface-solid, #f8fafc)'};border:${isCustomSel ? '2px solid var(--theme-accent, #10b981)' : '1px solid var(--theme-border-subtle, #cbd5e1)'};border-radius:10px;padding:10px 14px;cursor:pointer;transition:all .12s;box-shadow:${isCustomSel ? '0 4px 12px rgba(16,185,129,0.18)' : 'none'}">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:10px;font-weight:800;color:${isCustomSel ? 'var(--theme-accent, #16604a)' : 'var(--theme-text-muted, #475569)'};background:${isCustomSel ? 'var(--theme-accent-soft, #d1fae5)' : 'var(--theme-item-bg, #e2e8f0)'};padding:1px 6px;border-radius:4px">NIVEL M</span>
              <span style="font-size:13px;font-weight:800;color:var(--theme-text-main, #0f172a)">✏️ Precio Personalizado / Libre</span>
            </div>
            ${isCustomSel ? '<span style="color:var(--theme-accent, #10b981);font-weight:900;font-size:13px">✔ Activo</span>' : '<span style="font-size:11px;color:var(--theme-text-muted, #64748b);font-weight:600">Presiona M o clic</span>'}
          </div>
          <div id="pfCustomPriceRow" style="display:${isCustomSel ? 'block' : 'none'};margin-top:8px;padding-top:8px;border-top:1px dashed ${isCustomSel ? 'var(--theme-border-accent, #a7f3d0)' : 'var(--theme-border-subtle, #cbd5e1)'}">
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-weight:800;font-size:16px;color:var(--theme-accent, #16604a)">$</span>
              <input type="number" step="0.01" min="0" id="pfCustomPriceInput" class="fi" placeholder="0.00" value="${customUsd !== null ? customUsd : ''}" style="flex:1;font-size:15px;font-weight:800;padding:6px 10px;height:38px;border:2px solid var(--theme-accent, #16604a);border-radius:8px">
              <span style="font-size:12px;color:var(--theme-text-muted, #64748b);white-space:nowrap">USD / ${escapeHTML(l.unit || 'unid')}</span>
            </div>
          </div>
        </div>
      `;

      // Vincular eventos del input personalizado
      const customIn = mask.querySelector('#pfCustomPriceInput');
      if (customIn) {
        customIn.addEventListener('input', e => {
          customUsd = parseFloat(e.target.value) || 0;
          updateCalculations();
        });
        customIn.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            confirmSelection();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
        });
        if (isCustomSel) {
          setTimeout(() => { customIn.focus(); customIn.select(); }, 40);
        }
      }

      updateCalculations();
    };

    mask.addEventListener('click', e => {
      const card = e.target.closest('.pf-price-card');
      if (!card) return;
      const k = card.dataset.k;
      const opt = priceCards.find(c => c.k === k);
      if (!opt || !opt.available) return;
      activeLevel = k;
      renderCards();
    });

    minusBtn.addEventListener('click', () => {
      const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
      if (cur > 1) { qtyIn.value = cur - 1; updateCalculations(); }
    });

    plusBtn.addEventListener('click', () => {
      const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
      qtyIn.value = cur + 1;
      updateCalculations();
    });

    qtyIn.addEventListener('input', updateCalculations);

    // Atajos de teclado mientras se escribe en el input de Cantidad
    qtyIn.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
        qtyIn.value = cur + 1;
        updateCalculations();
        return;
      }
      if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
        if (cur > 1) { qtyIn.value = cur - 1; updateCalculations(); }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
        qtyIn.value = cur + 1;
        updateCalculations();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = Math.max(1, parseInt(qtyIn.value, 10) || 1);
        if (cur > 1) { qtyIn.value = cur - 1; updateCalculations(); }
        return;
      }
      const k = e.key.toUpperCase();
      if (['A', 'B', 'C', 'D', 'M'].includes(k)) {
        e.preventDefault();
        const opt = priceCards.find(c => c.k === k);
        if (opt && opt.available) {
          activeLevel = k;
          renderCards();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmSelection();
        return;
      }
    });

    const confirmSelection = () => {
      const q = Math.max(1, parseInt(qtyIn.value, 10) || 1);
      let finalPriceUsd = getActivePriceUsd();
      if (activeLevel === 'M') {
        const inp = mask.querySelector('#pfCustomPriceInput');
        const v = inp ? parseFloat(inp.value) : customUsd;
        if (isNaN(v) || v < 0) {
          showToast('Ingresa un precio válido', 'warn');
          if (inp) inp.focus();
          return;
        }
        finalPriceUsd = +v.toFixed(2);
      }
      finish({
        level: activeLevel,
        price_usd: finalPriceUsd,
        qty: q
      });
    };

    confirmBtn.addEventListener('click', confirmSelection);
    cancelBtn.addEventListener('click', () => finish(null));
    closeBtn.addEventListener('click', () => finish(null));
    mask.addEventListener('click', e => { if (e.target === mask) finish(null); });

    const handleKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmSelection();
        return;
      }

      // Si el foco está en un input que no sea qtyIn (ej: customPrice), dejar que escriba números
      if (e.target.id === 'pfCustomPriceInput') return;

      const k = e.key.toUpperCase();
      if (['A', 'B', 'C', 'D', 'M'].includes(k)) {
        const opt = priceCards.find(c => c.k === k);
        if (opt && opt.available) {
          e.preventDefault();
          activeLevel = k;
          renderCards();
          return;
        }
      }
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        plusBtn.click();
      }
      if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        minusBtn.click();
      }
    };

    document.addEventListener('keydown', handleKey, true);
    renderCards();
    setTimeout(() => { qtyIn.focus(); qtyIn.select(); }, 60);
  });
}

/* ---------- Mini-lista de precio estilo MixNet (Legado) ----------
   Al seleccionar un producto se abre una lista para elegir el nivel de precio
   A/B/C/D o un precio propio. Devuelve una promesa con:
   { level:'A'|'B'|'C'|'D' } | { custom:number } | null (cancelado) */
function pfPricePopup(l) {
  return new Promise(resolve => {
    const _n = v => Number(v || 0);
    const _bs = v => _n(v).toLocaleString('es-VE', { maximumFractionDigits: 0 });
    const rate = typeof getRate === 'function' ? _n(getRate()) : _n(window.RATE || 0);
    const updatedUsd = _n(l.price_b || l.price_usd);   // ► precio actualizado (nivel B)
    const usdOf = o => (o.k === 'C' || o.k === 'D') ? (rate > 0 ? _n(o.valBs) / rate : -1) : o.val;
    const actTag = o => o.act ? ' <span class="pf-act">✓ actualizado</span>' : '';
    const opts = [
      { k: 'A', t: `A · <b>$${_n(l.price_a).toFixed(2)}</b> US$`, val: _n(l.price_a), on: _n(l.price_a) > 0 },
      { k: 'B', t: `B · <b>$${updatedUsd.toFixed(2)}</b> US$`, val: updatedUsd, on: updatedUsd > 0, act: true },
      { k: 'C', t: `C · <b>Bs ${_bs(l.price_c_bs)}</b>`, valBs: _n(l.price_c_bs), on: _n(l.price_c_bs) > 0 },
      { k: 'D', t: `D · <b>Bs ${_bs(l.price_d_bs)}</b>`, valBs: _n(l.price_d_bs), on: _n(l.price_d_bs) > 0 },
      { k: 'M', t: 'Precio propio…', val: null, on: true },
    ];

    const mask = document.createElement('div');
    mask.className = 'pf-popup-mask';
    mask.innerHTML = `
      <div class="pf-popup" role="dialog" aria-label="Elegir precio">
        <div class="pf-popup-title">${escapeHTML(l.name)}${l.brand ? ` <small>(${escapeHTML(l.brand)})</small>` : ''}</div>
        <div class="pf-popup-opts"></div>
        <div class="pf-popup-custom" style="display:none">
          <input type="number" step="0.01" min="0" class="fi" placeholder="Precio en US$" style="flex:1">
          <button type="button" class="btn-p sm">OK</button>
        </div>
        <div class="pf-popup-keys"><kbd>↑↓</kbd> mover · <kbd>Enter</kbd> elegir · <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd><kbd>D</kbd> directo · <kbd>Esc</kbd> cancelar</div>
      </div>`;
    document.body.appendChild(mask);

    const listBox = mask.querySelector('.pf-popup-opts');
    const customBox = mask.querySelector('.pf-popup-custom');
    const customIn = mask.querySelector('input');
    const customBtn = mask.querySelector('button');

    let sel = 0;
    let done = false;
    const resolveOnce = v => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      resolve(v);
    };
    mask.addEventListener('click', e => {
      if (e.target === mask) resolveOnce(null);
    });
    const pick = i => {
      const o = opts[i];
      if (!o.on) return;
      if (o.k === 'M') { showCustom(); return; }
      resolveOnce({ level: o.k });
    };
    const render = () => {
      listBox.innerHTML = opts.map((o, i) => `
        <button type="button" class="pf-popup-opt${i === sel ? ' on' : ''}${o.on ? '' : ' dis'}"
          data-i="${i}" ${o.on ? '' : 'disabled'}>${o.t}${actTag(o)}</button>`).join('');
    };
    const showCustom = () => {
      sel = -1; render();
      listBox.style.display = 'none';
      customBox.style.display = 'flex';
      customIn.focus();
    };
    const confirmCustom = () => {
      const v = parseFloat(customIn.value);
      if (isNaN(v) || v < 0) { customIn.focus(); return; }
      resolveOnce({ custom: +v.toFixed(2) });
    };

    listBox.addEventListener('click', e => {
      const b = e.target.closest('.pf-popup-opt');
      if (!b) return;
      const i = Number(b.dataset.i);
      sel = i; render();
      pick(i);
    });
    customBtn.addEventListener('click', confirmCustom);
    customIn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmCustom(); }
      if (e.key === 'Escape') { e.stopPropagation(); listBox.style.display = ''; customBox.style.display = 'none'; sel = 0; render(); customIn.value = ''; listBox.querySelector('.pf-popup-opt')?.focus(); }
    });

    const onKey = e => {
      if (customBox.style.display === 'flex') return; // el campo maneja sus propias teclas
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolveOnce(null); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); do { sel = (sel + 1) % opts.length; } while (!opts[sel].on); render(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); do { sel = (sel - 1 + opts.length) % opts.length; } while (!opts[sel].on); render(); return; }
      if (e.key === 'Enter') { e.preventDefault(); pick(sel); return; }
      const k = e.key.toLowerCase();
      const idx = opts.findIndex(o => o.k === k);
      if (idx >= 0) { e.preventDefault(); sel = idx; render(); pick(idx); return; }
    };
    document.addEventListener('keydown', onKey, true);

    render();
    // Preseleccionar el nivel que corresponde al "precio actualizado" (nivel B / price_usd),
    // comparando los 4 niveles contra ese valor (USD directo; C/D convertidos con la tasa).
    let curIdx = -1;
    opts.forEach((o, i) => {
      if (i >= 4 || !o.on) return;
      const u = usdOf(o);
      if (u >= 0 && Math.abs(u - updatedUsd) < 0.01) {
        if (o.act || curIdx === -1) curIdx = i; // B (actualizado) tiene prioridad
      }
    });
    if (curIdx === -1) curIdx = opts.findIndex(o => o.on);
    sel = curIdx;
    render();
  });
}

/* ---------- Popup de cantidad estilo MixNet ----------
   Se abre después de elegir el precio. Devuelve una promesa con la cantidad
   (number) o null si se cancela (conserva la cantidad actual de la línea). */
function pfQtyPopup(l) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'pf-popup-mask';
    mask.innerHTML = `
      <div class="pf-popup pf-qty" role="dialog" aria-label="Elegir cantidad">
        <div class="pf-popup-title">${escapeHTML(l.name)}${l.unit ? ` <small>(${escapeHTML(l.unit)})</small>` : ''}</div>
        <div class="pf-qty-body">
          <button type="button" class="pf-qty-btn" data-d="-1" tabindex="-1">−</button>
          <input type="number" step="1" min="1" value="${Math.max(1, Math.ceil(Number(l.qty) || 1))}" class="pf-qty-in">
          <button type="button" class="pf-qty-btn" data-d="1" tabindex="-1">＋</button>
        </div>
        <div class="pf-popup-keys"><kbd>↑↓</kbd> ±1 · <kbd>Shift</kbd>+<kbd>↑↓</kbd> ±10 · <kbd>Enter</kbd> aceptar · <kbd>Esc</kbd> cancelar</div>
      </div>`;
    document.body.appendChild(mask);

    const input = mask.querySelector('input');
    const btn = (d) => mask.querySelector(`.pf-qty-btn[data-d="${d}"]`);
    let done = false;
    const resolveOnce = v => { if (done) return; done = true; mask.remove(); resolve(v); };
    const clamp = v => Math.max(1, Math.round(Number(v) || 1));
    const set = v => { input.value = clamp(v); input.focus(); };
    const change = (step) => { const v = clamp(input.value) + step; if (v >= 1) set(v); };

    mask.addEventListener('click', e => {
      const b = e.target.closest('.pf-qty-btn');
      if (b) { change(Number(b.dataset.d) || 0); return; }
      if (e.target === mask) resolveOnce(null); // clic fuera: cancela, conserva actual
    });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); resolveOnce(clamp(input.value)); return; }
      if (e.key === 'Escape') { e.preventDefault(); resolveOnce(null); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); change(e.shiftKey ? -10 : -1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); change(e.shiftKey ? 10 : 1); return; }
    });
    input.focus();
    input.select();
  });
}
