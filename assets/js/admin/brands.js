/* ======================================================
   JJ Paper Admin — Brands CRUD
   ====================================================== */

let adminBrandsList = [];
let editingBrandId  = null;

async function loadBrands() {
  const { data, error } = await sb.from('jjp_brands').select('*').order('sort_order');
  if (error) { showToast('Error cargando marcas', 'err'); return; }
  adminBrandsList = data || [];
  renderBrandsTable();
}

function renderBrandsTable() {
  const tbody = document.getElementById('brandsTableBody');
  const count = document.getElementById('brandsCount');
  if (!tbody) return;
  if (count) count.textContent = `${adminBrandsList.length} marcas`;

  if (!adminBrandsList.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No hay marcas registradas</td></tr>`;
    return;
  }

  tbody.innerHTML = adminBrandsList.map(b => `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:10px">
        ${b.logo_url ? `<img src="${escapeHTML(b.logo_url)}" alt="${escapeHTML(b.name)}" style="width:44px;height:32px;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:6px;padding:2px">` : '<span style="width:44px;height:32px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;border-radius:6px">🏷️</span>'}
        <div>
          <div class="td-name">${escapeHTML(b.name)}</div>
          <div class="td-sub">${escapeHTML(b.country || '')}</div>
        </div>
      </div>
    </td>
    <td><code class="slug-chip">${b.slug}</code></td>
    <td>${b.country || '—'}</td>
    <td><span class="badge ${b.active ? 'badge-green' : 'badge-red'}">${b.active ? 'Activa' : 'Inactiva'}</span></td>
    <td>
      <div class="td-actions">
        <button class="btn-p sm" onclick="editBrand('${b.id}')">✏️ Editar</button>
        <button class="btn-danger sm" onclick="deleteBrand('${b.id}','${b.name.replace(/'/g,"\\'")}')">🗑️</button>
      </div>
    </td>
  </tr>`).join('');
}

// ---- Form ----

function openNewBrand() {
  editingBrandId = null;
  document.getElementById('brandFormPanel').style.display = 'block';
  document.getElementById('brandFormTitle').textContent = 'Nueva Marca';
  document.getElementById('brandForm')?.reset();
  brandLogoPreview('');
  document.getElementById('brandFormPanel').scrollIntoView({ behavior: 'smooth' });
}

// Live preview of the logo URL typed/loaded in the form
function brandLogoPreview(url) {
  const img = document.getElementById('brandLogoPreview');
  if (!img) return;
  if (url) { img.src = url; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}

function editBrand(id) {
  const b = adminBrandsList.find(x => x.id === id);
  if (!b) return;
  editingBrandId = id;
  document.getElementById('brandFormTitle').textContent   = 'Editar Marca';
  document.getElementById('f-brand-name').value    = b.name;
  document.getElementById('f-brand-slug').value    = b.slug;
  document.getElementById('f-brand-country').value = b.country || '';
  document.getElementById('f-brand-logo').value    = b.logo_url || '';
  brandLogoPreview(b.logo_url || '');
  document.getElementById('f-brand-sort').value    = b.sort_order || 0;
  document.getElementById('f-brand-active').checked = b.active;
  document.getElementById('brandFormPanel').style.display = 'block';
  document.getElementById('brandFormPanel').scrollIntoView({ behavior: 'smooth' });
}

function cancelBrandForm() {
  document.getElementById('brandFormPanel').style.display = 'none';
  editingBrandId = null;
}

function autoSlug(source, targetId) {
  const target = document.getElementById(targetId);
  if (target && !editingBrandId) {
    target.value = source.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

async function saveBrand() {
  const name = document.getElementById('f-brand-name')?.value.trim();
  let   slug = document.getElementById('f-brand-slug')?.value.trim();
  if (!name) { showToast('El nombre es requerido', 'warn'); return; }
  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const payload = {
    name, slug,
    country:    document.getElementById('f-brand-country')?.value.trim() || null,
    logo_url:   document.getElementById('f-brand-logo')?.value.trim() || null,
    sort_order: parseInt(document.getElementById('f-brand-sort')?.value) || 0,
    active:     document.getElementById('f-brand-active')?.checked ?? true,
  };

  let error;
  if (editingBrandId) {
    ({ error } = await sb.from('jjp_brands').update(payload).eq('id', editingBrandId));
  } else {
    ({ error } = await sb.from('jjp_brands').insert(payload));
  }

  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(editingBrandId ? '✅ Marca actualizada' : '✅ Marca creada');
  cancelBrandForm();
  await loadBrands();
}

async function deleteBrand(id, name) {
  if (!confirm(`¿Eliminar la marca "${name}"?\nLos productos vinculados quedarán sin marca.`)) return;
  const { error } = await sb.from('jjp_brands').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Marca eliminada');
  await loadBrands();
}
