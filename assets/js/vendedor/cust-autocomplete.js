/* ======================================================
   JJ Paper Vendedor — Autocompletado y Búsqueda de Cliente
   Soporte nativo para Códigos MixNet (00, 008-872, etc.),
   RIF, Razón Social/Nombre y Teléfono.
   ====================================================== */

let custAc = { timer: null, results: {}, sel: -1 };

function isValidMixCode(code) {
  if (!code) return false;
  const s = String(code).trim();
  if (s === '00' || s === '0') return true;
  // Descartar si es palabra "zona" o si es solamente un número de 1 a 3 dígitos (ej: "004", "008", "014", "020")
  if (/^zona\b/i.test(s)) return false;
  if (/^[0-9]{1,3}$/.test(s)) return false;

  const digits = s.replace(/\D/g, '');
  // Teléfonos venezolanos completos (10 a 12 dígitos, ej: 0414-1234567 o 0212-7654321)
  if (digits.length >= 10) return false;

  // Teléfonos con prefijo (04... o 02...) sin guión de 8 o más dígitos
  if ((s.startsWith('04') || s.startsWith('02') || s.startsWith('58')) && digits.length >= 8 && !s.includes('-')) {
    return false;
  }

  // Si tiene guión y el segundo bloque tiene 7 dígitos (ej: 0414-1234567, 0212-1234567), es un teléfono
  const parts = s.split('-');
  if (parts.length === 2 && parts[1].length >= 7) return false;

  // Formato estándar de código MixNet de cliente: XXX-YYY (ej: 003-251, 008-872, 020-0012)
  if (/^[0-9]{2,4}-[0-9A-Za-z]{1,6}$/.test(s)) return true;
  // Formato alfanumérico con guión (ej: C-0012)
  if (/^[A-Za-z0-9-]{3,12}$/.test(s) && s.includes('-')) return true;
  return false;
}

/**
 * Extrae el código MixNet desde el campo notes o propiedades del cliente,
 * calibrado para ignorar zonas y números de teléfono.
 */
function custAcExtractMixCode(c) {
  if (!c) return '';
  if (c.mixnet_code && isValidMixCode(c.mixnet_code)) return String(c.mixnet_code).trim();
  if (c.rif === '00' || c.is_recuperada || /recuperad/i.test(c.name || '')) return '00';
  if (c.notes) {
    const str = String(c.notes);
    // 1. Etiqueta explícita: "Codigo MixNet: 003-251", "MixNet: 003-251", etc.
    const m = str.match(/(?:c[oó]digo\s*mixnet|mixnet|cod\.?\s*mixnet|c[oó]d\.?\s*cli(?:ente)?)\s*[:#-]?\s*([0-9A-Za-z-]+)/i);
    if (m && isValidMixCode(m[1])) {
      return m[1].trim();
    }
    // 2. Corchetes en notas como "[003-251]"
    const mBracket = str.match(/\[([0-9]{2,4}-[0-9A-Za-z]+)\]/);
    if (mBracket && isValidMixCode(mBracket[1])) {
      return mBracket[1].trim();
    }
    // 3. Patrón correlativo XXX-YYY (ej: 003-251), descartando si viene precedido de teléfono (Tel, Cel, Tlf, Fax)
    const mStandalone = str.match(/\b([0-9]{3}-[0-9]{1,6})\b/);
    if (mStandalone) {
      const prefix = str.slice(0, mStandalone.index);
      if (!/(?:tel|t[eé]l|cel|fax|tlf)[^0-9]*$/i.test(prefix) && isValidMixCode(mStandalone[1])) {
        return mStandalone[1].trim();
      }
    }
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
  custAc.currentReqId = (custAc.currentReqId || 0) + 1;
  const thisReqId = custAc.currentReqId;
  custAc.timer = setTimeout(async () => {
    const digits = q.replace(/\D/g, '');
    const cleanQ = q.replace(/[%_,[\]()"'\\;]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQ) { custAcHide(boxId); return; }

    const isRecuperadaQuery = q === '00' || q === '0' || /recuperad/i.test(q);
    const isMixCode = (searchCode && (searchCode.includes('-') || searchCode === '00')) || /^[0-9]{2,4}-[0-9A-Za-z]+$/.test(cleanQ);

    const orParts = [];
    orParts.push(`name.ilike.%${cleanQ}%`);
    orParts.push(`rif.ilike.%${cleanQ}%`);

    // Búsqueda en notas (código MixNet completo o parcial ej: 251, o texto)
    if (isMixCode) {
      const codeToSearch = searchCode && searchCode.includes('-') ? searchCode : cleanQ;
      orParts.push(`notes.ilike.%${codeToSearch}%`);
    } else if (cleanQ.length >= 2) {
      orParts.push(`notes.ilike.%${cleanQ}%`);
    }

    // Búsqueda por teléfono: solo si se ingresaron al menos 4 dígitos para evitar que "04" traiga todo el país
    if (digits && digits.length >= 4) {
      orParts.push(`phone.ilike.%${digits}%`);
    }

    // Caso especial Cuenta Recuperada
    if (isRecuperadaQuery) {
      orParts.push(`rif.eq.00`);
      orParts.push(`name.ilike.%recuperad%`);
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
    if (thisReqId !== custAc.currentReqId) return; // Descartar consulta vieja si el usuario siguió escribiendo
    if (error) { console.error('autocompletado cliente:', error); custAcHide(boxId); return; }

    const results = (data || []).map(c => ({
      ...c,
      mixnet_code: custAcExtractMixCode(c)
    }));

    // Priorizar coincidencia exacta o por código MixNet (completo o sufijo ej: -251)
    const targetCodeLow = (searchCode || q).toLowerCase();
    const cleanQLow = cleanQ.toLowerCase();
    results.sort((a, b) => {
      const aCode = (a.mixnet_code || '').toLowerCase();
      const bCode = (b.mixnet_code || '').toLowerCase();
      const aExact = aCode === targetCodeLow || aCode.endsWith('-' + targetCodeLow) || aCode.replace(/-/g, '') === targetCodeLow;
      const bExact = bCode === targetCodeLow || bCode.endsWith('-' + targetCodeLow) || bCode.replace(/-/g, '') === targetCodeLow;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;

      if (aCode.startsWith(targetCodeLow) && !bCode.startsWith(targetCodeLow)) return -1;
      if (bCode.startsWith(targetCodeLow) && !aCode.startsWith(targetCodeLow)) return 1;

      const aRif = (a.rif || '').toLowerCase();
      const bRif = (b.rif || '').toLowerCase();
      if (aRif === targetCodeLow && bRif !== targetCodeLow) return -1;
      if (bRif === targetCodeLow && aRif !== targetCodeLow) return 1;

      const aStarts = (a.name || '').toLowerCase().startsWith(cleanQLow);
      const bStarts = (b.name || '').toLowerCase().startsWith(cleanQLow);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

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