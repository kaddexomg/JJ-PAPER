/* ======================================================
   JJ Paper Vendedor — Difusión WhatsApp
   Contactos (import masivo) · Plantillas con variables ·
   Campañas automatizadas (las despacha wa-server con throttle)
   ====================================================== */

let dContacts   = [];
let dTemplates  = [];
let dCampaigns  = [];
let dTab        = 'campanas';
let editingTplId = null;
let dImportRows  = [];   // preview del import pendiente de confirmar

const D_VARS = ['nombre', 'vendedor', 'descuento', 'link'];

const D_CAMP_STATUS = {
  en_cola:    ['⏳ En cola', '#b45309'],
  enviando:   ['📤 Enviando', '#16604A'],
  pausada:    ['⏸️ Pausada', '#6b7280'],
  completada: ['✅ Completada', '#15803d'],
  cancelada:  ['✕ Cancelada', '#b91c1c'],
};

/* ---------- init ---------- */
async function initDifusion() {
  await Promise.all([loadDContacts(), loadDTemplates(), loadDCampaigns()]);
  setDTab('campanas');

  // Progreso en vivo: wa-server actualiza contadores → refresco de la lista
  sb.channel('difusion-progress')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_wa_campaigns' },
      () => loadDCampaigns())
    .subscribe();
}

function setDTab(t) {
  dTab = t;
  document.querySelectorAll('.of-chip[data-tab]').forEach(c => {
    const on = c.dataset.tab === t;
    c.classList.toggle('on', on);
    c.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('[data-panel]').forEach(p => {
    p.style.display = p.dataset.panel === t ? '' : 'none';
  });
}

/* ================== CONTACTOS ================== */
async function loadDContacts() {
  const { data, error } = await sb.from('jjp_customers')
    .select('*').eq('seller_id', SELLER.id).order('name');
  if (error) { showToast('Error cargando contactos', 'err'); return; }
  dContacts = data || [];
  renderDContacts();
}

function renderDContacts() {
  const tbody = document.getElementById('dContactsBody');
  const q = normTxt(document.getElementById('dContactSearch')?.value.trim() || '');
  let list = dContacts;
  if (q) list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')) ||
                                 (c.tags || []).some(t => normTxt(t).includes(q)));

  document.getElementById('dContactCount').textContent = `${dContacts.length} contacto(s) en tu cartera`;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin contactos. Usa "Importar lista" para cargar tu avance de datos. 📇</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c => `<tr>
    <td>
      <div class="td-name">${escapeHTML(c.name)}</div>
      <div class="td-sub">${escapeHTML(c.phone || '')}</div>
    </td>
    <td>${(c.tags || []).map(t => `<span class="d-tag">${escapeHTML(t)}</span>`).join(' ') || '—'}</td>
    <td>${c.total_orders > 0 ? `${c.total_orders} compra(s)` : '<span class="d-tag" style="background:#fef3c7;color:#92400e">prospecto</span>'}</td>
    <td>${c.last_order_at ? fmtDate(c.last_order_at) : '—'}</td>
    <td><div class="td-actions">
      <button class="btn-o sm" onclick="toggleOptOut('${c.id}')" aria-pressed="${c.wa_opt_out}"
        title="${c.wa_opt_out ? 'Excluido de difusiones — clic para incluir' : 'Incluido en difusiones — clic para excluir'}">
        ${c.wa_opt_out ? '🔕 Excluido' : '🔔 Incluido'}</button>
      <button class="btn-o sm" onclick="editTags('${c.id}')" title="Editar etiquetas">🏷️</button>
    </div></td>
  </tr>`).join('');
}

async function toggleOptOut(id) {
  const c = dContacts.find(x => x.id === id);
  if (!c) return;
  const { error } = await sb.from('jjp_customers')
    .update({ wa_opt_out: !c.wa_opt_out, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo actualizar', 'err'); return; }
  c.wa_opt_out = !c.wa_opt_out;
  showToast(c.wa_opt_out ? 'Excluido de difusiones 🔕' : 'Incluido en difusiones 🔔');
  renderDContacts();
}

async function editTags(id) {
  const c = dContacts.find(x => x.id === id);
  if (!c) return;
  const raw = prompt(`Etiquetas de ${c.name} (separadas por coma):`, (c.tags || []).join(', '));
  if (raw === null) return;
  const tags = raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const { error } = await sb.from('jjp_customers')
    .update({ tags, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo guardar', 'err'); return; }
  c.tags = tags;
  renderDContacts();
}

/* ---- Import masivo ---- */
function openImportModal() {
  dImportRows = [];
  document.getElementById('di-text').value = '';
  document.getElementById('di-tag').value = '';
  document.getElementById('diPreview').innerHTML = '';
  document.getElementById('diConfirmBtn').disabled = true;
  openDModal('importModal');
}

function diFileChosen(input) {
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('di-text').value = reader.result; diParse(); };
  reader.readAsText(f, 'utf-8');
  input.value = '';
}

// Acepta líneas "Nombre, teléfono[, ciudad]" con separador coma / punto y coma / tab
function diParse() {
  const tagBase = document.getElementById('di-tag').value.trim().toLowerCase();
  const lines = document.getElementById('di-text').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = []; let bad = 0;

  for (const line of lines) {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length < 2) { bad++; continue; }
    // El teléfono es la parte con más dígitos (tolera "teléfono, nombre" invertido)
    let phoneIdx = 0, best = 0;
    parts.forEach((p, i) => { const d = p.replace(/\D/g, '').length; if (d > best) { best = d; phoneIdx = i; } });
    if (best < 10) { bad++; continue; }
    const phone = parts[phoneIdx];
    const rest  = parts.filter((_, i) => i !== phoneIdx);
    const name  = rest[0] || '';
    if (!name) { bad++; continue; }
    rows.push({ name, phone, city: rest[1] || null, tags: tagBase ? [tagBase] : [] });
  }

  dImportRows = rows.slice(0, 500);
  const prev = document.getElementById('diPreview');
  prev.innerHTML = rows.length
    ? `<p><strong>${rows.length}</strong> contacto(s) listos${bad ? ` · <span style="color:#b45309">${bad} línea(s) ignoradas</span>` : ''}${rows.length > 500 ? ' · <span style="color:#b91c1c">solo se importarán los primeros 500</span>' : ''}</p>
       <ul style="margin:6px 0 0;padding-left:18px;max-height:120px;overflow:auto">${rows.slice(0, 8).map(r =>
         `<li>${escapeHTML(r.name)} — ${escapeHTML(r.phone)}</li>`).join('')}${rows.length > 8 ? '<li>…</li>' : ''}</ul>`
    : `<p style="color:#b45309">Nada que importar todavía. Formato: <code>Nombre, teléfono</code> (una línea por contacto).</p>`;
  document.getElementById('diConfirmBtn').disabled = !dImportRows.length;
}

async function diConfirm() {
  const btn = document.getElementById('diConfirmBtn');
  btn.disabled = true; btn.textContent = 'Importando…';
  const { data, error } = await sb.rpc('jjp_wa_import_contacts', { p_rows: dImportRows });
  btn.disabled = false; btn.textContent = '📥 Importar';
  if (error) { showToast('Error importando: ' + error.message, 'err'); return; }
  showToast(`Importados: ${data.inserted} nuevos · ${data.updated} actualizados` +
            (data.skipped ? ` · ${data.skipped} inválidos` : ''));
  closeDModal('importModal');
  loadDContacts();
}

/* ================== PLANTILLAS ================== */
async function loadDTemplates() {
  const { data, error } = await sb.from('jjp_wa_templates')
    .select('*').eq('active', true).order('created_at');
  if (error) { showToast('Error cargando plantillas', 'err'); return; }
  dTemplates = data || [];
  renderDTemplates();
}

function renderDTemplates() {
  const wrap = document.getElementById('dTplList');
  if (!dTemplates.length) {
    wrap.innerHTML = '<p class="table-empty">Sin plantillas. Crea la primera. 📝</p>';
    return;
  }
  wrap.innerHTML = dTemplates.map(t => {
    const mine = t.owner_id === SELLER.id;
    return `<article class="d-tpl-card">
      <div class="d-tpl-hd">
        <strong>${escapeHTML(t.name)}</strong>
        <span class="d-tag">${t.owner_id ? '👤 mía' : '🌐 global'}${t.kind === 'reactivacion' ? ' · 🔄 reactivación' : ''}</span>
      </div>
      <pre class="d-tpl-body">${escapeHTML(t.body)}</pre>
      <div class="td-actions">
        <button class="btn-o sm" onclick="newCampaign('${t.id}')">📣 Usar en campaña</button>
        ${mine ? `<button class="btn-o sm" onclick="openTplModal('${t.id}')">✏️ Editar</button>
                  <button class="btn-o sm" onclick="deleteTpl('${t.id}')" title="Eliminar plantilla">🗑️</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function openTplModal(id = null) {
  editingTplId = id;
  const t = id ? dTemplates.find(x => x.id === id) : null;
  document.getElementById('tplModalTitle').textContent = t ? `Editar: ${t.name}` : 'Nueva plantilla';
  document.getElementById('tp-name').value = t?.name || '';
  document.getElementById('tp-body').value = t?.body || '';
  tplPreview();
  openDModal('tplModal');
}

function tplInsertVar(v) {
  const ta = document.getElementById('tp-body');
  const pos = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, pos) + `{{${v}}}` + ta.value.slice(ta.selectionEnd ?? pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + v.length + 4;
  tplPreview();
}

function dSampleVars(name = 'María González') {
  return {
    nombre:    name,
    vendedor:  SELLER.name || 'su vendedor JJ Paper',
    descuento: APP.SETTINGS.wa_react_discount || '10',
    link:      sellerRefLink() || `${location.origin}/catalogo.html`,
  };
}

function dRender(body, vars) {
  return String(body || '').replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
}

function tplPreview() {
  document.getElementById('tplPreview').textContent =
    dRender(document.getElementById('tp-body').value, dSampleVars());
}

async function saveTpl() {
  const name = document.getElementById('tp-name').value.trim();
  const body = document.getElementById('tp-body').value.trim();
  if (!name || !body) { showToast('Nombre y mensaje son obligatorios', 'warn'); return; }
  let error;
  if (editingTplId) {
    ({ error } = await sb.from('jjp_wa_templates').update({ name, body }).eq('id', editingTplId));
  } else {
    ({ error } = await sb.from('jjp_wa_templates').insert({ owner_id: SELLER.id, name, body }));
  }
  if (error) { showToast('Error guardando plantilla', 'err'); return; }
  showToast('Plantilla guardada ✔');
  closeDModal('tplModal');
  loadDTemplates();
}

async function deleteTpl(id) {
  if (!confirm('¿Eliminar esta plantilla? Las campañas ya lanzadas no se afectan.')) return;
  const { error } = await sb.from('jjp_wa_templates').delete().eq('id', id);
  if (error) { showToast('No se pudo eliminar', 'err'); return; }
  showToast('Plantilla eliminada');
  loadDTemplates();
}

/* ================== CAMPAÑAS ================== */
async function loadDCampaigns() {
  const { data, error } = await sb.from('jjp_wa_campaigns')
    .select('*').order('created_at', { ascending: false }).limit(50);
  if (error) { showToast('Error cargando campañas', 'err'); return; }
  dCampaigns = data || [];
  renderDCampaigns();
}

function renderDCampaigns() {
  const tbody = document.getElementById('dCampBody');
  if (!dCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin campañas todavía. Lanza la primera con "＋ Nueva campaña". 📣</td></tr>';
    return;
  }
  tbody.innerHTML = dCampaigns.map(c => {
    const [label, color] = D_CAMP_STATUS[c.status] || [c.status, '#666'];
    const done = c.sent_count + c.failed_count;
    const pct = c.total ? Math.round(done / c.total * 100) : 0;
    const active = c.status === 'en_cola' || c.status === 'enviando';
    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(c.name)} ${c.kind === 'reactivacion' ? '🔄' : ''}</div>
        <div class="td-sub">${fmtDate(c.created_at)}</div>
      </td>
      <td><span style="color:${color};font-weight:600">${label}</span></td>
      <td style="min-width:140px">
        <div class="d-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
             aria-label="Progreso de ${escapeHTML(c.name)}">
          <div class="d-prog-fill" style="width:${pct}%"></div>
        </div>
        <div class="td-sub">${c.sent_count}/${c.total} enviados${c.failed_count ? ` · ${c.failed_count} fallidos/omitidos` : ''}</div>
      </td>
      <td style="text-align:center">${c.total}</td>
      <td><div class="td-actions">
        ${active ? `<button class="btn-o sm" onclick="setCampStatus('${c.id}','pausada')">⏸️ Pausar</button>` : ''}
        ${c.status === 'pausada' ? `<button class="btn-p sm" onclick="setCampStatus('${c.id}','en_cola')">▶️ Reanudar</button>` : ''}
        ${(active || c.status === 'pausada') ? `<button class="btn-o sm" onclick="cancelCampaign('${c.id}')" title="Cancelar campaña">✕</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

async function setCampStatus(id, status) {
  const { error } = await sb.from('jjp_wa_campaigns').update({ status }).eq('id', id);
  if (error) { showToast('No se pudo actualizar', 'err'); return; }
  showToast(status === 'pausada' ? 'Campaña pausada ⏸️' : 'Campaña reanudada ▶️');
  loadDCampaigns();
}

async function cancelCampaign(id) {
  if (!confirm('¿Cancelar la campaña? Los mensajes pendientes NO se enviarán.')) return;
  await setCampStatus(id, 'cancelada');
}

/* ---- Nueva campaña ---- */
function newCampaign(preTplId = null) {
  setDTab('campanas');
  const sel = document.getElementById('nc-tpl');
  sel.innerHTML = dTemplates.map(t =>
    `<option value="${t.id}">${escapeHTML(t.name)} ${t.owner_id ? '(mía)' : '(global)'}</option>`).join('');
  if (preTplId) sel.value = preTplId;
  document.getElementById('nc-name').value = 'Difusión ' + new Date().toLocaleDateString('es-VE');
  document.getElementById('nc-tag').value = '';
  document.getElementById('nc-aud').value = 'todos';
  ncRefresh();
  openDModal('campModal');
}

function ncAudience() {
  const aud = document.getElementById('nc-aud').value;
  const tag = document.getElementById('nc-tag').value.trim().toLowerCase();
  const inactDays = parseInt(APP.SETTINGS.wa_react_days, 10) || 60;
  let list = dContacts.filter(c => c.phone && !c.wa_opt_out);
  if (aud === 'inactivos')  list = list.filter(c => c.total_orders > 0 && c.last_order_at &&
      (Date.now() - new Date(c.last_order_at).getTime()) > inactDays * 86400e3);
  if (aud === 'prospectos') list = list.filter(c => !c.total_orders);
  if (aud === 'etiqueta')   list = list.filter(c => (c.tags || []).map(t => t.toLowerCase()).includes(tag));
  return list;
}

function ncRefresh() {
  document.getElementById('nc-tag-wrap').style.display =
    document.getElementById('nc-aud').value === 'etiqueta' ? '' : 'none';
  const list = ncAudience();
  const tpl  = dTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  document.getElementById('ncCount').textContent =
    list.length ? `Se enviará a ${list.length} contacto(s), uno por uno con pausa aleatoria.` : 'Ningún contacto coincide con esa audiencia.';
  document.getElementById('ncPreview').textContent =
    tpl ? dRender(tpl.body, dSampleVars(list[0]?.name || 'María González')) : '';
  document.getElementById('ncLaunchBtn').disabled = !list.length || !tpl;
}

async function launchCampaign() {
  const name = document.getElementById('nc-name').value.trim() || 'Difusión';
  const tpl  = dTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const list = ncAudience();
  if (!tpl || !list.length) return;
  if (!confirm(`Vas a enviar "${tpl.name}" a ${list.length} contacto(s) por WhatsApp. ¿Lanzar campaña?`)) return;

  const btn = document.getElementById('ncLaunchBtn');
  btn.disabled = true; btn.textContent = 'Lanzando…';

  const { data: camp, error } = await sb.from('jjp_wa_campaigns')
    .insert({ owner_id: SELLER.id, name, template_id: tpl.id, body: tpl.body, total: list.length })
    .select('id').single();
  if (error) { showToast('Error creando campaña', 'err'); btn.disabled = false; btn.textContent = '🚀 Lanzar campaña'; return; }

  const targets = list.map(c => ({
    campaign_id: camp.id, owner_id: SELLER.id, customer_id: c.id,
    phone: c.phone, name: c.name, vars: dSampleVars(c.name),
  }));
  for (let i = 0; i < targets.length; i += 100) {
    const { error: e2 } = await sb.from('jjp_wa_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) { showToast('Error cargando destinatarios: ' + e2.message, 'err'); break; }
  }

  btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
  showToast('Campaña lanzada 🚀 — los mensajes salen espaciados para proteger tu número');
  closeDModal('campModal');
  loadDCampaigns();
}

/* ---------- modales (foco + ESC, convención a11y del proyecto) ---------- */
let dLastFocus = null;
function openDModal(id) {
  dLastFocus = document.activeElement;
  const m = document.getElementById(id);
  m.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(m.querySelector('.modal-box'));
  m.querySelector('input,textarea,select,button')?.focus();
}
function closeDModal(id) {
  document.getElementById(id).classList.remove('op');
  dLastFocus?.focus?.();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay.op').forEach(m => closeDModal(m.id));
});
