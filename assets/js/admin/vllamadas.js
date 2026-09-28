/**
 * JJ Paper — Controlador de Pantalla Completa para Llamadas B2B y Centralita
 * Windows 7 + Headset · Puente GSM USB · Tipificador y Agenda de Rellamadas
 */

let activeCallTarget = null;
let pageCallSeconds = 0;
let pageCallTimer = null;
let pageIsCallActive = false;
let gsmBridgeConnected = false;

document.addEventListener('DOMContentLoaded', async () => {
  initLlamadasPage();
  checkGsmBridgeOnPage();
  setInterval(checkGsmBridgeOnPage, 4000);
  loadCallbacksList();
  loadCallHistory();
  initCustomerSearch();
});

function initLlamadasPage() {
  // Pre-cargar número de la URL si viene con ?phone=...
  const params = new URLSearchParams(window.location.search);
  const phoneParam = params.get('phone');
  const nameParam = params.get('name');
  const companyParam = params.get('company');
  const idParam = params.get('id');

  if (phoneParam) {
    document.getElementById('pageDialerInput').value = phoneParam;
    onPageNumberChange(phoneParam);
    if (companyParam || nameParam) {
      setPageCallTarget({
        id: idParam || null,
        company: companyParam || 'Cliente',
        name: nameParam || '',
        phone: phoneParam,
        type: idParam ? 'prospect' : 'manual'
      });
    }
  }
}

// 1. Verificación del Puente GSM
async function checkGsmBridgeOnPage() {
  const statusEl = document.getElementById('pageBridgeStatus');
  const badgeEl = document.getElementById('pageBridgeBadge');

  try {
    let res = await fetch('http://127.0.0.1:8789/status').catch(() => null);
    if (!res || !res.ok) {
      res = await fetch('/lan/gsm/status').catch(() => null);
    }

    if (res && res.ok) {
      const data = await res.json();
      gsmBridgeConnected = !!data.connected;

      if (data.connected) {
        if (statusEl) statusEl.innerHTML = `🟢 <strong>Móvil USB Conectado:</strong> ${escapeHTML(data.model || 'Android')} (SIM Lista)`;
        if (badgeEl) {
          badgeEl.textContent = '🟢 Conectado por USB';
          badgeEl.className = 'of-chip on';
          badgeEl.style.background = '#dcfce7';
          badgeEl.style.color = '#15803d';
        }
        return;
      } else if (data.adb_installed) {
        if (statusEl) statusEl.innerHTML = `🟡 <strong>Cable USB:</strong> Conecta tu celular y activa "Depuración USB"`;
        if (badgeEl) {
          badgeEl.textContent = '🟡 Esperando Celular';
          badgeEl.className = 'of-chip';
        }
        return;
      }
    }
  } catch (_) {}

  gsmBridgeConnected = false;
  if (statusEl) statusEl.innerHTML = `⚪ <strong>Modo Directo / Headset:</strong> Inicia <code>iniciar-puente-gsm.bat</code> para control por USB`;
  if (badgeEl) {
    badgeEl.textContent = '⚪ Puente Offline';
    badgeEl.className = 'of-chip';
  }
}

// 2. Control Numérico y DTMF
function onPageNumberChange(val) {
  const locInfo = window.JJDialer ? window.JJDialer.detectPhoneLocation?.(val) : null;
  const locEl = document.getElementById('pageLocDisplay');
  if (locEl) {
    if (locInfo && locInfo.label) {
      locEl.textContent = `📍 ${locInfo.label}`;
    } else {
      locEl.textContent = 'Ingresa el número a marcar';
    }
  }
}

function pagePressKey(char) {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value += char;
  onPageNumberChange(input.value);
}

function pageBackspace() {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value = input.value.slice(0, -1);
  onPageNumberChange(input.value);
}

function pageClearNumber() {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value = '';
  onPageNumberChange('');
}

// 3. Inicio y Colgado de Llamada
async function pageStartCall() {
  const input = document.getElementById('pageDialerInput');
  const phone = input ? input.value.trim() : '';
  if (!phone) {
    if (typeof showToast === 'function') showToast('Ingresa un número antes de iniciar la llamada.', 'warn');
    return;
  }

  pageStopTimer();
  pageCallSeconds = 0;
  pageIsCallActive = true;
  updatePageCallUI();

  pageCallTimer = setInterval(() => {
    pageCallSeconds++;
    updatePageCallUI();
  }, 1000);

  const cleanNumber = phone.replace(/[^\d+]/g, '');

  if (gsmBridgeConnected) {
    try {
      await fetch('http://127.0.0.1:8789/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanNumber })
      }).catch(() => null);

      if (typeof showToast === 'function') {
        showToast(`📲 Marcando ${phone} desde tu celular por USB... ¡Habla desde tu Headset!`, 'info');
      }
      return;
    } catch (_) {}
  }

  if (typeof showToast === 'function') {
    showToast(`Llamada en curso: ${phone}. Cronómetro activo ⏱️`, 'info');
  }
}

async function pageHangupCall() {
  pageStopTimer();

  if (gsmBridgeConnected) {
    try {
      await fetch('http://127.0.0.1:8789/hangup', { method: 'POST' }).catch(() => null);
    } catch (_) {}
  }

  if (typeof showToast === 'function') {
    showToast(`Llamada finalizada. Duración: ${pageCallSeconds} segundos. Procede a tipificar.`, 'info');
  }

  // Hacer scroll suave hacia la sección de tipificación
  document.getElementById('tipificadorSection')?.scrollIntoView({ behavior: 'smooth' });
}

function pageStopTimer() {
  if (pageCallTimer) {
    clearInterval(pageCallTimer);
    pageCallTimer = null;
  }
  pageIsCallActive = false;
  updatePageCallUI();
}

function updatePageCallUI() {
  const timerEl = document.getElementById('pageTimerDisplay');
  const badgeEl = document.getElementById('pageCallStateBadge');
  const btnStart = document.getElementById('pageBtnStart');
  const btnHang = document.getElementById('pageBtnHang');

  if (timerEl) {
    const mins = Math.floor(pageCallSeconds / 60).toString().padStart(2, '0');
    const secs = (pageCallSeconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${mins}:${secs} (${pageCallSeconds}s)`;
  }

  if (badgeEl) {
    if (pageIsCallActive) {
      badgeEl.textContent = '🟢 En Llamada Activa';
      badgeEl.style.background = '#dcfce7';
      badgeEl.style.color = '#15803d';
    } else if (pageCallSeconds > 0) {
      badgeEl.textContent = `⏹️ Finalizada (${pageCallSeconds}s)`;
      badgeEl.style.background = '#fef3c7';
      badgeEl.style.color = '#b45309';
    } else {
      badgeEl.textContent = '⚪ En Espera';
      badgeEl.style.background = '#f1f5f9';
      badgeEl.style.color = '#64748b';
    }
  }

  if (btnStart && btnHang) {
    if (pageIsCallActive) {
      btnStart.style.display = 'none';
      btnHang.style.display = 'inline-flex';
    } else {
      btnStart.style.display = 'inline-flex';
      btnHang.style.display = 'none';
    }
  }
}

// 4. Búsqueda y Selección de Clientes/Prospectos
function initCustomerSearch() {
  const searchInput = document.getElementById('pageCustomerSearchInput');
  const resultsBox = document.getElementById('pageCustomerSearchResults');
  if (!searchInput || !resultsBox) return;

  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) {
      resultsBox.style.display = 'none';
      return;
    }

    let matches = [];
    if (typeof sb !== 'undefined') {
      try {
        const { data: prospects } = await sb.from('jjp_prospects')
          .select('id, company_name, contact_name, phone, city')
          .or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(6);
        if (prospects) {
          matches = prospects.map(p => ({
            id: p.id,
            company: p.company_name,
            name: p.contact_name,
            phone: p.phone,
            type: 'prospect'
          }));
        }
      } catch (_) {}
    }

    if (!matches.length) {
      resultsBox.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#64748b">No se encontraron clientes</div>';
      resultsBox.style.display = 'block';
      return;
    }

    resultsBox.innerHTML = matches.map(m => `
      <div class="search-item" onclick="selectSearchCustomer('${m.id}', '${escapeHTML(m.company)}', '${escapeHTML(m.name)}', '${escapeHTML(m.phone)}')" style="padding:8px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:12px">
        <div style="font-weight:700;color:#0f172a">${escapeHTML(m.company)}</div>
        <div style="color:#64748b;font-size:11px">👤 ${escapeHTML(m.name || 'Sin nombre')} · 📞 ${escapeHTML(m.phone || 'Sin tel')}</div>
      </div>
    `).join('');
    resultsBox.style.display = 'block';
  });
}

function selectSearchCustomer(id, company, name, phone) {
  document.getElementById('pageCustomerSearchResults').style.display = 'none';
  document.getElementById('pageCustomerSearchInput').value = company;
  document.getElementById('pageDialerInput').value = phone;
  onPageNumberChange(phone);
  setPageCallTarget({ id, company, name, phone, type: 'prospect' });
}

function setPageCallTarget(target) {
  activeCallTarget = target;
  const labelEl = document.getElementById('pageTargetDisplay');
  if (labelEl) {
    labelEl.innerHTML = `<strong>${escapeHTML(target.company)}</strong> · 👤 ${escapeHTML(target.name || 'Sin contacto')} · 📞 ${escapeHTML(target.phone)}`;
  }
}

// 5. Argumentos y Tipificación
function togglePageArg(btn) {
  btn.classList.toggle('on');
  if (btn.classList.contains('on')) {
    btn.style.background = '#dbeafe';
    btn.style.borderColor = '#3b82f6';
    btn.style.color = '#1d4ed8';
  } else {
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

function selectPageOutcome(btn) {
  document.querySelectorAll('#tipificadorSection .of-chip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');

  const code = btn.dataset.outcome;
  const cbBox = document.getElementById('pageCallbackBox');
  const chk = document.getElementById('pageEnableCallback');
  if (cbBox && chk) {
    if (code === 'rellamar' || code === 'encargado' || code === 'cotizacion') {
      chk.checked = true;
      cbBox.style.display = 'block';
      if (!document.getElementById('pageCallbackDateTime').value) {
        setPagePreset(code === 'cotizacion' ? '2d' : 'tomorrow_am');
      }
    }
  }
}

function setPagePreset(preset) {
  const dtInput = document.getElementById('pageCallbackDateTime');
  if (!dtInput) return;

  const targetDate = new Date();
  if (preset === '2h') targetDate.setHours(targetDate.getHours() + 2);
  else if (preset === 'tomorrow_am') {
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(9, 0, 0, 0);
  } else if (preset === 'tomorrow_pm') {
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(14, 30, 0, 0);
  } else if (preset === '2d') {
    targetDate.setDate(targetDate.getDate() + 2);
    targetDate.setHours(10, 0, 0, 0);
  } else if (preset === 'next_week') {
    targetDate.setDate(targetDate.getDate() + 7);
    targetDate.setHours(10, 0, 0, 0);
  }

  const pad = n => String(n).padStart(2, '0');
  dtInput.value = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}T${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}`;
}

// 6. Guardado en CRM & Agenda
async function savePageCallLog() {
  const selectedBtn = document.querySelector('#tipificadorSection .of-chip.on');
  const outcomeCode = selectedBtn ? selectedBtn.dataset.outcome : 'interesado';
  const outcomeText = selectedBtn ? selectedBtn.textContent.trim() : 'Llamada realizada';
  const notes = (document.getElementById('pageCallNotes')?.value || '').trim();
  const phone = (document.getElementById('pageDialerInput')?.value || '').trim();

  const activeArgs = Array.from(document.querySelectorAll('#tipificadorSection [data-arg].on')).map(c => c.dataset.arg);
  const argsText = activeArgs.length ? ` [Argumentos: ${activeArgs.join('; ')}]` : '';

  const hasCallback = document.getElementById('pageEnableCallback')?.checked;
  const cbDate = hasCallback ? document.getElementById('pageCallbackDateTime')?.value : null;
  const cbReason = hasCallback ? document.getElementById('pageCallbackReason')?.value.trim() : '';

  pageStopTimer();

  const target = activeCallTarget || {
    id: null,
    company: document.getElementById('pageCustomerSearchInput')?.value || 'Directo',
    name: '',
    phone
  };

  const timestamp = new Date().toLocaleString('es-VE');
  const summary = `[Llamada ${timestamp} | ${pageCallSeconds}s]: ${outcomeText}.${argsText} ${notes}${cbDate ? ` | Rellamada: ${new Date(cbDate).toLocaleString('es-VE')}` : ''}`;

  // 1. Guardar en LocalStorage
  const history = JSON.parse(localStorage.getItem('jjp_call_history_v1') || '[]');
  history.unshift({
    id: 'call_' + Date.now(),
    phone,
    company: target.company,
    name: target.name,
    duration_seconds: pageCallSeconds,
    outcome: outcomeCode,
    outcome_text: outcomeText,
    arguments: activeArgs,
    notes,
    callback_at: cbDate,
    created_at: new Date().toISOString()
  });
  localStorage.setItem('jjp_call_history_v1', JSON.stringify(history.slice(0, 300)));

  if (hasCallback && cbDate) {
    const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]');
    callbacks.unshift({
      id: 'cb_' + Date.now(),
      targetId: target.id,
      phone,
      company: target.company,
      name: target.name,
      callback_at: cbDate,
      reason: cbReason || outcomeText
    });
    localStorage.setItem('jjp_callbacks_agenda_v1', JSON.stringify(callbacks.slice(0, 200)));
  }

  // 2. Guardar en Supabase si está enlazado a un prospecto
  try {
    if (target.id && typeof sb !== 'undefined') {
      const { data: p } = await sb.from('jjp_prospects').select('notes, contact_count').eq('id', target.id).single();
      const currentNotes = (p && p.notes) ? p.notes : '';
      const updateData = {
        notes: currentNotes ? `${summary}\n${currentNotes}` : summary,
        status: outcomeCode === 'interesado' ? 'interesado' : (outcomeCode === 'cotizacion' ? 'cotizacion_solicitada' : 'contactado_llamada'),
        contacted: true,
        contact_count: ((p && p.contact_count) || 0) + 1,
        last_contact_at: new Date().toISOString(),
        last_contact_channel: 'llamada_headset'
      };
      if (cbDate) updateData.scheduled_callback_at = new Date(cbDate).toISOString();
      await sb.from('jjp_prospects').update(updateData).eq('id', target.id);
    }
  } catch (e) {
    console.warn('Error sincronizando con Supabase:', e);
  }

  if (typeof showToast === 'function') {
    showToast(`✅ Llamada de ${pageCallSeconds}s guardada exitosamente.`);
  }

  // Reset y refresco
  loadCallbacksList();
  loadCallHistory();
  document.getElementById('pageCallNotes').value = '';
}

// 7. Renderizado de Agenda e Historial
function loadCallbacksList() {
  const container = document.getElementById('pageCallbacksList');
  if (!container) return;

  const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]');
  if (!callbacks.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;font-size:12px">No hay rellamadas agendadas pendientes.</div>';
    return;
  }

  const now = new Date();
  container.innerHTML = callbacks.map(cb => {
    let badge = '🟢 Programada';
    let badgeColor = '#15803d';
    let badgeBg = '#dcfce7';

    if (cb.callback_at) {
      const d = new Date(cb.callback_at);
      if (d < now) { badge = '🔴 Vencida'; badgeColor = '#b91c1c'; badgeBg = '#fee2e2'; }
      else if (d.toDateString() === now.toDateString()) { badge = '🟡 Para Hoy'; badgeColor = '#b45309'; badgeBg = '#fef3c7'; }
    }

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:12.5px;color:#0f172a">${escapeHTML(cb.company)} <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor};font-weight:800">${badge}</span></div>
          <div style="font-size:11px;color:#64748b">📞 <strong>${escapeHTML(cb.phone)}</strong> · ⏰ ${cb.callback_at ? new Date(cb.callback_at).toLocaleString('es-VE') : ''}</div>
          ${cb.reason ? `<div style="font-size:10.5px;color:#0369a1;margin-top:2px"><em>${escapeHTML(cb.reason)}</em></div>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-p sm" onclick="loadCustomerToDialer('${escapeHTML(cb.phone)}', '${escapeHTML(cb.company)}', '${escapeHTML(cb.name)}', '${cb.targetId || ''}')" style="background:#059669;padding:4px 8px;font-size:11px;font-weight:800">📞 Marcar</button>
          <button type="button" class="btn-g sm" onclick="deleteCallback('${cb.id}')" style="padding:4px 6px;font-size:11px">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function loadCallHistory() {
  const container = document.getElementById('pageHistoryList');
  if (!container) return;

  const history = JSON.parse(localStorage.getItem('jjp_call_history_v1') || '[]');
  if (!history.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;font-size:12px">No hay llamadas registradas hoy.</div>';
    return;
  }

  container.innerHTML = history.slice(0, 15).map(h => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="font-weight:700;font-size:12px;color:#0f172a">${escapeHTML(h.company || 'Directo')} (${escapeHTML(h.phone)})</span>
        <span style="font-size:11px;font-weight:800;color:#0284c7">${h.duration_seconds}s</span>
      </div>
      <div style="font-size:11px;color:#16a34a;font-weight:700">${escapeHTML(h.outcome_text || 'Llamada')}</div>
      ${h.notes ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${escapeHTML(h.notes)}</div>` : ''}
      <div style="font-size:10px;color:#94a3b8;margin-top:4px">${new Date(h.created_at).toLocaleTimeString('es-VE')}</div>
    </div>
  `).join('');
}

function loadCustomerToDialer(phone, company, name, id) {
  document.getElementById('pageDialerInput').value = phone;
  onPageNumberChange(phone);
  setPageCallTarget({ id, company, name, phone, type: id ? 'prospect' : 'manual' });
  pageStartCall();
}

function deleteCallback(id) {
  const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]').filter(x => x.id !== id);
  localStorage.setItem('jjp_callbacks_agenda_v1', JSON.stringify(callbacks));
  loadCallbacksList();
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
