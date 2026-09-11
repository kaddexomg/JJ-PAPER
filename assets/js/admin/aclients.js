/* ======================================================
   JJ Paper Admin — Gestión Global de Clientes y Zonas
   Optimizado: Importación masiva por lotes (batch upsert)
   ====================================================== */

let adminCustomers = [];
let adminProfiles  = [];
let currentZoneFilter = 'todos';
let editingAdminCustId = null;

async function loadAdminCustomers() {
  const { data: profs } = await sb.from('jjp_profiles').select('id, name, role');
  adminProfiles = profs || [];

  // PostgREST corta en 1.000 filas: paginamos para cargar TODA la cartera global
  // (zona 010 quedaba fuera porque sus clientes no tienen last_order_at y caen al final del orden).
  adminCustomers = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('jjp_customers')
      .select('*').order('last_order_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) { showToast('Error cargando clientes', 'err'); return; }
    adminCustomers.push(...(data || []));
    if (!data || data.length < PAGE || from > 12000) break;
    from += PAGE;
  }
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
  else if (zone === '010' || zone === '020') color = '#16a085'; // Keyder
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

  const MAX_RENDER = 150;
  const toShow = list.slice(0, MAX_RENDER);

  const rows = toShow.map(c => `
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
          <button class="btn-o sm" style="color:#0f766e;border-color:#0f766e;font-weight:700" onclick="openCustomerAiFlow('${c.id}')" title="🧠 Flujo IA: Analizar necesidades, redactar y contactar">🧠 Flujo IA</button>
          <button class="btn-p sm" onclick="openAdminCustModal('${c.id}')" title="Editar cliente">✏️</button>
          <button class="btn-o sm" onclick="deleteAdminCustomer('${c.id}')" title="Eliminar cliente" style="color:var(--danger)">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');

  const moreNotice = list.length > MAX_RENDER
    ? `<tr><td colspan="7" style="text-align:center;padding:12px;color:var(--gr);font-size:13px;background:rgba(0,0,0,0.02)">Mostrando los primeros ${MAX_RENDER} de ${list.length} clientes. Usa el buscador arriba para afinar la lista.</td></tr>`
    : '';

  tbody.innerHTML = rows + moreNotice;
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

  const findSeller = pat => adminProfiles.find(x => pat.test(x.name?.toLowerCase() || ''))?.id || null;
  if (zone === '008') {
    seller_id = findSeller(/marianela/);
  } else if (zone === '014') {
    seller_id = findSeller(/andreina/);
  } else if (zone === '006' || zone === '004') {
    seller_id = findSeller(/yovanni|giovanni|006.*004|004.*006|araujo/);
  } else if (zone === '010' || zone === '020') {
    seller_id = findSeller(/keyder|salazar/) || adminProfiles.find(x => x.role === 'admin')?.id || null;
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

/* ---- Importación masiva CSV consolidado (Optimizada por lotes) ---- */
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
  if (!confirm(`Se procesarán ${rows.length} registros para importación masiva y distribución automática por zonas. ¿Continuar?`)) return;

  showToast('Preparando importación masiva...', 'ok', 4000);

  const marianela = adminProfiles.find(x => x.name?.toLowerCase().includes('marianela'))?.id || null;
  const andreina  = adminProfiles.find(x => x.name?.toLowerCase().includes('andreina'))?.id || null;
  const giovanni  = adminProfiles.find(x => x.name?.toLowerCase().includes('giovanni'))?.id || null;
  const keyder    = adminProfiles.find(x => /keyder|salazar/.test(x.name?.toLowerCase() || ''))?.id
                    || adminProfiles.find(x => x.role === 'admin')?.id || null;

  // Preparar todos los registros normalizados
  const batchRecords = [];
  for (const r of rows) {
    const name = r.name || r.nombre || r.cliente || 'Cliente';
    const rawPhone = r.phone || r.telefono || r.celular || '';
    const phone = rawPhone.replace(/\D/g, '') || null;
    const zone = r.zone || r.zona || null;
    const rif = r.rif || r.ci || null;
    const email = r.email || r.correo || null;
    const city = r.city || r.ciudad || 'Caracas';

    let seller_id = null;
    if (zone === '008') seller_id = marianela;
    else if (zone === '014') seller_id = andreina;
    else if (zone === '006' || zone === '004') seller_id = giovanni;
    else if (zone === '010' || zone === '020') seller_id = keyder;

    batchRecords.push({
      name,
      phone: phone || ('s/n-' + Math.random().toString(36).slice(2, 8)), // Asegurar unicidad si no hay teléfono
      zone,
      seller_id,
      rif,
      email,
      city,
      updated_at: new Date().toISOString()
    });
  }

  // Insertar por lotes de 100 elementos para evitar timeouts
  const BATCH_SIZE = 100;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batchRecords.length; i += BATCH_SIZE) {
    const chunk = batchRecords.slice(i, i + BATCH_SIZE);
    showToast(`Procesando lote ${Math.floor(i / BATCH_SIZE) + 1} de ${Math.ceil(batchRecords.length / BATCH_SIZE)}...`, 'ok', 3000);
    
    const { error } = await sb.from('jjp_customers').upsert(chunk, { onConflict: 'phone' });
    if (error) {
      errorCount += chunk.length;
    } else {
      successCount += chunk.length;
    }
  }

  showToast(`Importación finalizada: ${successCount} procesados con éxito${errorCount ? ` · ${errorCount} con error` : ''}`, 'ok', 6000);
  loadAdminCustomers();
}

/* ==========================================================================
   Flujo IA B2B Universal para Clientes de Cartera (Analizar -> Redactar -> Enviar)
   ========================================================================== */
async function openCustomerAiFlow(customerId) {
  const c = adminCustomers.find(x => x.id === customerId);
  if (!c) return;

  document.getElementById('customerAiFlowModalOvl')?.remove();

  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay op';
  ovl.id = 'customerAiFlowModalOvl';
  ovl.style.zIndex = '99999';
  ovl.innerHTML = `
    <div class="modal-box" style="max-width:680px;width:100%;border-radius:14px" onclick="event.stopPropagation()">
      <div class="modal-hd" style="border-bottom:1px solid #e2e8f0;padding:14px 18px">
        <div>
          <h3 style="margin:0;font-size:16px;color:#0f766e">🧠 Flujo IA B2B: ${escapeHTML(c.name)}</h3>
          <span style="font-size:11.5px;color:#64748b">Paso 1: Analizar cuenta → Paso 2: Redactar propuesta → Paso 3: Contactar</span>
        </div>
        <button class="modal-close" onclick="document.getElementById('customerAiFlowModalOvl')?.remove()" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div id="cFlowLoading" style="text-align:center;padding:24px;color:#0f766e;font-weight:600">
          <div style="font-size:24px;margin-bottom:8px">🧠</div>
          Analizando necesidades operativas de la cuenta con Gemini IA… ⏳
        </div>
        <div id="cFlowContent" style="display:none;flex-direction:column;gap:12px">
          <!-- Insights IA -->
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px">
            <div style="font-weight:700;color:#065f46;font-size:12.5px;margin-bottom:4px">🎯 Diagnóstico de Necesidades:</div>
            <div id="cfPain" style="font-size:12px;color:#047857;margin-bottom:8px;line-height:1.4"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div style="background:#fff;padding:6px 10px;border-radius:6px;border:1px solid #a7f3d0">
                <div style="font-size:10.5px;font-weight:700;color:#065f46">📦 Insumos Core (Prioridad):</div>
                <div id="cfCore" style="font-size:11.5px;color:#047857;margin-top:2px"></div>
              </div>
              <div style="background:#fff;padding:6px 10px;border-radius:6px;border:1px solid #a7f3d0">
                <div style="font-size:10.5px;font-weight:700;color:#065f46">🔄 Cross-Selling:</div>
                <div id="cfCross" style="font-size:11.5px;color:#047857;margin-top:2px"></div>
              </div>
            </div>
          </div>

          <!-- Pestañas de Vista: Correo vs WhatsApp -->
          <div style="display:flex;gap:8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px">
            <button id="cfTabEmail" class="btn-p sm" onclick="switchCustomerFlowTab('email')">✉️ Correo (130-180 palabras)</button>
            <button id="cfTabWa" class="btn-o sm" onclick="switchCustomerFlowTab('wa')">💬 WhatsApp (Spintax)</button>
          </div>

          <!-- Bloque Correo -->
          <div id="cfBoxEmail" style="display:flex;flex-direction:column;gap:8px">
            <div class="fg">
              <label class="fl" style="font-size:11px;font-weight:700">Asunto Persuasivo (Banco Dinámico):</label>
              <input class="fi" id="cfEmailSubject" style="font-weight:600">
            </div>
            <div class="fg">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
                <label class="fl" style="font-size:11px;font-weight:700">Cuerpo del Correo (4 Pilares + Firma de Keyder):</label>
                <span id="cfEmailWords" style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#166534">0 palabras</span>
              </div>
              <textarea class="fi" id="cfEmailBody" rows="8" style="font-size:12px;line-height:1.45"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn-o sm" onclick="copyCustomerFlowEmail()">📋 Copiar Correo</button>
              <button class="btn-p sm" onclick="openEmailComposerWithFlow('${c.id}')">✉️ Abrir en Redactor CRM</button>
            </div>
          </div>

          <!-- Bloque WhatsApp -->
          <div id="cfBoxWa" style="display:none;flex-direction:column;gap:8px">
            <div class="fg">
              <label class="fl" style="font-size:11px;font-weight:700">Mensaje Móvil (Spintax anti-bloqueo):</label>
              <textarea class="fi" id="cfWaBody" rows="8" style="font-size:12px;line-height:1.45"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn-o sm" onclick="copyCustomerFlowWa()">📋 Copiar WhatsApp Resuelto</button>
              <button class="btn-p sm" style="background:#059669;border-color:#059669" onclick="openDirectCustomerWa('${escapeHTML(c.phone || '')}')">💬 Abrir WhatsApp Directo</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(ovl);
  ovl.onclick = () => ovl.remove();

  try {
    const rate = (typeof getRate === 'function') ? getRate() : (window.APP?.EXCHANGE_RATE || 40);
    const result = await GeminiClient.analyzeAndDraftProspectB2B({
      companyName: c.name,
      sector: (c.tags && c.tags[0]) || 'Comercio General',
      contactName: '',
      contactRole: '',
      address: c.address || c.city || 'Caracas',
      notes: c.notes || `Zona: ${c.zone || 'Sin zona'}. Compras históricas: ${c.total_orders || 0}`,
      city: c.city || 'Caracas',
      sellerName: 'Keyder José Salazar',
      sellerPhone: '0412-4676073'
    });

    document.getElementById('cFlowLoading').style.display = 'none';
    document.getElementById('cFlowContent').style.display = 'flex';

    document.getElementById('cfPain').textContent = result.dolor_operativo || 'Optimización de suministros y resguardo operativo.';
    document.getElementById('cfCore').textContent = (result.insumos_core || []).join(' · ');
    document.getElementById('cfCross').textContent = result.insumo_cross_sell || 'Cintas de embalaje industrial';

    document.getElementById('cfEmailSubject').value = result.subject || `Propuesta comercial para ${c.name}`;
    document.getElementById('cfEmailBody').value = result.email_body || '';
    document.getElementById('cfWaBody').value = result.wa_body || '';

    const words = result.email_body ? result.email_body.trim().split(/\s+/).length : 0;
    document.getElementById('cfEmailWords').textContent = `${words} palabras`;
  } catch (err) {
    document.getElementById('cFlowLoading').innerHTML = `<span style="color:#dc2626">Error analizando con IA: ${err.message}</span>`;
  }
}
window.openCustomerAiFlow = openCustomerAiFlow;

function switchCustomerFlowTab(tab) {
  const isEmail = tab === 'email';
  document.getElementById('cfBoxEmail').style.display = isEmail ? 'flex' : 'none';
  document.getElementById('cfBoxWa').style.display = isEmail ? 'none' : 'flex';
  document.getElementById('cfTabEmail').className = isEmail ? 'btn-p sm' : 'btn-o sm';
  document.getElementById('cfTabWa').className = isEmail ? 'btn-o sm' : 'btn-p sm';
}
window.switchCustomerFlowTab = switchCustomerFlowTab;

function copyCustomerFlowEmail() {
  const subj = document.getElementById('cfEmailSubject')?.value || '';
  const body = document.getElementById('cfEmailBody')?.value || '';
  navigator.clipboard.writeText(`Asunto: ${subj}\n\n${body}`).then(() => {
    showToast('¡Asunto y correo copiados al portapapeles! 📋');
  });
}
window.copyCustomerFlowEmail = copyCustomerFlowEmail;

function copyCustomerFlowWa() {
  const body = document.getElementById('cfWaBody')?.value || '';
  const resolved = body.replace(/\{([^{}]+)\}/g, (_, choices) => {
    const arr = choices.split('|');
    return arr[Math.floor(Math.random() * arr.length)];
  });
  navigator.clipboard.writeText(resolved).then(() => {
    showToast('¡Mensaje de WhatsApp resuelto y copiado! 💬');
  });
}
window.copyCustomerFlowWa = copyCustomerFlowWa;

function openDirectCustomerWa(rawPhone) {
  const cleanPhone = (rawPhone || '').replace(/\D/g, '');
  if (!cleanPhone) { showToast('El cliente no tiene teléfono registrado', 'warn'); return; }
  let norm = cleanPhone;
  if (norm.startsWith('0')) norm = '58' + norm.slice(1);
  else if (!norm.startsWith('58')) norm = '58' + norm;

  const body = document.getElementById('cfWaBody')?.value || '';
  const resolved = body.replace(/\{([^{}]+)\}/g, (_, choices) => {
    const arr = choices.split('|');
    return arr[Math.floor(Math.random() * arr.length)];
  });
  window.open(`https://wa.me/${norm}?text=${encodeURIComponent(resolved)}`, '_blank');
}
window.openDirectCustomerWa = openDirectCustomerWa;

function openEmailComposerWithFlow(customerId) {
  const c = adminCustomers.find(x => x.id === customerId);
  const subj = document.getElementById('cfEmailSubject')?.value || '';
  const body = document.getElementById('cfEmailBody')?.value || '';
  document.getElementById('customerAiFlowModalOvl')?.remove();

  if (c?.email) {
    window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  } else {
    copyCustomerFlowEmail();
    showToast('El cliente no tiene email registrado; texto copiado al portapapeles', 'info');
  }
}
window.openEmailComposerWithFlow = openEmailComposerWithFlow;
