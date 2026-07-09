/* ======================================================
   JJ Paper Admin — Promociones / Combos CRUD
   Reusa renderPromoCard() de assets/js/promos.js para la vista previa.
   ====================================================== */

let adminPromosList = [];
let editingPromoId  = null;

const PROMO_STATUS = {
  hidden:    ['Oculta',     'badge-red'],
  scheduled: ['Programada', 'badge-blue'],
  expired:   ['Expirada',   'badge-yellow'],
  live:      ['Activa',     'badge-green'],
};

function promoStatus(p) {
  if (!p.active) return 'hidden';
  const now = Date.now();
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return 'scheduled';
  if (p.ends_at && new Date(p.ends_at).getTime() < now)     return 'expired';
  return 'live';
}

async function loadPromosAdmin() {
  const { data, error } = await sb.from('jjp_promos').select('*')
    .order('sort_order').order('created_at', { ascending: false });
  if (error) { showToast('Error cargando promociones', 'err'); return; }
  adminPromosList = data || [];
  renderPromoStats();
  renderPromosTable();
}

function renderPromoStats() {
  const counts = { live: 0, scheduled: 0, expired: 0, hidden: 0 };
  adminPromosList.forEach(p => counts[promoStatus(p)]++);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('psTotal', adminPromosList.length);
  set('psLive', counts.live);
  set('psScheduled', counts.scheduled);
  set('psExpired', counts.expired + counts.hidden);
  const count = document.getElementById('promosCount');
  if (count) count.textContent = `${adminPromosList.length} publicaciones`;
}

function renderPromosTable() {
  const tbody = document.getElementById('promosTableBody');
  if (!tbody) return;

  if (!adminPromosList.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">
      Aún no has publicado promociones. Crea la primera con "+ Nueva Publicación".</td></tr>`;
    return;
  }

  tbody.innerHTML = adminPromosList.map(p => {
    const st = PROMO_STATUS[promoStatus(p)];
    const kindLabel = { promo: '🔥 Oferta', combo: '🎁 Combo', anuncio: '📣 Anuncio' }[p.kind] || p.kind;
    const vig = [
      p.starts_at ? `Desde ${fmtDate(p.starts_at)}` : null,
      p.ends_at   ? `hasta ${fmtDate(p.ends_at)}`   : null,
    ].filter(Boolean).join(' ') || 'Sin límite';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:20px" class="pr-theme-${p.theme || 'green'}">${p.image_url ? '🖼️' : escapeHTML(p.emoji || '🎉')}</span>
          <div>
            <div class="td-name">${p.featured ? '⭐ ' : ''}${escapeHTML(p.title)}</div>
            <div class="td-sub">${escapeHTML(p.badge || '')}</div>
          </div>
        </div>
      </td>
      <td>${kindLabel}</td>
      <td>${p.price_usd ? `<b>${fmtPrice(p.price_usd)}</b>${p.old_price_usd ? ` <s style="color:#aaa">${fmtPrice(p.old_price_usd)}</s>` : ''}` : '—'}</td>
      <td style="font-size:12px">${vig}</td>
      <td><span class="badge ${st[1]}">${st[0]}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="editPromo('${p.id}')">✏️</button>
          <button class="btn-ghost sm" title="${p.active ? 'Ocultar' : 'Publicar'}" onclick="togglePromo('${p.id}')">${p.active ? '🙈' : '👁️'}</button>
          <button class="btn-ghost sm" title="Duplicar" onclick="duplicatePromo('${p.id}')">📄</button>
          <button class="btn-danger sm" onclick="deletePromo('${p.id}','${p.title.replace(/'/g, "\\'")}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ---------- Formulario ---------- */

const PROMO_FIELDS = ['title','kind','badge','description','emoji','image','price','oldprice','ctalabel','ctaurl','wamsg','theme','sort'];

function promoFormEl(name) { return document.getElementById(`f-promo-${name}`); }

function openNewPromo() {
  editingPromoId = null;
  document.getElementById('promoFormTitle').textContent = 'Nueva Publicación';
  document.getElementById('promoForm')?.reset();
  promoFormEl('starts').value = '';
  promoFormEl('ends').value = '';
  promoFormEl('active').checked = true;
  promoFormEl('featured').checked = false;
  showPromoForm();
}

function editPromo(id) {
  const p = adminPromosList.find(x => x.id === id);
  if (!p) return;
  editingPromoId = id;
  document.getElementById('promoFormTitle').textContent = 'Editar Publicación';
  promoFormEl('title').value    = p.title;
  promoFormEl('kind').value     = p.kind || 'promo';
  promoFormEl('badge').value    = p.badge || '';
  promoFormEl('description').value = p.description || '';
  promoFormEl('emoji').value    = p.emoji || '';
  promoFormEl('image').value    = p.image_url || '';
  promoFormEl('price').value    = p.price_usd ?? '';
  promoFormEl('oldprice').value = p.old_price_usd ?? '';
  promoFormEl('ctalabel').value = p.cta_label || '';
  promoFormEl('ctaurl').value   = p.cta_url || '';
  promoFormEl('wamsg').value    = p.wa_message || '';
  promoFormEl('theme').value    = p.theme || 'green';
  promoFormEl('sort').value     = p.sort_order || 0;
  promoFormEl('starts').value   = isoToLocalInput(p.starts_at);
  promoFormEl('ends').value     = isoToLocalInput(p.ends_at);
  promoFormEl('active').checked   = p.active;
  promoFormEl('featured').checked = p.featured;
  showPromoForm();
}

function showPromoForm() {
  const panel = document.getElementById('promoFormPanel');
  panel.style.display = 'block';
  refreshPromoPreview();
  panel.scrollIntoView({ behavior: 'smooth' });
}

function cancelPromoForm() {
  document.getElementById('promoFormPanel').style.display = 'none';
  editingPromoId = null;
}

// datetime-local (hora local) ↔ ISO UTC
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToIso(val) {
  return val ? new Date(val).toISOString() : null;
}

function promoPayloadFromForm() {
  return {
    title:         promoFormEl('title').value.trim(),
    kind:          promoFormEl('kind').value,
    badge:         promoFormEl('badge').value.trim() || null,
    description:   promoFormEl('description').value.trim() || null,
    emoji:         promoFormEl('emoji').value.trim() || null,
    image_url:     promoFormEl('image').value.trim() || null,
    price_usd:     parseFloat(promoFormEl('price').value) || null,
    old_price_usd: parseFloat(promoFormEl('oldprice').value) || null,
    cta_label:     promoFormEl('ctalabel').value.trim() || null,
    cta_url:       promoFormEl('ctaurl').value.trim() || null,
    wa_message:    promoFormEl('wamsg').value.trim() || null,
    theme:         promoFormEl('theme').value,
    featured:      promoFormEl('featured').checked,
    starts_at:     localInputToIso(promoFormEl('starts').value),
    ends_at:       localInputToIso(promoFormEl('ends').value),
    active:        promoFormEl('active').checked,
    sort_order:    parseInt(promoFormEl('sort').value) || 0,
    updated_at:    new Date().toISOString(),
  };
}

// Vista previa en vivo usando la misma tarjeta que ve el cliente
function refreshPromoPreview() {
  const box = document.getElementById('promoPreview');
  if (!box) return;
  const p = { id: 'preview', ...promoPayloadFromForm() };
  if (!p.title) p.title = 'Título de la promoción';
  box.innerHTML = renderPromoCard(p);
}

async function savePromo() {
  const payload = promoPayloadFromForm();
  if (!payload.title) { showToast('El título es requerido', 'warn'); return; }
  if (payload.old_price_usd && payload.price_usd && payload.old_price_usd <= payload.price_usd) {
    showToast('El precio anterior debe ser mayor al precio de oferta', 'warn'); return;
  }
  if (payload.starts_at && payload.ends_at && payload.ends_at <= payload.starts_at) {
    showToast('La fecha de fin debe ser posterior al inicio', 'warn'); return;
  }

  let error;
  if (editingPromoId) {
    ({ error } = await sb.from('jjp_promos').update(payload).eq('id', editingPromoId));
  } else {
    ({ error } = await sb.from('jjp_promos').insert(payload));
  }
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(editingPromoId ? '✅ Publicación actualizada' : '✅ Publicación creada');
  cancelPromoForm();
  await loadPromosAdmin();
}

async function togglePromo(id) {
  const p = adminPromosList.find(x => x.id === id);
  if (!p) return;
  const { error } = await sb.from('jjp_promos')
    .update({ active: !p.active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(p.active ? 'Publicación oculta' : '✅ Publicación visible');
  await loadPromosAdmin();
}

async function duplicatePromo(id) {
  const p = adminPromosList.find(x => x.id === id);
  if (!p) return;
  const { id: _omit, created_at, updated_at, ...copy } = p;
  copy.title = `${copy.title} (copia)`;
  copy.active = false;
  const { error } = await sb.from('jjp_promos').insert(copy);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('📄 Copia creada (oculta). Edítala y publícala.');
  await loadPromosAdmin();
}

async function deletePromo(id, title) {
  if (!confirm(`¿Eliminar la publicación "${title}"?\nEsta acción no se puede deshacer.`)) return;
  const { error } = await sb.from('jjp_promos').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Publicación eliminada');
  await loadPromosAdmin();
}
