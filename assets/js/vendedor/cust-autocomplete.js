/* ======================================================
   JJ Paper Vendedor — Autocompletado y Búsqueda de Cliente
   Soporte nativo para Códigos MixNet (00, 008-872, etc.),
   RIF, Razón Social/Nombre y Teléfono.
   ====================================================== */

let custAc = { timer: null, results: {}, sel: -1 };

/**
 * Extrae el código MixNet desde el campo notes o propiedades del cliente
 */
function custAcExtractMixCode(c) {
  if (!c) return '';
  if (c.mixnet_code) return String(c.mixnet_code).trim();
  if (c.rif === '00' || c.is_recuperada || /recuperad/i.test(c.name || '')) return '00';
  if (c.notes) {
    const m = c.notes.match(/(?:codigo\s*mixnet|mixnet):\s*([0-9A-Za-z-]+)/i);
    if (m) return m[1].trim();
  }
  return '';
}

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

  // Evitar que mousedown en el dropdown o scrollbar desenfoque el input y cierre el menú
  box.addEventListener('mousedown', e => {
    e.stopPropagation();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      // Solo ocultar si el foco no está dentro del dropdown
      if (!box.contains(document.activeElement)) {
        custAcHide(opts.boxId);
      }
    }, 220);
  });

  document.addEventListener('mousedown', e => {
    if (e.target !== input && !box.contains(e.target)) custAcHide(opts.boxId);
  });
}

async function custAcSearch(nameId, boxId, opts) {
  const input = document.getElementById(nameId);
  const box   = document.getElementById(boxId);
  let rawQ    = (input?.value || '').trim();
  // Limpiar corchetes que puedan venir del auto-relleno como "[003-251] LA LIBROTECA"
  const bracketMatch = rawQ.match(/^\[([0-9A-Za-z-]+)\]\s*(.*)$/);
  const q = (bracketMatch ? (bracketMatch[2] || bracketMatch[1]) : rawQ).trim();
  const searchCode = bracketMatch ? bracketMatch[1] : q;

  if (q.length < ((opts && opts.minLen) || 1)) { custAcHide(boxId); return; }
  clearTimeout(custAc.timer);
  custAc.timer = setTimeout(async () => {
    const digits = q.replace(/\D/g, '');
    const cleanQ = q.replace(/[%_,[\]()]/g, ' ').trim();
    const orParts = [
      `name.ilike.%${cleanQ}%`,
      `rif.ilike.%${cleanQ}%`,
      `notes.ilike.%${cleanQ}%`
    ];
    if (searchCode && searchCode !== cleanQ) {
      orParts.push(`notes.ilike.%${searchCode}%`);
    }
    if (digits && digits.length >= 2) {
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

    const { data, error } = await query.limit((opts && opts.limit) || 15);
    if (error) { console.error('autocompletado cliente:', error); custAcHide(boxId); return; }

    const isRecuperadaQuery = q === '00' || q === '0' || /recuperad/i.test(q);
    const results = (data || []).map(c => ({
      ...c,
      mixnet_code: custAcExtractMixCode(c)
    }));

    // Priorizar coincidencia exacta o por inicio de código MixNet
    const targetCodeLow = (searchCode || q).toLowerCase();
    results.sort((a, b) => {
      const aCode = (a.mixnet_code || '').toLowerCase();
      const bCode = (b.mixnet_code || '').toLowerCase();
      if (aCode === targetCodeLow && bCode !== targetCodeLow) return -1;
      if (bCode === targetCodeLow && aCode !== targetCodeLow) return 1;
      if (aCode.startsWith(targetCodeLow) && !bCode.startsWith(targetCodeLow)) return -1;
      if (bCode.startsWith(targetCodeLow) && !aCode.startsWith(targetCodeLow)) return 1;
      return 0;
    });

    // Opción oficial MixNet de Cuenta Recuperada (Código 00)
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
        <div style="padding:14px 16px;font-size:12.5px;color:var(--gr)">
          <div>No se encontró ningún cliente registrado con ese código, RIF o nombre.</div>
          <button type="button" class="btn sm" style="margin-top:10px;width:100%;background:var(--p, #16604a);color:#fff;font-weight:700"
                  onmousedown="custAcPickRecuperada('${boxId}')">
            ⚡ Usar Cuenta Recuperada (Código Oficial MixNet: [00])
          </button>
        </div>`;
      box.style.display = 'block';
      return;
    }

    box.innerHTML = results.map((c, i) => {
      const code = c.mixnet_code || (c.rif === '00' ? '00' : '');
      const isRec = c.is_recuperada || code === '00' || c.rif === '00';
      const badgeStyle = isRec
        ? 'background:#fef3c7;color:#b45309;border:1px solid #fde68a'
        : (code ? 'background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd' : 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1');
      const codeBadge = code ? `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10.5px;font-weight:800;${badgeStyle}">MixNet: [${escapeHTML(code)}]</span>` : '';
      const rifBadge = c.rif ? `<span style="font-size:11px;color:var(--gm, #475569);font-weight:700;margin-right:6px">RIF: ${escapeHTML(c.rif)}</span>` : '';

      return `
      <div class="pos-result cust-ac-item ${isRec ? 'recuperada-item' : ''}" data-i="${i}"
           style="cursor:pointer;padding:10px 14px;border-bottom:1px solid var(--theme-border-subtle, #f1f5f9);display:flex;align-items:center;gap:12px;transition:background .1s ease;${isRec ? 'background:rgba(245, 158, 11, 0.06);border-left:4px solid #f59e0b;' : ''}"
           onmouseover="custAcHover('${boxId}',${i})"
           onmousedown="custAcPick('${boxId}',${i})">
        <div style="font-size:18px;flex:none">${isRec ? '⚡' : '🏢'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:700;color:var(--theme-text-main, #0f172a);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${codeBadge}
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(c.name)}</span>
          </div>
          <div style="font-size:11.5px;color:var(--theme-text-muted, #64748b);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap">
            ${rifBadge}
            ${c.phone && c.phone !== '00000000000' ? `<span>📞 ${escapeHTML(c.phone)}</span>` : ''}
            ${c.city ? `<span>📍 ${escapeHTML(c.city)}</span>` : ''}
          </div>
        </div>
        <button type="button" class="btn-o sm" style="flex:none;font-weight:700;border-radius:6px;padding:3px 10px">${isRec ? 'Usar [00]' : 'Seleccionar'}</button>
      </div>`;
    }).join('');

    box.style.display = 'block';
  }, 200);
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
  if (!box) return;
  box.querySelectorAll('.cust-ac-item').forEach(el => {
    const isSelected = Number(el.dataset.i) === i;
    el.classList.toggle('on', isSelected);
    el.style.background = isSelected ? 'var(--theme-bg-surface-solid, #f1f5f9)' : '';
  });
}

function custAcPick(boxId, i) {
  const c = (custAc.results[boxId] || [])[i];
  custAcHide(boxId);
  if (c && custAc.handlers && custAc.handlers[boxId]) {
    custAc.handlers[boxId](c);
    const se = document.getElementById('posSearch');
    if (se) {
      setTimeout(() => { se.focus(); se.select(); }, 50);
    }
  }
}

function custAcKey(e, opts) {
  const box = document.getElementById(opts.boxId);
  if (!box || box.style.display === 'none') {
    if (e.key === 'ArrowDown') {
      custAcSearch(opts.nameId, opts.boxId, opts);
    }
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    custAcHide(opts.boxId);
    return;
  }

  const items = box.querySelectorAll('.cust-ac-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    custAc.sel = Math.min(custAc.sel + 1, items.length - 1);
    custAcHover(opts.boxId, custAc.sel);
    items[custAc.sel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    custAc.sel = Math.max(custAc.sel - 1, 0);
    custAcHover(opts.boxId, custAc.sel);
    items[custAc.sel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = custAc.sel >= 0 ? custAc.sel : 0;
    custAcPick(opts.boxId, idx);
  } else if (e.key === 'Tab') {
    if (custAc.sel >= 0) {
      e.preventDefault();
      custAcPick(opts.boxId, custAc.sel);
    } else {
      custAcHide(opts.boxId);
    }
  }
}

function custAcHide(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';
  box.style.display = 'none';
}