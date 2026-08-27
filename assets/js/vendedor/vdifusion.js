/* ======================================================
   JJ Paper Vendedor — Difusión WhatsApp
   Contactos (import masivo) · Plantillas con variables ·
   Campañas automatizadas (las despacha wa-server con throttle)
   ====================================================== */

let dContacts   = [];
let dTemplates  = [];
let dCampaigns  = [];
let dProducts   = [];
let dCombos     = [];
let dTab        = 'campanas';
let editingTplId = null;
let dImportRows  = [];   // preview del import pendiente de confirmar

const D_VARS = ['nombre', 'empresa', 'vendedor', 'producto', 'precio', 'descuento', 'link', 'descripcion'];

const D_CAMP_STATUS = {
  en_cola:    ['⏳ En cola', '#b45309'],
  pending:    ['⏳ En cola', '#b45309'],
  enviando:   ['📤 Enviando', '#16604A'],
  sending:    ['📤 Enviando', '#16604A'],
  pausada:    ['⏸️ Pausada', '#6b7280'],
  completada: ['✅ Completada', '#15803d'],
  sent:       ['✅ Completada', '#15803d'],
  cancelada:  ['✕ Cancelada', '#b91c1c'],
};

/* ---------- init ---------- */
async function initDifusion() {
  await Promise.all([loadDContacts(), loadDTemplates(), loadDCampaigns(), loadDProductsAndCombos()]);
  setDTab('campanas');

  // Progreso en vivo: wa-server actualiza contadores → refresco de la lista
  sb.channel('difusion-progress')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_wa_campaigns' },
      () => loadDCampaigns())
    .subscribe();
}

async function loadDProductsAndCombos() {
  try {
    // Cargar productos para el selector de promociones
    const { data: prods } = await sb.from('jjp_product_variants')
      .select('id,sku,price_usd,variant_name,jjp_products(id,name,description),jjp_brands(name)')
      .eq('active', true)
      .order('price_usd', { ascending: false })
      .limit(300);
    dProducts = prods || [];

    // Cargar promociones / combos activos
    const { data: promos } = await sb.from('jjp_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .limit(100);
    dCombos = promos || [];

    renderProductAndComboSelects();
  } catch (e) {
    console.warn('Error cargando catálogo para difusión:', e);
  }
}

function renderProductAndComboSelects() {
  const pSel = document.getElementById('nc-prod-select');
  if (pSel) {
    pSel.innerHTML = '<option value="">-- Selecciona un producto del catálogo --</option>' +
      dProducts.map(p => {
        const title = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
        return `<option value="${p.id}">${escapeHTML(title)} — $${(+p.price_usd).toFixed(2)}</option>`;
      }).join('');
  }

  const cSel = document.getElementById('nc-combo-select');
  if (cSel) {
    cSel.innerHTML = '<option value="">-- Selecciona un combo u oferta activa --</option>' +
      dCombos.map(c => {
        const price = c.price_usd ? ` — $${(+c.price_usd).toFixed(2)}` : '';
        return `<option value="${c.id}">[${c.kind.toUpperCase()}] ${escapeHTML(c.title)}${price}</option>`;
      }).join('');
  }
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
  const isAdm = SELLER?.role === 'admin';
  let q = sb.from('jjp_customers').select('*').order('name');
  if (!isAdm && SELLER?.id) {
    q = q.eq('seller_id', SELLER.id);
  }
  const { data, error } = await q;
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

function diParse() {
  const tagBase = document.getElementById('di-tag').value.trim().toLowerCase();
  const lines = document.getElementById('di-text').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = []; let bad = 0;

  for (const line of lines) {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length < 2) { bad++; continue; }
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

const DEFAULT_GLOBAL_TEMPLATES = [
  {
    id: 'tpl-promo-prod',
    name: '📦 Promoción de Producto Destacado',
    kind: 'producto',
    owner_id: null,
    body: 'Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nLe escribimos para presentarle una excelente oferta en:\n📦 *{{producto}}*\n💲 Precio especial: *{{precio}}*\n\n👉 Consulte disponibilidad o haga su pedido directo aquí: {{link}}\n\n¿Desea que le reservemos inventario de este rubro?'
  },
  {
    id: 'tpl-promo-combo',
    name: '🎁 Oferta Combo / Pack Especial',
    kind: 'combo',
    owner_id: null,
    body: '¡Saludos cordiales {{nombre}}! 🌟\n\nDesde JJ Paper queremos compartirle nuestro combo del mes:\n🎁 *{{producto}}*\n📝 Incluye: {{descripcion}}\n💲 Precio de oportunidad: *{{precio}}*\n\n👉 Vea todos los detalles y haga su pedido en: {{link}}\n\n¡Quedamos a su orden para coordinar despacho inmediato!'
  },
  {
    id: 'tpl-reactivacion',
    name: '🔄 Reactivación de Clientes con Descuento',
    kind: 'reactivacion',
    owner_id: null,
    body: 'Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nEsperamos que todo marche excelente en su negocio. Le informamos que tiene activo un *{{descuento}}% de descuento* en su próximo pedido.\n\n👉 Vea el catálogo actualizado con precios al día aquí: {{link}}\n\n¿En qué podemos apoyarle esta semana?'
  },
  {
    id: 'tpl-catalogo-general',
    name: '🏢 Catálogo Digital y Lista de Precios B2B',
    kind: 'general',
    owner_id: null,
    body: 'Estimados amigos de *{{empresa}}*,\n\nLe saluda {{vendedor}} de JJ Paper. Le compartimos nuestro catálogo digital actualizado con precios y existencias disponibles.\n\n👉 Enlace directo: {{link}}\n\nCualquier cotización que requiera, estamos a su completa disposición.'
  }
];

/* ================== PLANTILLAS ================== */
async function loadDTemplates() {
  const { data, error } = await sb.from('jjp_wa_templates')
    .select('*').eq('active', true).order('created_at');
  
  const list = data || [];
  // Asegurar que siempre estén disponibles las plantillas base del sistema
  const existingNames = new Set(list.map(x => x.name.toLowerCase()));
  const missingGlobals = DEFAULT_GLOBAL_TEMPLATES.filter(g => !existingNames.has(g.name.toLowerCase()));
  dTemplates = [...list, ...missingGlobals];
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

function tplApplyPreset(type) {
  const nameEl = document.getElementById('tp-name');
  const bodyEl = document.getElementById('tp-body');
  if (type === 'promo_producto') {
    if (!nameEl.value) nameEl.value = 'Promoción de Producto';
    bodyEl.value = `Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nLe escribimos para presentarle una excelente oferta en:\n📦 *{{producto}}*\n💲 Precio especial: *{{precio}}*\n\n👉 Consulte disponibilidad o haga su pedido directo aquí: {{link}}\n\n¿Desea que le reservemos inventario de este rubro?`;
  } else if (type === 'promo_combo') {
    if (!nameEl.value) nameEl.value = 'Oferta Combo Especial';
    bodyEl.value = `¡Saludos cordiales {{nombre}}! 🌟\n\nDesde JJ Paper queremos compartirle nuestro combo del mes:\n🎁 *{{producto}}*\n📝 Incluye: {{descripcion}}\n💲 Precio de oportunidad: *{{precio}}*\n\n👉 Vea todos los detalles y haga su pedido en: {{link}}\n\n¡Quedamos a su orden para coordinar despacho inmediato!`;
  } else if (type === 'reactivacion') {
    if (!nameEl.value) nameEl.value = 'Reactivación con Descuento';
    bodyEl.value = `Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nEsperamos que todo marche excelente en su negocio. Le informamos que tiene activo un *{{descuento}}% de descuento* en su próximo pedido.\n\n👉 Vea el catálogo actualizado con precios al día aquí: {{link}}\n\n¿En qué podemos apoyarle esta semana?`;
  }
  tplPreview();
}

function dSampleVars(name = 'Distribuidora Alfa, C.A.', extraContext = {}) {
  const bcv = parseFloat(APP.SETTINGS?.rate_bcv) || 0;
  
  let prodName = 'Resma Carta HP 75g (Caja × 10)';
  let prodPrice = '$38.50 USD' + (bcv ? ` (Bs ${ (38.50 * bcv).toFixed(2) })` : '');
  let prodDesc = 'Papel bond de alta blancura ideal para oficina y colegios.';
  let prodLink = sellerRefLink() || `${location.origin}/catalogo.html`;
  let discount = APP.SETTINGS?.wa_react_discount || '10';

  if (extraContext.type === 'producto' && extraContext.productId) {
    const p = dProducts.find(x => x.id === extraContext.productId);
    if (p) {
      prodName = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
      const priceUsd = Number(p.price_usd) || 0;
      prodPrice = `$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '');
      prodDesc = p.jjp_products?.description || '';
      prodLink = `${location.origin}/catalogo.html?q=${encodeURIComponent(p.jjp_products?.name || '')}`;
    }
  } else if (extraContext.type === 'combo' && extraContext.comboId) {
    const c = dCombos.find(x => x.id === extraContext.comboId);
    if (c) {
      prodName = c.title || 'Combo Especial';
      const priceUsd = Number(c.price_usd) || 0;
      prodPrice = priceUsd ? (`$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '')) : 'Consultar';
      prodDesc = c.description || '';
      prodLink = `${location.origin}/promociones.html`;
      if (c.badge) discount = c.badge;
    }
  }

  return {
    nombre:      name,
    empresa:     name,
    vendedor:    SELLER.name || 'su asesor comercial JJ Paper',
    descuento:   discount,
    producto:    prodName,
    precio:      prodPrice,
    descripcion: prodDesc,
    link:        prodLink,
  };
}

function ncOnSpeedChange() {
  const mode = document.getElementById('nc-speed-mode')?.value || 'safe';
  const customWrap = document.getElementById('nc-custom-speed-wrap');
  const minIn = document.getElementById('nc-delay-min');
  const maxIn = document.getElementById('nc-delay-max');
  
  if (customWrap) customWrap.style.display = mode === 'custom' ? 'grid' : 'none';
  if (minIn && maxIn) {
    if (mode === 'safe') { minIn.value = 15; maxIn.value = 35; }
    else if (mode === 'ultra_safe') { minIn.value = 30; maxIn.value = 60; }
    else if (mode === 'moderate') { minIn.value = 8; maxIn.value = 18; }
  }
}

function dRender(body, vars) {
  let str = String(body || '').replace(/\{([^{}]+?)\}/g, (_, choices) => {
    if (choices.startsWith('{') || choices.endsWith('}')) return choices;
    const parts = choices.split('|');
    if (parts.length > 1) {
      return parts[0].trim(); // preview toma la primera opción
    }
    return choices;
  });
  return str.replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
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
  if (error) { showToast('Error guardando plantilla: ' + error.message, 'err'); return; }
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
  const isAdm = SELLER?.role === 'admin';
  let q = sb.from('jjp_wa_campaigns').select('*').order('created_at', { ascending: false }).limit(50);
  if (!isAdm && SELLER?.id) {
    q = q.eq('owner_id', SELLER.id);
  }
  const { data, error } = await q;
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
    const done = (c.sent_count || 0) + (c.failed_count || 0);
    const pct = c.total ? Math.round(done / c.total * 100) : 0;
    const active = c.status === 'en_cola' || c.status === 'pending' || c.status === 'enviando' || c.status === 'sending';
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
        <div class="td-sub">${c.sent_count || 0}/${c.total || 0} enviados${c.failed_count ? ` · ${c.failed_count} fallidos/omitidos` : ''}</div>
      </td>
      <td style="text-align:center">${c.total || 0}</td>
      <td><div class="td-actions">
        ${active ? `<button class="btn-o sm" onclick="setCampStatus('${c.id}','pausada')">⏸️ Pausar</button>` : ''}
        ${c.status === 'pausada' ? `<button class="btn-p sm" onclick="setCampStatus('${c.id}','pending')">▶️ Reanudar</button>` : ''}
        ${(active || c.status === 'pausada') ? `<button class="btn-o sm" onclick="cancelCampaign('${c.id}')" title="Cancelar campaña">✕</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

async function setCampStatus(id, status) {
  const { error } = await sb.from('jjp_wa_campaigns').update({ status }).eq('id', id);
  if (error) { showToast('No se pudo actualizar: ' + error.message, 'err'); return; }
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
  document.getElementById('nc-type').value = 'general';
  document.getElementById('nc-tag').value = '';
  document.getElementById('nc-aud').value = 'todos';
  renderProductAndComboSelects();
  ncOnTypeChange();
  openDModal('campModal');
}

function ncOnTypeChange() {
  const type = document.getElementById('nc-type').value;
  const prodWrap = document.getElementById('nc-prod-wrap');
  const comboWrap = document.getElementById('nc-combo-wrap');
  if (prodWrap) prodWrap.style.display = type === 'producto' ? '' : 'none';
  if (comboWrap) comboWrap.style.display = type === 'combo' ? '' : 'none';
  ncRefresh();
}

function ncGetExtraContext() {
  const type = document.getElementById('nc-type')?.value || 'general';
  const productId = document.getElementById('nc-prod-select')?.value || null;
  const comboId = document.getElementById('nc-combo-select')?.value || null;
  return { type, productId, comboId };
}

function ncAudience() {
  const aud = document.getElementById('nc-aud').value;
  const tag = document.getElementById('nc-tag').value.trim().toLowerCase();
  const inactDays = parseInt(APP.SETTINGS?.wa_react_days, 10) || 60;
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
  const extra = ncGetExtraContext();

  document.getElementById('ncCount').textContent =
    list.length ? `Se enviará a ${list.length} contacto(s), uno por uno con pausa aleatoria.` : 'Ningún contacto coincide con esa audiencia.';
  document.getElementById('ncPreview').textContent =
    tpl ? dRender(tpl.body, dSampleVars(list[0]?.name || 'María González', extra)) : '';
  document.getElementById('ncLaunchBtn').disabled = !list.length || !tpl;
}

function ncOnAttachChange() {
  const opt = document.getElementById('nc-attach-opt')?.value || 'none';
  const customWrap = document.getElementById('nc-custom-file-wrap');
  const statusEl = document.getElementById('nc-attach-status');
  if (customWrap) customWrap.style.display = opt === 'custom_file' ? '' : 'none';
  
  if (statusEl) {
    if (opt === 'pdf_lista_precios') {
      statusEl.textContent = '📄 Se generará el PDF oficial de Lista de Precios con los colores de JJ Paper y precios vigentes en USD y Bs BCV.';
    } else if (opt === 'prod_image') {
      const extra = ncGetExtraContext();
      const prod = dProducts.find(p => p.id === extra.productId);
      const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
      if (imgUrl) {
        statusEl.textContent = `🖼️ Se adjuntará la imagen de: ${prod.jjp_products?.name || prod.variant_name || 'producto'}`;
      } else {
        statusEl.textContent = '⚠️ El producto seleccionado no tiene imagen registrada; se enviará solo texto o selecciona otra opción.';
      }
    } else if (opt === 'custom_file') {
      statusEl.textContent = '📁 Selecciona un archivo PDF o imagen desde tu equipo.';
    } else {
      statusEl.textContent = '';
    }
  }
}

async function launchCampaign() {
  const btn = document.getElementById('ncLaunchBtn');
  const name = document.getElementById('nc-name').value.trim();
  const list = ncAudience();
  const tpl  = dTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const extra = ncGetExtraContext();
  const attachOpt = document.getElementById('nc-attach-opt')?.value || 'none';

  const delayMin = parseInt(document.getElementById('nc-delay-min')?.value, 10) || 15;
  const delayMax = parseInt(document.getElementById('nc-delay-max')?.value, 10) || 35;

  if (!name) { showToast('El nombre de la campaña es obligatorio', 'warn'); return; }
  if (!tpl)  { showToast('Selecciona una plantilla', 'warn'); return; }
  if (!list.length) { showToast('No hay destinatarios en esta audiencia', 'warn'); return; }

  btn.disabled = true;
  let mediaPath = null, mediaType = null, mediaMime = null, mediaFilename = null, mediaSize = null;

  if (attachOpt === 'pdf_lista_precios') {
    btn.textContent = 'Generando catálogo PDF…';
    try {
      if (typeof docPdfProductos !== 'function') throw new Error('Motor de documentos no disponible.');
      const { blob, filename } = await docPdfProductos({ conStock: true, titulo: 'Lista de Precios Mayorista' });
      mediaFilename = filename || 'Lista_de_Precios_JJ_Paper.pdf';
      mediaMime = 'application/pdf';
      mediaType = 'document';
      mediaSize = blob.size;
      mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${mediaFilename}`;
      const { error: upErr } = await sb.storage.from('jjp-wa-media')
        .upload(mediaPath, blob, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error('No se pudo guardar el PDF: ' + upErr.message);
    } catch (err) {
      showToast('Error generando PDF: ' + err.message, 'err');
      btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
      return;
    }
  } else if (attachOpt === 'prod_image' && extra.productId) {
    const prod = dProducts.find(x => x.id === extra.productId);
    const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
    if (imgUrl) {
      mediaPath = imgUrl;
      mediaType = 'image';
      mediaMime = 'image/jpeg';
      mediaFilename = (prod.jjp_products?.name || prod.variant_name || 'producto').replace(/[^\w.-]/g, '_') + '.jpg';
    }
  } else if (attachOpt === 'custom_file') {
    const file = document.getElementById('nc-custom-file')?.files?.[0];
    if (file) {
      btn.textContent = 'Subiendo archivo…';
      try {
        mediaFilename = file.name;
        mediaMime = file.type || 'application/octet-stream';
        mediaType = file.type.startsWith('image/') ? 'image' : 'document';
        mediaSize = file.size;
        mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const { error: upErr } = await sb.storage.from('jjp-wa-media')
          .upload(mediaPath, file, { contentType: mediaMime, upsert: true });
        if (upErr) throw new Error('No se pudo subir el archivo: ' + upErr.message);
      } catch (err) {
        showToast('Error subiendo archivo: ' + err.message, 'err');
        btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
        return;
      }
    }
  }

  const sessionUser = (await sb.auth.getUser())?.data?.user;
  const ownerId = sessionUser?.id || SELLER?.id;
  const isRealUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tpl.id);
  
  let payload = {
    owner_id: ownerId,
    created_by: ownerId,
    name,
    template_id: isRealUuid ? tpl.id : null,
    body: tpl.body,
    message: tpl.body,
    status: 'en_cola',
    total: list.length,
    delay_min_s: delayMin,
    delay_max_s: Math.max(delayMin + 1, delayMax)
  };

  if (mediaPath) {
    payload.media_path = mediaPath;
    payload.media_type = mediaType;
    payload.media_mime = mediaMime;
    payload.media_filename = mediaFilename;
    payload.media_size = mediaSize;
  }

  let { data: camp, error } = await sb.from('jjp_wa_campaigns').insert(payload).select('id').single();

  // Nota: con el schema reparado ya no hace falta reintento inteligente.
  // Si falla es un error real, no de schema.
  if (error) {
    console.error('Error creando campaña:', error);
  }

  if (error) {
    console.error('Error final creando campaña:', error);
    showToast('Error creando campaña: ' + (error.message || error.details || JSON.stringify(error)), 'err');
    btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
    return;
  }

  const targets = list.map(c => ({
    campaign_id: camp.id,
    owner_id: ownerId,
    customer_id: c.id || null,
    phone: c.phone,
    name: c.name,
    status: 'en_cola',
    vars: dSampleVars(c.name, extra),
  }));

  for (let i = 0; i < targets.length; i += 100) {
    let { error: e2 } = await sb.from('jjp_wa_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) {
      console.error('Error insertando destinatarios:', e2);
      showToast('Error cargando destinatarios: ' + e2.message, 'err');
      break;
    }
  }

  btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
  showToast('Campaña lanzada 🚀 — wa-server la despachará automáticamente con su adjunto');
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

