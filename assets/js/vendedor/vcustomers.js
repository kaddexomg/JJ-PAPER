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
  '004': { name: 'Giovanni', code: '004' }
};

async function loadCustomers() {
  const { data, error } = await sb.from('jjp_customers')
    .select('*').order('last_order_at', { ascending: false, nullsFirst: false });
  if (error) { showToast('Error cargando clientes', 'err'); return; }
  vCustomers = data || [];
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
  return `<span class="badge-zone" style="background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">Zona ${escapeHTML(zone)}</span>`;
}

function renderCustomers() {
  const tbody = document.getElementById('custBody');
  const q = normTxt(document.getElementById('custSearch')?.value.trim() || '');

  let list = vCustomers;
  
  // Si no es admin, filtramos por su cartera / zona
  const isAdmin = SELLER.role === 'admin' || SELLER.is_admin;
  if (!isAdmin) {
    if (custFilter === 'mios')      list = list.filter(c => c.seller_id === SELLER.id);
    if (custFilter === 'libres')    list = list.filter(c => !c.seller_id);
    if (custFilter === 'inactivos') list = list.filter(c => c.seller_id === SELLER.id && isInactive(c));
  } else {
    // Admin ve todos, pero respetamos filtros si aplica
    if (custFilter === 'mios')      list = list.filter(c => c.seller_id);
    if (custFilter === 'libres')    list = list.filter(c => !c.seller_id);
    if (custFilter === 'inactivos') list = list.filter(c => isInactive(c));
  }

  if (q) list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')) || (c.zone || '').includes(q));

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${
      custFilter === 'mios' ? 'Aún no tienes clientes en tu cartera. Toma los "Sin vendedor" o crea nuevos. 💪' : 'Sin resultados.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const inactive = isInactive(c);
    const mine     = c.seller_id === SELLER.id || isAdmin;
    const waReact  = `Hola ${c.name} 👋, le escribe ${SELLER.name} de JJ Paper. ¡Tenemos promociones nuevas en papelería que le pueden interesar! ¿Le envío el catálogo? ${location.origin}/catalogo.html${SELLER.ref_code ? '?ref=' + SELLER.ref_code : ''}`;
    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(c.name)} ${inactive ? '<span title="Sin comprar hace +60 días">😴</span>' : ''}</div>
        <div class="td-sub">${escapeHTML(c.phone || '')}${mine ? '' : (c.seller_id ? ' · de otro vendedor' : ' · 🆓 sin vendedor')}</div>
      </td>
      <td>${getZoneBadge(c.zone)}</td>
      <td>${escapeHTML(c.city || '—')}</td>
      <td style="text-align:center">${c.total_orders}</td>
      <td><strong>${fmtPrice(c.total_usd)}</strong></td>
      <td>${c.last_order_at ? fmtDate(c.last_order_at) : '<span style="color:#ccc">nunca</span>'}</td>
      <td><div class="td-actions">
        ${!c.seller_id && !isAdmin ? `<button class="btn-o sm" onclick="claimCustomer('${c.id}')" title="Añadir a mi cartera">➕ Tomar</button>` : ''}
        ${mine ? `<button class="btn-p sm" onclick="openCustomerModal('${c.id}')">✏️</button>` : ''}
        <button class="btn-send sm" onclick="custCtxMenu(event, '${c.id}')"
                title="Enviar catálogo o lista de precios" aria-haspopup="menu">📤</button>
        <a class="btn-o sm" href="pos.html?cliente=${encodeURIComponent(c.id)}" title="Nueva venta a este cliente">🛍️</a>
        <a class="btn-o sm" href="cotizador.html?cliente=${encodeURIComponent(c.id)}" title="Cotizarle">📋</a>
        ${mine ? `<a class="btn-o sm" href="whatsapp.html?cust=${c.id}" title="Abrir chat en el CRM">📨</a>` : ''}
        <a class="btn-wa sm" style="width:auto;padding:7px 10px" target="_blank" title="${inactive ? 'Reactivar por WhatsApp' : 'Escribir por WhatsApp'}"
           href="https://wa.me/${(c.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waReact)}">${inactive ? '🔄' : '💬'}</a>
      </div></td>
    </tr>`;
  }).join('');
}

function custCtxMenu(ev, id) {
  const c = vCustomers.find(x => x.id === id);
  if (!c) return;
  sendMenuAbrir(ev, {
    nombre: c.name, telefono: c.phone, email: c.email,
    customerId: c.id, docs: ['catalogo', 'lista'],
  });
}

async function claimCustomer(id) {
  const { error } = await sb.from('jjp_customers')
    .update({ seller_id: SELLER.id, updated_at: new Date().toISOString() })
    .eq('id', id).is('seller_id', null);
  if (error) { showToast('No se pudo asignar', 'err'); return; }
  showToast('Cliente añadido a tu cartera ✔');
  loadCustomers();
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
  document.getElementById('cu-email').value   = c?.email || '';
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

  const fields = {
    name, phone,
    rif:     document.getElementById('cu-rif').value.trim()     || null,
    city:    document.getElementById('cu-city').value.trim()    || null,
    zone:    document.getElementById('cu-zone').value.trim()    || null,
    email:   document.getElementById('cu-email').value.trim()   || null,
    address: document.getElementById('cu-address').value.trim() || null,
    notes:   document.getElementById('cu-notes').value.trim()   || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingCustId) {
    ({ error } = await sb.from('jjp_customers').update(fields).eq('id', editingCustId));
  } else {
    ({ error } = await sb.from('jjp_customers').insert({ ...fields, seller_id: SELLER.id }));
  }
  if (error) {
    showToast(error.message?.includes('duplicate') ? 'Ya existe un cliente con ese teléfono' : 'Error guardando cliente', 'err');
    return;
  }
  showToast('Cliente guardado ✔');
  closeCustomerModal();
  loadCustomers();
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
        const { error } = await sb.from('jjp_customers').insert({
          name: r.name || 'Cliente', phone: r.phone || null, email: r.email || null,
          city: r.city || null, zone: r.zone || null, rif: r.rif || null, seller_id: SELLER.id
        });
        if (error) fail++; else added++;
      }
    } catch (e) { fail++; }
  }
  showToast(`Importado: ${added} nuevos · ${upd} actualizados${fail ? ` · ${fail} con error` : ''}`, fail ? 'warn' : 'ok', 6000);
  loadCustomers();
}
