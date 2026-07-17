/* ======================================================
   JJ Paper Admin — Clientes destacados (jjp_clients)
   Marquee "Clientes que confían en nosotros" del home.
   Se gestiona desde admin/ajustes.html: agregar empresa
   con logo (archivo → bucket jjp-clients, o URL directa),
   activar/desactivar y eliminar.
   ====================================================== */

let adminClientsList = [];

async function loadClientsPanel() {
  const { data, error } = await sb.from('jjp_clients').select('*').order('sort_order');
  if (error) { showToast('Error cargando clientes', 'err'); return; }
  adminClientsList = data || [];
  renderClientsList();
}

function renderClientsList() {
  const box = document.getElementById('clientsList');
  if (!box) return;

  if (!adminClientsList.length) {
    box.innerHTML = `<p style="font-size:12px;color:var(--gr)">Aún no hay clientes registrados.</p>`;
    return;
  }

  box.innerHTML = adminClientsList.map(c => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0">
      ${c.logo_url
        ? `<img src="${escapeHTML(c.logo_url.startsWith('http') ? c.logo_url : '../' + c.logo_url)}" alt="${escapeHTML(c.name)}" style="width:64px;height:40px;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:6px;padding:3px">`
        : '<span style="width:64px;height:40px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;border-radius:6px">🤝</span>'}
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px">${escapeHTML(c.name)}</div>
        <span class="badge ${c.active ? 'badge-green' : 'badge-red'}" style="font-size:10px">${c.active ? 'Visible en el sitio' : 'Oculto'}</span>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-o sm" onclick="toggleClient('${c.id}', ${!c.active})">${c.active ? '🙈 Ocultar' : '👁️ Mostrar'}</button>
        <button class="btn-danger sm" onclick="deleteClient('${c.id}','${c.name.replace(/'/g, "\\'")}')">🗑️</button>
      </div>
    </div>`).join('');
}

async function addClient() {
  const name = document.getElementById('cl-name')?.value.trim();
  const url  = document.getElementById('cl-logo-url')?.value.trim();
  const file = document.getElementById('cl-logo-file')?.files?.[0];
  if (!name) { showToast('Escribe el nombre de la empresa/cliente', 'warn'); return; }

  let logo_url = url || null;

  // Archivo tiene prioridad sobre la URL: se sube al bucket jjp-clients
  if (file) {
    if (file.size > 2 * 1024 * 1024) { showToast('El logo no debe pasar de 2 MB', 'warn'); return; }
    const ext  = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.${ext}`;
    const { error: upErr } = await sb.storage.from('jjp-clients')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/png' });
    if (upErr) { showToast('Error al subir el logo: ' + upErr.message, 'err'); return; }
    const { data: { publicUrl } } = sb.storage.from('jjp-clients').getPublicUrl(path);
    logo_url = publicUrl;
  }

  const maxSort = adminClientsList.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
  const { error } = await sb.from('jjp_clients').insert({ name, logo_url, sort_order: maxSort + 1 });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }

  showToast('✅ Cliente agregado al marquee del sitio');
  document.getElementById('cl-name').value = '';
  document.getElementById('cl-logo-url').value = '';
  document.getElementById('cl-logo-file').value = '';
  await loadClientsPanel();
}

async function toggleClient(id, active) {
  const { error } = await sb.from('jjp_clients').update({ active }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(active ? 'Cliente visible en el sitio' : 'Cliente oculto');
  await loadClientsPanel();
}

async function deleteClient(id, name) {
  if (!confirm(`¿Eliminar a "${name}" de los clientes destacados?`)) return;
  const { error } = await sb.from('jjp_clients').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Cliente eliminado');
  await loadClientsPanel();
}
