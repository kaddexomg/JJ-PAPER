/* ======================================================
   JJ Paper Vendedor — CRM de clientes con Zonas y Vendedores
   Zonas: Marianela (008), Andreina (014), Giovanni (006 y 004)
   ====================================================== */

let vCustomers  = [];
let custFilter  = 'mios';
let editingCustId = null;

const INACTIVE_DAYS = 60;

// Mapeo de Zonas y Vendedores asignados
const ZONE_SELLER_MAP = {
  '008': { name: 'Marianela', code: '008' },
  '014': { name: 'Andreina', code: '014' },
  '006': { name: 'Giovanni', code: '006' },
  '004': { name: 'Giovanni', code: '004' },
  '010': { name: 'Keyder', code: '010' },
  '020': { name: 'Keyder', code: '020' }
};

function getActiveSeller() {
  if (typeof SELLER !== 'undefined' && SELLER) return SELLER;
  if (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) return CURRENT_PROFILE;
  if (typeof window !== 'undefined' && window.SELLER) return window.SELLER;
  return { id: null, name: 'JJ Paper', role: 'vendedor' };
}

const CUST_CACHE_KEY  = 'jjp_vcust_cache_v1';
const CUST_CACHE_TIME = 'jjp_vcust_cache_v1_time';
const CUST_TTL        = 7 * 60 * 1000; // 7 minutos de vigencia

function _getCustCache() {
  try {
    const raw = sessionStorage.getItem(CUST_CACHE_KEY);
    const time = sessionStorage.getItem(CUST_CACHE_TIME);
    if (!raw || !time) return null;
    if (Date.now() - parseInt(time, 10) > CUST_TTL) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (_) { return null; }
}

function _setCustCache(data) {
  try {
    sessionStorage.setItem(CUST_CACHE_KEY, JSON.stringify(data));
    sessionStorage.setItem(CUST_CACHE_TIME, String(Date.now()));
  } catch (_) {}
}

async function loadCustomers(force = false) {
  const seller = getActiveSeller();
  const isAdmin = seller?.role === 'admin' || seller?.is_admin;

  if (!force) {
    const cached = _getCustCache();
    if (cached) {
      vCustomers = cached;
      renderCustomers();
      return;
    }
  }

  vCustomers = [];
  const PAGE = 1000;
  let from = 0;
  const CUST_COLS = 'id,name,phone,rif,zone,city,total_orders,total_usd,last_order_at,seller_id,email,email_status,address,notes,tags';
  for (;;) {
    let query = sb.from('jjp_customers')
      .select(CUST_COLS).order('last_order_at', { ascending: false, nullsFirst: false });

    // La Zona 020 es estrictamente exclusiva del Admin Keyder (no se descarga para otros vendedores)
    if (!isAdmin) {
      query = query.neq('zone', '020');
    }

    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) { showToast('Error cargando clientes', 'err'); return; }
    vCustomers.push(...(data || []));
    if (!data || data.length < PAGE || from > 12000) break;
    from += PAGE;
  }
  _setCustCache(vCustomers);
  renderCustomers();
}

function setCustFilter(f) {
  custFilter = f;
  document.querySelectorAll('.of-chip').forEach(c => c.classList.toggle('on', c.dataset.f === f));
  renderCustomers();
}

function isInactive(c) {
  if (!c.last_order_at) return c.total_orders > 0;
  return (Date.now() - new Date(c.last_order_at).getTime()) > INACTIVE_DAYS * 86400e3;
}

function getZoneBadge(zone) {
  if (!zone) return '<span class="badge-zone" style="background:#eee;color:#555">Sin Zona</span>';
  let color = '#3498db';
  if (zone === '008') color = '#e67e22'; // Marianela
  else if (zone === '014') color = '#9b59b6'; // Andreina
  else if (zone === '006' || zone === '004') color = '#2ecc71'; // Giovanni
  else if (zone === '010' || zone === '020') color = '#16a085'; // Keyder
  return `<span class="badge-zone" style="background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">Zona ${escapeHTML(zone)}</span>`;
}

function renderCustomers() {
  const tbody = document.getElementById('custBody');
  const q = normTxt(document.getElementById('custSearch')?.value.trim() || '');

  let list = vCustomers;
  
  const seller = getActiveSeller();
  const isAdmin = seller?.role === 'admin' || seller?.is_admin;
  const sellerId = seller?.id || null;
  const sellerName = seller?.name || 'JJ Paper';
  const sellerRef = seller?.ref_code || '';

  if (!isAdmin) {
    list = list.filter(c => c.zone !== '020');
    if (custFilter === 'mios')      list = list.filter(c => c.seller_id === sellerId);
    if (custFilter === 'libres')    list = list.filter(c => !c.seller_id);
    if (custFilter === 'inactivos') list = list.filter(c => c.seller_id === sellerId && isInactive(c));
  } else {
    // Admin Keyder: tiene su PROPIA cartera (010 y 020) en 'Mi cartera' e 'Inactivos',
    // y conserva 'Todos' y 'Sin vendedor' para la gestión global.
    if (custFilter === 'mios')      list = list.filter(c => c.seller_id === sellerId);
    if (custFilter === 'libres')    list = list.filter(c => !c.seller_id);
    if (custFilter === 'inactivos') list = list.filter(c => c.seller_id === sellerId && isInactive(c));
  }

  if (q) list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')) || (c.zone || '').includes(q));

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${
      custFilter === 'mios' ? 'Aún no tienes clientes en tu cartera. Toma los "Sin vendedor" o crea nuevos. 💪' : 'Sin resultados.'
    }</td></tr>`;
    return;
  }

  const MAX_RENDER = 150;
  const toShow = list.slice(0, MAX_RENDER);

  const rows = toShow.map(c => {
    const inactive = isInactive(c);
    const mine     = c.seller_id === sellerId || isAdmin;
    const waReact  = `Hola ${c.name} 👋, le escribe ${sellerName} de JJ Paper. ¡Tenemos promociones nuevas en papelería que le pueden interesar! ¿Le envío el catálogo? ${location.origin}/catalogo.html${sellerRef ? '?ref=' + sellerRef : ''}`;
    const isMobile = c.phone && (c.phone.includes('041') || c.phone.includes('042') || c.phone.includes('584'));
    const showRescueBtn = mine && c.email_status === 'bounced_hard' && isMobile;
    return `<tr>
      <td>
        <div class="td-name">
          <a href="javascript:void(0)" onclick="openCustomerHistory('${c.id}')" style="color:inherit;text-decoration:none;cursor:pointer" onmouseover="this.style.color='var(--p)'" onmouseout="this.style.color='inherit'" title="Ver ficha 360° e historial de compras">
            ${escapeHTML(c.name)} 📜
          </a>
          ${inactive ? '<span title="Sin comprar hace +60 días">😴</span>' : ''}
        </div>
        <div class="td-sub">${escapeHTML(c.phone || '')}${mine ? '' : (c.seller_id ? ' · de otro vendedor' : ' · 🆓 sin vendedor')}${c.email_status === 'bounced_hard' ? ' <span style="color:#ef4444;font-weight:bold;font-size:11px">🔴 Rebotado</span>' : ''}</div>
      </td>
      <td>${getZoneBadge(c.zone)}</td>
      <td>${escapeHTML(c.city || '—')}</td>
      <td style="text-align:center">
        ${c.total_orders > 0
          ? `<a href="javascript:void(0)" onclick="openCustomerHistory('${c.id}')" style="display:inline-block;padding:2px 8px;background:#e6f4ea;color:#137333;border-radius:12px;font-weight:700;text-decoration:none" title="Ver ${c.total_orders} compras">${c.total_orders}</a>`
          : '<span style="color:#94a3b8">0</span>'}
      </td>
      <td><strong>${fmtPrice(c.total_usd)}</strong></td>
      <td>${c.last_order_at ? fmtDate(c.last_order_at) : '<span style="color:#ccc">nunca</span>'}</td>
      <td><div class="td-actions">
        <button class="btn-o sm" style="color:#16604A;border-color:#16604A;font-weight:700" onclick="openCustomerHistory('${c.id}')" title="Ver Ficha 360° e Historial de Compras">📜</button>
        ${!c.seller_id && !isAdmin ? `<button class="btn-o sm" onclick="claimCustomer('${c.id}')" title="Añadir a mi cartera">➕ Tomar</button>` : ''}
        ${mine ? `<button class="btn-p sm" onclick="openCustomerModal('${c.id}')">✏️</button>` : ''}
        ${showRescueBtn ? `<button class="btn-o sm" style="color:#d32f2f;border-color:#d32f2f" onclick="rescueEmailByWa('${c.id}')" title="🤖 Rescatar Email por WhatsApp (rebotó: ${escapeHTML(c.email || '')})">🤖</button>` : ''}
        <button class="btn-send sm" onclick="custCtxMenu(event, '${c.id}')"
                title="Enviar catálogo o lista de precios" aria-haspopup="menu">📤</button>
        <a class="btn-o sm" href="pos.html?cliente=${encodeURIComponent(c.id)}" title="Nueva venta a este cliente">💰</a>
        <a class="btn-o sm" href="cotizador.html?cliente=${encodeURIComponent(c.id)}" title="Cotizarle">📋</a>
        ${mine ? `<a class="btn-o sm" href="whatsapp.html?cust=${c.id}" title="Abrir chat en el CRM">📨</a>` : ''}
        <a class="btn-wa sm" style="width:auto;padding:7px 10px" target="_blank" title="${inactive ? 'Reactivar por WhatsApp' : 'Escribir por WhatsApp'}"
           href="https://wa.me/${(c.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waReact)}">${inactive ? '🔄' : '💬'}</a>
      </div></td>
    </tr>`;
  }).join('');

  const moreNotice = list.length > MAX_RENDER
    ? `<tr><td colspan="7" style="text-align:center;padding:12px;color:var(--gr);font-size:13px;background:rgba(0,0,0,0.02)">Mostrando los primeros ${MAX_RENDER} de ${list.length} clientes. Usa el buscador arriba para afinar la lista.</td></tr>`
    : '';

  tbody.innerHTML = rows + moreNotice;
}

function custCtxMenu(ev, id) {
  const c = vCustomers.find(x => x.id === id);
  if (!c) return;
  sendMenuAbrir(ev, {
    nombre: c.name, telefono: c.phone, email: c.email,
    customerId: c.id, docs: ['catalogo', 'lista'],
  });
}

async function rescueEmailByWa(custId) {
  const c = vCustomers.find(x => x.id === custId);
  if (!c || !c.phone) return;
  const oldEmail = c.email || 'el anterior';
  const seller = getActiveSeller();
  const sellerName = seller?.name || 'JJ Paper';
  
  showToast('🤖 Redactando mensaje con IA...', 'info');
  
  try {
    const prompt = `Eres el asistente de JJ Paper. Redacta un mensaje MUY BREVE y persuasivo por WhatsApp para el cliente "${c.name}".
Tu nombre es ${sellerName}.
Dile amablemente que el correo que tenemos registrado (${oldEmail}) rebotó al intentar enviarle la Lista de Precios o Catálogo.
Pídele que por favor nos facilite un correo actualizado para enviarle la información.
Usa emojis y un tono cordial, directo y profesional. No incluyas variables sin llenar.`;
    
    let msg = '';
    if (window.GeminiClient && window.GeminiClient.callGemini) {
      msg = await window.GeminiClient.callGemini({ prompt, temperature: 0.7 });
    }
    
    if (!msg || !msg.trim()) {
      msg = `Hola ${c.name} 👋, le escribe ${sellerName} de JJ Paper. Intentamos enviarle nuestra Lista de Precios pero el correo que tenemos registrado (${oldEmail}) nos rebotó. ¿Podría facilitarnos un correo actualizado para hacerle llegar la información? ¡Gracias!`;
    }
    
    msg = msg.trim();
    
    const isAdmin = seller?.role === 'admin' || seller?.is_admin;
    const path = isAdmin ? 'whatsapp.html' : 'whatsapp.html'; 
    // They are in their respective dirs, so just relative path is fine since vcustomers.js is in vendedor/
    // Wait, vcustomers.js might be loaded from admin/ too. Let's just use 'whatsapp.html' assuming relative to current file HTML
    
    window.location.href = `whatsapp.html?cust=${encodeURIComponent(c.id)}&text=${encodeURIComponent(msg)}`;
  } catch (err) {
    showToast('Error generando mensaje con IA', 'err');
    console.error(err);
  }
}

async function claimCustomer(id) {
  const sellerId = getActiveSeller()?.id || null;
  const { error } = await sb.from('jjp_customers')
    .update({ seller_id: sellerId, updated_at: new Date().toISOString() })
    .eq('id', id).is('seller_id', null);
  if (error) { showToast('No se pudo asignar', 'err'); return; }
  showToast('Cliente añadido a tu cartera ✔');
  const target = vCustomers.find(x => x.id === id);
  if (target) {
    target.seller_id = sellerId;
    _setCustCache(vCustomers);
    renderCustomers();
  } else {
    loadCustomers(true);
  }
}

/* ---- Crear / editar ---- */
function openCustomerModal(id = null) {
  editingCustId = id;
  const c = id ? vCustomers.find(x => x.id === id) : null;
  document.getElementById('custModalTitle').textContent = c ? `Editar: ${c.name}` : 'Nuevo cliente';
  document.getElementById('cu-name').value    = c?.name || '';
  document.getElementById('cu-phone').value   = c?.phone || '';
  document.getElementById('cu-rif').value     = c?.rif || '';
  document.getElementById('cu-city').value    = c?.city || '';
  document.getElementById('cu-zone').value    = c?.zone || '';
  
  const emailInput = document.getElementById('cu-email');
  emailInput.value   = c?.email || '';
  emailInput.dataset.originalEmail = c?.email || '';
  emailInput.dataset.originalStatus = c?.email_status || '';
  
  let warnEl = document.getElementById('cu-email-warn');
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.id = 'cu-email-warn';
    warnEl.style = 'color:#d32f2f;font-size:12px;margin-top:4px;font-weight:bold;';
    emailInput.parentNode.appendChild(warnEl);
  }
  if (c?.email_status === 'bounced_hard') {
    warnEl.textContent = '⚠️ Este correo rebotó. Si lo actualizas, se habilitará de nuevo para envíos.';
  } else {
    warnEl.textContent = '';
  }

  document.getElementById('cu-address').value = c?.address || '';
  document.getElementById('cu-notes').value   = c?.notes || '';
  document.getElementById('custModal').classList.add('op');
}
function closeCustomerModal() {
  document.getElementById('custModal').classList.remove('op');
}

async function saveCustomer() {
  const name  = document.getElementById('cu-name').value.trim();
  const phone = document.getElementById('cu-phone').value.trim().replace(/\D/g, '');
  if (!name || !phone) { showToast('Nombre y teléfono son obligatorios', 'warn'); return; }

  const sellerId = getActiveSeller()?.id || null;
  
  const emailInput = document.getElementById('cu-email');
  const emailVal = emailInput.value.trim() || null;
  const originalEmail = emailInput.dataset.originalEmail || null;
  const originalStatus = emailInput.dataset.originalStatus || null;

  const fields = {
    name, phone,
    rif:     document.getElementById('cu-rif').value.trim()     || null,
    city:    document.getElementById('cu-city').value.trim()    || null,
    zone:    document.getElementById('cu-zone').value.trim()    || null,
    email:   emailVal,
    address: document.getElementById('cu-address').value.trim() || null,
    notes:   document.getElementById('cu-notes').value.trim()   || null,
    updated_at: new Date().toISOString(),
  };
  
  if (editingCustId && originalStatus === 'bounced_hard' && emailVal && emailVal !== originalEmail) {
    fields.email_status = 'valid';
    fields.bounce_reason = null;
    fields.bounced_at = null;
  }

  let error, insertedRow;
  if (editingCustId) {
    ({ error } = await sb.from('jjp_customers').update(fields).eq('id', editingCustId));
  } else {
    const res = await sb.from('jjp_customers').insert({ ...fields, seller_id: sellerId }).select('id,name,phone,rif,zone,city,total_orders,total_usd,last_order_at,seller_id,email,address,notes,tags').maybeSingle();
    error = res.error;
    insertedRow = res.data;
  }
  if (error) {
    showToast(error.message?.includes('duplicate') ? 'Ya existe un cliente con ese teléfono' : 'Error guardando cliente', 'err');
    return;
  }
  showToast('Cliente guardado ✔');
  closeCustomerModal();

  if (editingCustId) {
    const target = vCustomers.find(x => x.id === editingCustId);
    if (target) {
      Object.assign(target, fields);
      _setCustCache(vCustomers);
      renderCustomers();
      return;
    }
  } else if (insertedRow) {
    vCustomers.unshift(insertedRow);
    _setCustCache(vCustomers);
    renderCustomers();
    return;
  }
  loadCustomers(true);
}

function custPhoneNorm(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('58') && d.length === 12) return '0' + d.slice(2);
  if (d.startsWith('0') && d.length === 11) return d;
  if (d.length === 10 && /^[24]/.test(d)) return '0' + d;
  return d || null;
}
function custPick(o, keys) {
  for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase().trim())) return String(o[k] ?? '').trim();
  return '';
}
function custParseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].includes(';') && !lines[0].includes(',')) ? ';' : ',';
  const head = lines[0].split(sep).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => {
    const c = l.split(sep), o = {};
    head.forEach((h, i) => o[h] = (c[i] || '').trim());
    return o;
  });
}

function openCustImport() { document.getElementById('custImportInput')?.click(); }

async function custImportFile(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  let rows = [];
  try {
    if (/\.csv$/i.test(file.name)) rows = custParseCSV(await file.text());
    else if (window.XLSX) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } else { showToast('No se pudo leer el Excel. Exporta a CSV e inténtalo.', 'warn'); return; }
  } catch (e) { showToast('Error leyendo el archivo: ' + e.message, 'err'); return; }

  const mapped = rows.map(r => ({
    name: custPick(r, ['nombre', 'name', 'cliente', 'empresa', 'razon social']),
    phone: custPhoneNorm(custPick(r, ['telefono', 'teléfono', 'phone', 'celular', 'tel', 'movil', 'móvil'])),
    email: custPick(r, ['email', 'correo', 'e-mail', 'mail']).toLowerCase(),
    city: custPick(r, ['ciudad', 'city']),
    zone: custPick(r, ['zona', 'zone', 'grupo zona']),
    rif: custPick(r, ['rif', 'ci', 'cedula', 'cédula', 'documento']),
  })).filter(r => r.name || r.phone || r.email);

  if (!mapped.length) { showToast('No hallé filas válidas. Columnas: nombre, telefono, email, ciudad, zona, rif.', 'warn'); return; }
  if (!confirm(`Importar ${mapped.length} cliente(s) a tu cartera?`)) return;

  showToast('Importando…');
  let added = 0, upd = 0, fail = 0;
  for (const r of mapped) {
    try {
      const ors = [];
      if (r.email) ors.push(`email.eq.${r.email}`);
      if (r.phone) ors.push(`phone.eq.${r.phone}`);
      let existing = null;
      if (ors.length) { const { data } = await sb.from('jjp_customers').select('id').or(ors.join(',')).limit(1); existing = data?.[0]; }
      if (existing) {
        await sb.from('jjp_customers').update({
          email: r.email || undefined, city: r.city || undefined, zone: r.zone || undefined, rif: r.rif || undefined,
          updated_at: new Date().toISOString()
        }).eq('id', existing.id);
        upd++;
      } else {
        const sellerId = getActiveSeller()?.id || null;
        const { error } = await sb.from('jjp_customers').insert({
          name: r.name || 'Cliente', phone: r.phone || null, email: r.email || null,
          city: r.city || null, zone: r.zone || null, rif: r.rif || null, seller_id: sellerId
        });
        if (error) fail++; else added++;
      }
    } catch (e) { fail++; }
  }
  showToast(`Importado: ${added} nuevos · ${upd} actualizados${fail ? ` · ${fail} con error` : ''}`, fail ? 'warn' : 'ok', 6000);
  loadCustomers(true);
}
