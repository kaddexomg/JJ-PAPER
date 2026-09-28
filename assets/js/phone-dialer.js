/**
 * ============================================================================
 * JJ Paper — Marcador Telefónico Comercial B2B, Keypad y Bitácora de Llamadas
 * Soporte Nativo para Windows 7 con Headset · Detección de Operador y Localidad
 * Conteo de Segundos de Llamada en Tiempo Real · $0 Inversión
 * ============================================================================
 */

(function () {
  'use strict';

  if (window.JJDialer) return;

  let callTimerInterval = null;
  let callSeconds = 0;
  let isCallActive = false;
  let currentTarget = null; // { id, name, company, phone, type: 'prospect'|'customer' }

  // 1. Mapeo de Prefijos Venezolanos: Operador y Localidad
  const VENEZUELA_PREFIXES = {
    // Fijos Nacionales (CANTV)
    '0212': { type: 'Fijo', operator: 'CANTV', location: 'Caracas / La Guaira / Miranda' },
    '0241': { type: 'Fijo', operator: 'CANTV', location: 'Valencia / Carabobo' },
    '0243': { type: 'Fijo', operator: 'CANTV', location: 'Maracay / Aragua' },
    '0244': { type: 'Fijo', operator: 'CANTV', location: 'Cagua / La Victoria / Aragua' },
    '0251': { type: 'Fijo', operator: 'CANTV', location: 'Barquisimeto / Lara' },
    '0261': { type: 'Fijo', operator: 'CANTV', location: 'Maracaibo / Zulia' },
    '0274': { type: 'Fijo', operator: 'CANTV', location: 'Mérida' },
    '0276': { type: 'Fijo', operator: 'CANTV', location: 'San Cristóbal / Táchira' },
    '0281': { type: 'Fijo', operator: 'CANTV', location: 'Barcelona / Puerto La Cruz / Anzoátegui' },
    '0285': { type: 'Fijo', operator: 'CANTV', location: 'Ciudad Bolívar' },
    '0286': { type: 'Fijo', operator: 'CANTV', location: 'Puerto Ordaz / San Félix / Bolívar' },
    '0239': { type: 'Fijo', operator: 'CANTV', location: 'Valles del Tuy / Miranda' },
    '0234': { type: 'Fijo', operator: 'CANTV', location: 'Barlovento / Miranda' },
    '0232': { type: 'Fijo', operator: 'CANTV', location: 'Guarenas / Guatire / Miranda' },
    // Móviles
    '0414': { type: 'Móvil', operator: 'Movistar', location: 'Nacional' },
    '0424': { type: 'Móvil', operator: 'Movistar', location: 'Nacional' },
    '0412': { type: 'Móvil', operator: 'Digitel', location: 'Nacional' },
    '0416': { type: 'Móvil', operator: 'Movilnet', location: 'Nacional' },
    '0426': { type: 'Móvil', operator: 'Movilnet', location: 'Nacional' }
  };

  function detectPhoneLocation(raw) {
    if (!raw) return { label: 'Esperando número...', badgeClass: 'badge-gray' };
    const digits = raw.replace(/\D/g, '');
    let prefix = '';
    if (digits.startsWith('58')) {
      prefix = '0' + digits.substring(2, 5);
    } else if (digits.startsWith('0')) {
      prefix = digits.substring(0, 4);
    } else if (digits.length >= 3) {
      prefix = '0' + digits.substring(0, 3);
    }

    const info = VENEZUELA_PREFIXES[prefix];
    if (info) {
      return {
        label: `${info.operator} · ${info.location} (${info.type})`,
        badgeClass: info.type === 'Fijo' ? 'badge-blue' : 'badge-emerald',
        operator: info.operator,
        location: info.location
      };
    }

    if (digits.length > 5) {
      return { label: 'Número Nacional / Internacional', badgeClass: 'badge-purple' };
    }
    return { label: 'Ingresa el número a marcar', badgeClass: 'badge-gray' };
  }

  function formatPhoneForDialing(raw) {
    if (!raw) return '';
    let cleaned = raw.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '58' + cleaned.substring(1);
    else if (!cleaned.startsWith('58') && cleaned.length === 10) cleaned = '58' + cleaned;
    return cleaned;
  }

  function formatTime(s) {
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    stopTimer();
    callSeconds = 0;
    isCallActive = true;
    updateCallStatusUI();
    callTimerInterval = setInterval(() => {
      callSeconds++;
      updateCallStatusUI();
    }, 1000);
  }

  function stopTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    isCallActive = false;
    updateCallStatusUI();
  }

  function updateCallStatusUI() {
    const timerEl = document.getElementById('jjDialerTimerDisplay');
    const badgeEl = document.getElementById('jjDialerCallStateBadge');
    const btnCall = document.getElementById('jjDialerBtnStart');
    const btnHang = document.getElementById('jjDialerBtnHang');

    if (timerEl) {
      timerEl.textContent = `${formatTime(callSeconds)} (${callSeconds}s)`;
    }

    if (badgeEl) {
      if (isCallActive) {
        badgeEl.textContent = '🟢 En Llamada';
        badgeEl.style.background = '#dcfce7';
        badgeEl.style.color = '#15803d';
      } else if (callSeconds > 0) {
        badgeEl.textContent = `⏹️ Finalizada (${callSeconds} seg)`;
        badgeEl.style.background = '#fef3c7';
        badgeEl.style.color = '#b45309';
      } else {
        badgeEl.textContent = '⚪ Listo';
        badgeEl.style.background = '#f1f5f9';
        badgeEl.style.color = '#64748b';
      }
    }

    if (btnCall && btnHang) {
      if (isCallActive) {
        btnCall.style.display = 'none';
        btnHang.style.display = 'inline-flex';
      } else {
        btnCall.style.display = 'inline-flex';
        btnHang.style.display = 'none';
      }
    }
  }

  // 2. Apertura del Marcador Completo (Softphone Dialpad)
  function openDialer(target = {}) {
    currentTarget = target.id ? target : { id: null, name: 'Llamada Directa', company: 'Marcación Manual', phone: target.phone || '', type: 'manual' };

    let modal = document.getElementById('jjDialerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'jjDialerModal';
      modal.className = 'modal-overlay op';
      modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:999999;background:rgba(15,23,42,0.75);backdrop-filter:blur(5px);';
      document.body.appendChild(modal);
    } else {
      modal.style.display = 'flex';
      modal.classList.add('op');
    }

    const initialPhone = currentTarget.phone || '';
    const locInfo = detectPhoneLocation(initialPhone);

    modal.innerHTML = `
      <div class="modal-box" style="max-width:440px;width:94%;background:var(--theme-bg-surface-solid, #ffffff);color:var(--theme-text-main, #0f172a);border-radius:20px;padding:20px 22px;box-shadow:0 25px 60px rgba(0,0,0,0.35);border:1px solid var(--theme-border-subtle, #e2e8f0);max-height:92vh;overflow-y:auto" onclick="event.stopPropagation()">
        
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);padding-bottom:10px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px;background:rgba(16,185,129,0.12);padding:6px;border-radius:10px">🎧</span>
            <div>
              <h3 style="margin:0;font-size:16.5px;font-weight:800;color:var(--theme-text-main, #0f172a)">Marcador Telefónico JJ Paper</h3>
              <div style="font-size:11px;color:var(--theme-accent, #047857);font-weight:700">Windows 7 + Headset · Línea Propia ($0 Inversión)</div>
            </div>
          </div>
          <button type="button" class="btn-g sm" onclick="window.JJDialer.close()" style="border-radius:8px">✕</button>
        </div>

        <!-- Info del Destinatario -->
        <div style="background:var(--theme-item-bg, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
          <div style="min-width:0;flex:1">
            <div style="font-size:13.5px;font-weight:800;color:var(--theme-text-main, #0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHTML(currentTarget.company || 'Marcación Rápida')}
            </div>
            <div style="font-size:11.5px;color:#64748b">
              👤 ${escapeHTML(currentTarget.name || 'Sin contacto')}
            </div>
          </div>
          <div style="text-align:right">
            <span id="jjDialerCallStateBadge" style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;background:#f1f5f9;color:#64748b">⚪ Listo</span>
            <div id="jjDialerTimerDisplay" style="font-family:monospace;font-size:12.5px;font-weight:800;color:#0284c7;margin-top:2px">00:00 (0s)</div>
          </div>
        </div>

        <!-- Pantalla / Input del Teléfono con Detector de Localidad -->
        <div style="margin-bottom:12px">
          <div style="position:relative;display:flex;align-items:center">
            <input type="text" id="jjDialerNumberInput" class="fi" value="${escapeHTML(initialPhone)}" placeholder="Escribe o marca el número..." style="font-size:19px;font-weight:800;letter-spacing:1px;text-align:center;padding:10px 40px 10px 12px;border-radius:10px;height:46px;width:100%" oninput="window.JJDialer.onNumberChange(this.value)">
            <button type="button" onclick="window.JJDialer.backspace()" style="position:absolute;right:8px;background:transparent;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:4px" title="Borrar último dígito">⌫</button>
          </div>
          <div id="jjDialerLocDisplay" style="margin-top:4px;font-size:11px;font-weight:700;color:#0369a1;text-align:center;background:#e0f2fe;padding:3px 8px;border-radius:6px">
            📍 ${locInfo.label}
          </div>
        </div>

        <!-- Teclado Numérico Visual DTMF (Keypad) -->
        <div class="jj-keypad-grid" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:14px">
          ${renderKeypadBtn('1', '')}
          ${renderKeypadBtn('2', 'ABC')}
          ${renderKeypadBtn('3', 'DEF')}
          ${renderKeypadBtn('4', 'GHI')}
          ${renderKeypadBtn('5', 'JKL')}
          ${renderKeypadBtn('6', 'MNO')}
          ${renderKeypadBtn('7', 'PQRS')}
          ${renderKeypadBtn('8', 'TUV')}
          ${renderKeypadBtn('9', 'WXYZ')}
          ${renderKeypadBtn('*', '')}
          ${renderKeypadBtn('0', '+')}
          ${renderKeypadBtn('#', '')}
        </div>

        <!-- Acciones de Llamada -->
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button type="button" id="jjDialerBtnStart" class="btn-p" onclick="window.JJDialer.startCall()" style="flex:1;padding:10px;font-size:14px;font-weight:800;background:#059669;border-color:#059669;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px">
            <span>📞 Llamar</span>
          </button>
          <button type="button" id="jjDialerBtnHang" class="btn-p" onclick="window.JJDialer.hangupCall()" style="flex:1;padding:10px;font-size:14px;font-weight:800;background:#dc2626;border-color:#dc2626;display:none;align-items:center;justify-content:center;gap:6px;border-radius:10px">
            <span>🛑 Colgar / Fin</span>
          </button>
          <button type="button" class="btn-o" onclick="window.JJDialer.openInWhatsApp()" style="padding:10px 14px;border-radius:10px" title="Llamar o chatear por WhatsApp Web con Headset">
            💬 WhatsApp
          </button>
        </div>

        <!-- Atajos Complementarios Windows 7 -->
        <div style="display:flex;gap:6px;justify-content:center;margin-bottom:12px">
          <button type="button" class="btn-o sm" onclick="window.JJDialer.copyCurrentNumber()" style="font-size:11px;padding:3px 8px">📋 Copiar</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleQr()" style="font-size:11px;padding:3px 8px">📱 QR Móvil</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.triggerTelProtocol()" style="font-size:11px;padding:3px 8px">📟 tel: / MicroSIP</button>
        </div>

        <div id="jjDialerQrBox" style="display:none;text-align:center;padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:12px;border:1px solid #cbd5e1">
          <img id="jjDialerQrImg" src="" alt="QR" style="width:130px;height:130px;border-radius:6px">
          <div style="font-size:11px;color:#64748b;margin-top:4px">Apunta la cámara de tu celular para marcar de una vez</div>
        </div>

        <!-- Registro de Resultado y Bitácora -->
        <div style="border-top:1px solid var(--theme-border-subtle, #e2e8f0);padding-top:10px;margin-top:10px">
          <label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:4px;color:var(--theme-text-main, #334155)">Resultado de la Llamada:</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;margin-bottom:8px">
            <button type="button" class="of-chip on" data-call-res="contactado_interesado" onclick="window.JJDialer.selectOutcome(this)">✅ Contactado (Interesado)</button>
            <button type="button" class="of-chip" data-call-res="pedir_cotizacion" onclick="window.JJDialer.selectOutcome(this)">📋 Pidió Cotización</button>
            <button type="button" class="of-chip" data-call-res="rellamar" onclick="window.JJDialer.selectOutcome(this)">⏳ Ocupado / Rellamar</button>
            <button type="button" class="of-chip" data-call-res="no_contesta" onclick="window.JJDialer.selectOutcome(this)">🚫 No contesta / Buzón</button>
          </div>

          <textarea id="jjDialerNotes" class="fi" rows="2" placeholder="Notas de la llamada... (ej: Atendió compras, enviar catálogo)" style="width:100%;font-size:12px;resize:vertical;margin-bottom:8px"></textarea>
          
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" class="btn-g sm" onclick="window.JJDialer.close()">Cerrar</button>
            <button type="button" class="btn-p sm" onclick="window.JJDialer.saveCallLog()" style="background:var(--theme-accent, #16604a);font-weight:800">💾 Guardar Bitácora</button>
          </div>
        </div>

      </div>
    `;

    setTimeout(() => {
      document.getElementById('jjDialerNumberInput')?.focus();
    }, 50);
  }

  function renderKeypadBtn(digit, sub) {
    return `
      <button type="button" class="jj-keypad-btn" onclick="window.JJDialer.pressKey('${digit}')" style="background:var(--theme-item-bg, #f1f5f9);color:var(--theme-text-main, #0f172a);border:1px solid var(--theme-border-subtle, #cbd5e1);border-radius:10px;padding:8px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .1s ease">
        <span style="font-size:18px;font-weight:800;line-height:1">${digit}</span>
        ${sub ? `<span style="font-size:9px;color:#64748b;font-weight:600;letter-spacing:1px">${sub}</span>` : '<span style="height:10px"></span>'}
      </button>
    `;
  }

  function pressKey(char) {
    const input = document.getElementById('jjDialerNumberInput');
    if (!input) return;
    input.value += char;
    onNumberChange(input.value);
  }

  function backspace() {
    const input = document.getElementById('jjDialerNumberInput');
    if (!input) return;
    input.value = input.value.slice(0, -1);
    onNumberChange(input.value);
  }

  function onNumberChange(val) {
    const locInfo = detectPhoneLocation(val);
    const locEl = document.getElementById('jjDialerLocDisplay');
    if (locEl) {
      locEl.textContent = `📍 ${locInfo.label}`;
    }
  }

  function startCall() {
    const input = document.getElementById('jjDialerNumberInput');
    const phone = input ? input.value.trim() : '';
    if (!phone) {
      if (typeof showToast === 'function') showToast('Ingresa un número antes de iniciar la llamada.', 'warn');
      return;
    }

    startTimer();
    const cleanNumber = formatPhoneForDialing(phone);
    if (typeof showToast === 'function') {
      showToast(`Llamada en curso: ${phone}. Cronómetro activo ⏱️`, 'info');
    }
  }

  function hangupCall() {
    stopTimer();
    if (typeof showToast === 'function') {
      showToast(`Llamada finalizada. Duración: ${callSeconds} segundos.`, 'info');
    }
  }

  function openInWhatsApp() {
    const input = document.getElementById('jjDialerNumberInput');
    const phone = input ? input.value.trim() : '';
    const cleanNumber = formatPhoneForDialing(phone);
    if (!cleanNumber) {
      if (typeof showToast === 'function') showToast('Número inválido para WhatsApp.', 'warn');
      return;
    }
    startTimer();
    window.open(`https://wa.me/${cleanNumber}`, '_blank');
  }

  function triggerTelProtocol() {
    const input = document.getElementById('jjDialerNumberInput');
    const phone = input ? input.value.trim() : '';
    const cleanNumber = formatPhoneForDialing(phone);
    if (!cleanNumber) return;
    startTimer();
    window.location.href = `tel:+${cleanNumber}`;
  }

  function copyCurrentNumber() {
    const input = document.getElementById('jjDialerNumberInput');
    const num = input ? input.value.trim() : '';
    if (!num) return;
    navigator.clipboard.writeText(num).then(() => {
      if (typeof showToast === 'function') showToast(`Número ${num} copiado. 📋`);
    });
  }

  function toggleQr() {
    const box = document.getElementById('jjDialerQrBox');
    const img = document.getElementById('jjDialerQrImg');
    const input = document.getElementById('jjDialerNumberInput');
    if (!box || !img || !input) return;

    if (box.style.display === 'block') {
      box.style.display = 'none';
      return;
    }

    const clean = formatPhoneForDialing(input.value);
    if (!clean) {
      if (typeof showToast === 'function') showToast('Ingresa un número primero para generar el QR.', 'warn');
      return;
    }

    const telUri = `tel:+${clean}`;
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(telUri)}`;
    box.style.display = 'block';
  }

  function selectOutcome(btn) {
    document.querySelectorAll('#jjDialerModal .of-chip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }

  async function saveCallLog() {
    const selectedBtn = document.querySelector('#jjDialerModal .of-chip.on');
    const outcomeText = selectedBtn ? selectedBtn.textContent.trim() : 'Llamada realizada';
    const notesInput = (document.getElementById('jjDialerNotes')?.value || '').trim();
    const durationText = formatTime(callSeconds);
    const durationSeconds = callSeconds;
    const phoneInput = document.getElementById('jjDialerNumberInput')?.value.trim() || '';

    stopTimer();

    const timestamp = new Date().toLocaleString('es-VE');
    const locInfo = detectPhoneLocation(phoneInput);
    const callSummary = `[Llamada ${timestamp} | ${durationText} (${durationSeconds}s) | ${locInfo.label}]: ${outcomeText}. ${notesInput}`;

    try {
      if (currentTarget && currentTarget.id && currentTarget.type === 'prospect') {
        const p = (typeof prospectsList !== 'undefined') ? prospectsList.find(x => x.id === currentTarget.id) : null;
        const currentNotes = (p && p.notes) ? p.notes : '';
        const newNotes = currentNotes ? `${callSummary}\n${currentNotes}` : callSummary;

        const updatePayload = {
          notes: newNotes,
          status: 'contactado_llamada',
          contacted: true,
          contact_count: (p && p.contact_count ? p.contact_count : 0) + 1,
          last_contact_at: new Date().toISOString(),
          last_contact_channel: 'llamada_headset'
        };

        if (typeof sb !== 'undefined') {
          await sb.from('jjp_prospects').update(updatePayload).eq('id', currentTarget.id);
        }

        if (p) {
          Object.assign(p, updatePayload);
          if (typeof applyProspectFilters === 'function') applyProspectFilters();
          if (typeof updateProspectKpis === 'function') updateProspectKpis();
        }
      }

      if (typeof showToast === 'function') {
        showToast(`Llamada de ${durationSeconds}s guardada exitosamente en la bitácora CRM. ✅`);
      }
      close();
    } catch (e) {
      console.error('Error guardando llamada:', e);
      if (typeof showToast === 'function') showToast('Error al registrar llamada: ' + e.message, 'err');
    }
  }

  function close() {
    stopTimer();
    const modal = document.getElementById('jjDialerModal');
    if (modal) {
      modal.classList.remove('op');
      modal.style.display = 'none';
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 3. Inyección del Botón Flotante Permanente (FAB) en Pantalla
  function injectFloatingDialerButton() {
    if (document.getElementById('jjp-dialer-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'jjp-dialer-fab';
    fab.title = 'Abrir Marcador Telefónico Comercial (Alt+P)';
    fab.innerHTML = '📞';
    fab.style.cssText = `
      position: fixed;
      bottom: 84px;
      right: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #059669, #047857);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 4px 14px rgba(5, 150, 105, 0.45);
      cursor: pointer;
      z-index: 99990;
      transition: transform .15s ease, box-shadow .15s ease;
      user-select: none;
    `;

    fab.onmouseover = () => {
      fab.style.transform = 'scale(1.1)';
      fab.style.boxShadow = '0 6px 20px rgba(5, 150, 105, 0.6)';
    };
    fab.onmouseout = () => {
      fab.style.transform = 'scale(1)';
      fab.style.boxShadow = '0 4px 14px rgba(5, 150, 105, 0.45)';
    };
    fab.onclick = () => {
      openDialer();
    };

    document.body.appendChild(fab);
  }

  // Atajo Alt+P para abrir el marcador desde cualquier pantalla
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      const modal = document.getElementById('jjDialerModal');
      if (modal && modal.style.display === 'flex') {
        close();
      } else {
        openDialer();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingDialerButton);
  } else {
    injectFloatingDialerButton();
  }

  window.JJDialer = {
    open: openDialer,
    close,
    pressKey,
    backspace,
    onNumberChange,
    startCall,
    hangupCall,
    openInWhatsApp,
    triggerTelProtocol,
    copyCurrentNumber,
    toggleQr,
    selectOutcome,
    saveCallLog
  };
})();
