/**
 * ============================================================================
 * JJ Paper — Marcador Telefónico Comercial B2B, Keypad y Bitácora de Llamadas
 * Soporte Nativo para Windows 7 con Headset · Detección de Operador y Localidad
 * Conteo de Segundos de Llamada en Tiempo Real · Puente GSM Móvil USB · $0 Inversión
 * Tipificador B2B Completo · Argumentario y Agenda de Rellamadas Persistente
 * ============================================================================
 */

(function () {
  'use strict';

  if (window.JJDialer) return;

  let callTimerInterval = null;
  let callSeconds = 0;
  let isCallActive = false;
  let currentTarget = null; // { id, name, company, phone, type: 'prospect'|'customer' }
  let gsmBridgeStatus = { connected: false, running: false, model: '', serial: '', adb: false };
  let gsmPollInterval = null;
  let activeTab = 'dialer'; // 'dialer' | 'disposition' | 'callbacks'

  // Claves de persistencia local anti-fallos
  const STORAGE_CALLBACKS_KEY = 'jjp_callbacks_agenda_v1';
  const STORAGE_CALL_HISTORY_KEY = 'jjp_call_history_v1';

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
    if (!raw) return { label: 'Esperando número...', badgeClass: 'badge-gray', operator: 'Desconocido', location: 'Nacional' };
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
      return { label: 'Número Nacional / Internacional', badgeClass: 'badge-purple', operator: 'Nacional', location: 'Venezuela' };
    }
    return { label: 'Ingresa el número a marcar', badgeClass: 'badge-gray', operator: 'Desconocido', location: 'Nacional' };
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
    window.JJPhoneAudio?.playConnected();
    callSeconds = 0;
    isCallActive = true;
    updateCallStatusUI();
    callTimerInterval = setInterval(() => {
      callSeconds++;
      updateCallStatusUI();
    }, 1000);
  }

  function stopTimer() {
    window.JJPhoneAudio?.stopRingback();
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

  // 2. Comunicación con el Puente GSM USB
  async function checkBridgeStatus() {
    const bridgeBanner = document.getElementById('jjDialerBridgeBanner');
    const bridgeStatusText = document.getElementById('jjDialerBridgeText');

    try {
      // 1. Probar en puerto nativo 8789
      let res = await fetch('http://127.0.0.1:8789/status', { mode: 'cors' }).catch(() => null);
      // 2. Si no, probar a través del proxy de wa-server
      if (!res || !res.ok) {
        res = await fetch('/lan/gsm/status').catch(() => null);
      }

      if (res && res.ok) {
        const data = await res.json();
        gsmBridgeStatus = {
          connected: !!data.connected,
          running: true,
          model: data.model || 'Android',
          serial: data.serial || '',
          adb: !!data.adb_installed,
          callState: data.call_state || 0
        };

        // Si el celular contestó (call_state === 2), arrancar cronómetro
        if (data.call_state === 2 && !isCallActive) {
          startTimer();
        }
        // Si el celular colgó (call_state === 0 tras estar activa), terminar
        if (data.call_state === 0 && isCallActive && callSeconds > 2) {
          hangupCall();
        }

        if (bridgeBanner && bridgeStatusText) {
          if (gsmBridgeStatus.connected) {
            bridgeBanner.style.background = '#ecfdf5';
            bridgeBanner.style.borderColor = '#a7f3d0';
            bridgeStatusText.innerHTML = `🟢 <strong>Móvil USB Conectado:</strong> ${escapeHTML(gsmBridgeStatus.model)} (SIM Lista)`;
            bridgeStatusText.style.color = '#065f46';
          } else if (gsmBridgeStatus.adb) {
            bridgeBanner.style.background = '#fffbeb';
            bridgeBanner.style.borderColor = '#fde68a';
            bridgeStatusText.innerHTML = `🟡 <strong>Cable USB:</strong> Conecta tu celular y activa "Depuración USB".`;
            bridgeStatusText.style.color = '#92400e';
          } else {
            bridgeBanner.style.background = '#f8fafc';
            bridgeBanner.style.borderColor = '#e2e8f0';
            bridgeStatusText.innerHTML = `⚪ <strong>Puente GSM Activo:</strong> Esperando dispositivo móvil...`;
            bridgeStatusText.style.color = '#475569';
          }
        }
        return;
      }
    } catch (_) {}

    gsmBridgeStatus = { connected: false, running: false, model: '', serial: '', adb: false };
    if (bridgeBanner && bridgeStatusText) {
      bridgeBanner.style.background = '#f8fafc';
      bridgeBanner.style.borderColor = '#e2e8f0';
      bridgeStatusText.innerHTML = `⚪ <strong>Modo Directo / Headset:</strong> Inicia <code>iniciar-puente-gsm.bat</code> para marcar automáticamente por USB.`;
      bridgeStatusText.style.color = '#64748b';
    }
  }

  // 3. Gestor de Rellamadas Agendadas
  function getStoredCallbacks() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_CALLBACKS_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveStoredCallback(cb) {
    try {
      const list = getStoredCallbacks();
      // Si ya existe con el mismo target ID o teléfono, actualizar
      const idx = list.findIndex(x => (cb.targetId && x.targetId === cb.targetId) || (x.phone === cb.phone && cb.phone));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...cb, updated_at: new Date().toISOString() };
      } else {
        list.unshift({ ...cb, created_at: new Date().toISOString() });
      }
      localStorage.setItem(STORAGE_CALLBACKS_KEY, JSON.stringify(list.slice(0, 200)));
    } catch (e) {
      console.warn('Error guardando rellamada en storage:', e);
    }
  }

  function removeStoredCallback(callbackId) {
    try {
      const list = getStoredCallbacks().filter(x => x.id !== callbackId);
      localStorage.setItem(STORAGE_CALLBACKS_KEY, JSON.stringify(list));
      renderCallbacksTab();
    } catch (_) {}
  }

  // 4. Apertura del Marcador Completo (Softphone Dialpad)
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

    renderModalContent();

    setTimeout(() => {
      document.getElementById('jjDialerNumberInput')?.focus();
    }, 50);

    checkBridgeStatus();
    if (!gsmPollInterval) {
      gsmPollInterval = setInterval(checkBridgeStatus, 4000);
    }
  }

  function switchTab(tabName) {
    activeTab = tabName;
    renderModalContent();
  }

  function renderModalContent() {
    const modal = document.getElementById('jjDialerModal');
    if (!modal) return;

    const initialPhone = currentTarget.phone || '';
    const locInfo = detectPhoneLocation(initialPhone);
    const callbacks = getStoredCallbacks();
    const pendingCount = callbacks.length;

    modal.innerHTML = `
      <div class="modal-box" style="max-width:500px;width:95%;background:var(--theme-bg-surface-solid, #ffffff);color:var(--theme-text-main, #0f172a);border-radius:20px;padding:18px 22px;box-shadow:0 25px 60px rgba(0,0,0,0.35);border:1px solid var(--theme-border-subtle, #e2e8f0);max-height:94vh;overflow-y:auto" onclick="event.stopPropagation()">
        
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);padding-bottom:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:24px;background:rgba(16,185,129,0.12);padding:6px;border-radius:10px">🎧</span>
            <div>
              <h3 style="margin:0;font-size:16.5px;font-weight:800;color:var(--theme-text-main, #0f172a)">Marcador Telefónico JJ Paper</h3>
              <div style="font-size:11px;color:var(--theme-accent, #047857);font-weight:700">Windows 7 + Headset · USB Directo (Sin WiFi) · $0 Inversión</div>
            </div>
          </div>
          <button type="button" class="btn-g sm" onclick="window.JJDialer.close()" style="border-radius:8px">✕</button>
        </div>

        <!-- Pestañas de Navegación del Marcador -->
        <div style="display:flex;gap:6px;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:8px">
          <button type="button" class="btn-o sm ${activeTab === 'dialer' ? 'on' : ''}" onclick="window.JJDialer.switchTab('dialer')" style="font-weight:700;font-size:12px;border-radius:8px;${activeTab === 'dialer' ? 'background:#10b981;color:#fff;border-color:#10b981' : ''}">
            ⌨️ Marcador
          </button>
          <button type="button" class="btn-o sm ${activeTab === 'disposition' ? 'on' : ''}" onclick="window.JJDialer.switchTab('disposition')" style="font-weight:700;font-size:12px;border-radius:8px;${activeTab === 'disposition' ? 'background:#10b981;color:#fff;border-color:#10b981' : ''}">
            📋 Tipificador & Agenda
          </button>
          <button type="button" class="btn-o sm ${activeTab === 'callbacks' ? 'on' : ''}" onclick="window.JJDialer.switchTab('callbacks')" style="font-weight:700;font-size:12px;border-radius:8px;${activeTab === 'callbacks' ? 'background:#10b981;color:#fff;border-color:#10b981' : ''}">
            ⏰ Rellamadas (${pendingCount})
          </button>
        </div>

        <!-- Barra de Estado del Puente USB -->
        <div id="jjDialerBridgeBanner" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:11.5px;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span id="jjDialerBridgeText" style="flex:1;color:#64748b">⚪ Verificando conexión USB...</span>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.checkBridge()" style="font-size:10.5px;padding:2px 7px" title="Reintentar conexión con celular USB">🔄 Probar</button>
        </div>

        <!-- Info del Destinatario y Cronómetro en Vivo -->
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
            <span id="jjDialerCallStateBadge" style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;background:#f1f5f9;color:#64748b">
              ${isCallActive ? '🟢 En Llamada' : (callSeconds > 0 ? `⏹️ Finalizada (${callSeconds}s)` : '⚪ Listo')}
            </span>
            <div id="jjDialerTimerDisplay" style="font-family:monospace;font-size:12.5px;font-weight:800;color:#0284c7;margin-top:2px">
              ${formatTime(callSeconds)} (${callSeconds}s)
            </div>
          </div>
        </div>

        <!-- CONTENIDO SEGÚN PESTAÑA ACTIVA -->
        ${activeTab === 'dialer' ? renderDialerTabHtml(initialPhone, locInfo) : ''}
        ${activeTab === 'disposition' ? renderDispositionTabHtml() : ''}
        ${activeTab === 'callbacks' ? renderCallbacksTabHtml(callbacks) : ''}

      </div>
    `;

    updateCallStatusUI();
  }

  // 4.1 Pestaña 1: Marcador Numérico DTMF
  function renderDialerTabHtml(initialPhone, locInfo) {
    return `
      <!-- Pantalla / Input del Teléfono con Detector de Localidad -->
      <div style="margin-bottom:10px">
        <div style="position:relative;display:flex;align-items:center">
          <input type="text" id="jjDialerNumberInput" class="fi" value="${escapeHTML(initialPhone)}" placeholder="Escribe o marca el número..." style="font-size:19px;font-weight:800;letter-spacing:1px;text-align:center;padding:10px 40px 10px 12px;border-radius:10px;height:46px;width:100%" oninput="window.JJDialer.onNumberChange(this.value)">
          <button type="button" onclick="window.JJDialer.backspace()" style="position:absolute;right:8px;background:transparent;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:4px" title="Borrar último dígito">⌫</button>
        </div>
        <div id="jjDialerLocDisplay" style="margin-top:4px;font-size:11px;font-weight:700;color:#0369a1;text-align:center;background:#e0f2fe;padding:3px 8px;border-radius:6px">
          📍 ${locInfo.label}
        </div>
      </div>

      <!-- Teclado Numérico Visual DTMF (Keypad) -->
      <div class="jj-keypad-grid" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:7px;margin-bottom:12px">
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
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button type="button" id="jjDialerBtnStart" class="btn-p" onclick="window.JJDialer.startCall()" style="flex:1;padding:11px;font-size:14px;font-weight:800;background:#059669;border-color:#059669;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px">
          <span>📞 Llamar</span>
        </button>
        <button type="button" id="jjDialerBtnHang" class="btn-p" onclick="window.JJDialer.hangupCall()" style="flex:1;padding:11px;font-size:14px;font-weight:800;background:#dc2626;border-color:#dc2626;display:none;align-items:center;justify-content:center;gap:6px;border-radius:10px">
          <span>🛑 Colgar / Fin</span>
        </button>
        <button type="button" class="btn-o" onclick="window.JJDialer.openInWhatsApp()" style="padding:10px 14px;border-radius:10px" title="Llamar o chatear por WhatsApp Web con Headset">
          💬 WhatsApp
        </button>
        <button type="button" class="btn-o" onclick="window.JJDialer.switchTab('disposition')" style="padding:10px 12px;border-radius:10px;font-weight:700" title="Ir a tipificar y agendar rellamada">
          📋 Tipificar
        </button>
      </div>

      <!-- Atajos Complementarios Windows 7 -->
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:10px">
        <button type="button" class="btn-o sm" onclick="window.JJDialer.copyCurrentNumber()" style="font-size:11px;padding:3px 8px">📋 Copiar</button>
        <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleQr()" style="font-size:11px;padding:3px 8px">📱 QR Móvil</button>
        <button type="button" class="btn-o sm" onclick="window.JJDialer.triggerTelProtocol()" style="font-size:11px;padding:3px 8px">📟 tel: / SIP</button>
        <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleAudioGuide()" style="font-size:11px;padding:3px 8px">🎧 Audio ($0)</button>
      </div>

      <!-- Guía Desplegable de Audio para Windows 7 ($0 Inversión) -->
      <div id="jjDialerAudioGuide" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:11px;color:#166534">
        <div style="font-weight:800;margin-bottom:4px;font-size:12px">🎧 ¿Cómo hablar y escuchar desde tu Headset en Windows 7 ($0 Inversión)?</div>
        <ul style="margin:0;padding-left:16px;line-height:1.5">
          <li><strong>Opción A (Recomendada):</strong> Conecta tu celular por USB. El sistema marca y cuelga con 1 clic. Usa el altavoz/manos libres del celular en el escritorio mientras tomas notas en pantalla.</li>
          <li><strong>Opción B (Cable 3.5mm Auxiliar):</strong> Conecta un cable jack de audio del celular a la entrada azul (Line-In) de la PC. En Windows 7 activa "Escuchar este dispositivo" y escucharás al cliente en tu Headset con nitidez perfecta sin WiFi ni datos.</li>
          <li><strong>Opción C (WhatsApp Web):</strong> Llama gratis por WhatsApp desde el navegador usando el micrófono y auriculares de la PC.</li>
        </ul>
      </div>

      <div id="jjDialerQrBox" style="display:none;text-align:center;padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:10px;border:1px solid #cbd5e1">
        <img id="jjDialerQrImg" src="" alt="QR" style="width:130px;height:130px;border-radius:6px">
        <div style="font-size:11px;color:#64748b;margin-top:4px">Apunta la cámara de tu celular para marcar de una vez</div>
      </div>
    `;
  }

  // 4.2 Pestaña 2: Tipificador B2B, Argumentario y Agendamiento
  function renderDispositionTabHtml() {
    return `
      <div style="border-top:1px solid var(--theme-border-subtle, #e2e8f0);padding-top:10px">
        
        <!-- 1. Tipificación / Resultado Principal -->
        <label style="font-size:11.5px;font-weight:800;display:block;margin-bottom:5px;color:var(--theme-text-main, #334155)">
          1. Tipificación de la Llamada:
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px;margin-bottom:12px">
          <button type="button" class="of-chip on" data-call-res="interesado" onclick="window.JJDialer.selectOutcome(this)">✅ Interesado / Venta</button>
          <button type="button" class="of-chip" data-call-res="cotizacion" onclick="window.JJDialer.selectOutcome(this)">📋 Pidió Cotización</button>
          <button type="button" class="of-chip" data-call-res="rellamar" onclick="window.JJDialer.selectOutcome(this)">⏳ Agendar Rellamada</button>
          <button type="button" class="of-chip" data-call-res="encargado" onclick="window.JJDialer.selectOutcome(this)">👤 Hablar con Encargado</button>
          <button type="button" class="of-chip" data-call-res="no_contesta" onclick="window.JJDialer.selectOutcome(this)">🚫 No Contesta / Buzón</button>
          <button type="button" class="of-chip" data-call-res="no_interesa" onclick="window.JJDialer.selectOutcome(this)">❌ No le Interesa</button>
          <button type="button" class="of-chip" data-call-res="equivocado" onclick="window.JJDialer.selectOutcome(this)">⚠️ Número Equivocado</button>
        </div>

        <!-- 2. Argumentario / Objeción del Cliente -->
        <label style="font-size:11.5px;font-weight:800;display:block;margin-bottom:5px;color:var(--theme-text-main, #334155)">
          2. Argumento / Situación del Cliente:
        </label>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Pide descuento o mejor precio por bulto" style="font-size:10.5px;padding:3px 7px">🏷️ Pide descuento / mejor precio</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Solicita crédito a 15 o 30 días" style="font-size:10.5px;padding:3px 7px">💳 Pide crédito (15/30 días)</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Tiene suficiente inventario por ahora" style="font-size:10.5px;padding:3px 7px">📦 Tiene stock por ahora</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Pide enviar catálogo por WhatsApp" style="font-size:10.5px;padding:3px 7px">📲 Enviar catálogo por WA</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Pide cotización formal por correo" style="font-size:10.5px;padding:3px 7px">📧 Enviar lista por Correo</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="El encargado solo atiende en la mañana" style="font-size:10.5px;padding:3px 7px">⏰ Atiende solo en la mañana</button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.toggleArgumentChip(this)" data-arg="Consulta condiciones de despacho y flete" style="font-size:10.5px;padding:3px 7px">🚚 Pregunta por despacho/flete</button>
        </div>

        <!-- 3. Agendamiento de Rellamada (Fecha y Hora) -->
        <div id="jjDialerScheduleBox" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px;padding:10px;margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:11.5px;font-weight:800;color:#0f172a">⏰ Agendar Próxima Llamada:</span>
            <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer">
              <input type="checkbox" id="jjDialerEnableCallback" checked onchange="document.getElementById('jjDialerCallbackFields').style.display = this.checked ? 'block' : 'none'">
              Activar agenda
            </label>
          </div>

          <div id="jjDialerCallbackFields">
            <!-- Botones de Atajo Rápido -->
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
              <button type="button" class="btn-o sm" onclick="window.JJDialer.setCallbackPreset('2h')" style="font-size:10px;padding:2px 6px">+2 Horas</button>
              <button type="button" class="btn-o sm" onclick="window.JJDialer.setCallbackPreset('tomorrow_am')" style="font-size:10px;padding:2px 6px">Mañana 9:00 AM</button>
              <button type="button" class="btn-o sm" onclick="window.JJDialer.setCallbackPreset('tomorrow_pm')" style="font-size:10px;padding:2px 6px">Mañana 2:30 PM</button>
              <button type="button" class="btn-o sm" onclick="window.JJDialer.setCallbackPreset('2d')" style="font-size:10px;padding:2px 6px">En 2 Días</button>
              <button type="button" class="btn-o sm" onclick="window.JJDialer.setCallbackPreset('next_week')" style="font-size:10px;padding:2px 6px">Próxima Semana</button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
              <div>
                <label style="font-size:10.5px;color:#64748b;display:block">Fecha y Hora:</label>
                <input type="datetime-local" id="jjDialerCallbackDateTime" class="fi" style="font-size:11.5px;padding:4px 6px;height:32px;width:100%">
              </div>
              <div>
                <label style="font-size:10.5px;color:#64748b;display:block">Motivo de Rellamada:</label>
                <input type="text" id="jjDialerCallbackReason" class="fi" placeholder="Ej: Confirmar cotización..." style="font-size:11.5px;padding:4px 6px;height:32px;width:100%">
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Notas Adicionales -->
        <label style="font-size:11.5px;font-weight:800;display:block;margin-bottom:4px;color:var(--theme-text-main, #334155)">Notas de la Conversación:</label>
        <textarea id="jjDialerNotes" class="fi" rows="2" placeholder="Detalles de lo conversado... (ej: Atendió compras, enviar cotización formal de resmas y bandejas)" style="width:100%;font-size:12px;resize:vertical;margin-bottom:10px"></textarea>
        
        <!-- Botones de Guardar -->
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <button type="button" class="btn-g sm" onclick="window.JJDialer.switchTab('dialer')">← Volver al Marcador</button>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn-g sm" onclick="window.JJDialer.close()">Cerrar</button>
            <button type="button" class="btn-p sm" onclick="window.JJDialer.saveCallLog()" style="background:var(--theme-accent, #16604a);font-weight:800;padding:6px 14px">
              💾 Guardar y Registrar Llamada
            </button>
          </div>
        </div>

      </div>
    `;
  }

  // 4.3 Pestaña 3: Agenda de Rellamadas
  function renderCallbacksTabHtml(callbacks) {
    if (!callbacks || callbacks.length === 0) {
      return `
        <div style="text-align:center;padding:30px 10px;color:#64748b">
          <div style="font-size:32px;margin-bottom:6px">📅</div>
          <div style="font-weight:700;font-size:13px;color:#0f172a">No hay rellamadas agendadas pendientes</div>
          <div style="font-size:11.5px;margin-top:4px">Cuando tipifiques una llamada con "Agendar Rellamada", aparecerá aquí para marcar con 1 clic.</div>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.switchTab('dialer')" style="margin-top:12px">← Ir al Marcador</button>
        </div>
      `;
    }

    const now = new Date();
    const rows = callbacks.map(cb => {
      let badge = '🟢 Programada';
      let badgeBg = '#dcfce7';
      let badgeColor = '#15803d';

      if (cb.callback_at) {
        const cbDate = new Date(cb.callback_at);
        if (cbDate < now) {
          badge = '🔴 Vencida';
          badgeBg = '#fee2e2';
          badgeColor = '#b91c1c';
        } else if (cbDate.toDateString() === now.toDateString()) {
          badge = '🟡 Para Hoy';
          badgeBg = '#fef3c7';
          badgeColor = '#b45309';
        }
      }

      const formattedDate = cb.callback_at ? new Date(cb.callback_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin fecha';

      return `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
              <span style="font-weight:800;font-size:12.5px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${escapeHTML(cb.company || 'Empresa')}
              </span>
              <span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor}">
                ${badge}
              </span>
            </div>
            <div style="font-size:11px;color:#64748b">
              👤 ${escapeHTML(cb.name || 'Sin contacto')} · 📞 <strong>${escapeHTML(cb.phone || '')}</strong>
            </div>
            <div style="font-size:10.5px;color:#0369a1;margin-top:2px">
              ⏰ ${formattedDate} ${cb.reason ? `· <em>${escapeHTML(cb.reason)}</em>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn-p sm" onclick="window.JJDialer.dialScheduledCustomer('${escapeHTML(cb.phone)}', '${escapeHTML(cb.company)}', '${escapeHTML(cb.name)}', '${cb.targetId || ''}')" style="background:#059669;padding:4px 8px;font-size:11px;font-weight:800" title="Cargar y marcar">
              📞 Marcar
            </button>
            <button type="button" class="btn-g sm" onclick="window.JJDialer.deleteScheduledCallback('${cb.id}')" style="padding:4px 6px;font-size:11px" title="Completada / Eliminar de agenda">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="max-height:360px;overflow-y:auto;padding-right:4px">
        ${rows}
      </div>
      <div style="margin-top:10px;display:flex;justify-content:space-between">
        <button type="button" class="btn-o sm" onclick="window.JJDialer.switchTab('dialer')">← Volver al Marcador</button>
        <button type="button" class="btn-g sm" onclick="window.JJDialer.close()">Cerrar</button>
      </div>
    `;
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
    window.JJPhoneAudio?.playDtmf(char);
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

  function toggleArgumentChip(btn) {
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

  function setCallbackPreset(preset) {
    const dtInput = document.getElementById('jjDialerCallbackDateTime');
    if (!dtInput) return;

    const targetDate = new Date();
    if (preset === '2h') {
      targetDate.setHours(targetDate.getHours() + 2);
    } else if (preset === 'tomorrow_am') {
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

    // Formato para input datetime-local: YYYY-MM-DDTHH:mm
    const pad = n => String(n).padStart(2, '0');
    const formatted = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}T${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}`;
    dtInput.value = formatted;
  }

  async function startCall() {
    const input = document.getElementById('jjDialerNumberInput');
    const phone = input ? input.value.trim() : '';
    if (!phone) {
      if (typeof showToast === 'function') showToast('Ingresa un número antes de iniciar la llamada.', 'warn');
      return;
    }

    const cleanNumber = formatPhoneForDialing(phone);
    const badgeEl = document.getElementById('jjDialerCallStateBadge');
    const btnCall = document.getElementById('jjDialerBtnStart');
    const btnHang = document.getElementById('jjDialerBtnHang');

    if (badgeEl) {
      badgeEl.textContent = '🟡 Marcando...';
      badgeEl.style.background = '#fef3c7';
      badgeEl.style.color = '#b45309';
    }
    if (btnCall) btnCall.style.display = 'none';
    if (btnHang) btnHang.style.display = 'inline-flex';

    // Iniciar Tono de Timbrado en Headset
    window.JJPhoneAudio?.startRingback();

    // Si el puente USB está activo, disparar la marcación real en el celular
    if (gsmBridgeStatus.connected) {
      try {
        let res = await fetch('http://127.0.0.1:8789/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: cleanNumber })
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch('/lan/gsm/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: cleanNumber })
          }).catch(() => null);
        }

        if (res && res.ok) {
          const d = await res.json();
          if (d.requires_manual_tap) {
            if (typeof showToast === 'function') {
              showToast('📲 Número colocado en tu teléfono. Toca el botón verde en tu celular para hablar.', 'info');
            }
          } else {
            if (typeof showToast === 'function') {
              showToast(`📲 Marcando ${phone} desde tu celular por USB... ¡Habla desde tu Headset!`, 'info');
            }
          }
          return;
        }
      } catch (e) {
        console.warn('Error llamando vía puente GSM local:', e);
      }
    }

    // Fallback remoto a Supabase si estamos en Cloudflare Pages (HTTPS) o servidor en otra PC
    if (typeof sb !== 'undefined') {
      try {
        await sb.from('jjp_server_control').update({
          command: 'call:' + cleanNumber,
          command_at: new Date().toISOString()
        }).eq('id', 1);

        if (typeof showToast === 'function') {
          showToast(`📲 Comando enviado al servidor GSM... Marcando ${phone}. ¡Habla desde tu Headset!`, 'info');
        }
        return;
      } catch (_) {}
    }

    // Si no hay puente o es llamada manual, arrancar cronómetro
    startTimer();
    if (typeof showToast === 'function') {
      showToast(`Llamada en curso: ${phone}. Cronómetro activo ⏱️`, 'info');
    }
  }

  async function hangupCall() {
    window.JJPhoneAudio?.playEnded();
    stopTimer();

    try {
      await fetch('http://127.0.0.1:8789/hangup', { method: 'POST' }).catch(() => null);
      await fetch('/lan/gsm/hangup', { method: 'POST' }).catch(() => null);
    } catch (_) {}

    if (typeof sb !== 'undefined') {
      try {
        await sb.from('jjp_server_control').update({
          command: 'hangup',
          command_at: new Date().toISOString()
        }).eq('id', 1);
      } catch (_) {}
    }

    if (typeof showToast === 'function') {
      showToast(`Llamada finalizada. Duración: ${callSeconds} segundos.`, 'info');
    }

    // Conmutar automáticamente a la pestaña de tipificación para registrar argumentos y agendar
    switchTab('disposition');
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

  function toggleAudioGuide() {
    const g = document.getElementById('jjDialerAudioGuide');
    if (g) {
      g.style.display = g.style.display === 'block' ? 'none' : 'block';
    }
  }

  function selectOutcome(btn) {
    document.querySelectorAll('#jjDialerModal .of-chip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    
    // Si seleccionó rellamar o encargado, enfocar la caja de agenda
    const code = btn.dataset.callRes;
    const chk = document.getElementById('jjDialerEnableCallback');
    if (chk) {
      if (code === 'rellamar' || code === 'encargado' || code === 'cotizacion') {
        chk.checked = true;
        document.getElementById('jjDialerCallbackFields').style.display = 'block';
        if (!document.getElementById('jjDialerCallbackDateTime').value) {
          setCallbackPreset(code === 'cotizacion' ? '2d' : 'tomorrow_am');
        }
      }
    }
  }

  function dialScheduledCustomer(phone, company, name, targetId) {
    currentTarget = {
      id: targetId || null,
      company: company || 'Cliente Agendado',
      name: name || '',
      phone: phone || '',
      type: targetId ? 'prospect' : 'manual'
    };
    switchTab('dialer');
    setTimeout(() => {
      startCall();
    }, 150);
  }

  // 5. Guardado y Persistencia Anti-Fallos
  async function saveCallLog() {
    const selectedBtn = document.querySelector('#jjDialerModal .of-chip.on');
    const outcomeCode = selectedBtn ? selectedBtn.dataset.callRes : 'interesado';
    const outcomeText = selectedBtn ? selectedBtn.textContent.trim() : 'Llamada realizada';
    const notesInput = (document.getElementById('jjDialerNotes')?.value || '').trim();
    const durationText = formatTime(callSeconds);
    const durationSeconds = callSeconds;
    const phoneInput = document.getElementById('jjDialerNumberInput')?.value.trim() || currentTarget.phone || '';

    // Recoger chips de argumentos seleccionados
    const activeArgChips = document.querySelectorAll('#jjDialerModal [data-arg].on');
    const selectedArgs = Array.from(activeArgChips).map(c => c.dataset.arg);
    const argsSummary = selectedArgs.length > 0 ? ` [Argumentos: ${selectedArgs.join('; ')}]` : '';

    // Verificar si se agendó rellamada
    const hasCallback = document.getElementById('jjDialerEnableCallback')?.checked;
    const callbackDateTime = hasCallback ? document.getElementById('jjDialerCallbackDateTime')?.value : null;
    const callbackReason = hasCallback ? (document.getElementById('jjDialerCallbackReason')?.value || '').trim() : '';

    stopTimer();

    const timestamp = new Date().toLocaleString('es-VE');
    const locInfo = detectPhoneLocation(phoneInput);
    const callSummary = `[Llamada ${timestamp} | ${durationText} (${durationSeconds}s) | ${locInfo.label}]: ${outcomeText}.${argsSummary} ${notesInput}${callbackDateTime ? ` | Próxima Rellamada: ${new Date(callbackDateTime).toLocaleString('es-VE')}` : ''}`;

    // 1. Persistencia Inmediata en LocalStorage (Zero Data Loss)
    try {
      const history = JSON.parse(localStorage.getItem(STORAGE_CALL_HISTORY_KEY) || '[]');
      history.unshift({
        id: 'call_' + Date.now(),
        phone: phoneInput,
        company: currentTarget.company || 'Directo',
        name: currentTarget.name || '',
        duration_seconds: durationSeconds,
        outcome: outcomeCode,
        outcome_text: outcomeText,
        arguments: selectedArgs,
        notes: notesInput,
        callback_at: callbackDateTime,
        created_at: new Date().toISOString()
      });
      localStorage.setItem(STORAGE_CALL_HISTORY_KEY, JSON.stringify(history.slice(0, 300)));

      if (hasCallback && callbackDateTime) {
        saveStoredCallback({
          id: 'cb_' + Date.now(),
          targetId: currentTarget.id,
          phone: phoneInput,
          company: currentTarget.company || 'Cliente',
          name: currentTarget.name || '',
          callback_at: callbackDateTime,
          reason: callbackReason || outcomeText
        });
      }
    } catch (e) {
      console.warn('Error guardando en almacenamiento local:', e);
    }

    // 2. Persistencia en Base de Datos de Supabase (Core)
    try {
      if (currentTarget && currentTarget.id && currentTarget.type === 'prospect') {
        const p = (typeof prospectsList !== 'undefined') ? prospectsList.find(x => x.id === currentTarget.id) : null;
        const currentNotes = (p && p.notes) ? p.notes : '';
        const newNotes = currentNotes ? `${callSummary}\n${currentNotes}` : callSummary;

        // Mapear código de tipificación a estado del prospecto
        let newStatus = 'contactado_llamada';
        if (outcomeCode === 'interesado') newStatus = 'interesado';
        else if (outcomeCode === 'cotizacion') newStatus = 'cotizacion_solicitada';
        else if (outcomeCode === 'rellamar') newStatus = 'rellamar';
        else if (outcomeCode === 'no_contesta') newStatus = 'no_contesta';
        else if (outcomeCode === 'no_interesa') newStatus = 'no_interesa';
        else if (outcomeCode === 'equivocado') newStatus = 'equivocado';

        const updatePayload = {
          notes: newNotes,
          status: newStatus,
          contacted: true,
          contact_count: (p && p.contact_count ? p.contact_count : 0) + 1,
          last_contact_at: new Date().toISOString(),
          last_contact_channel: 'llamada_headset'
        };

        if (callbackDateTime) {
          updatePayload.scheduled_callback_at = new Date(callbackDateTime).toISOString();
        }

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
        showToast(`Llamada de ${durationSeconds}s tipificada exitosamente como "${outcomeText}". ✅`);
      }
      close();
    } catch (e) {
      console.error('Error guardando llamada:', e);
      if (typeof showToast === 'function') showToast('Registrado localmente (alerta en BD: ' + e.message + ')', 'warn');
      close();
    }
  }

  function close() {
    stopTimer();
    if (gsmPollInterval) {
      clearInterval(gsmPollInterval);
      gsmPollInterval = null;
    }
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

  // 6. Inyección del Botón Flotante Permanente (Pill Button Alt+P)
  function injectFloatingDialerButton() {
    if (document.getElementById('jjp-dialer-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'jjp-dialer-fab';
    fab.title = 'Abrir Marcador Telefónico Comercial con Headset (Alt+P)';
    fab.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:#34d399;display:inline-block;box-shadow:0 0 8px #34d399"></span>
      <span style="font-size:13.5px;font-weight:800;letter-spacing:0.3px;white-space:nowrap">📞 Marcador (Alt+P)</span>
    `;
    fab.style.cssText = `
      position: fixed;
      bottom: 84px;
      right: 20px;
      padding: 10px 18px;
      border-radius: 30px;
      background: linear-gradient(135deg, #059669, #047857);
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 9px;
      box-shadow: 0 6px 22px rgba(5, 150, 105, 0.5);
      border: 1.5px solid #34d399;
      cursor: pointer;
      z-index: 999999;
      transition: all .2s ease;
      user-select: none;
      font-family: inherit;
    `;

    fab.onmouseover = () => {
      fab.style.transform = 'translateY(-2px) scale(1.04)';
      fab.style.boxShadow = '0 8px 26px rgba(5, 150, 105, 0.65)';
    };
    fab.onmouseout = () => {
      fab.style.transform = 'none';
      fab.style.boxShadow = '0 6px 22px rgba(5, 150, 105, 0.5)';
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

  // --------------------------------------------------------------------------
  // WIDGET FLOTANTE GLOBAL DE LLAMADA ACTIVA (PERSISTE EN TODAS LAS PÁGINAS)
  // --------------------------------------------------------------------------
  let globalCallWidgetTimer = null;

  function initGlobalCallWidget() {
    if (globalCallWidgetTimer) clearInterval(globalCallWidgetTimer);
    globalCallWidgetTimer = setInterval(updateGlobalCallWidget, 1000);
    updateGlobalCallWidget();
  }

  function updateGlobalCallWidget() {
    const isCallPage = window.location.pathname.includes('llamadas.html');
    let session = null;
    try {
      const raw = localStorage.getItem('jjp_active_call_session');
      if (raw) session = JSON.parse(raw);
    } catch (_) {}

    const widget = document.getElementById('jjFloatingCallWidget');

    // Si no hay llamada o estamos en la centralita completa de llamadas.html, ocultar widget
    if (!session || !session.is_active || isCallPage) {
      if (widget) widget.style.display = 'none';
      return;
    }

    const elapsed = Math.floor((Date.now() - session.started_at) / 1000);
    if (elapsed > 3600) {
      // Expirar sesión si supera 1 hora
      localStorage.removeItem('jjp_active_call_session');
      if (widget) widget.style.display = 'none';
      return;
    }

    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    const compName = session.company ? (session.company.length > 20 ? session.company.slice(0, 18) + '...' : session.company) : (session.phone || 'Cliente');

    if (!widget) {
      const el = document.createElement('div');
      el.id = 'jjFloatingCallWidget';
      el.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 9999999;
        background: linear-gradient(135deg, #0f172a, #1e293b);
        color: #ffffff;
        border-radius: 30px;
        padding: 9px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        border: 2px solid #10b981;
        font-family: system-ui, -apple-system, sans-serif;
        user-select: none;
      `;
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 10px #10b981"></span>
          <div>
            <div style="font-size:12px;font-weight:800;color:#ffffff;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="floatingWidgetCompany">${escapeHTML(compName)}</div>
            <div style="font-size:11px;font-family:monospace;color:#34d399;font-weight:700" id="floatingWidgetTimer">${mins}:${secs} (${elapsed}s)</div>
          </div>
        </div>
        <button type="button" onclick="window.JJDialer.openFullCallCenter()" style="background:#0284c7;color:#fff;border:none;border-radius:20px;padding:6px 12px;font-size:11.5px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          📋 Tipificar
        </button>
        <button type="button" onclick="window.JJDialer.hangupFromFloatingWidget()" style="background:#dc2626;color:#fff;border:none;border-radius:20px;padding:6px 10px;font-size:11.5px;font-weight:800;cursor:pointer" title="Colgar llamada">
          🛑 Colgar
        </button>
      `;
      document.body.appendChild(el);
    } else {
      widget.style.display = 'flex';
      const compEl = document.getElementById('floatingWidgetCompany');
      const timeEl = document.getElementById('floatingWidgetTimer');
      if (compEl) compEl.textContent = compName;
      if (timeEl) timeEl.textContent = `${mins}:${secs} (${elapsed}s)`;
    }
  }

  function openFullCallCenter() {
    const isAdmin = window.location.pathname.includes('/admin/');
    const path = isAdmin ? 'llamadas.html' : '../vendedor/llamadas.html';
    window.location.href = path;
  }

  async function hangupFromFloatingWidget() {
    window.JJPhoneAudio?.playEnded();
    localStorage.removeItem('jjp_active_call_session');
    const widget = document.getElementById('jjFloatingCallWidget');
    if (widget) widget.style.display = 'none';

    try {
      await fetch('http://127.0.0.1:8789/hangup', { method: 'POST' }).catch(() => null);
      await fetch('/lan/gsm/hangup', { method: 'POST' }).catch(() => null);
    } catch (_) {}

    if (typeof sb !== 'undefined') {
      try {
        await sb.from('jjp_server_control').update({
          command: 'hangup',
          command_at: new Date().toISOString()
        }).eq('id', 1);
      } catch (_) {}
    }

    if (typeof showToast === 'function') {
      showToast('Llamada finalizada desde el widget.', 'info');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalCallWidget);
  } else {
    initGlobalCallWidget();
  }

  window.JJDialer = {
    open: openDialer,
    close,
    switchTab,
    pressKey,
    backspace,
    onNumberChange,
    toggleArgumentChip,
    setCallbackPreset,
    startCall,
    hangupCall,
    openInWhatsApp,
    triggerTelProtocol,
    copyCurrentNumber,
    toggleQr,
    toggleAudioGuide,
    selectOutcome,
    dialScheduledCustomer,
    deleteScheduledCallback: removeStoredCallback,
    saveCallLog,
    checkBridge: checkBridgeStatus,
    detectPhoneLocation,
    formatPhoneForDialing,
    openFullCallCenter,
    hangupFromFloatingWidget
  };
})();
