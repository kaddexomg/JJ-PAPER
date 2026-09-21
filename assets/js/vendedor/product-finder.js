/* ======================================================
   JJ Paper — Buscador universal de productos (reusable)
   Usado por POS, cotizador y consulta de existencias.
   Busca por nombre, SKU (producto/variante), código de barras y marca.
   Requiere: sb, normTxt, fmtPrice, toBs (de config.js).
   ====================================================== */

let PF_PRODUCTS = null;

async function pfLoad(force) {
  if (PF_PRODUCTS && !force) return PF_PRODUCTS;
  const { data, error } = await sb.from('jjp_products')
    .select('id,name,sku,price_usd,price_a,price_b,price_c_bs,price_d_bs,mixnet_status,unit,emoji,image_url,stock,min_qty,jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,price_a,price_b,price_c_bs,price_d_bs,stock,min_qty,active,jjp_brands(name))')
    .eq('active', true).range(0, 1999).order('name');
  if (error) { if (typeof showToast === 'function') showToast('Error cargando productos', 'err'); return PF_PRODUCTS || []; }
  
  let products = data || [];
  
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
      if (tok.length <= 2) {
        const re = new RegExp('(^|[^a-z0-9])' + tok + '([^a-z0-9]|$)', 'i');
        return re.test(fullText);
      }
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

/* ---------- Mini-lista de precio estilo MixNet ----------
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
