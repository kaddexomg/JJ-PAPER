/* ======================================================
   JJ Paper Vendedor — CRM de clientes
   (RLS: el vendedor ve sus clientes + los sin asignar)
   ====================================================== */

let vCustomers  = [];
let custFilter  = 'mios';
let editingCustId = null;

const INACTIVE_DAYS = 60;

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

function renderCustomers() {
  const tbody = document.getElementById('custBody');
  const q = normTxt(document.getElementById('custSearch')?.value.trim() || '');

  let list = vCustomers;
  if (custFilter === 'mios')      list = list.filter(c => c.seller_id === SELLER.id);
  if (custFilter === 'libres')    list = list.filter(c => !c.seller_id);
  if (custFilter === 'inactivos') list = list.filter(c => c.seller_id === SELLER.id && isInactive(c));
  if (q) list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')));

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${
      custFilter === 'mios' ? 'Aún no tienes clientes en tu cartera. Toma los "Sin vendedor" o crea nuevos. 💪' : 'Sin resultados.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const inactive = isInactive(c);
    const mine     = c.seller_id === SELLER.id;
    const waReact  = `Hola ${c.name} 👋, le escribe ${SELLER.name} de JJ Paper. ¡Tenemos promociones nuevas en papelería que le pueden interesar! ¿Le envío el catálogo? ${location.origin}/catalogo.html${SELLER.ref_code ? '?ref=' + SELLER.ref_code : ''}`;
    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(c.name)} ${inactive ? '<span title="Sin comprar hace +60 días">😴</span>' : ''}</div>
        <div class="td-sub">${escapeHTML(c.phone || '')}${mine ? '' : (c.seller_id ? ' · de otro vendedor' : ' · 🆓 sin vendedor')}</div>
      </td>
      <td>${escapeHTML(c.city || '—')}</td>
      <td style="text-align:center">${c.total_orders}</td>
      <td><strong>${fmtPrice(c.total_usd)}</strong></td>
      <td>${c.last_order_at ? fmtDate(c.last_order_at) : '<span style="color:#ccc">nunca</span>'}</td>
      <td><div class="td-actions">
        ${!c.seller_id ? `<button class="btn-o sm" onclick="claimCustomer('${c.id}')" title="Añadir a mi cartera">➕ Tomar</button>` : ''}
        ${mine ? `<button class="btn-p sm" onclick="openCustomerModal('${c.id}')">✏️</button>` : ''}
        <a class="btn-o sm" href="pos.html?tel=${encodeURIComponent(c.phone || '')}" title="Nueva venta a este cliente">🛍️</a>
        ${mine ? `<a class="btn-o sm" href="whatsapp.html?cust=${c.id}" title="Abrir chat en el CRM">📨</a>` : ''}
        <a class="btn-wa sm" style="width:auto;padding:7px 10px" target="_blank" title="${inactive ? 'Reactivar por WhatsApp' : 'Escribir por WhatsApp'}"
           href="https://wa.me/${(c.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waReact)}">${inactive ? '🔄' : '💬'}</a>
      </div></td>
    </tr>`;
  }).join('');
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
