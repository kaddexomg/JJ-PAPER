/* ======================================================
   JJ Paper Admin — Units CRUD
   ====================================================== */

let adminUnitsList = [];
let editingUnitId  = null;

async function loadUnits() {
  const { data, error } = await sb.from('jjp_units').select('*').order('sort_order');
  if (error) { showToast('Error cargando unidades', 'err'); return; }
  adminUnitsList = data || [];
  renderUnitsTable();
}

function renderUnitsTable() {
  const tbody = document.getElementById('unitsTableBody');
  const count = document.getElementById('unitsCount');
  if (!tbody) return;
  if (count) count.textContent = `${adminUnitsList.length} unidades`;

  if (!adminUnitsList.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No hay unidades registradas</td></tr>`;
    return;
  }

  tbody.innerHTML = adminUnitsList.map(u => `<tr>
    <td><strong>${u.name}</strong></td>
    <td><code class="slug-chip">${u.abbr}</code></td>
    <td style="font-size:12px;color:var(--gr)">${u.description || '—'}</td>
    <td>
      <div class="td-actions">
        <button class="btn-p sm" onclick="editUnit('${u.id}')">✏️ Editar</button>
        <button class="btn-danger sm" onclick="deleteUnit('${u.id}','${u.name.replace(/'/g,"\\'")}')">🗑️</button>
      </div>
    </td>
  </tr>`).join('');
}

// ---- Form ----

function openNewUnit() {
  editingUnitId = null;
  document.getElementById('unitFormPanel').style.display = 'block';
  document.getElementById('unitFormTitle').textContent = 'Nueva Unidad';
  document.getElementById('unitForm')?.reset();
  document.getElementById('unitFormPanel').scrollIntoView({ behavior: 'smooth' });
}

function editUnit(id) {
  const u = adminUnitsList.find(x => x.id === id);
  if (!u) return;
  editingUnitId = id;
  document.getElementById('unitFormTitle').textContent = 'Editar Unidad';
  document.getElementById('f-unit-name').value  = u.name;
  document.getElementById('f-unit-abbr').value  = u.abbr;
  document.getElementById('f-unit-desc').value  = u.description || '';
  document.getElementById('f-unit-sort').value  = u.sort_order || 0;
  document.getElementById('unitFormPanel').style.display = 'block';
  document.getElementById('unitFormPanel').scrollIntoView({ behavior: 'smooth' });
}

function cancelUnitForm() {
  document.getElementById('unitFormPanel').style.display = 'none';
  editingUnitId = null;
}

async function saveUnit() {
  const name = document.getElementById('f-unit-name')?.value.trim();
  const abbr = document.getElementById('f-unit-abbr')?.value.trim().toLowerCase();
  if (!name || !abbr) { showToast('Nombre y abreviatura requeridos', 'warn'); return; }

  const payload = {
    name, abbr,
    description: document.getElementById('f-unit-desc')?.value.trim() || null,
    sort_order:  parseInt(document.getElementById('f-unit-sort')?.value) || 0,
  };

  let error;
  if (editingUnitId) {
    ({ error } = await sb.from('jjp_units').update(payload).eq('id', editingUnitId));
  } else {
    ({ error } = await sb.from('jjp_units').insert(payload));
  }

  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(editingUnitId ? '✅ Unidad actualizada' : '✅ Unidad creada');
  cancelUnitForm();
  await loadUnits();
}

async function deleteUnit(id, name) {
  if (!confirm(`¿Eliminar la unidad "${name}"?\nLos productos vinculados conservarán el texto de unidad actual.`)) return;
  const { error } = await sb.from('jjp_units').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Unidad eliminada');
  await loadUnits();
}
