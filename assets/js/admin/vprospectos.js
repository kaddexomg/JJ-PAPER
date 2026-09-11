/* ==========================================================================
   JJ Paper Admin — Módulo de Prospectos B2B (Leads & Hiper-Personalización IA)
   - Exclusivo para Administrador (Keyder José Salazar)
   - Importación masiva continua desde Google Sheets / Excel (sin duplicados)
   - Análisis de necesidades operativas por cuenta con Gemini IA
   - Redacción especializada de Correos (130-180 palabras | 4 Pilares) y WhatsApp
   - Conversión 1-clic de Prospecto a Cliente formal en Cartera (jjp_customers)
   ========================================================================== */

let prospectsList = [];
let filteredProspects = [];
let currentSectorFilter = 'todos';
let currentStatusFilter = 'todos';
let activeProspectModal = null;
let currentEditingProspectId = null;

const KEYDER_PROFILE = {
  name: 'Keyder José Salazar',
  role: 'Dirección Comercial | JJ Paper C.A.',
  phone: '0412-4676073',
  email: 'ventas@jjpaper.com'
};

/* --------------------------------------------------------------------------
   1. Carga Inicial de Prospectos desde Supabase Core
   -------------------------------------------------------------------------- */
async function loadProspects() {
  try {
    const tbody = document.getElementById('prospectsTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><div class="spinner-sm"></div> Cargando prospectos B2B...</td></tr>`;
    }

    const { data, error } = await sb.from('jjp_prospects')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error cargando prospectos:', error);
      showToast('Error cargando prospectos: ' + error.message, 'err');
      return;
    }

    prospectsList = data || [];
    renderSectorFilterChips();
    applyProspectFilters();
    updateProspectKpis();
  } catch (e) {
    console.error('Excepción cargando prospectos:', e);
    showToast('Error de conexión al cargar prospectos', 'err');
  }
}

/* --------------------------------------------------------------------------
   2. Renderizado de Filtros y Chips de Sectores
   -------------------------------------------------------------------------- */
function renderSectorFilterChips() {
  const container = document.getElementById('sectorChipsContainer');
  if (!container) return;

  const sectors = new Set();
  prospectsList.forEach(p => {
    if (p.sector && p.sector.trim()) sectors.add(p.sector.trim());
  });

  const sortedSectors = Array.from(sectors).sort();

  let html = `<button class="of-chip ${currentSectorFilter === 'todos' ? 'on' : ''}" onclick="setSectorFilter('todos')">🌐 Todos (${prospectsList.length})</button>`;
  
  sortedSectors.forEach(s => {
    const count = prospectsList.filter(p => p.sector === s).length;
    html += `<button class="of-chip ${currentSectorFilter === s ? 'on' : ''}" onclick="setSectorFilter('${escapeHTML(s)}')">${escapeHTML(s)} (${count})</button>`;
  });

  container.innerHTML = html;
}

function setSectorFilter(sector) {
  currentSectorFilter = sector;
  renderSectorFilterChips();
  applyProspectFilters();
}

function setStatusFilter(status) {
  currentStatusFilter = status;
  document.querySelectorAll('#statusFilterTabs .of-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
  applyProspectFilters();
}

function applyProspectFilters() {
  const q = (document.getElementById('prospectSearchInput')?.value || '').trim().toLowerCase();

  filteredProspects = prospectsList.filter(p => {
    // Filtro de sector
    if (currentSectorFilter !== 'todos' && p.sector !== currentSectorFilter) return false;

    // Filtro de estado
    if (currentStatusFilter !== 'todos') {
      if (currentStatusFilter === 'nuevo' && p.status !== 'nuevo' && p.status !== 'pendiente') return false;
      if (currentStatusFilter === 'analizado' && p.status !== 'analizado_ia' && p.status !== 'borrador_creado') return false;
      if (currentStatusFilter === 'contactado' && !p.status.startsWith('contactado') && !p.contacted) return false;
      if (currentStatusFilter === 'ganado' && p.status !== 'ganado' && !p.converted_customer_id) return false;
    }

    // Buscador general
    if (q) {
      const matchComp = (p.company_name || '').toLowerCase().includes(q);
      const matchCont = (p.contact_name || '').toLowerCase().includes(q);
      const matchRole = (p.contact_role || '').toLowerCase().includes(q);
      const matchTel = (p.phone_1 || '').includes(q) || (p.phone_2 || '').includes(q);
      const matchEmail = (p.email || '').toLowerCase().includes(q);
      const matchAddr = (p.address || '').toLowerCase().includes(q);
      const matchNotes = (p.notes || '').toLowerCase().includes(q);
      return matchComp || matchCont || matchRole || matchTel || matchEmail || matchAddr || matchNotes;
    }

    return true;
  });

  renderProspectsTable();
}

/* --------------------------------------------------------------------------
   3. KPIs y Resumen Operativo
   -------------------------------------------------------------------------- */
function updateProspectKpis() {
  const total = prospectsList.length;
  const analizados = prospectsList.filter(p => p.status === 'analizado_ia' || p.status === 'borrador_creado' || (p.ai_analysis && p.ai_analysis.dolor_operativo)).length;
  const contactados = prospectsList.filter(p => p.contacted || (p.status && p.status.startsWith('contactado'))).length;
  const pendientes = total - contactados;
  const ganados = prospectsList.filter(p => p.status === 'ganado' || p.converted_customer_id).length;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('kpiTotalProspects', total);
  setEl('kpiAnalyzedProspects', analizados);
  setEl('kpiContactedProspects', contactados);
  setEl('kpiPendingProspects', pendientes);
  setEl('kpiWonProspects', ganados);
}

/* --------------------------------------------------------------------------
   4. Renderizado de la Tabla Principal
   -------------------------------------------------------------------------- */
function renderProspectsTable() {
  const tbody = document.getElementById('prospectsTableBody');
  if (!tbody) return;

  if (filteredProspects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No se encontraron prospectos con los filtros actuales.</td></tr>`;
    return;
  }

  const MAX = 150;
  const toShow = filteredProspects.slice(0, MAX);

  tbody.innerHTML = toShow.map(p => {
    const hasAi = Boolean(p.custom_email_body || (p.ai_analysis && p.ai_analysis.dolor_operativo));
    
    // Insignia de estado
    let badgeClass = 'badge-gray';
    let badgeTxt = 'Nuevo';
    if (p.status === 'ganado' || p.converted_customer_id) {
      badgeClass = 'badge-green';
      badgeTxt = '⭐ Ganado / Cliente';
    } else if (p.status === 'contactado_wa') {
      badgeClass = 'badge-emerald';
      badgeTxt = '💬 Contactado WA';
    } else if (p.status === 'contactado_email') {
      badgeClass = 'badge-blue';
      badgeTxt = '✉️ Contactado Correo';
    } else if (hasAi || p.status === 'analizado_ia' || p.status === 'borrador_creado') {
      badgeClass = 'badge-purple';
      badgeTxt = '🧠 Analizado con IA';
    }

    const contactDisplay = p.contact_name || (p.contact_role ? `<em>${escapeHTML(p.contact_role)}</em>` : '<span style="color:#94a3b8">No indicado</span>');
    const roleDisplay = p.contact_name && p.contact_role ? `<div style="font-size:11.5px;color:#64748b">${escapeHTML(p.contact_role)}</div>` : '';
    const phoneDisplay = p.phone_2 || p.phone_1 || '—';
    const emailDisplay = p.email ? `<div style="font-size:11.5px;color:#2563eb">${escapeHTML(p.email)}</div>` : '';

    return `
      <tr class="prospect-row ${hasAi ? 'row-analyzed' : ''}">
        <td>
          <div style="font-weight:700;color:var(--dark);font-size:13.5px">${escapeHTML(p.company_name)}</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px">
            📍 ${escapeHTML(p.address || p.city || 'Caracas')}
          </div>
          ${p.notes ? `<div style="font-size:11px;color:#b45309;margin-top:3px;background:#fef3c7;padding:2px 6px;border-radius:4px;display:inline-block">💡 ${escapeHTML(p.notes.slice(0, 75))}${p.notes.length > 75 ? '...' : ''}</div>` : ''}
        </td>
        <td>
          <span class="badge-sector">${escapeHTML(p.sector || 'Otro')}</span>
        </td>
        <td>
          <div style="font-weight:600">${contactDisplay}</div>
          ${roleDisplay}
        </td>
        <td>
          <div style="font-weight:600;font-size:12.5px">${escapeHTML(phoneDisplay)}</div>
          ${emailDisplay}
        </td>
        <td>
          <span class="prospect-status-badge ${badgeClass}">${badgeTxt}</span>
          ${p.contact_count > 0 ? `<div style="font-size:10.5px;color:#64748b;margin-top:2px">Interacciones: ${p.contact_count}</div>` : ''}
        </td>
        <td>
          ${hasAi ? `
            <div style="font-size:11.5px;color:#047857;font-weight:600">
              ✓ 2 Core + Cross-Sell
            </div>
            <div style="font-size:11px;color:#64748b">130-180 palabras listos</div>
          ` : `
            <button class="btn-ai-analyze-sm" onclick="analyzeSingleProspect('${p.id}')" title="Analizar necesidades con Gemini IA">
              🧠 Analizar con IA
            </button>
          `}
        </td>
        <td style="text-align:right">
          <div class="prospect-actions">
            <button class="btn-action-icon" onclick="openProspectDetailModal('${p.id}')" title="Ver análisis y opciones de contacto">
              👁️
            </button>
            <button class="btn-action-icon" style="color:#2563eb" onclick="openEmailModalForProspect('${p.id}')" title="Ver/Enviar correo personalizado">
              ✉️
            </button>
            <button class="btn-action-icon" style="color:#059669" onclick="openWaModalForProspect('${p.id}')" title="Ver/Enviar WhatsApp">
              💬
            </button>
            ${!p.converted_customer_id ? `
              <button class="btn-action-icon" style="color:#d97706" onclick="convertProspectToCustomer('${p.id}')" title="Convertir en Cliente de Cartera (jjp_customers)">
                ⭐
              </button>
            ` : ''}
            <button class="btn-action-icon" style="color:#64748b" onclick="openEditProspectModal('${p.id}')" title="Editar datos">
              ✏️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (filteredProspects.length > MAX) {
    tbody.innerHTML += `<tr><td colspan="7" style="text-align:center;padding:10px;background:#f8fafc;color:#64748b;font-size:12px">Mostrando primeros ${MAX} de ${filteredProspects.length} prospectos. Afina con el buscador o filtros arriba.</td></tr>`;
  }
}

/* --------------------------------------------------------------------------
   5. Motor Inteligente de Análisis IA (Individual y Masivo)
   -------------------------------------------------------------------------- */
async function analyzeSingleProspect(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  showToast(`Analizando a ${p.company_name} con IA… 🧠`, 'info');

  try {
    const result = await GeminiClient.analyzeAndDraftProspectB2B({
      companyName: p.company_name,
      sector: p.sector,
      contactName: p.contact_name,
      contactRole: p.contact_role,
      address: p.address,
      notes: p.notes,
      city: p.city || 'Caracas',
      sellerName: KEYDER_PROFILE.name,
      sellerPhone: KEYDER_PROFILE.phone
    });

    // Actualizar en base de datos
    const updatePayload = {
      status: p.status === 'nuevo' ? 'analizado_ia' : p.status,
      ai_analysis: {
        sector_deducido: result.sector_deducido,
        dolor_operativo: result.dolor_operativo,
        insumos_core: result.insumos_core,
        insumo_cross_sell: result.insumo_cross_sell,
        angulo_seleccionado: result.angulo_seleccionado
      },
      suggested_subject: result.subject,
      custom_email_body: result.email_body,
      custom_wa_body: result.wa_body,
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('jjp_prospects').update(updatePayload).eq('id', prospectId);
    if (error) throw error;

    // Actualizar en memoria local
    Object.assign(p, updatePayload);
    updateProspectKpis();
    applyProspectFilters();

    showToast(`¡${p.company_name} analizado exitosamente! ✨`);
    openProspectDetailModal(prospectId);

  } catch (err) {
    console.error('Error analizando prospecto:', err);
    showToast('Error analizando con IA: ' + err.message, 'err');
  }
}

async function analyzeBatchProspects(count = 5) {
  const pending = prospectsList.filter(p => !p.custom_email_body && (!p.ai_analysis || !p.ai_analysis.dolor_operativo)).slice(0, count);
  if (pending.length === 0) {
    showToast('Todos los prospectos en vista ya cuentan con análisis de IA.', 'info');
    return;
  }

  if (!confirm(`¿Deseas iniciar el análisis de necesidades con IA para los próximos ${pending.length} prospectos?`)) return;

  const btn = document.getElementById('btnBatchAnalyze');
  if (btn) {
    btn.disabled = true;
    btn.textContent = `Analizando 0/${pending.length}… ⏳`;
  }

  let successCount = 0;
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    if (btn) btn.textContent = `Analizando ${i + 1}/${pending.length} (${p.company_name})… ⏳`;

    try {
      const result = await GeminiClient.analyzeAndDraftProspectB2B({
        companyName: p.company_name,
        sector: p.sector,
        contactName: p.contact_name,
        contactRole: p.contact_role,
        address: p.address,
        notes: p.notes,
        city: p.city || 'Caracas',
        sellerName: KEYDER_PROFILE.name,
        sellerPhone: KEYDER_PROFILE.phone
      });

      const updatePayload = {
        status: p.status === 'nuevo' ? 'analizado_ia' : p.status,
        ai_analysis: {
          sector_deducido: result.sector_deducido,
          dolor_operativo: result.dolor_operativo,
          insumos_core: result.insumos_core,
          insumo_cross_sell: result.insumo_cross_sell,
          angulo_seleccionado: result.angulo_seleccionado
        },
        suggested_subject: result.subject,
        custom_email_body: result.email_body,
        custom_wa_body: result.wa_body,
        updated_at: new Date().toISOString()
      };

      await sb.from('jjp_prospects').update(updatePayload).eq('id', p.id);
      Object.assign(p, updatePayload);
      successCount++;
    } catch (e) {
      console.warn('Error en lote para ' + p.company_name, e);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '⚡ Analizar Lote con IA';
  }

  updateProspectKpis();
  applyProspectFilters();
  showToast(`Análisis masivo completado: ${successCount} cuentas procesadas ✔`);
}

/* --------------------------------------------------------------------------
   6. Modales de Detalle, Correo y WhatsApp
   -------------------------------------------------------------------------- */
function openProspectDetailModal(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  currentEditingProspectId = prospectId;
  const modal = document.getElementById('prospectDetailModal');
  const ai = p.ai_analysis || {};

  document.getElementById('pdmTitle').textContent = p.company_name;
  document.getElementById('pdmSector').textContent = p.sector || 'No especificado';
  document.getElementById('pdmContact').textContent = `${p.contact_name || 'Sin nombre'} ${p.contact_role ? `(${p.contact_role})` : ''}`;
  document.getElementById('pdmPhones').textContent = `${p.phone_2 || ''} ${p.phone_1 ? ' / ' + p.phone_1 : ''}`.trim() || 'Sin teléfono';
  document.getElementById('pdmEmail').textContent = p.email || 'Sin correo';
  document.getElementById('pdmAddress').textContent = p.address || 'Caracas, Venezuela';
  document.getElementById('pdmNotes').textContent = p.notes || 'Ninguna observación previa';

  // Bloque IA
  const aiWrap = document.getElementById('pdmAiContent');
  if (p.custom_email_body || ai.dolor_operativo) {
    aiWrap.innerHTML = `
      <div class="ai-box-insights">
        <div style="font-weight:700;color:#065f46;margin-bottom:4px">🎯 Dolor Operativo Detectado:</div>
        <div style="font-size:12.5px;color:#047857;margin-bottom:10px;line-height:1.4">${escapeHTML(ai.dolor_operativo || 'Optimización de suministros y resguardo operativo')}</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div style="background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #a7f3d0">
            <div style="font-size:11px;font-weight:700;color:#065f46">📦 Insumos Core Propuestos:</div>
            <ul style="margin:4px 0 0 16px;padding:0;font-size:11.5px;color:#047857">
              ${(ai.insumos_core || ['Rollos térmicos de caja', 'Carpetas de fibra y papel Bond']).map(i => `<li>${escapeHTML(i)}</li>`).join('')}
            </ul>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #a7f3d0">
            <div style="font-size:11px;font-weight:700;color:#065f46">🔄 Cross-Selling Recomendado:</div>
            <div style="font-size:11.5px;color:#047857;margin-top:4px">${escapeHTML(ai.insumo_cross_sell || 'Cintas de embalaje industrial para almacén')}</div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-p sm" onclick="openEmailModalForProspect('${p.id}')">✉️ Ver Correo Redactado (130-180 palabras)</button>
          <button class="btn-o sm" style="color:#059669;border-color:#059669" onclick="openWaModalForProspect('${p.id}')">💬 Ver WhatsApp con Spintax</button>
          <button class="btn-o sm" onclick="analyzeSingleProspect('${p.id}')">🔄 Re-analizar con IA</button>
        </div>
      </div>
    `;
  } else {
    aiWrap.innerHTML = `
      <div style="text-align:center;padding:20px;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
        <p style="color:#64748b;font-size:13px;margin-bottom:12px">Esta cuenta aún no ha sido analizada por Gemini IA.</p>
        <button class="btn-p sm" onclick="analyzeSingleProspect('${p.id}')">🧠 Analizar Necesidades y Redactar Copy Ahora</button>
      </div>
    `;
  }

  modal.classList.add('op');
}

function closeProspectDetailModal() {
  document.getElementById('prospectDetailModal')?.classList.remove('op');
}

/* Modal Correo */
function openEmailModalForProspect(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  currentEditingProspectId = prospectId;
  closeProspectDetailModal();

  // Si no tiene copy, generarlo o colocar fallback
  const subject = p.suggested_subject || `Propuesta de abastecimiento operativo y homologación para ${p.company_name}`;
  const body = p.custom_email_body || `Estimado(a) ${p.contact_name || 'Gerencia de Compras'}:\n\nEs un placer saludarle desde JJ Paper C.A...`;

  document.getElementById('pemTo').value = p.email || '';
  document.getElementById('pemSubject').value = subject;
  document.getElementById('pemBody').value = body;
  updateEmailWordCountBadge();

  document.getElementById('prospectEmailModal').classList.add('op');
}

function closeProspectEmailModal() {
  document.getElementById('prospectEmailModal')?.classList.remove('op');
}

function updateEmailWordCountBadge() {
  const text = document.getElementById('pemBody')?.value || '';
  const count = text.trim() ? text.trim().split(/\s+/).length : 0;
  const badge = document.getElementById('pemWordCountBadge');
  if (badge) {
    badge.textContent = `${count} palabras`;
    if (count >= 130 && count <= 180) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#166534';
      badge.title = 'Longitud óptima recomendada (130-180 palabras)';
    } else {
      badge.style.background = '#fef3c7';
      badge.style.color = '#92400e';
      badge.title = 'Recomendado mantener entre 130 y 180 palabras';
    }
  }
}

function copyEmailToClipboard() {
  const subj = document.getElementById('pemSubject').value;
  const body = document.getElementById('pemBody').value;
  const full = `Asunto: ${subj}\n\n${body}`;

  navigator.clipboard.writeText(full).then(() => {
    showToast('¡Asunto y cuerpo del correo copiados al portapapeles! 📋');
  });
}

async function markProspectContactedEmail() {
  if (!currentEditingProspectId) return;
  const p = prospectsList.find(x => x.id === currentEditingProspectId);
  if (!p) return;

  const newCount = (p.contact_count || 0) + 1;
  const updatePayload = {
    status: 'contactado_email',
    contacted: true,
    contact_count: newCount,
    last_contact_at: new Date().toISOString()
  };

  await sb.from('jjp_prospects').update(updatePayload).eq('id', p.id);
  Object.assign(p, updatePayload);
  updateProspectKpis();
  applyProspectFilters();

  showToast(`Estado de ${p.company_name} actualizado a Contactado por Correo ✔`);
  closeProspectEmailModal();
}

/* Modal WhatsApp */
function openWaModalForProspect(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  currentEditingProspectId = prospectId;
  closeProspectDetailModal();

  const phone = p.phone_2 || p.phone_1 || '';
  const body = p.custom_wa_body || `{Hola|Buen día} ${p.contact_name || 'responsable de compras'} 👋, un cordial saludo de ${KEYDER_PROFILE.name} de JJ Paper...`;

  document.getElementById('pwmPhone').value = phone;
  document.getElementById('pwmBody').value = body;

  document.getElementById('prospectWaModal').classList.add('op');
}

function closeProspectWaModal() {
  document.getElementById('prospectWaModal')?.classList.remove('op');
}

function copyWaToClipboard() {
  const body = document.getElementById('pwmBody').value;
  // Resolver spintax al copiar para tener una versión lista
  const resolved = (typeof GeminiClient !== 'undefined' && GeminiClient.resolveSpintax) 
    ? GeminiClient.resolveSpintax(body) 
    : body.replace(/\{([^{}]+)\}/g, (_, choices) => {
        const arr = choices.split('|');
        return arr[Math.floor(Math.random() * arr.length)];
      });

  navigator.clipboard.writeText(resolved).then(() => {
    showToast('¡Mensaje de WhatsApp resuelto y copiado al portapapeles! 💬');
  });
}

function openExternalWhatsApp() {
  const rawPhone = (document.getElementById('pwmPhone').value || '').replace(/\D/g, '');
  const body = document.getElementById('pwmBody').value;

  if (!rawPhone) {
    showToast('El prospecto no tiene un número telefónico registrado', 'warn');
    return;
  }

  // Normalizar a formato internacional 58
  let formatted = rawPhone;
  if (formatted.startsWith('0')) formatted = '58' + formatted.slice(1);
  else if (!formatted.startsWith('58')) formatted = '58' + formatted;

  // Resolver spintax
  const resolved = body.replace(/\{([^{}]+)\}/g, (_, choices) => {
    const arr = choices.split('|');
    return arr[Math.floor(Math.random() * arr.length)];
  });

  const url = `https://wa.me/${formatted}?text=${encodeURIComponent(resolved)}`;
  window.open(url, '_blank');

  markProspectContactedWa();
}

async function markProspectContactedWa() {
  if (!currentEditingProspectId) return;
  const p = prospectsList.find(x => x.id === currentEditingProspectId);
  if (!p) return;

  const newCount = (p.contact_count || 0) + 1;
  const updatePayload = {
    status: 'contactado_wa',
    contacted: true,
    contact_count: newCount,
    last_contact_at: new Date().toISOString()
  };

  await sb.from('jjp_prospects').update(updatePayload).eq('id', p.id);
  Object.assign(p, updatePayload);
  updateProspectKpis();
  applyProspectFilters();

  showToast(`Estado de ${p.company_name} actualizado a Contactado por WhatsApp ✔`);
  closeProspectWaModal();
}

/* --------------------------------------------------------------------------
   7. Conversión 1-Clic a Cliente Formal (jjp_customers)
   -------------------------------------------------------------------------- */
async function convertProspectToCustomer(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  if (!confirm(`¿Deseas convertir a "${p.company_name}" en cliente oficial de tu cartera (Zona 020 / Keyder Salazar)?`)) return;

  const targetPhone = (p.phone_2 || p.phone_1 || '').replace(/\D/g, '') || ('sn-' + Date.now().toString().slice(-8));

  // Verificar si ya existe en jjp_customers por teléfono o nombre
  const { data: existing } = await sb.from('jjp_customers')
    .select('id, name')
    .or(`phone.eq.${targetPhone},name.ilike.%${p.company_name}%`)
    .limit(1);

  let customerId = existing?.[0]?.id;

  if (!customerId) {
    const newCustPayload = {
      name: p.company_name,
      phone: targetPhone,
      email: p.email || null,
      address: p.address || null,
      city: p.city || 'Caracas',
      zone: '020', // Cartera propia de Keyder
      notes: `Convertido desde Prospectos B2B. Sector: ${p.sector || 'General'}. Contacto: ${p.contact_name || ''} (${p.contact_role || ''}). ${p.notes || ''}`.trim(),
      tags: ['prospecto_convertido', (p.sector || '').toLowerCase().replace(/\s+/g, '_')].filter(Boolean)
    };

    const { data: created, error: createErr } = await sb.from('jjp_customers').insert(newCustPayload).select('id').single();
    if (createErr) {
      showToast('Error creando cliente en jjp_customers: ' + createErr.message, 'err');
      return;
    }
    customerId = created.id;
  }

  // Marcar prospecto como ganado
  const updatePayload = {
    status: 'ganado',
    converted_customer_id: customerId,
    updated_at: new Date().toISOString()
  };

  await sb.from('jjp_prospects').update(updatePayload).eq('id', p.id);
  Object.assign(p, updatePayload);

  updateProspectKpis();
  applyProspectFilters();

  showToast(`⭐ ¡"${p.company_name}" ahora forma parte oficial de tu cartera de clientes!`, 'success');
}

/* --------------------------------------------------------------------------
   8. Importación Continua desde Google Sheets / Excel
   -------------------------------------------------------------------------- */
function openImportModal() {
  document.getElementById('importProspectsModal').classList.add('op');
}

function closeImportModal() {
  document.getElementById('importProspectsModal').classList.remove('op');
}

// Subida de archivo .xlsx o .csv
async function handleImportFileInput(input) {
  const file = input.files?.[0];
  if (!file) return;

  showToast('Leyendo archivo de Google Sheets/Excel… 📄', 'info');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      await processImportedRows(rows);
    } catch (err) {
      console.error(err);
      showToast('Error procesando archivo: ' + err.message, 'err');
    } finally {
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// Pegado directo (Ctrl+V) desde Google Sheets
async function handlePasteImport() {
  const text = document.getElementById('pasteImportTextarea')?.value || '';
  if (!text.trim()) {
    showToast('Pega los datos de las celdas de Google Sheets en el área de texto', 'warn');
    return;
  }

  const lines = text.trim().split(/\r?\n/);
  const rows = lines.map(line => line.split('\t'));

  await processImportedRows(rows);
  document.getElementById('pasteImportTextarea').value = '';
}

async function processImportedRows(allRows) {
  if (!allRows || allRows.length === 0) {
    showToast('El archivo o texto pegado no contiene filas', 'warn');
    return;
  }

  // Buscar fila de cabecera
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const r = allRows[i].map(c => String(c || '').toLowerCase().trim());
    if (r.some(c => c.includes('empresa') || c.includes('cliente') || c.includes('razón'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    showToast('No se encontró la cabecera (debe contener columna "Empresa" o "Cliente")', 'err');
    return;
  }

  const headers = allRows[headerIdx].map(h => String(h || '').toLowerCase().trim());

  const col = {
    sector: headers.findIndex(h => h.includes('sector') || h.includes('rubro')),
    empresa: headers.findIndex(h => h.includes('empresa') || h.includes('cliente') || h.includes('razón')),
    contacto: headers.findIndex(h => h.includes('contacto') || h.includes('cargo') || h.includes('atención')),
    tel1: headers.findIndex(h => (h.includes('tel') || h.includes('fijo')) && !h.includes('2')),
    tel2: headers.findIndex(h => h.includes('teléfono 2') || h.includes('telefono 2') || h.includes('cel') || h.includes('whatsapp') || h.includes('movil')),
    email: headers.findIndex(h => h.includes('correo') || h.includes('email')),
    direccion: headers.findIndex(h => h.includes('direcci') || h.includes('sede') || h.includes('ubicaci')),
    notas: headers.findIndex(h => h.includes('nota') || h.includes('observaci'))
  };

  if (col.empresa === -1) {
    showToast('No se pudo identificar la columna de Empresa', 'err');
    return;
  }

  let inserted = 0;
  let updated = 0;

  showToast('Guardando prospectos en la base de datos… ⏳', 'info');

  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;

    const rawCompany = String(r[col.empresa] || '').trim();
    if (!rawCompany || rawCompany.toLowerCase() === 'empresa') continue;

    const sector = col.sector !== -1 && r[col.sector] ? String(r[col.sector]).trim() : 'Otro';
    const rawContact = col.contacto !== -1 && r[col.contacto] ? String(r[col.contacto]).trim() : '';

    let contactName = rawContact;
    let contactRole = '';
    const matchParen = rawContact.match(/^([^(]+)\(([^)]+)\)$/);
    if (matchParen) {
      contactName = matchParen[1].trim();
      contactRole = matchParen[2].trim();
    } else if (rawContact.toLowerCase().includes('gerencia') || rawContact.toLowerCase().includes('dirección') || rawContact.toLowerCase().includes('coordinación') || rawContact.toLowerCase().includes('jefatura')) {
      contactRole = rawContact;
      contactName = '';
    }

    const tel1 = col.tel1 !== -1 && r[col.tel1] ? String(r[col.tel1]).trim() : null;
    const tel2 = col.tel2 !== -1 && r[col.tel2] ? String(r[col.tel2]).trim() : null;
    const email = col.email !== -1 && r[col.email] ? String(r[col.email]).trim() : null;
    const address = col.direccion !== -1 && r[col.direccion] ? String(r[col.direccion]).trim() : null;
    const notes = col.notas !== -1 && r[col.notas] ? String(r[col.notas]).trim() : null;

    const payload = {
      company_name: rawCompany,
      sector: sector || 'Otro',
      contact_name: contactName || null,
      contact_role: contactRole || null,
      phone_1: tel1,
      phone_2: tel2,
      email: email,
      address: address,
      notes: notes,
      updated_at: new Date().toISOString()
    };

    // Upsert por company_name
    const { error: upsertErr } = await sb.from('jjp_prospects').upsert(payload, { onConflict: 'company_name' });
    if (!upsertErr) {
      inserted++;
    }
  }

  showToast(`¡Importación finalizada! ${inserted} prospectos sincronizados con éxito ✔`);
  closeImportModal();
  await loadProspects();
}

/* --------------------------------------------------------------------------
   9. Modal de Creación / Edición Manual
   -------------------------------------------------------------------------- */
function openNewProspectModal() {
  currentEditingProspectId = null;
  document.getElementById('editProspectModalTitle').textContent = 'Nuevo Prospecto B2B';
  document.getElementById('ep-company').value = '';
  document.getElementById('ep-sector').value = 'Supermercados';
  document.getElementById('ep-contact').value = '';
  document.getElementById('ep-role').value = '';
  document.getElementById('ep-tel1').value = '';
  document.getElementById('ep-tel2').value = '';
  document.getElementById('ep-email').value = '';
  document.getElementById('ep-address').value = '';
  document.getElementById('ep-notes').value = '';
  document.getElementById('editProspectModal').classList.add('op');
}

function openEditProspectModal(prospectId) {
  const p = prospectsList.find(x => x.id === prospectId);
  if (!p) return;

  currentEditingProspectId = prospectId;
  document.getElementById('editProspectModalTitle').textContent = `Editar: ${p.company_name}`;
  document.getElementById('ep-company').value = p.company_name || '';
  document.getElementById('ep-sector').value = p.sector || 'Otro';
  document.getElementById('ep-contact').value = p.contact_name || '';
  document.getElementById('ep-role').value = p.contact_role || '';
  document.getElementById('ep-tel1').value = p.phone_1 || '';
  document.getElementById('ep-tel2').value = p.phone_2 || '';
  document.getElementById('ep-email').value = p.email || '';
  document.getElementById('ep-address').value = p.address || '';
  document.getElementById('ep-notes').value = p.notes || '';
  document.getElementById('editProspectModal').classList.add('op');
}

function closeEditProspectModal() {
  document.getElementById('editProspectModal')?.classList.remove('op');
}

async function saveManualProspect() {
  const company = document.getElementById('ep-company').value.trim();
  if (!company) {
    showToast('El nombre de la empresa es obligatorio', 'warn');
    return;
  }

  const payload = {
    company_name: company,
    sector: document.getElementById('ep-sector').value.trim() || 'Otro',
    contact_name: document.getElementById('ep-contact').value.trim() || null,
    contact_role: document.getElementById('ep-role').value.trim() || null,
    phone_1: document.getElementById('ep-tel1').value.trim() || null,
    phone_2: document.getElementById('ep-tel2').value.trim() || null,
    email: document.getElementById('ep-email').value.trim() || null,
    address: document.getElementById('ep-address').value.trim() || null,
    notes: document.getElementById('ep-notes').value.trim() || null,
    updated_at: new Date().toISOString()
  };

  if (currentEditingProspectId) {
    const { error } = await sb.from('jjp_prospects').update(payload).eq('id', currentEditingProspectId);
    if (error) {
      showToast('Error actualizando prospecto: ' + error.message, 'err');
      return;
    }
  } else {
    payload.status = 'nuevo';
    payload.source = 'manual';
    const { error } = await sb.from('jjp_prospects').insert(payload);
    if (error) {
      showToast('Error creando prospecto: ' + error.message, 'err');
      return;
    }
  }

  showToast('Prospecto guardado con éxito ✔');
  closeEditProspectModal();
  await loadProspects();
}

/* --------------------------------------------------------------------------
   10. Campañas Masivas de WhatsApp y Email para Prospectos B2B
   -------------------------------------------------------------------------- */
let currentCampChannel = 'whatsapp';

function openProspectCampaignModal(channel = 'whatsapp') {
  currentCampChannel = channel;
  const isEmail = channel === 'email';

  // Filtrar prospectos elegibles según canal
  const eligible = filteredProspects.filter(p => {
    if (isEmail) {
      return p.email && p.email.includes('@');
    } else {
      const phone = (p.phone_2 || p.phone_1 || '').replace(/\D/g, '');
      const isVeMobile = /^(?:58)?0?4(12|14|24|16|26)\d{7}$/.test(phone);
      const isIntlMobile = phone.length >= 11 && !phone.startsWith('0') && !/^(?:58|0)?(?:2\d{2})\d{7}$/.test(phone);
      return (isVeMobile || isIntlMobile);
    }
  });

  document.getElementById('pcModalTitle').textContent = isEmail 
    ? '📣 Nueva Campaña de Email para Prospectos B2B' 
    : '📢 Nueva Campaña de WhatsApp para Prospectos B2B';

  const sectorTag = currentSectorFilter !== 'todos' ? `[${currentSectorFilter}] ` : '';
  document.getElementById('pcCampName').value = (isEmail ? 'Campaña Email ' : 'Difusión WA ') + sectorTag + new Date().toLocaleDateString('es-VE');
  document.getElementById('pcEligibleCount').textContent = `${eligible.length} cuentas con ${isEmail ? 'correo válido' : 'WhatsApp verificado'}`;

  document.getElementById('pcSubjectGroup').style.display = isEmail ? 'block' : 'none';
  if (isEmail) {
    document.getElementById('pcSubject').value = 'Propuesta de abastecimiento operativo y homologación | JJ Paper';
  }

  const defaultWa = `{Hola|Buen día|Estimado(a)} {{nombre}} 👋, un cordial saludo de Keyder Salazar de JJ Paper C.A.\n\nPonemos a su disposición suministro directo mayorista en consumibles de punto de venta, papelería corporativa y embalaje:\n*📦 Rollos térmicos POS y cajas registradoras*\n*📦 Carpetas reglamentarias y resmas Bond*\n*📦 Cintas de empaque industrial*\n\n• Delivery gratuito en Caracas directamente en su sede o centro de distribución.\n• Cotizaciones formales en PDF emitidas en minutos.\n• Facturación fiscal formal con RIF (J-295375450) en bolívares a tasa oficial BCV.\n\n👉 Puede revisar nuestro catálogo digital aquí:\n{{link}}\n\n{¿Desea que le preparemos una cotización formal?|¿Gusta que le verifiquemos disponibilidad para su despacho de esta semana?|Quedo a su disposición para coordinar su requerimiento.}\n\nAtentamente,\nKeyder José Salazar | Teléfono/WhatsApp: 0412-4676073\nJJ Paper C.A.`;

  const defaultEmail = `Estimado(a) {{nombre}}:\n\nEs un placer saludarle desde JJ Paper C.A. Entendemos la alta exigencia diaria que demanda la operación de sus sedes en Caracas, donde la disponibilidad oportuna de suministros resulta indispensable.\n\nPonemos a su disposición nuestro suministro directo en insumos de alta demanda:\n• Rollos térmicos y consumibles para puntos de venta y facturación (cero quiebres de stock).\n• Carpetas reglamentarias de fibra marrón, archivadores y resmas de papel Bond para resguardo documental.\n• Cintas de embalaje industrial de alto micraje para almacén y despacho.\n\nBeneficios de operar con JJ Paper:\n- Le adjuntamos a este correo nuestra lista de precios oficial con más de 700 artículos disponibles para entrega inmediata.\n- Cotizaciones inmediatas en segundos adaptadas a su presupuesto.\n- Servicio de Delivery gratuito en Caracas directamente en su sede o centro de distribución.\n- Facturación fiscal formal con RIF (J-295375450) en bolívares a tasa oficial BCV del día.\n\nLe invitamos a revisar la lista adjunta. Si nos indica qué requerimiento tienen abierto esta semana, con gusto le enviaremos la cotización formal en minutos.\n\nAtentamente,\n\nKeyder José Salazar\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: 0412-4676073\nCaracas, Venezuela`;

  document.getElementById('pcBody').value = isEmail ? defaultEmail : defaultWa;

  document.getElementById('prospectCampaignModal').classList.add('op');
}

function closeProspectCampaignModal() {
  document.getElementById('prospectCampaignModal')?.classList.remove('op');
}

async function launchProspectsCampaign() {
  const isEmail = currentCampChannel === 'email';
  const name = document.getElementById('pcCampName').value.trim();
  const body = document.getElementById('pcBody').value.trim();
  const subject = isEmail ? document.getElementById('pcSubject').value.trim() : null;
  const mode = document.getElementById('pcModeSelect').value; // 'ia_custom' o 'template'
  const speed = document.getElementById('pcSpeedSelect')?.value || 'human';

  if (!name) { showToast('Ingresa un nombre para la campaña', 'warn'); return; }
  if (!body) { showToast('Ingresa el texto del mensaje', 'warn'); return; }
  if (isEmail && !subject) { showToast('Ingresa el asunto del correo', 'warn'); return; }

  const eligible = filteredProspects.filter(p => {
    if (isEmail) return p.email && p.email.includes('@');
    const phone = (p.phone_2 || p.phone_1 || '').replace(/\D/g, '');
    const isVeMobile = /^(?:58)?0?4(12|14|24|16|26)\d{7}$/.test(phone);
    const isIntlMobile = phone.length >= 11 && !phone.startsWith('0') && !/^(?:58|0)?(?:2\d{2})\d{7}$/.test(phone);
    return (isVeMobile || isIntlMobile);
  });

  if (eligible.length === 0) {
    showToast('No hay prospectos válidos en la lista filtrada', 'warn');
    return;
  }

  const btn = document.getElementById('pcLaunchBtn');
  btn.disabled = true;
  btn.textContent = 'Encolando campaña… ⏳';

  try {
    const { data: prof } = await sb.from('jjp_profiles').select('id, name').eq('role', 'admin').limit(1).single();
    const ownerId = prof?.id || 'bddc57dc-5bf9-4a72-9e1c-751d07b03164';

    let delayMin = 45, delayMax = 90, batchSize = 10, batchPause = 5;
    if (speed === 'safe') { delayMin = 25; delayMax = 55; }
    if (speed === 'ultra_safe') { delayMin = 60; delayMax = 120; }
    if (speed === 'fast') { delayMin = 15; delayMax = 30; }

    if (!isEmail) {
      // 1. Crear campaña en jjp_wa_campaigns
      const campPayload = {
        owner_id: ownerId,
        name: name,
        kind: 'prospectos',
        body: body,
        message: body,
        status: 'en_cola',
        delay_min_s: delayMin,
        delay_max_s: delayMax,
        batch_size: batchSize,
        batch_pause_m: batchPause,
        total: eligible.length
      };

      const { data: camp, error: cErr } = await sb.from('jjp_wa_campaigns').insert(campPayload).select('id').single();
      if (cErr) throw cErr;

      // 2. Insertar destinatarios en jjp_wa_campaign_targets
      const targets = eligible.map(p => {
        const rawPhone = (p.phone_2 || p.phone_1 || '').replace(/\D/g, '');
        let norm = rawPhone;
        if (norm.startsWith('0')) norm = '58' + norm.slice(1);
        else if (!norm.startsWith('58')) norm = '58' + norm;

        const targetCustomBody = (mode === 'ia_custom' && p.custom_wa_body) ? p.custom_wa_body : body;

        return {
          campaign_id: camp.id,
          owner_id: ownerId,
          phone: norm,
          name: p.company_name,
          vars: {
            nombre: p.contact_name || p.company_name,
            empresa: p.company_name,
            vendedor: KEYDER_PROFILE.name,
            link: 'https://jj-paper.pages.dev',
            custom_body: targetCustomBody
          },
          status: 'pending'
        };
      });

      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50);
        await sb.from('jjp_wa_campaign_targets').insert(chunk);
      }

      showToast(`¡Campaña de WhatsApp "${name}" encolada con éxito para ${eligible.length} prospectos! 🚀`);
    } else {
      // 1. Crear campaña en jjp_email_campaigns
      const campPayload = {
        owner_id: ownerId,
        name: name,
        kind: 'prospectos',
        subject: subject,
        body: body,
        status: 'running',
        delay_min_s: 15,
        delay_max_s: 45,
        total: eligible.length
      };

      const { data: camp, error: cErr } = await sb.from('jjp_email_campaigns').insert(campPayload).select('id').single();
      if (cErr) throw cErr;

      // 2. Insertar destinatarios en jjp_email_campaign_targets
      const targets = eligible.map(p => {
        const targetCustomSubject = (mode === 'ia_custom' && p.suggested_subject) ? p.suggested_subject : subject;
        const targetCustomBody = (mode === 'ia_custom' && p.custom_email_body) ? p.custom_email_body : body;

        return {
          campaign_id: camp.id,
          owner_id: ownerId,
          email: p.email.toLowerCase().trim(),
          to_addr: p.email.toLowerCase().trim(),
          name: p.company_name,
          vars: {
            nombre: p.contact_name || p.company_name,
            empresa: p.company_name,
            vendedor: KEYDER_PROFILE.name,
            custom_subject: targetCustomSubject,
            custom_body: targetCustomBody
          },
          status: 'pending'
        };
      });

      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50);
        await sb.from('jjp_email_campaign_targets').insert(chunk);
      }

      showToast(`¡Campaña de Correo "${name}" iniciada con éxito para ${eligible.length} prospectos! 🚀`);
    }

    closeProspectCampaignModal();
  } catch (err) {
    console.error('Error lanzando campaña de prospectos:', err);
    showToast('Error lanzando campaña: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Lanzar Campaña Ahora';
  }
}

/* --------------------------------------------------------------------------
   Auto-inicialización
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth('admin');
  if (!session) return;
  renderUserBar(session);

  document.getElementById('menuToggleBtn')?.addEventListener('click', () => {
    document.getElementById('adminAside')?.classList.toggle('op');
  });

  document.getElementById('pemBody')?.addEventListener('input', updateEmailWordCountBadge);

  await loadProspects();
});
