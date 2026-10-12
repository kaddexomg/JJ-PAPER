/* ======================================================
   JJ Paper Vendedor — Autocompletado de cliente
   Enlazado al campo "Nombre / empresa" del POS y del
   cotizador: al escribir muestra abajo los clientes que
   coinciden (por nombre o teléfono) y al elegir uno
   rellena los demás campos vía el callback de cada página.
   ====================================================== */

let custAc = { timer: null, results: {}, sel: -1 };

function custAcBind(opts) {
  const input = document.getElementById(opts.nameId);
  const box   = document.getElementById(opts.boxId);
  if (!input || !box) return;
  custAc.handlers = custAc.handlers || {};
  custAc.handlers[opts.boxId] = opts.onPick;

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    custAcSearch(opts.nameId, opts.boxId, opts);
    if (opts.onChange) opts.onChange();
  });
  input.addEventListener('keydown', e => custAcKey(e, opts));
  input.addEventListener('blur', () => setTimeout(() => custAcHide(opts.boxId), 150));
  document.addEventListener('mousedown', e => {
    if (e.target !== input && !box.contains(e.target)) custAcHide(opts.boxId);
  });
}

async function custAcSearch(nameId, boxId, opts) {
  const input = document.getElementById(nameId);
  const box   = document.getElementById(boxId);
  const q     = input.value.trim();
  if (q.length < ((opts && opts.minLen) || 2)) { custAcHide(boxId); return; }
  clearTimeout(custAc.timer);
  custAc.timer = setTimeout(async () => {
    const digits = q.replace(/\D/g, '');
    const orParts = [
      `name.ilike.%${q}%`,
      `rif.ilike.%${q}%`,
      `notes.ilike.%${q}%`
    ];
    if (digits && digits.length >= 3) {
      orParts.push(`phone.ilike.%${digits}%`);
    }
    const or = orParts.join(',');

    const sellerObj = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (typeof CURRENT_PROFILE !== 'undefined' ? CURRENT_PROFILE : null);
    const sellerId = opts?.sellerId || sellerObj?.id;
    const isAdmin = sellerObj?.role === 'admin' || sellerObj?.is_admin;

    let query = sb.from('jjp_customers')
      .select('id,name,phone,rif,city,address,notes,total_orders,total_usd,seller_id,zone')
      .or(or);

    // En ventas y cotizaciones los vendedores regulares se restringen a su clientela asignada; los administradores tienen acceso global
    if (sellerId && opts?.sellerOnly !== false && !isAdmin) {
      query = query.eq('seller_id', sellerId);
    }

    // La Zona 020 es estrictamente exclusiva del Admin Keyder
    if (!isAdmin) {
      query = query.neq('zone', '020');
    }

    const { data, error } = await query.limit((opts && opts.limit) || 8);
    if (error) { console.error('autocompletado cliente:', error); custAcHide(boxId); return; }
    
    // Función auxiliar para extraer código MixNet de notes
    const getMixCode = (notes) => {
      if (!notes) return '';
      const m = notes.match(/(?:codigo\s*mixnet|mixnet):\s*([0-9A-Za-z-]+)/i);
      return m ? m[1].trim() : '';
    };

    const isRecuperadaQuery = q === '00' || /recuperad/i.test(q);
    const results = (data || []).map(c => ({
      ...c,
      mixnet_code: getMixCode(c.notes)
    }));

    // Si busca 00 o cuenta recuperada, o si no hay clientes, asegurar opción de Cuenta Recuperada
    const cuentaRecuperadaOption = {
      id: null,
      name: 'CUENTA RECUPERADA',
      rif: '00',
      phone: '00000000000',
      city: 'Caracas',
      address: '',
      notes: 'Cliente no registrado en MixNet (Código 00)',
      mixnet_code: '00',
      is_recuperada: true
    };

    if (isRecuperadaQuery && !results.some(r => r.mixnet_code === '00' || /recuperad/i.test(r.name))) {
      results.unshift(cuentaRecuperadaOption);
    }

    custAc.results[boxId] = results;
    custAc.sel = -1;

    if (!results.length) {
      box.innerHTML = `
        <div style="padding:10px 12px;font-size:12px;color:var(--gr)">
          <div>No está en tu clientela asignada.</div>
          <button type="button" class="btn sm" style="margin-top:6px;width:100%;background:var(--p);color:#fff"
                  onmousedown="custAcPickRecuperada('${boxId}')">
            ⚡ Usar Cuenta Recuperada (Código 00 - MixNet)
          </button>
        </div>`;
      box.style.display = 'block';
      return;
    }

    box.innerHTML = results.map((c, i) => {
      const codeBadge = c.mixnet_code ? `<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:6px">MixNet: ${escapeHTML(c.mixnet_code)}</span>` : '';
      const rifBadge = c.rif ? `<span style="font-size:11px;color:var(--gm);font-weight:600;margin-right:6px">${escapeHTML(c.rif)}</span>` : '';
      const isRec = c.is_recuperada || c.mixnet_code === '00';
      return `
      <div class="pos-result cust-ac-item ${isRec ? 'recuperada-item' : ''}" data-i="${i}"
           style="${isRec ? 'background:rgba(245, 158, 11, 0.08);border-left:3px solid #f59e0b;' : ''}"
           onmouseover="custAcHover('${boxId}',${i})"
           onmousedown="custAcPick('${boxId}',${i})">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:4px">
            ${codeBadge}
            <span>${escapeHTML(c.name)}</span>
          </div>
          <div style="font-size:11px;color:var(--gr);margin-top:2px">
            ${rifBadge}
            ${c.phone ? '· Tel: ' + escapeHTML(c.phone) : ''}
            ${c.city ? ' · ' + escapeHTML(c.city) : ''}
          </div>
        </div>
        <span class="btn-o sm">${isRec ? '⚡ Usar 00' : 'Elegir'}</span>
      </div>`;
    }).join('');

    box.style.display = 'block';
  }, 250);
}

function custAcPickRecuperada(boxId) {
  const rec = {
    id: null,
    name: 'CUENTA RECUPERADA',
    rif: '00',
    phone: '00000000000',
    city: 'Caracas',
    address: '',
    notes: 'Cliente no registrado en MixNet (Código 00)',
    mixnet_code: '00',
    is_recuperada: true
  };
  custAcHide(boxId);
  if (custAc.handlers && custAc.handlers[boxId]) {
    custAc.handlers[boxId](rec);
    const se = document.getElementById('posSearch');
    if (se) se.focus();
  }
}

function custAcHover(boxId, i) {
  custAc.sel = i;
  const box = document.getElementById(boxId);
  box.querySelectorAll('.cust-ac-item').forEach(el =>
    el.classList.toggle('on', Number(el.dataset.i) === i));
}

function custAcPick(boxId, i) {
  const c = (custAc.results[boxId] || [])[i];
  custAcHide(boxId);
  if (c && custAc.handlers && custAc.handlers[boxId]) {
    custAc.handlers[boxId](c);
    const se = document.getElementById('posSearch');
    if (se) se.focus();
  }
}

function custAcKey(e, opts) {
  if (e.key === 'Escape') {
    custAcHide(opts.boxId);
    const se = document.getElementById('posSearch');
    if (se) se.focus();
    return;
  }
  const items = document.getElementById(opts.boxId).querySelectorAll('.cust-ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    custAc.sel = Math.min(custAc.sel + 1, items.length - 1);
    custAcHover(opts.boxId, custAc.sel);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    custAc.sel = Math.max(custAc.sel - 1, 0);
    custAcHover(opts.boxId, custAc.sel);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = custAc.sel >= 0 ? custAc.sel : 0;
    custAcPick(opts.boxId, idx);
  }
}

function custAcHide(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';
  box.style.display = 'none';
}

/**
 * Renderiza la tarjeta de cliente seleccionado en la vista
 * Oculta el buscador y muestra la tarjeta con datos limpios
 */
function custAcRenderCard(c, opts) {
  if (!opts) return;
  const cardEl = document.getElementById(opts.cardId);
  const wrapEl = document.getElementById(opts.inputWrapId);
  if (!cardEl) return;

  if (!c) {
    cardEl.innerHTML = '';
    cardEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = 'block';
    return;
  }

  const code = c.mixnet_code || (c.notes && c.notes.match(/(?:codigo\s*mixnet|mixnet):\s*([0-9A-Za-z-]+)/i)?.[1]) || (c.rif === '00' ? '00' : '');
  const isRec = c.is_recuperada || code === '00' || c.rif === '00';
  const badgeStyle = isRec
    ? 'background:#fef3c7;color:#b45309;border:1px solid #fde68a'
    : (code ? 'background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd' : 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1');

  const codeBadge = code ? `<span style="font-size:11px;font-weight:900;padding:2px 8px;border-radius:6px;${badgeStyle}">MixNet: [${escapeHTML(code)}]</span>` : `<span style="font-size:11px;font-weight:900;padding:2px 8px;border-radius:6px;${badgeStyle}">Cliente</span>`;

  cardEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--theme-bg-surface-solid, #fff);border:1.5px solid var(--theme-border-accent, #10b981);border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.03)">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(16,185,129,0.12);display:flex;align-items:center;justify-content:center;font-size:18px;flex:none">
          ${isRec ? '⚡' : '🏢'}
        </div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${codeBadge}
            <strong style="font-size:14px;color:var(--theme-text-main, #0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(c.name || 'Sin nombre')}</strong>
          </div>
          <div style="font-size:12px;color:var(--theme-text-muted, #64748b);margin-top:2px;display:flex;gap:10px;flex-wrap:wrap">
            ${c.rif ? `<span><strong>RIF:</strong> ${escapeHTML(c.rif)}</span>` : ''}
            ${c.phone && c.phone !== '00000000000' ? `<span><strong>Tel:</strong> ${escapeHTML(c.phone)}</span>` : ''}
            ${c.city ? `<span><strong>Ciudad:</strong> ${escapeHTML(c.city)}</span>` : ''}
          </div>
        </div>
      </div>
      <div style="flex:none">
        <button type="button" class="btn-o sm" onclick="${opts.onResetFn || 'quoteResetCustomer()'}" title="Cambiar de cliente (Esc o F3)" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:5px 12px">
          ✏️ Cambiar <kbd style="background:rgba(0,0,0,0.06);border:1px solid rgba(0,0,0,0.1);padding:1px 5px;border-radius:4px;font-size:10px">Esc</kbd>
        </button>
      </div>
    </div>
  `;

  if (wrapEl) wrapEl.style.display = 'none';
  cardEl.style.display = 'block';
}

/**
 * Restaura el campo de búsqueda de cliente y le devuelve el foco
 */
function custAcShowInput(opts) {
  if (!opts) return;
  const cardEl = document.getElementById(opts.cardId);
  const wrapEl = document.getElementById(opts.inputWrapId);
  const inputEl = document.getElementById(opts.inputId);
  if (cardEl) {
    cardEl.innerHTML = '';
    cardEl.style.display = 'none';
  }
  if (wrapEl) wrapEl.style.display = 'block';
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
    inputEl.select();
  }
}