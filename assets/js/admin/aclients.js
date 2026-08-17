/* ======================================================
   JJ Paper Admin — Gestión Global de Clientes y Zonas
   Asignación automática:
     - Zona 008 -> Marianela
     - Zona 014 -> Andreina
     - Zonas 006, 004 -> Giovanni
   ====================================================== */

let adminCustomers = [];
let adminProfiles  = [];
let currentZoneFilter = 'todos';
let editingAdminCustId = null;

async function loadAdminCustomers() {
  // Cargar perfiles (vendedores) para conocer IDs y nombres
  const { data: profs } = await sb.from('jjp_profiles').select('id, name, role');
  adminProfiles = profs || [];

  const { data, error } = await sb.from('jjp_customers')
    .select('*').order('last_order_at', { ascending: false, nullsFirst: false });
  if (error) { showToast('Error cargando clientes', 'err'); return; }
  adminCustomers = data || [];
  renderAdminCustomers();
}

function setAdminZone(zone) {
  currentZoneFilter = zone;
  document.querySelectorAll('#zoneFilterChips .of-chip').forEach(c => {
    c.classList.toggle('on', c.dataset.zone === zone);
  });
  renderAdminCustomers();
}

function getSellerName(sellerId) {
  if (!sellerId) return '<span style="color:#999">🆓 Sin asignar</span>';
  const p = adminProfiles.find(x => x.id === sellerId);
  return p ? escapeHTML(p.name || p.role) : '<span style="color:#999">Asignado</span>';
}

function getZoneBadge(zone) {
  if (!zone) return '<span style="background:#eee;color:#555;padding:2px 6px;border-radius:4px;font-size:11px">Sin Zona</span>';
  let color = '#3498db';
  if (zone === '008') color = '#e67e22'; // Marianela
  else if (zone === '014') color = '#9b59b6'; // Andreina
  else if (zone === '006' || zone === '004') color = '#2ecc71'; // Giovanni
  return `<span style="background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">Zona ${escapeHTML(zone)}</span>`;
}

function renderAdminCustomers() {
  const tbody = document.getElementById('adminCustBody');
  const q = normTxt(document.getElementById('adminCustSearch')?.value.trim() || '');

  let list = adminCustomers;
  if (currentZoneFilter !== 'todos') {
    if (currentZoneFilter === 'sin') list = list.filter(c => !c.zone);
    else list = list.filter(c => c.zone === currentZoneFilter);
  }
  if (q) {
    list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')) || (c.rif || '').toLowerCase().includes(q));
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No se encontraron clientes con los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>
        <div style="font-weight:600;color:var(--dark)">${escapeHTML(c.name)}</div>
        <div style="font-size:12px;color:var(--gr)">${escapeHTML(c.phone || '—')} ${c.rif ? '· ' + escapeHTML(c.rif) : ''}</div>
      </td>
      <td>${getZoneBadge(c.zone)}</td>
      <td>${getSellerName(c.seller_id)}</td>
      <td>${escapeHTML(c.city || '—')}</td>
      <td style="text-align:center">${c.total_orders}</td>
      <td><strong>${fmtPrice(c.total_usd)}</strong></td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="openAdminCustModal('${c.id}')" title="Editar cliente">✏️</button>
          <button class="btn-o sm" onclick="deleteAdminCustomer('${c.id}')" title="Eliminar cliente" style="color:var(--danger)">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

/* ---- Crear / Editar / Eliminar ---- */
function openAdminCustModal(id = null) {
  editingAdminCustId = id;
  const c = id ? adminCustomers.find(x => x.id === id) : null;
  document.getElementById('adminCustModalTitle').textContent = c ? `Editar: ${c.name}` : 'Nuevo cliente';
  document.getElementById('ac-name').value    = c?.name || '';
  document.getElementById('ac-phone').value   = c?.phone || '';
  document.getElementById('ac-rif').value     = c?.rif || '';
  document.getElementById('ac-zone').value    = c?.zone || '';
  document.getElementById('ac-city').value    = c?.city || '';
  document.getElementById('ac-email').value   = c?.email || '';
  document.getElementById('ac-address').value = c?.address || '';
  document.getElementById('ac-notes').value   = c?.notes || '';
  document.getElementById('adminCustModal').classList.add('op');
}

function closeAdminCustModal() {
  document.getElementById('adminCustModal').classList.remove('op');
}

async function saveAdminCustomer() {
  const name  = document.getElementById('ac-name').value.trim();
  const phone = document.getElementById('ac-phone').value.trim().replace(/\D/g, '');
  if (!name || !phone) { showToast('Nombre y teléfono son obligatorios', 'warn'); return; }

  const zone = document.getElementById('ac-zone').value.trim() || null;
  let seller_id = null;

  // Asignación automática por zona si no tiene
  if (zone === '008') {
    const s = adminProfiles.find(x => x.name?.toLowerCase().includes('marianela'));
    if (s) seller_id = s.id;
  } else if (zone === '014') {
    const s = adminProfiles.find(x => x.name?.toLowerCase().includes('andreina'));
    if (s) seller_id = s.id;
  } else if (zone === '006' || zone === '004') {
    const s = adminProfiles.find(x => x.name?.toLowerCase().includes('giovanni'));
    if (s) seller_id = s.id;
  }

  const fields = {
    name, phone, seller_id,
    rif:     document.getElementById('ac-rif').value.trim()     || null,
    zone:    zone,
    city:    document.getElementById('ac-city').value.trim()    || null,
    email:   document.getElementById('ac-email').value.trim()   || null,
    address: document.getElementById('ac-address').value.trim() || null,
    notes:   document.getElementById('ac-notes').value.trim()   || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingAdminCustId) {
    ({ error } = await sb.from('jjp_customers').update(fields).eq('id', editingAdminCustId));
  } else {
    ({ error } = await sb.from('jjp_customers').insert(fields));
  }
  if (error) {
    showToast(error.message?.includes('duplicate') ? 'Ya existe un cliente con ese teléfono' : 'Error guardando cliente', 'err');
    return;
  }
  showToast('Cliente guardado con éxito ✔');
  closeAdminCustModal();
  loadAdminCustomers();
}

async function deleteAdminCustomer(id) {
  if (!confirm('¿Seguro que deseas eliminar este cliente?')) return;
  const { error } = await sb.from('jjp_customers').delete().eq('id', id);
  if (error) { showToast('No se pudo eliminar', 'err'); return; }
  showToast('Cliente eliminado ✔');
  loadAdminCustomers();
}

/* ---- Importación masiva CSV consolidado ---- */
function openAdminCustImport() {
  document.getElementById('adminCustImportInput')?.click();
}

function parseCSVLine(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => {
    const cols = l.split(sep);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] || '').trim().replace(/^["']|["']$/g, ''));
    return obj;
  });
}

async function adminCustImportFile(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;

  let rows = [];
  try {
    const text = await file.text();
    rows = parseCSVLine(text);
  } catch (e) {
    showToast('Error leyendo el CSV: ' + e.message, 'err');
    return;
  }

  if (!rows.length) { showToast('El archivo CSV está vacío o no tiene formato válido', 'warn'); return; }
  if (!confirm(`Se procesarán ${rows.length} registros para importación y distribución automática por zonas. ¿Continuar?`)) return;

  showToast('Importando y distribuyendo clientes...', 'ok', 8000);

  // Mapear IDs de vendedores
  const marianela = adminProfiles.find(x => x.name?.toLowerCase().includes('marianela'))?.id || null;
  const andreina  = adminProfiles.find(x => x.name?.toLowerCase().includes('andreina'))?.id || null;
  const giovanni  = adminProfiles.find(x => x.name?.toLowerCase().includes('giovanni'))?.id || null;

  let added = 0, updated = 0, failed = 0;

  for (const r of rows) {
    try {
      const name = r.name || r.nombre || r.cliente || 'Cliente';
      const rawPhone = r.phone || r.telefono || r.celular || '';
      const phone = rawPhone.replace(/\D/g, '');
      const zone = r.zone || r.zona || '';
      const rif = r.rif || r.ci || null;
      const email = r.email || r.correo || null;
      const city = r.city || r.ciudad || null;

      if (!phone) { failed++; continue; }

      // Asignar vendedor según zona
      let seller_id = null;
      if (zone === '008') seller_id = marianela;
      else if (zone === '014') seller_id = andreina;
      else if (zone === '006' || zone === '004') seller_id = giovanni;

      // Verificar si ya existe por teléfono
      const { data: existing } = await sb.from('jjp_customers').select('id').eq('phone', phone).limit(1);
      const extId = existing?.[0]?.id;

      if (extId) {
        await sb.from('jjp_customers').update({
          name, zone: zone || undefined, seller_id: seller_id || undefined, rif: rif || undefined, email: email || undefined, city: city || undefined,
          updated_at: new Date().toISOString()
        }).eq('id', extId);
        updated++;
      } else {
        const { error } = await sb.from('jjp_customers').insert({
          name, phone, zone: zone || null, seller_id: seller_id || null, rif, email, city
        });
        if (error) failed++; else added++;
      }
    } catch (e) {
      failed++;
    }
  }

  showToast(`Importación completa: ${added} nuevos · ${updated} actualizados${failed ? ` · ${failed} errores` : ''}`, 'ok', 6000);
  loadAdminCustomers();
}
