/* ======================================================
   JJ Paper Vendedor — Cotizador al mayor
   (reusa el buscador/ticket del POS con totales sin pago)
   ====================================================== */

let posProducts = [];
let posTicket   = {};
let editingQuoteId = null;
let editingQuoteNumber = null;
let posCursor = -1;        // índice del resultado resaltado por teclado
let posResultsList = [];   // lista de resultados actualmente renderizada
let quoteCustomer = null;  // cliente seleccionado para asociar ID

async function quoteInitSellerSelector() {
  const sel = document.getElementById('qSellerSelect');
  if (!sel) return;
  const currentSeller = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (typeof CURRENT_PROFILE !== 'undefined' ? CURRENT_PROFILE : null);
  const isAdmin = currentSeller?.role === 'admin' || currentSeller?.is_admin;

  try {
    const { data: profs } = await sb.from('jjp_profiles')
      .select('id,name,role,ref_code')
      .eq('active', true)
      .order('name');

    const sellers = profs || [];
    sel.innerHTML = sellers.map(s => {
      const isMe = currentSeller && s.id === currentSeller.id;
      const prefix = s.role === 'admin' ? '👑 ' : '🧑‍💼 ';
      const suffix = s.role === 'admin' ? ' (Admin)' : (s.ref_code ? ` (${s.ref_code})` : '');
      return `<option value="${s.id}" ${isMe ? 'selected' : ''}>${prefix}${escapeHTML(s.name)}${suffix}</option>`;
    }).join('');

    if (!isAdmin && currentSeller?.id) {
      sel.value = currentSeller.id;
      sel.disabled = true;
    }
  } catch (err) {
    console.error('Error inicializando selector de vendedor en Cotizador:', err);
  }
}

async function initQuoter() {
  await quoteInitSellerSelector();
  posProducts = await pfLoad();          // buscador universal (nombre/SKU/código/marca)
  posRenderResults(pfMatch(posProducts, ''));
  const params = new URLSearchParams(location.search);
  const id = params.get('add');   // desde Consultar stock
  if (id) {
    const p = posProducts.find(x => x.id === id);
    if (p) posAddAndPick(p, (p.jjp_product_variants || []).filter(x => x.active)[0] || null);
  }
  // Viene con el cliente ya elegido (desde el chat de WhatsApp, el correo
  // o la ficha del cliente): sus datos entran solos.
  const cliente = params.get('cliente');
  if (cliente) await quoteCargarCliente(cliente);
  pfPhoneBridge(posOnScan);   // teléfono → agrega a la cotización en vivo

  const editParam = params.get('edit') || params.get('quote') || params.get('cotizacion') || params.get('id');
  if (editParam) {
    await loadQuoteForEdit(editParam);
  }

  // Autocompletado de cliente en el campo Nombre (elige → rellena tel/RIF/ciudad)
  custAcBind({
    nameId: 'qCliName',
    boxId: 'qCliNameResults',
    onPick: quotePickCustomer,
  });
  quoteInitGlobalKeys();
  quoteInitTabNav();
  updateQuoteHeaderStatus();
}

async function quoteCargarCliente(id) {
  const { data: c } = await sb.from('jjp_customers')
    .select('id,name,phone,rif,city').eq('id', id).maybeSingle();
  if (!c) { showToast('No se encontró ese cliente', 'warn'); return; }
  quoteCustomer = c;
  const set = (campo, v) => { const el = document.getElementById(campo); if (el && v) el.value = v; };
  set('qCliName', c.name); set('qCliTel', c.phone);
  set('qCliRif', c.rif);   set('qCliCity', c.city);
  showToast(`Cotizando para ${c.name}`);
}

function quotePickCustomer(c) {
  quoteCustomer = c;
  document.getElementById('qCliName').value = c.name || '';
  document.getElementById('qCliTel').value  = c.phone || '';
  document.getElementById('qCliRif').value  = c.rif || '';
  document.getElementById('qCliCity').value = c.city || '';
  const codeBadge = c.mixnet_code ? `[MixNet: ${escapeHTML(c.mixnet_code)}] ` : '';
  const rifText = c.rif ? ` (RIF: ${escapeHTML(c.rif)})` : '';
  document.getElementById('qCliNameResults').innerHTML =
    `<p style="font-size:12px;color:var(--gm);margin:8px 0">✔ Cliente seleccionado: <strong>${codeBadge}${escapeHTML(c.name)}</strong>${rifText}</p>`;
  document.getElementById('qCliNameResults').style.display = 'block';
}

function setCuentaRecuperada() {
  const nameEl = document.getElementById('qCliName');
  const telEl  = document.getElementById('qCliTel');
  const rifEl  = document.getElementById('qCliRif');
  const cityEl = document.getElementById('qCliCity');

  if (nameEl) nameEl.value = 'CUENTA RECUPERADA';
  if (telEl)  telEl.value  = '00000000000';
  if (rifEl)  rifEl.value  = '00';
  if (cityEl) cityEl.value = 'Caracas';

  quoteCustomer = {
    id: null,
    name: 'CUENTA RECUPERADA',
    rif: '00',
    phone: '00000000000',
    city: 'Caracas',
    notes: 'Cliente no registrado en MixNet (Código 00)',
    mixnet_code: '00',
    is_recuperada: true
  };

  const res = document.getElementById('qCliNameResults');
  if (res) {
    res.innerHTML = `<p style="font-size:12px;color:#d97706;font-weight:700;margin:8px 0">✔ Código Oficial MixNet [00] — CUENTA RECUPERADA (Cliente nuevo sin registrar)</p>`;
    res.style.display = 'block';
  }
  showToast('⚡ Cliente 00 (Cuenta Recuperada) aplicado para MixNet');
  const se = document.getElementById('posSearch');
  if (se) se.focus();
}

function setConsumidorFinal() {
  const nameEl = document.getElementById('qCliName');
  const telEl  = document.getElementById('qCliTel');
  const rifEl  = document.getElementById('qCliRif');
  const cityEl = document.getElementById('qCliCity');

  if (nameEl) nameEl.value = 'Consumidor Final';
  if (telEl)  telEl.value  = '00000000000';
  if (rifEl)  rifEl.value  = 'V-00000000';
  if (cityEl) cityEl.value = 'Mostrador';

  quoteCustomer = null;
  const res = document.getElementById('qCliNameResults');
  if (res) res.style.display = 'none';
  showToast('⚡ Cliente Mostrador / Consumidor Final aplicado');
}

function posOnScan(code) {
  const hit = pfFindByCode(posProducts, code);
  if (hit) { posAddAndPick(hit.product, hit.variant); showToast('📱➕ ' + hit.product.name); }
  else showToast('📱 Código no está en el catálogo: ' + code, 'warn');
}
function posPhone() {
  const url = pfPhoneScanUrl();
  const a = document.getElementById('posPhoneUrl');
  if (a) { a.textContent = url; a.href = url; }
  const qr = document.getElementById('posPhoneQR');
  if (qr) qr.href = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url);
  document.getElementById('posPhoneModal')?.classList.add('op');
}
function closePosPhone() { document.getElementById('posPhoneModal')?.classList.remove('op'); }

async function loadQuoteForEdit(val) {
  if (!val) return;
  const qStr = String(val).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qStr);
  const qQuery = sb.from('jjp_quotes').select('*');
  const { data: q, error } = await (isUuid ? qQuery.eq('id', qStr) : qQuery.eq('quote_number', qStr)).maybeSingle();
  if (error || !q) {
    showToast('Cotización no encontrada: ' + qStr, 'err');
    return;
  }

  // Permisos: vendedor solo puede editar sus propias cotizaciones
  const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
    ? SELLER
    : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) ? CURRENT_PROFILE : (window.SELLER || null));
  const isAdmin = (activeSeller?.role === 'admin');
  if (!isAdmin && q.seller_id && activeSeller?.id && q.seller_id !== activeSeller.id) {
    alert('Esta cotización pertenece a otro vendedor. Solo puedes modificar cotizaciones de tu propia cartera.');
    return;
  }
  
  editingQuoteId = q.id;
  editingQuoteNumber = q.quote_number;
  
  const cliName = document.getElementById('qCliName');
  const cliTel  = document.getElementById('qCliTel');
  const cliRif  = document.getElementById('qCliRif');
  const cliCity = document.getElementById('qCliCity');
  
  if (cliName) cliName.value = q.client_name || '';
  if (cliTel)  cliTel.value  = q.phone || '';
  if (cliRif)  cliRif.value  = q.rif || '';
  if (cliCity) cliCity.value = q.city || '';
  
  if (q.customer_id) {
    quoteCustomer = { id: q.customer_id, name: q.client_name, rif: q.rif, phone: q.phone, city: q.city };
  }
  if (q.seller_id && document.getElementById('qSellerSelect')) {
    document.getElementById('qSellerSelect').value = q.seller_id;
  }
  
  // Persistir descuento usando el ID exacto del DOM 'qDisc'
  const dscInput = document.getElementById('qDisc') || document.getElementById('qDscPct');
  if (dscInput) {
    dscInput.value = Number(q.discount_pct) || 0;
  }
  
  const notes = document.getElementById('qNotes');
  if (notes && q.notes) {
    notes.value = q.notes;
  }
  
  posTicket = {};
  if (Array.isArray(q.items)) {
    q.items.forEach(item => {
      const pid = item.product_id || item.id;
      const vid = item.variant_id || null;
      const key = vid ? `${pid}::${vid}` : pid;

      // Buscar el producto y variante original en posProducts para reinyectar precios A/B/C/D y stock
      const p = posProducts.find(x => x.id === pid);
      let variant = null;
      if (p && vid && p.jjp_product_variants) {
        variant = p.jjp_product_variants.find(v => v.id === vid);
      }
      const src = variant || p;

      posTicket[key] = {
        id: pid,
        product_id: pid,
        variant_id: vid,
        name: item.name || p?.name || '—',
        sku: item.sku || variant?.sku || p?.sku || '',
        brand: item.brand || (variant ? (variant.jjp_brands?.name || variant.variant_name || null) : null),
        unit: item.unit || p?.unit || 'unid',
        price_usd: Number(item.price_usd ?? src?.price_usd ?? 0),
        price_level: item.price_level || 'B',
        price_a: Number(src?.price_a ?? 0),
        price_b: Number(src?.price_b ?? 0),
        price_c_bs: Number(src?.price_c_bs ?? 0),
        price_d_bs: Number(src?.price_d_bs ?? 0),
        qty: Number(item.qty || item.quantity || 1),
        stock: variant ? variant.stock : (p ? p.stock : 0),
        is_custom: item.is_custom || false,
      };
    });
  }
  
  posRenderTicket();
  
  const btn = document.getElementById('qSubmitBtn');
  if (btn) btn.innerHTML = `💾 Guardar Cambios (${q.quote_number || 'Cotización'})`;
  updateQuoteHeaderStatus();
  showToast(`Editando cotización ${q.quote_number || ''} ✏️`);
}

function posUpdateName(key, newName) {
  if (posTicket[key] && newName.trim()) {
    posTicket[key].name = newName.trim();
  }
}

/* --- buscador (mismo patrón del POS) --- */
function posSearch() {
  posRenderResults(pfMatch(posProducts, document.getElementById('posSearch').value.trim()));
}

function posSearchKey(e) {
  if (document.querySelector('.pf-popup-mask')) return; // popup abierto: no interferir
  if (e.key === 'Tab') {
    e.preventDefault();
    quoteNavTab(e.shiftKey ? -1 : 1);
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
    else clearQuote();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); quoteSubmit(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const code = document.getElementById('posSearch').value.trim();
  if (!code) {
    // Si el buscador está vacío, permanecer en el buscador de productos
    return;
  }
  const hit = pfFindByCode(posProducts, code);
  if (hit) {
    posAddDirect(hit.product, hit.variant);
    return;
  }

  if (posCursor >= 0 && posCursor < posResultsList.length) {
    posPickIdx();
    return;
  } else if (posResultsList.length > 0) {
    posNavTo(0);
    posPickIdx();
    return;
  }
}
function posScanCam() {
  pfScanCamera(code => {
    const hit = pfFindByCode(posProducts, code);
    if (hit) { posAddDirect(hit.product, hit.variant); }
    else { document.getElementById('posSearch').value = code; posSearch(); showToast('Código no está en el catálogo; búscalo manual', 'warn'); }
  });
}

// Vacía la cotización en curso (con confirmación si tiene líneas)
function clearQuote() {
  if (posTicket && Object.keys(posTicket).length && !confirm('¿Vaciar esta cotización?')) return;
  posTicket = {};
  posRenderTicket();
  const se = document.getElementById('posSearch');
  if (se) { se.value = ''; se.focus(); }
  posSearch();
}

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
        <div style="font-size:11px;color:var(--gr);margin-top:2px">${pfPriceHtml(p.price_usd, p)} /${escapeHTML(p.unit || 'unid')} · <span class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</span></div>
      </div>
      <div style="display:flex;align-items:center;flex:none">
        ${vSel}
        <button type="button" class="btn-p sm" onclick="event.stopPropagation(); posAdd('${p.id}')" style="white-space:nowrap;padding:6px 12px;font-weight:700;background:#16604a;color:#fff;border-radius:6px;display:inline-flex;align-items:center;gap:4px">Elegir Precio ➔</button>
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

// Agrega o abre el selector de precio unificado para el producto/variante
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
    product_id: p.id,
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
      setTimeout(() => { se.focus(); se.select(); }, 60);
    }
  });
}

function posAddDirect(p, variant) {
  posAddAndPick(p, variant);
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



function posLineBs(l) {
  const rate = getRate();
  if (l.price_level === 'C') return Number(l.price_c_bs) || 0;
  if (l.price_level === 'D') return Number(l.price_d_bs) || 0;
  return (Number(l.price_usd) || 0) * rate;
}

function posSetPriceLevel(key, level) {
  const l = posTicket[key];
  if (!l || l.is_custom || !['A', 'B', 'C', 'D', 'M'].includes(level)) return;
  if (level === 'M') {
    l.price_level = 'M';
    posRenderTicket();
    setTimeout(() => {
      const inp = document.getElementById(`price-in-${key}`);
      if (inp) { inp.focus(); inp.select(); }
    }, 40);
    return;
  }
  const rate = getRate();
  let usd = 0;
  if (level === 'A') usd = Number(l.price_a) || 0;
  else if (level === 'B') usd = Number(l.price_b) || Number(l.price_usd) || 0;
  else if (level === 'C') usd = (Number(l.price_c_bs) || 0) / rate;
  else if (level === 'D') usd = (Number(l.price_d_bs) || 0) / rate;
  if (!(usd > 0)) { showToast('Este producto no tiene precio ' + level, 'warn'); return; }
  l.price_level = level;
  l.price_usd = +usd.toFixed(2);
  posRenderTicket();
}

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

function posRenderTicket() {
  const box  = document.getElementById('posTicket');
  const tots = document.getElementById('posTotals');
  const lines = Object.entries(posTicket);
  if (!lines.length) {
    box.innerHTML = '<p style="color:#aaa;font-size:13px">Agrega productos desde el buscador.</p>';
    tots.innerHTML = ''; return;
  }
  box.innerHTML = lines.map(([k, l], idx) => {
    const isCursor = (quoteTicketCursor === idx);
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
            ${lvlBtn('M', 'Precio M (Personalizado / Manual)')}
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
            <input type="text" class="fi ticket-nav-input" id="name-in-${k}" data-ticket-field="name" data-ticket-idx="${idx}" data-ticket-key="${k}" value="${escapeHTML(l.name)}" style="font-weight:700;font-size:13px;color:var(--theme-text-main, #0f172a);padding:2px 6px;margin:0;flex:1;height:26px;border:1px solid transparent;background:transparent;border-radius:4px" onfocus="this.style.border='1px solid var(--theme-border-glass, #cbd5e1)';this.style.background='var(--theme-input-bg, #fff)'" onblur="this.style.border='1px solid transparent';this.style.background='transparent'" onchange="posUpdateName('${k}', this.value)" aria-label="Nombre del producto">
            ${l.brand ? `<small style="color:var(--theme-text-muted, #64748b);font-weight:600">(${escapeHTML(l.brand)})</small>` : ''}
            ${isCustomBadge}
          </div>
          ${levelSelector}
        </div>
        <div style="display:flex; gap:6px; align-items:center">
          <button type="button" onclick="posSwapLine('${k}')" title="Reemplazar producto" style="padding:4px 8px;color:#0284c7;border:1px solid rgba(2,132,199,0.3);background:var(--theme-bg-surface);cursor:pointer;font-size:11px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:4px;transition:all .15s" onmouseover="this.style.background='rgba(2,132,199,0.1)'" onmouseout="this.style.background='var(--theme-bg-surface)'" aria-label="Cambiar producto">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Cambiar
          </button>
          <button type="button" onclick="posRemoveLine('${k}')" title="Eliminar producto" style="padding:4px 8px;color:#ef4444;border:1px solid rgba(239,68,68,0.3);background:var(--theme-bg-surface);cursor:pointer;font-size:11px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:4px;transition:all .15s" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='var(--theme-bg-surface)'" aria-label="Quitar producto">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Quitar
          </button>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:4px;border-top:1px dashed var(--theme-border-subtle, #f1f5f9);margin-top:2px">
        <div style="font-size:11px;color:var(--theme-text-muted, #64748b);display:flex;align-items:center;gap:4px">
          <span>Precio:</span>
          <span style="font-weight:700;color:var(--theme-text-main, #0f172a)">$</span>
          <input type="number" step="0.01" id="price-in-${k}" data-ticket-field="price" data-ticket-idx="${idx}" data-ticket-key="${k}" class="fi ticket-nav-input" value="${l.price_usd}" style="width:72px;font-size:12px;font-weight:700;padding:2px 4px;margin:0;height:24px;border-radius:4px" onchange="posUpdatePrice('${k}', this.value)" aria-label="Precio unitario de ${escapeHTML(l.name)}">
          <span>/${escapeHTML(l.unit)}</span>
          <span style="color:var(--theme-accent, #047857);font-weight:600;margin-left:4px">≈ Bs ${fmtBsNum(posLineBs(l))}</span>
        </div>

        <div style="display:flex;align-items:center;gap:10px">
          <div style="display:flex;align-items:center;gap:3px">
            <button type="button" class="qb" onclick="posQty('${k}',-1)" title="Restar 1 (-)" style="width:24px;height:24px;border-radius:4px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);color:var(--theme-text-main, #0f172a);cursor:pointer;font-weight:700">−</button>
            <input type="number" min="1" id="qty-in-${k}" data-ticket-field="qty" data-ticket-idx="${idx}" data-ticket-key="${k}" class="fi ticket-nav-input" value="${l.qty}" style="width:46px;height:24px;text-align:center;padding:2px 4px;margin:0;font-size:12px;font-weight:800;border-radius:4px" onchange="posSetQty('${k}', this.value)" onkeydown="if(event.key==='+'||event.key==='='){event.preventDefault();posQty('${k}',1);}else if(event.key==='-'||event.key==='_'){event.preventDefault();posQty('${k}',-1);}" aria-label="Cantidad">
            <button type="button" class="qb" onclick="posQty('${k}',1)" title="Sumar 1 (+)" style="width:24px;height:24px;border-radius:4px;border:1px solid var(--theme-border-subtle, #cbd5e1);background:var(--theme-bg-elevated, #fff);color:var(--theme-text-main, #0f172a);cursor:pointer;font-weight:700">＋</button>
          </div>
          <strong style="min-width:65px;text-align:right;font-size:14px;color:var(--theme-text-main, #0f172a)">${fmtPrice(l.price_usd * l.qty)}</strong>
        </div>
      </div>
    </div>`;
  }).join('');

  const subtotal = lines.reduce((s, [, l]) => s + l.price_usd * l.qty, 0);
  const pct   = quoteDiscountPct();
  const descMonto = subtotal * (pct / 100);
  const baseImponible = subtotal - descMonto;
  const s = (typeof APP !== 'undefined' && APP.SETTINGS) ? APP.SETTINGS : {};
  const ivaPct = (s.iva_pct !== undefined && s.iva_pct !== '') ? parseFloat(s.iva_pct) : 16;
  const montoIva = ivaPct > 0 ? (baseImponible * ivaPct / 100) : 0;
  const total = +(baseImponible + montoIva).toFixed(2);
  const rate  = getRate();
  tots.innerHTML = `
    <div style="background:var(--theme-bg-surface-solid, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--theme-text-muted, #475569)">
        <span>Subtotal neto</span>
        <strong style="color:var(--theme-text-main, #0f172a)">${fmtPrice(subtotal)}</strong>
      </div>
      ${pct > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--theme-accent, #166534)">
          <span>Descuento propuesto (${pct}%)</span>
          <strong>−${fmtPrice(descMonto)}</strong>
        </div>` : ''}
      ${ivaPct > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--theme-text-muted, #475569)">
          <span>Base imponible</span>
          <strong style="color:var(--theme-text-main, #0f172a)">${fmtPrice(baseImponible)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--theme-text-muted, #475569)">
          <span>IVA (${ivaPct}%)</span>
          <strong style="color:var(--theme-text-main, #0f172a)">${fmtPrice(montoIva)}</strong>
        </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--theme-border-subtle, #cbd5e1);margin-top:2px">
        <span style="font-size:14px;font-weight:800;color:var(--theme-text-main, #0f172a)">Total estimado</span>
        <span style="font-size:19px;font-weight:900;color:var(--theme-accent, #16604a)">${fmtPrice(total)}</span>
      </div>
      ${sellerShowBs() ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#047857;font-weight:700">
          <span>En bolívares (tasa ${rate.toFixed(2)})</span>
          <span>Bs ${fmtBsNum(total * rate)}</span>
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

// % propuesto, acotado al máximo permitido al vendedor (jjp_profiles.max_discount_pct)
function quoteDiscountPct() {
  const el = document.getElementById('qDisc');
  if (!el) return 0;
  const isAdmin = (SELLER?.role === 'admin' || CURRENT_PROFILE?.role === 'admin');
  const max = isAdmin ? 100 : (Number(SELLER?.max_discount_pct) || 0);
  let pct = Math.max(0, Math.min(100, Number(el.value) || 0));
  if (!isAdmin && max > 0 && pct > max) {
    pct = max; el.value = max;
    showToast(`Tu descuento máximo permitido es ${max}%`, 'warn');
  }
  const hint = document.getElementById('qDiscHint');
  if (hint) hint.textContent = isAdmin
    ? 'Modo Admin: descuento directo aplicado.'
    : (max > 0 ? `Máx. permitido: ${max}%. Al facturar, el admin lo confirma.` : 'Al facturar, el admin confirma el descuento.');
  return pct;
}

/* --- guardar cotización --- */
let qSubmitting = false;
async function quoteSubmit() {
  if (qSubmitting) return;
  const lines = Object.values(posTicket);
  const name  = document.getElementById('qCliName').value.trim();
  let tel     = document.getElementById('qCliTel').value.trim();
  if (!lines.length) { showToast('La cotización está vacía', 'warn'); return; }
  if (!name) { showToast('El nombre del cliente es obligatorio', 'warn'); return; }
  if (!tel) {
    tel = '00000000000'; // Default para mostrador / consumidor final
  }

  qSubmitting = true;
  const btn = document.getElementById('qSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const subtotal = lines.reduce((s, l) => s + l.price_usd * l.qty, 0);
    const pct   = quoteDiscountPct();
    const descMonto = subtotal * (pct / 100);
    const baseImponible = subtotal - descMonto;
    const s = (typeof APP !== 'undefined' && APP.SETTINGS) ? APP.SETTINGS : {};
    const ivaPct = (s.iva_pct !== undefined && s.iva_pct !== '') ? parseFloat(s.iva_pct) : 16;
    const montoIva = ivaPct > 0 ? (baseImponible * ivaPct / 100) : 0;
    const total = +(baseImponible + montoIva).toFixed(2);

    // Resolución segura del vendedor activo o seleccionado en Cotizador
    const selectedSellerId = document.getElementById('qSellerSelect')?.value;
    const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
      ? SELLER
      : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
          ? CURRENT_PROFILE
          : (window.SELLER || null));
    const sellerId = selectedSellerId || activeSeller?.id || null;

    const quote = {
      client_name: name,
      phone: tel,
      rif:  document.getElementById('qCliRif')?.value.trim()  || null,
      city: document.getElementById('qCliCity')?.value.trim() || null,
      items: lines.map(l => ({
        id: l.product_id || l.id || null, variant_id: l.variant_id || null, name: l.name, brand: l.brand, sku: l.sku || null,
        qty: l.qty, unit: l.unit, price_usd: l.price_usd,
        price_level: l.price_level || 'B',
        price_bs: posLineBs(l) || null,
        subtotal_usd: +(l.price_usd * l.qty).toFixed(2),
        is_custom: !!l.is_custom,
      })),
      estimated_total_usd: total,
      discount_pct: pct,
      exchange_rate: getRate(),
      notes: document.getElementById('qNotes')?.value.trim() || null,
      seller_id: sellerId,
      customer_id: (typeof quoteCustomer !== 'undefined' && quoteCustomer?.id) ? quoteCustomer.id : null,
    };
      
    let error;
    if (editingQuoteId) {
      const res = await sb.from('jjp_quotes').update(quote).eq('id', editingQuoteId);
      error = res.error;
      quote.quote_number = editingQuoteNumber; // <--- This fixes quoteShowDone(quote)
    } else {
      let qNum = null;
      if (typeof fetchNextDocSerial === 'function') {
        qNum = await fetchNextDocSerial('cotizacion');
      }
      if (!qNum || !/^\d{8}$/.test(String(qNum).trim())) {
        try {
          const { data: sData } = await sb.rpc('jjp_next_doc_serial', { p_type: 'cotizacion' });
          if (sData) qNum = String(sData).padStart(8, '0').slice(-8);
        } catch (_) {}
      }
      if (!qNum || !/^\d{8}$/.test(String(qNum).trim())) {
        qNum = String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
      }
      quote.quote_number = qNum;
      quote.status = 'pendiente';
      quote.source = 'vendedor';
      quote.seller_id = sellerId;
      const res = await sb.from('jjp_quotes').insert(quote);
      error = res.error;
    }

    if (error) {
      console.error('quote save error:', error);
      showToast('No se pudo guardar la cotización: ' + (error.message || 'Error en base de datos'), 'err');
    } else {
      if (editingQuoteId && window.location.search) {
        try { history.replaceState({}, '', window.location.pathname); } catch (_) {}
      }
      editingQuoteId = null;
      editingQuoteNumber = null;
      const subBtn = document.getElementById('qSubmitBtn');
      if (subBtn) subBtn.innerHTML = '📋 Guardar Cotización';
      quoteShowDone(quote);
    }
  } catch (err) {
    console.error('Error al procesar la cotización:', err);
    showToast('Error inesperado al guardar la cotización', 'err');
  } finally {
    qSubmitting = false;
    if (btn) { btn.disabled = false; if (!editingQuoteId) btn.textContent = '📋 Guardar Cotización'; }
  }
}

/* Contexto para el hub de envío: la cotización recién guardada.
   El presupuesto se manda en PDF, no como una lista de texto. */
let quoteLast = null;
function quoteDoneCtx() {
  const q = quoteLast || {};
  return {
    nombre: q.client_name, telefono: q.phone, email: q.email || null,
    quote: {
      order_number: q.quote_number, client_name: q.client_name, rif: q.rif,
      phone: q.phone, city: q.city, items: q.items || [],
      subtotal_usd: (q.items || []).reduce((s, i) => s + (i.subtotal_usd || 0), 0),
      total_usd: q.estimated_total_usd, discount_pct: q.discount_pct,
      discount_status: Number(q.discount_pct) > 0 ? 'approved' : 'none',
      exchange_rate: q.exchange_rate, notes: q.notes,
      status: q.status, created_at: new Date().toISOString(),
    },
    docs: ['cotizacion', 'catalogo', 'lista'],
  };
}

function quoteShowDone(q) {
  quoteLast = q;
  const subtotal = q.items.reduce((s, i) => s + (i.subtotal_usd || 0), 0);
  const pct = Number(q.discount_pct) || 0;
  const descMonto = pct > 0 ? (subtotal * pct / 100) : 0;
  const baseImponible = subtotal - descMonto;
  const s = (typeof APP !== 'undefined' && APP.SETTINGS) ? APP.SETTINGS : {};
  const ivaPct = (s.iva_pct !== undefined && s.iva_pct !== '') ? parseFloat(s.iva_pct) : 16;
  const montoIva = ivaPct > 0 ? (baseImponible * ivaPct / 100) : 0;
  const total = Number(q.estimated_total_usd) || +(baseImponible + montoIva).toFixed(2);

  let fiscalLines = `\n\nSubtotal neto: ${fmtPrice(subtotal)}`;
  if (pct > 0) fiscalLines += `\n🔖 *Descuento ${pct}%: −${fmtPrice(descMonto)}*`;
  if (ivaPct > 0) {
    fiscalLines += `\nBase imponible: ${fmtPrice(baseImponible)}`;
    fiscalLines += `\nIVA (${ivaPct}%): ${fmtPrice(montoIva)}`;
  }

  const activeSeller = (typeof SELLER !== 'undefined' && SELLER)
    ? SELLER
    : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE)
        ? CURRENT_PROFILE
        : (window.SELLER || null));
  const sellerName = activeSeller?.name || 'JJ Paper';

  const waMsg = `📋 *COTIZACIÓN ${q.quote_number}* — JJ Paper\n\nHola ${q.client_name}, aquí está tu cotización:\n`
    + q.items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} x${i.qty} = ${fmtPrice(i.subtotal_usd)}`).join('\n')
    + fiscalLines
    + `\n\n💰 *Total estimado: ${fmtPrice(total)}* (${fmtBsNum(total * q.exchange_rate)})`
    + `\n_Precios sujetos a cambio según tasa del día._`
    + (q.notes ? `\n\n📝 ${q.notes}` : '')
    + `\n\nAtendido por: ${sellerName} — JJ Paper 📄`;

  let sendHubHtml = '';
  try {
    if (typeof sendBotonHTML === 'function') sendHubHtml = sendBotonHTML('quoteDoneCtx()');
  } catch (e) {
    console.warn('sendBotonHTML error:', e);
  }

  document.getElementById('qDoneBody').innerHTML = `
    <p style="text-align:center;font-size:15px">Cotización <strong>${escapeHTML(q.quote_number)}</strong> guardada para <strong>${escapeHTML(q.client_name)}</strong>.</p>
    <div class="co-done-box" style="margin:14px 0">
      <div class="co-done-row"><span>Subtotal neto</span><strong>${fmtPrice(subtotal)}</strong></div>
      ${pct > 0 ? `<div class="co-done-row"><span>Descuento propuesto (${pct}%)</span><strong>−${fmtPrice(descMonto)}</strong></div>` : ''}
      <div class="co-done-row"><span>Base imponible</span><strong>${fmtPrice(baseImponible)}</strong></div>
      ${ivaPct > 0 ? `<div class="co-done-row"><span>IVA (${ivaPct}%)</span><strong>${fmtPrice(montoIva)}</strong></div>` : ''}
      <div class="co-done-row" style="border-top:1px solid #cbd5e1;padding-top:6px;margin-top:4px"><span style="font-weight:700">Total estimado</span><strong style="color:#16604a;font-size:16px">${fmtPrice(total)}</strong></div>
      <div class="co-done-row"><span>Productos</span><strong>${q.items.length}</strong></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <a class="btn-p" style="width:auto;padding:9px 16px;background:#16604A;color:#fff;text-decoration:none;font-weight:700"
         href="pos.html?quote=${encodeURIComponent(q.quote_number)}">📋 Procesar como Pedido</a>
      <a class="btn-o" style="width:auto;padding:9px 16px" target="_blank"
         href="../comprobante.html?q=${encodeURIComponent(q.quote_number)}&print=1">🖨️ Imprimir presupuesto</a>
      ${sendHubHtml}
      <a class="btn-wa" style="width:auto;padding:9px 16px" target="_blank"
         href="https://wa.me/${(q.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}">💬 Solo el resumen</a>
      <button class="btn-o" onclick="quoteReset()">📋 Nueva cotización</button>
    </div>`;
  document.getElementById('qDoneModal').classList.add('op');
}

function quoteReset() {
  editingQuoteId = null;
  editingQuoteNumber = null;
  if (window.location.search) {
    try { history.replaceState({}, '', window.location.pathname); } catch (_) {}
  }
  const btn = document.getElementById('qSubmitBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '📋 Guardar Cotización';
  }

  posTicket = {};
  posRenderTicket();
  quoteCustomer = null;
  ['qCliName', 'qCliTel', 'qCliRif', 'qCliCity', 'qNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('qCliNameResults').innerHTML = '';
  document.getElementById('qCliNameResults').style.display = 'none';
  const disc = document.getElementById('qDisc'); if (disc) disc.value = 0;
  const hint = document.getElementById('qDiscHint'); if (hint) hint.textContent = '';
  document.getElementById('qDoneModal')?.classList.remove('op');
  updateQuoteHeaderStatus();
}

/* ---------- Control del Ticket con Teclado (F6 / Alt+T) ---------- */
let quoteTicketCursor = -1;

function quoteFocusTicket() {
  const keys = Object.keys(posTicket);
  if (!keys.length) {
    showToast('El ticket está vacío. Agrega productos con F2', 'warn');
    return;
  }
  quoteTicketCursor = 0;
  posRenderTicket();
  const firstLine = document.querySelector('#posTicket .pos-line');
  if (firstLine) firstLine.scrollIntoView({ block: 'nearest' });
  showToast('📃 Modo ticket: ↑↓ navegar · +/- cantidad · A/B/C/D precio · Supr borrar · Esc salir');
}

/* ---------- Navegación Secuencial por Tabulador ---------- */
const QUOTE_NAV_SEQUENCE = [
  'posSearch',
  'qCliName',
  'qCliTel',
  'qDisc',
  'qNotes',
  'qSubmitBtn'
];

function quoteNavTab(dir = 1) {
  const curr = document.activeElement;
  const currId = curr?.id;
  let idx = QUOTE_NAV_SEQUENCE.indexOf(currId);
  if (idx === -1) idx = (dir > 0) ? -1 : 0;
  let nextIdx = (idx + dir + QUOTE_NAV_SEQUENCE.length) % QUOTE_NAV_SEQUENCE.length;
  let target = document.getElementById(QUOTE_NAV_SEQUENCE[nextIdx]);
  let attempts = 0;
  while ((!target || target.disabled || target.offsetParent === null) && attempts < QUOTE_NAV_SEQUENCE.length) {
    nextIdx = (nextIdx + dir + QUOTE_NAV_SEQUENCE.length) % QUOTE_NAV_SEQUENCE.length;
    target = document.getElementById(QUOTE_NAV_SEQUENCE[nextIdx]);
    attempts++;
  }
  if (target) {
    target.focus();
    if (typeof target.select === 'function') target.select();
  }
}

function quoteInitTabNav() {
  QUOTE_NAV_SEQUENCE.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.__jjTabBound) return;
    el.__jjTabBound = true;
    el.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        quoteNavTab(e.shiftKey ? -1 : 1);
      }
    });
  });
}

/* ---------- Módulo de Ítem Libre / Personalizado (F8 / Alt+I) ---------- */
function openCustomItemModal() {
  let modal = document.getElementById('customItemModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customItemModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:440px;background:#fff;border-radius:14px;padding:22px;box-shadow:0 16px 48px rgba(0,0,0,0.25)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
          <h3 style="margin:0;font-size:17px;color:#0f172a;display:flex;align-items:center;gap:6px">➕ Ítem Libre / Personalizado</h3>
          <button type="button" class="btn-g sm" onclick="closeCustomItemModal()">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label class="fl">Descripción / Servicio / Flete *</label>
            <input class="fi" id="ciName" placeholder="Ej: Flete Caracas, Servicio Guillotinado..." style="width:100%" onkeydown="if(event.key==='Enter')document.getElementById('ciPriceUsd').focus()">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="fl">Cantidad *</label>
              <input class="fi" id="ciQty" type="number" min="1" step="1" value="1" style="width:100%">
            </div>
            <div>
              <label class="fl">Unidad de Medida</label>
              <input class="fi" id="ciUnit" value="serv" placeholder="serv, und, kg..." style="width:100%">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="fl">Precio en USD ($) *</label>
              <input class="fi" id="ciPriceUsd" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%" oninput="ciCalcFromUsd()" onkeydown="if(event.key==='Enter')addCustomItemToTicket()">
            </div>
            <div>
              <label class="fl">Precio en Bs (BCV)</label>
              <input class="fi" id="ciPriceBs" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%" oninput="ciCalcFromBs()" onkeydown="if(event.key==='Enter')addCustomItemToTicket()">
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button type="button" class="btn-o" onclick="closeCustomItemModal()">Cancelar</button>
            <button type="button" class="btn-p" onclick="addCustomItemToTicket()" style="background:#16604a;color:#fff">➕ Agregar al Ticket</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  document.getElementById('ciName').value = '';
  document.getElementById('ciQty').value = '1';
  document.getElementById('ciUnit').value = 'serv';
  document.getElementById('ciPriceUsd').value = '';
  document.getElementById('ciPriceBs').value = '';
  modal.classList.add('op');
  modal.style.display = 'flex';
  setTimeout(() => { document.getElementById('ciName')?.focus(); }, 80);
}

function closeCustomItemModal() {
  const modal = document.getElementById('customItemModal');
  if (modal) {
    modal.classList.remove('op');
    modal.style.display = 'none';
  }
}

function ciCalcFromUsd() {
  const rate = getRate();
  const usd = parseFloat(document.getElementById('ciPriceUsd')?.value) || 0;
  const bsEl = document.getElementById('ciPriceBs');
  if (bsEl) bsEl.value = (usd > 0) ? (usd * rate).toFixed(2) : '';
}

function ciCalcFromBs() {
  const rate = getRate();
  const bs = parseFloat(document.getElementById('ciPriceBs')?.value) || 0;
  const usdEl = document.getElementById('ciPriceUsd');
  if (usdEl) usdEl.value = (bs > 0 && rate > 0) ? (bs / rate).toFixed(2) : '';
}

function addCustomItemToTicket() {
  const name = document.getElementById('ciName')?.value.trim();
  const qty = parseInt(document.getElementById('ciQty')?.value, 10) || 1;
  const unit = document.getElementById('ciUnit')?.value.trim() || 'serv';
  let priceUsd = parseFloat(document.getElementById('ciPriceUsd')?.value) || 0;

  if (!name) {
    showToast('Ingresa una descripción para el ítem libre', 'warn');
    document.getElementById('ciName')?.focus();
    return;
  }
  if (priceUsd <= 0) {
    const bs = parseFloat(document.getElementById('ciPriceBs')?.value) || 0;
    const rate = getRate();
    if (bs > 0 && rate > 0) priceUsd = +(bs / rate).toFixed(2);
  }
  if (priceUsd <= 0) {
    showToast('Ingresa un precio válido en USD o Bs', 'warn');
    document.getElementById('ciPriceUsd')?.focus();
    return;
  }

  const key = 'custom_' + Date.now();
  const rate = getRate();
  posTicket[key] = {
    id: null,
    product_id: null,
    variant_id: null,
    name: name,
    sku: 'LIBRE',
    brand: 'Personalizado',
    unit: unit,
    price_usd: priceUsd,
    price_level: 'M',
    price_a: priceUsd,
    price_b: priceUsd,
    price_c_bs: +(priceUsd * rate).toFixed(2),
    price_d_bs: +(priceUsd * rate).toFixed(2),
    qty: qty,
    stock: 9999,
    is_custom: true
  };

  closeCustomItemModal();
  posRenderTicket();
  showToast(`➕ Agregado: ${name}`);
}

/* ---------- Pre-armador Inteligente de Cotizaciones con IA ---------- */
function openAiQuoteModal() {
  let modal = document.getElementById('jjAiQuoteModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'jjAiQuoteModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;background:rgba(15,23,42,0.7);backdrop-filter:blur(4px);';
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
    modal.classList.add('op');
  }

  modal.innerHTML = `
    <div class="modal-box" style="max-width:580px;width:92%;background:var(--theme-bg-surface-solid, #ffffff);color:var(--theme-text-main, #0f172a);border-radius:16px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,0.3);border:1px solid var(--theme-border-subtle, #e2e8f0)" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);padding-bottom:10px">
        <h3 style="margin:0;font-size:17px;font-weight:800;color:var(--theme-text-main, #0f172a);display:flex;align-items:center;gap:6px">
          ⚡ Pre-armador de Cotización con IA
        </h3>
        <button type="button" class="btn-g sm" onclick="closeAiQuoteModal()">✕</button>
      </div>

      <p style="font-size:12.5px;color:var(--theme-text-muted, #64748b);margin:0 0 10px 0;line-height:1.4">
        Pega abajo el correo electrónico, mensaje de WhatsApp o requerimiento recibido del cliente. La IA detectará la empresa, contacto, productos y cantidades para cargarlos de inmediato al cotizador:
      </p>

      <textarea id="aiQuoteRawInput" class="fi" rows="6" placeholder="Ejemplo:
Buenas tardes, por favor cotizar para Farmacia La Paz RIF J-30123456-7 a nombre de Lic. Carlos:
- 20 resmas de papel carta Report
- 10 cajas de bolígrafos negros
- 4 rollos térmicos para punto de venta
- 2 cintas de embalar transparente
Entrega en Los Ruices..." style="width:100%;font-size:13px;resize:vertical;font-family:inherit;margin-bottom:12px"></textarea>

      <div id="aiQuotePreviewBox" style="display:none;background:var(--theme-item-bg, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:10px;padding:12px;margin-bottom:12px;font-size:12.5px">
        <div style="font-weight:700;color:var(--theme-accent, #16604a);margin-bottom:6px">📋 Acuse de Recibo Inmediato Generado:</div>
        <div id="aiQuoteAckText" style="white-space:pre-wrap;color:var(--theme-text-main, #334155);font-size:12px;background:#fff;padding:8px;border-radius:6px;border:1px solid #cbd5e1;max-height:100px;overflow-y:auto"></div>
        <button type="button" class="btn-o sm" onclick="copyAiQuoteAck()" style="margin-top:6px;font-size:11px">📋 Copiar Acuse al Portapapeles</button>
      </div>

      <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
        <button type="button" class="btn-g" onclick="closeAiQuoteModal()">Cancelar</button>
        <button type="button" id="btnProcessAiQuote" class="btn-p" onclick="processAiQuoteRequest()" style="padding:8px 18px;font-size:13px;font-weight:800;background:var(--theme-accent, #16604a)">
          Analizar y Cargar al Cotizador 🚀
        </button>
      </div>
    </div>
  `;

  setTimeout(() => document.getElementById('aiQuoteRawInput')?.focus(), 50);
}

function closeAiQuoteModal() {
  const modal = document.getElementById('jjAiQuoteModal');
  if (modal) {
    modal.classList.remove('op');
    modal.style.display = 'none';
  }
}

async function processAiQuoteRequest() {
  const text = (document.getElementById('aiQuoteRawInput')?.value || '').trim();
  if (!text) {
    showToast('Por favor escribe o pega el requerimiento del cliente.', 'warn');
    return;
  }

  const btn = document.getElementById('btnProcessAiQuote');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analizando requerimientos con IA… 🧠';
  }

  try {
    if (typeof GeminiClient === 'undefined' || !GeminiClient.parseQuoteRequest) {
      throw new Error('Módulo GeminiClient no disponible. Por favor recarga la página.');
    }

    const parsed = await GeminiClient.parseQuoteRequest(text, posProducts);
    
    // 1. Llenar datos de cliente si se detectaron
    if (parsed.customer) {
      if (parsed.customer.client_name) {
        const cName = document.getElementById('qCliName');
        if (cName) cName.value = parsed.customer.client_name;
      }
      if (parsed.customer.rif) {
        const cRif = document.getElementById('qCliRif');
        if (cRif) cRif.value = parsed.customer.rif;
      }
      if (parsed.customer.phone) {
        const cTel = document.getElementById('qCliTel');
        if (cTel) cTel.value = parsed.customer.phone;
      }
      if (parsed.customer.city) {
        const cCity = document.getElementById('qCliCity');
        if (cCity) cCity.value = parsed.customer.city;
      }
    }

    // 2. Agregar ítems al ticket
    let addedCount = 0;
    if (Array.isArray(parsed.items)) {
      parsed.items.forEach(it => {
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        if (it.matched && it.product_id) {
          const key = it.variant_id ? `${it.product_id}::${it.variant_id}` : it.product_id;
          if (posTicket[key]) {
            posTicket[key].qty += qty;
          } else {
            posTicket[key] = {
              id: it.product_id,
              product_id: it.product_id,
              variant_id: it.variant_id || null,
              name: it.catalog_name || it.product_name,
              sku: it.sku || '',
              brand: it.brand || null,
              unit: it.unit || 'unid',
              price_usd: Number(it.price_usd || it.price_b || it.price_a || 0),
              price_level: 'B',
              price_a: Number(it.price_a || 0),
              price_b: Number(it.price_b || 0),
              price_c_bs: Number(it.price_c_bs || 0),
              price_d_bs: Number(it.price_d_bs || 0),
              qty: qty,
              is_custom: false
            };
          }
          addedCount++;
        } else {
          const customKey = 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
          posTicket[customKey] = {
            id: customKey,
            product_id: null,
            variant_id: null,
            name: it.product_name || it.raw_query || 'Ítem solicitado',
            sku: 'SOLICITADO',
            brand: null,
            unit: it.unit || 'unid',
            price_usd: 0,
            price_level: 'M',
            qty: qty,
            is_custom: true
          };
          addedCount++;
        }
      });
    }

    posRenderTicket();

    let hasSuggestions = false;
    if (parsed.cross_selling_ideas && parsed.cross_selling_ideas.length > 0) {
      hasSuggestions = true;
      const suggestionsHTML = parsed.cross_selling_ideas.map(item => `
        <span style="display:inline-block;background:rgba(22,96,74,0.1);color:#16604a;padding:4px 8px;border-radius:12px;font-size:12px;margin:4px;font-weight:600;border:1px solid rgba(22,96,74,0.2)">+ ${item}</span>
      `).join('');
      
      const suggestionsHtmlBlock = `
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed #ccc">
          <strong style="font-size:13px;color:#16604a;display:block;margin-bottom:6px">💡 IA Sugiere ofrecer:</strong>
          ${suggestionsHTML}
        </div>
      `;
      
      if (parsed.ack_message) {
        window.__lastAiAckMessage = parsed.ack_message;
        const previewBox = document.getElementById('aiQuotePreviewBox');
        const ackTextEl = document.getElementById('aiQuoteAckText');
        if (previewBox && ackTextEl) {
          ackTextEl.innerHTML = parsed.ack_message + suggestionsHtmlBlock;
          previewBox.style.display = 'block';
        }
      }
    } else {
      if (parsed.ack_message) {
        window.__lastAiAckMessage = parsed.ack_message;
        const previewBox = document.getElementById('aiQuotePreviewBox');
        const ackTextEl = document.getElementById('aiQuoteAckText');
        if (previewBox && ackTextEl) {
          ackTextEl.textContent = parsed.ack_message;
          previewBox.style.display = 'block';
        }
      }
    }

    showToast(`¡Cotización pre-armada! Se cargaron ${addedCount} productos al ticket. ✨`);
    
    // Si hay sugerencias, no cerramos automáticamente para que el vendedor las lea
    if (!hasSuggestions) {
      setTimeout(() => {
        closeAiQuoteModal();
        const firstQty = document.querySelector('input[data-ticket-field="qty"]');
        if (firstQty) firstQty.focus();
      }, 1200);
    }

  } catch (err) {
    console.warn('Fallo en IA principal para cotización, intentando fallback heurístico local:', err);
    try {
      let addedCount = 0;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const qtyMatch = line.match(/^(\d+)\s*(?:resmas?|cajas?|paquetes?|bultos?|unidades?|und|uds?)?\s+(?:de\s+)?(.+)/i) 
                      || line.match(/^(.+?)\s*[-:]\s*(\d+)\s*(?:resmas?|cajas?|paquetes?|bultos?|unidades?|und|uds?)?$/i);
        let qty = 1;
        let searchName = line;
        if (qtyMatch) {
          if (/^\d+$/.test(qtyMatch[1])) {
            qty = parseInt(qtyMatch[1], 10) || 1;
            searchName = qtyMatch[2] || line;
          } else {
            searchName = qtyMatch[1] || line;
            qty = parseInt(qtyMatch[2], 10) || 1;
          }
        }
        searchName = searchName.replace(/[^\w\s]/gi, ' ').trim().toLowerCase();
        if (searchName.length < 3) continue;

        const words = searchName.split(/\s+/).filter(w => w.length > 2);
        let bestProd = null;
        let bestScore = 0;

        for (const p of (posProducts || [])) {
          const pName = (p.name || '').toLowerCase();
          const pSku = (p.sku || '').toLowerCase();
          let score = 0;
          for (const w of words) {
            if (pSku.includes(w)) score += 3;
            if (pName.includes(w)) score += 1;
          }
          if (score > bestScore) {
            bestScore = score;
            bestProd = p;
          }
        }

        if (bestProd && bestScore >= Math.min(2, words.length)) {
          const key = bestProd.id;
          if (posTicket[key]) {
            posTicket[key].qty += qty;
          } else {
            posTicket[key] = {
              id: bestProd.id,
              product_id: bestProd.id,
              variant_id: null,
              name: bestProd.name,
              sku: bestProd.sku || '',
              brand: null,
              unit: bestProd.unit || 'unid',
              price_usd: Number(bestProd.price_usd || bestProd.price_b || bestProd.price_a || 0),
              price_level: 'B',
              price_a: Number(bestProd.price_a || 0),
              price_b: Number(bestProd.price_b || 0),
              price_c_bs: Number(bestProd.price_c_bs || 0),
              price_d_bs: Number(bestProd.price_d_bs || 0),
              qty: qty,
              active: true
            };
          }
          addedCount++;
        }
      }

      if (addedCount > 0) {
        posRenderTicket();
        showToast(`Cotización pre-armada por coincidencia local (${addedCount} productos cargados) ✨`);
        setTimeout(() => closeAiQuoteModal(), 1200);
        return;
      }
    } catch (e2) {
      console.error('Error en fallback heurístico:', e2);
    }
    showToast('Error analizando requerimiento: ' + err.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analizar y Cargar al Cotizador 🚀';
    }
  }
}

function copyAiQuoteAck() {
  if (!window.__lastAiAckMessage) return;
  navigator.clipboard.writeText(window.__lastAiAckMessage).then(() => {
    showToast('Acuse de recibo copiado al portapapeles. Listo para enviar al cliente. 📋');
  });
}

/* ---------- Control de Cabecera y Estado de Cotización Activa ---------- */
function updateQuoteHeaderStatus() {
  const ind = document.getElementById('quoteActiveIndicator');
  const act = document.getElementById('quoteActiveActions');
  const rate = getRate();
  const rateHtml = rate > 0 ? `<span style="background:#f1f5f9;color:#334155;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1">💵 Tasa BCV: <b>Bs ${rate.toFixed(2)}</b></span>` : '';
  
  if (editingQuoteId && editingQuoteNumber) {
    const cliName = document.getElementById('qCliName')?.value || '—';
    if (ind) {
      ind.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.35);font-size:12px;font-weight:800;padding:5px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Editando: <strong style="font-family:monospace;font-size:13px">${escapeHTML(editingQuoteNumber)}</strong>
          </span>
          <span style="font-size:12px;color:var(--theme-text-main);font-weight:600;display:inline-flex;align-items:center;gap:5px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            ${escapeHTML(cliName)}
          </span>
          ${rateHtml}
        </div>
      `;
    }
    if (act) {
      act.innerHTML = `
        <button type="button" class="btn-p sm" onclick="quoteConvertToPos()" title="Pasar a pedido y procesar (F7)" style="border-radius:999px;font-weight:700;padding:6px 14px;display:inline-flex;align-items:center;gap:6px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          Pasar a Pedido <kbd style="background:rgba(255,255,255,0.25);border:none;padding:1px 5px;border-radius:4px;font-size:11px">F7</kbd>
        </button>
        <button type="button" class="btn-o sm" onclick="quotePrintPdf()" title="Ver presupuesto oficial (F10)" style="border-radius:999px;font-weight:700;padding:6px 14px;display:inline-flex;align-items:center;gap:6px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
          Presupuesto PDF <kbd style="background:rgba(0,0,0,0.06);border:1px solid rgba(0,0,0,0.1);padding:1px 5px;border-radius:4px;font-size:11px">F10</kbd>
        </button>
        <button type="button" class="btn-g sm" onclick="quoteReset()" title="Salir del modo edición (Alt+N)" style="border-radius:999px;color:#dc2626;border:1px solid rgba(220,38,38,0.3);padding:6px 14px;display:inline-flex;align-items:center;gap:6px">
          ✕ Cancelar <kbd style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.2);padding:1px 5px;border-radius:4px;font-size:11px">Alt+N</kbd>
        </button>
      `;
    }
  } else {
    if (ind) {
      ind.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="background:rgba(16,185,129,0.12);color:var(--theme-accent);border:1px solid var(--theme-accent);font-size:12px;font-weight:800;padding:5px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
            Nueva Cotización
          </span>
          ${rateHtml}
        </div>
      `;
    }
    if (act) {
      act.innerHTML = '';
    }
  }
}

function quoteConvertToPos() {
  if (editingQuoteNumber) {
    window.location.href = `pos.html?quote=${encodeURIComponent(editingQuoteNumber)}`;
    return;
  }
  const lines = Object.values(posTicket || {});
  if (!lines.length) {
    showToast('La cotización está vacía. Agrega productos primero', 'warn');
    return;
  }
  showToast('Guardando cotización para procesar pedido...');
  quoteSubmit().then(() => {
    if (editingQuoteNumber) {
      window.location.href = `pos.html?quote=${encodeURIComponent(editingQuoteNumber)}`;
    }
  });
}

function quotePrintPdf() {
  if (editingQuoteNumber) {
    window.open(`../comprobante.html?q=${encodeURIComponent(editingQuoteNumber)}&print=1`, '_blank');
  } else {
    showToast('Guarda la cotización primero para generar el presupuesto PDF oficial', 'warn');
  }
}

function goToAllQuotes() {
  window.location.href = 'cotizaciones.html';
}

/* ---------- Buscador de Cotizaciones Existentes (F4) ---------- */
let qsQuotesList = [];
let qsCursor = 0;

async function openQuoteSearchModal() {
  let modal = document.getElementById('quoteSearchModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quoteSearchModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:720px;width:95%;background:#fff;border-radius:14px;padding:22px;box-shadow:0 16px 48px rgba(0,0,0,0.25)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="background:#ecfdf5;color:#16604a;font-weight:900;font-size:13px;padding:3px 8px;border-radius:6px">F4</span>
            <h3 style="margin:0;font-size:18px;color:#0f172a">📂 Cargar / Abrir Cotización Existente</h3>
          </div>
          <button type="button" class="btn-g sm" onclick="closeQuoteSearchModal()">✕ Esc</button>
        </div>
        <div style="margin-bottom:12px">
          <input class="fi" id="qsInput" placeholder="Escribe N° Cotización (ej: 00053333), nombre de cliente, RIF o teléfono..." style="width:100%;height:42px;font-size:14px;padding:8px 12px;border-radius:8px" oninput="filterQuotesInModal()" onkeydown="qsKeyNav(event)">
        </div>
        <div id="qsResults" style="max-height:380px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px">
          <p style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">Cargando cotizaciones recientes...</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:12px;color:#64748b;padding-top:8px;border-top:1px solid #f1f5f9">
          <span>Usa <kbd style="background:#f1f5f9;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1">↑</kbd> <kbd style="background:#f1f5f9;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1">↓</kbd> para navegar · <kbd style="background:#f1f5f9;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1">Enter</kbd> para cargar · <kbd style="background:#f1f5f9;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1">Esc</kbd> cerrar</span>
          <button type="button" class="btn-o sm" onclick="closeQuoteSearchModal();goToAllQuotes()" style="font-size:11px">📋 Ver Todas las Cotizaciones (F8)</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.classList.add('op');
  modal.style.display = 'flex';
  const input = document.getElementById('qsInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 60);
  }
  await fetchRecentQuotesForModal();
}

function closeQuoteSearchModal() {
  const modal = document.getElementById('quoteSearchModal');
  if (modal) {
    modal.classList.remove('op');
    modal.style.display = 'none';
  }
}

async function fetchRecentQuotesForModal() {
  const container = document.getElementById('qsResults');
  if (!container) return;
  container.innerHTML = '<p style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">Buscando cotizaciones...</p>';
  
  try {
    const activeSeller = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : ((typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) ? CURRENT_PROFILE : window.SELLER);
    const isAdmin = activeSeller?.role === 'admin';
    
    let query = sb.from('jjp_quotes')
      .select('id, quote_number, client_name, phone, rif, city, estimated_total_usd, discount_pct, status, created_at, seller_id')
      .order('created_at', { ascending: false })
      .limit(30);
      
    if (!isAdmin && activeSeller?.id) {
      query = query.eq('seller_id', activeSeller.id);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    qsQuotesList = data || [];
    qsCursor = 0;
    renderQuotesInModal(qsQuotesList);
  } catch (err) {
    console.error('Error fetching quotes for modal:', err);
    container.innerHTML = '<p style="text-align:center;padding:20px;color:#ef4444;font-size:13px">Error al cargar cotizaciones: ' + (err.message || 'Error de red') + '</p>';
  }
}

function renderQuotesInModal(list) {
  const container = document.getElementById('qsResults');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<p style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">No se encontraron cotizaciones.</p>';
    return;
  }
  
  const rate = getRate();
  container.innerHTML = list.map((q, idx) => {
    const dateStr = q.created_at ? new Date(q.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const totalUsd = Number(q.estimated_total_usd) || 0;
    const totalBs = (totalUsd * rate).toFixed(2);
    const isSelected = idx === qsCursor;
    return `
      <div class="qs-item" data-id="${q.id}" onclick="selectQuoteFromModal('${q.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${isSelected ? '#ecfdf5' : '#fff'};transition:background 0.15s ease">
        <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
          <span style="font-family:monospace;font-weight:900;background:#0f172a;color:#fff;padding:3px 8px;border-radius:6px;font-size:12px">${escapeHTML(q.quote_number || 'S/N')}</span>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:13px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(q.client_name || 'Sin nombre')}</div>
            <div style="font-size:11px;color:#64748b">${dateStr} ${q.phone ? '· 📞 ' + escapeHTML(q.phone) : ''} ${q.city ? '· 📍 ' + escapeHTML(q.city) : ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-weight:900;font-size:13px;color:#16604a">${fmtPrice(totalUsd)}</div>
            <div style="font-size:11px;color:#059669">Bs ${fmtBsNum(totalBs)}</div>
          </div>
          <span style="font-size:10px;text-transform:uppercase;padding:2px 6px;border-radius:4px;font-weight:800;background:${q.status === 'facturada' ? '#dcfce7;color:#15803d' : (q.status === 'confirmado_mixnet' ? '#dbeafe;color:#1d4ed8' : '#fef3c7;color:#b45309')}">${q.status === 'confirmado_mixnet' ? '✅ En MixNet' : (q.status || 'pendiente')}</span>
          ${q.status === 'confirmado_mixnet'
            ? `<span style="font-size:11px;color:#1d4ed8;font-weight:700">Ya enviada a MixNet</span>`
            : `<button type="button" class="btn-p sm" onclick="event.stopPropagation();confirmQuoteToMixnet('${q.id}','${(q.quote_number||'').replace(/'/g,'')}')" title="Marcar como confirmada para enviarla a MixNet" style="padding:4px 10px;font-size:11px;background:#1d4ed8;color:#fff;border-radius:6px">✅ Confirmar → MixNet</button>`}
          <button type="button" class="btn-p sm" onclick="event.stopPropagation();selectQuoteFromModal('${q.id}')" style="padding:4px 10px;font-size:11px;background:#16604a;color:#fff;border-radius:6px">✏️ Cargar</button>
        </div>
      </div>
    `;
  }).join('');
}

function selectQuoteFromModal(id) {
  closeQuoteSearchModal();
  loadQuoteForEdit(id);
}

// Confirmar cotización para su envío a MixNet.
// Solo al confirmar, el agente de la Win7 la escribe con el correlativo real de MixNet.
async function confirmQuoteToMixnet(id, quoteNumber) {
  if (!id) return;
  const label = quoteNumber ? '#' + quoteNumber : 'esta cotización';
  if (!confirm(`¿Confirmar ${label} para enviarla a MixNet?\n\nSe le asignará el número correlativo real de MixNet.`)) return;
  try {
    const res = await sb.from('jjp_quotes').update({ status: 'confirmado_mixnet' }).eq('id', id);
    if (res.error) throw res.error;
    if (typeof toast === 'function') toast('✅ Cotización confirmada · se enviará a MixNet', 'success');
    else alert('Cotización confirmada para MixNet.');
    if (typeof loadQuotesInModal === 'function') loadQuotesInModal();
    else if (typeof filterQuotesInModal === 'function') filterQuotesInModal();
  } catch (e) {
    alert('No se pudo confirmar: ' + (e.message || e));
  }
}

function filterQuotesInModal() {
  const q = document.getElementById('qsInput')?.value.trim().toLowerCase() || '';
  if (!q) {
    renderQuotesInModal(qsQuotesList);
    return;
  }
  const filtered = qsQuotesList.filter(item => {
    const num = (item.quote_number || '').toLowerCase();
    const cli = (item.client_name || '').toLowerCase();
    const tel = (item.phone || '').toLowerCase();
    const rif = (item.rif || '').toLowerCase();
    return num.includes(q) || cli.includes(q) || tel.includes(q) || rif.includes(q);
  });
  qsCursor = 0;
  renderQuotesInModal(filtered);
}

function qsKeyNav(e) {
  const container = document.getElementById('qsResults');
  const items = container?.querySelectorAll('.qs-item');
  if (!items || !items.length) {
    if (e.key === 'Escape') closeQuoteSearchModal();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    qsCursor = Math.min(qsCursor + 1, items.length - 1);
    items.forEach((it, i) => it.style.background = (i === qsCursor ? '#ecfdf5' : '#fff'));
    items[qsCursor]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    qsCursor = Math.max(qsCursor - 1, 0);
    items.forEach((it, i) => it.style.background = (i === qsCursor ? '#ecfdf5' : '#fff'));
    items[qsCursor]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = items[qsCursor];
    if (target) {
      const id = target.getAttribute('data-id');
      if (id) selectQuoteFromModal(id);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeQuoteSearchModal();
  }
}

/* ---------- Atajos de Teclado Globales de Cotizador ---------- */
function quoteInitGlobalKeys() {
  if (window.__quoteGlobalKeysBound) return;
  window.__quoteGlobalKeysBound = true;

  window.addEventListener('keydown', e => {
    if (document.querySelector('.pf-popup-mask')) return; // selector de producto maneja sus teclas
    
    // Modal de búsqueda de cotizaciones abierto
    const qsModal = document.getElementById('quoteSearchModal');
    if (qsModal && qsModal.style.display !== 'none' && qsModal.classList.contains('op')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeQuoteSearchModal();
        return;
      }
      return; // permitir que qsKeyNav maneje el input
    }

    const customModal = document.getElementById('customItemModal');
    if (customModal && customModal.style.display !== 'none' && customModal.classList.contains('op')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCustomItemModal();
        return;
      }
    }

    // Manejo de navegación en el ticket cuando quoteTicketCursor está activo
    if (quoteTicketCursor >= 0 && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      const keys = Object.keys(posTicket);
      if (keys.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          quoteTicketCursor = Math.min(quoteTicketCursor + 1, keys.length - 1);
          posRenderTicket();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          quoteTicketCursor = Math.max(quoteTicketCursor - 1, 0);
          posRenderTicket();
          return;
        }
        if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') {
          e.preventDefault();
          posQty(keys[quoteTicketCursor], 1);
          return;
        }
        if (e.key === '-' || e.key === 'ArrowLeft') {
          e.preventDefault();
          posQty(keys[quoteTicketCursor], -1);
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const targetKey = keys[quoteTicketCursor];
          posRemoveLine(targetKey);
          if (quoteTicketCursor >= Object.keys(posTicket).length) {
            quoteTicketCursor = Object.keys(posTicket).length - 1;
          }
          posRenderTicket();
          return;
        }
        const lvlKey = e.key.toUpperCase();
        if (['A', 'B', 'C', 'D'].includes(lvlKey)) {
          e.preventDefault();
          posSetPriceLevel(keys[quoteTicketCursor], lvlKey);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'F2') {
          e.preventDefault();
          quoteTicketCursor = -1;
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
      quoteShowHelpModal();
      return;
    }

    // Escape universal: cerrar modal de ayuda, teléfono o volver al buscador
    if (e.key === 'Escape') {
      const helpModal = document.getElementById('quoteShortcutsHelpModal');
      if (helpModal && helpModal.style.display !== 'none') {
        helpModal.style.display = 'none';
        return;
      }
      const doneModal = document.getElementById('qDoneModal');
      if (doneModal && doneModal.classList.contains('op')) {
        quoteReset();
        return;
      }
      const phoneModal = document.getElementById('posPhoneModal');
      if (phoneModal && phoneModal.classList.contains('op')) {
        closePosPhone();
        return;
      }
      if (quoteTicketCursor >= 0) {
        quoteTicketCursor = -1;
        posRenderTicket();
        const se = document.getElementById('posSearch');
        if (se) { se.focus(); se.select(); }
        return;
      }
      const se = document.getElementById('posSearch');
      if (document.activeElement === se && se.value.trim()) {
        se.value = '';
        posSearch();
        return;
      }
      if (document.activeElement !== se && se) {
        se.focus();
        se.select();
        return;
      }
      return;
    }

    // F2 o '/' (fuera de inputs): enfocar búsqueda de productos
    if (e.key === 'F2' || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
      e.preventDefault();
      quoteTicketCursor = -1;
      posRenderTicket();
      const se = document.getElementById('posSearch');
      if (se) { se.focus(); se.select(); }
      return;
    }

    // F3: enfocar búsqueda de cliente
    if (e.key === 'F3') {
      e.preventDefault();
      const cli = document.getElementById('qCliName');
      if (cli) { cli.focus(); cli.select(); }
      return;
    }

    // F4 o (Alt+O): abrir buscador de cotizaciones existentes
    if (e.key === 'F4' || (e.key.toLowerCase() === 'o' && e.altKey)) {
      e.preventDefault();
      openQuoteSearchModal();
      return;
    }

    // F6 o Alt+T: modo teclado sobre el ticket
    if (e.key === 'F6' || (e.key.toLowerCase() === 't' && e.altKey)) {
      e.preventDefault();
      quoteFocusTicket();
      return;
    }

    // F7: Facturar / Cobrar en POS
    if (e.key === 'F7') {
      e.preventDefault();
      quoteConvertToPos();
      return;
    }

    // F8 o (Alt+C): ir al listado de cotizaciones
    if (e.key === 'F8' || (e.key.toLowerCase() === 'c' && e.altKey)) {
      e.preventDefault();
      goToAllQuotes();
      return;
    }

    // F9 o Ctrl+Enter: guardar cotización / guardar cambios
    if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      quoteSubmit();
      return;
    }

    // F10 o Ctrl+P: ver o imprimir presupuesto PDF
    if (e.key === 'F10' || (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      quotePrintPdf();
      return;
    }

    // Alt+I: abrir modal de ítem libre / personalizado
    if (e.key.toLowerCase() === 'i' && e.altKey) {
      e.preventDefault();
      openCustomItemModal();
      return;
    }

    // Alt+N: nueva cotización / limpiar edición
    if (e.key.toLowerCase() === 'n' && e.altKey) {
      e.preventDefault();
      quoteReset();
      showToast('⚡ Nueva cotización lista');
      return;
    }

    // Alt+D: enfocar campo de descuento
    if (e.key.toLowerCase() === 'd' && e.altKey) {
      e.preventDefault();
      const disc = document.getElementById('qDisc');
      if (disc) { disc.focus(); disc.select(); }
      return;
    }
  });
}

function quoteShowHelpModal() {
  let modal = document.getElementById('quoteShortcutsHelpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quoteShortcutsHelpModal';
    modal.className = 'modal-overlay op';
    modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:640px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #e2e8f0;padding-bottom:12px">
          <h3 style="margin:0;font-size:18px;color:#0f172a;display:flex;align-items:center;gap:8px">⌨️ Centro de Atajos de Teclado del Cotizador</h3>
          <button type="button" class="btn-g sm" onclick="document.getElementById('quoteShortcutsHelpModal').style.display='none'">✕ Esc</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;line-height:1.5;color:#334155">
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">📂 Cotizaciones y Gestión</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F4</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Alt+O</kbd> Abrir cotización existente</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F8</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Alt+C</kbd> Ver todas las cotizaciones</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F7</kbd> Pasar a Pedido</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F10</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Ctrl+P</kbd> Ver / Imprimir PDF</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+N</kbd> Nueva cotización / limpiar</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">📦 Búsqueda y Selección</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F2</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">/</kbd> Buscar producto</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↑</kbd> <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">↓</kbd> Moverse en catálogo</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Enter</kbd> Elegir precio y cantidad</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">A/B/C/D</kbd> Nivel de precio en modal</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+I</kbd> Ítem Libre / Servicio</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">👤 Cliente y Descuento</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F3</kbd> Buscar cliente en cartera</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Alt+D</kbd> Descuento propuesto %</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Tab</kbd> Saltar entre secciones</div>
          </div>
          <div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#0f172a;display:block;margin-bottom:6px">📃 Edición del Ticket</b>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F6</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">Alt+T</kbd> Activar ticket</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">+ -</kbd> Ajustar cantidad</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px">A/B/C/D</kbd> Cambiar nivel de precio</div>
            <div style="margin-bottom:4px"><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Supr</kbd> Borrar fila activa</div>
            <div><kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">F9</kbd> o <kbd style="background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-weight:700">Ctrl+Enter</kbd> Guardar</div>
          </div>
        </div>
        <div style="text-align:right;margin-top:16px">
          <button type="button" class="btn-p sm" onclick="document.getElementById('quoteShortcutsHelpModal').style.display='none'">¡Entendido!</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
}
