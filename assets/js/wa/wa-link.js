/* ======================================================
   JJ Paper — CRM WhatsApp · vinculación de cuenta (QR / código)
   Habla con jjp_wa_sessions; el wa-server local ejecuta las acciones.
   ====================================================== */

let WA_SESSION = null;   // mi fila de jjp_wa_sessions
let _waLinkMe = null;

// Sondeo de respaldo inteligente: solo sondea si la ventana está activa, con retroceso y límite máximo
let _waPollAttempts = 0;
let _waPollInterval = null;

function scheduleNextPoll() {
  if (_waPollInterval) clearTimeout(_waPollInterval);
  const modal = document.getElementById('waLinkModal');
  const isModalOpen = modal?.classList.contains('op') || modal?.style?.display === 'block';
  const isActivelyConnecting = WA_SESSION?.status === 'starting' || WA_SESSION?.status === 'pending_qr' || WA_SESSION?.status === 'reconnecting';

  if (!isModalOpen && !isActivelyConnecting) {
    _waPollAttempts = 0;
    return;
  }

  _waPollAttempts++;
  // Si ya pasaron más de 15 intentos (~2 minutos) sin respuesta, pausar el sondeo
  if (_waPollAttempts > 15) {
    console.warn('[wa-link] Sondeo pausado: el servidor no responde tras múltiples intentos.');
    return;
  }

  // Intervalo progresivo: 3s los primeros 5 intentos, luego 10s
  const delay = _waPollAttempts <= 5 ? 3000 : 10000;
  _waPollInterval = setTimeout(async () => {
    await waLoadSession();
    scheduleNextPoll();
  }, delay);
}

async function waLinkInit(profileId) {
  _waLinkMe = profileId;
  await waLoadSession();

  // Estado de la sesión en vivo (QR rota ~60s, el server reescribe la fila)
  sb.channel('wa-link-' + profileId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_wa_sessions', filter: `profile_id=eq.${profileId}` },
      payload => { WA_SESSION = payload.new; waRenderLink(); })
    .subscribe();

  // Iniciar sondeo inicial controlado
  scheduleNextPoll();
}

async function waLoadSession() {
  const { data, error } = await sb.from('jjp_wa_sessions')
    .select('*').eq('profile_id', _waLinkMe).maybeSingle();
  if (error) { return; }
  WA_SESSION = data;
  waRenderLink();
}

function waSessionConnected() { return WA_SESSION?.status === 'connected'; }

// Chip de estado en el topbar
function waRenderChip() {
  const chip = document.getElementById('waStatusChip');
  if (!chip) return;
  const st = WA_SESSION?.status || 'logged_out';
  chip.textContent = WA_SESSION?.enabled === false ? WA_SESSION_LABEL.disabled
    : (WA_SESSION_LABEL[st] || st);
  chip.className = 'wa-chip' + (st === 'connected' ? ' ok' : '');
}

let _waCountdownTimer = null;

function waStartCountdown() {
  if (_waCountdownTimer) clearInterval(_waCountdownTimer);
  _waCountdownTimer = setInterval(() => {
    if (WA_SESSION?.status !== 'pending_qr' || !WA_SESSION?.qr_data) {
      clearInterval(_waCountdownTimer);
      _waCountdownTimer = null;
      return;
    }
    const age = WA_SESSION.qr_updated_at 
      ? Math.max(0, Math.floor((Date.now() - new Date(WA_SESSION.qr_updated_at).getTime()) / 1000))
      : 0;
    const remaining = Math.max(0, 60 - age);
    const cdEl = document.getElementById('waQrCountdown');
    if (cdEl) cdEl.textContent = remaining + 's';
    
    // Si ya superó los 65s, refrescar la interfaz para mostrar el estado de caducidad
    if (age > 65) {
      clearInterval(_waCountdownTimer);
      _waCountdownTimer = null;
      waRenderLink();
    }
  }, 1000);
}

function waRenderLink() {
  waRenderChip();
  if (typeof waUpdateConnectionUI === 'function') waUpdateConnectionUI();
  const box = document.getElementById('waLinkBody');
  if (!box) return;

  if (!WA_SESSION) {
    box.innerHTML = '<p class="wa-link-note">No tienes sesión de WhatsApp creada. Pide al administrador que la habilite.</p>';
    return;
  }
  if (!WA_SESSION.enabled) {
    box.innerHTML = '<p class="wa-link-note">⛔ Tu sesión de WhatsApp está deshabilitada. Pide al administrador que la active en el panel.</p>';
    return;
  }

  const st = WA_SESSION.status;
  let html = `<p class="wa-link-state">${WA_SESSION_LABEL[st] || escapeHTML(st || '')}</p>`;

  if (st === 'connected') {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <p class="wa-link-note">Cuenta vinculada: <strong>${escapeHTML(WA_SESSION.wa_name || '')}</strong>
      · ${escapeHTML(waPrettyPhone(WA_SESSION.wa_number || ''))}</p>
      <p class="wa-link-note">Los chats se sincronizan mientras el wa-server esté corriendo en la PC de la tienda.</p>
      <button class="btn-o" onclick="waLogout()">🔌 Desvincular esta cuenta</button>`;
  } else if (st === 'pending_qr' && WA_SESSION.qr_data) {
    const age = WA_SESSION.qr_updated_at 
      ? Math.max(0, Math.floor((Date.now() - new Date(WA_SESSION.qr_updated_at).getTime()) / 1000))
      : 0;
    const isExpired = age > 65;

    if (isExpired) {
      if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
      html += `
        <div class="wa-qr-container">
          <div class="wa-qr-box expired">
            <img class="wa-qr blurred" src="${WA_SESSION.qr_data}" alt="Código QR caducado">
            <div class="wa-qr-overlay">
              <div class="wa-qr-overlay-icon">⌛</div>
              <div class="wa-qr-overlay-title">Código QR caducado</div>
              <div class="wa-qr-overlay-desc">El código expiró por seguridad. Haz clic abajo para generar uno nuevo.</div>
              <button class="btn-p btn-sm" onclick="waRequestConnect()">🔄 Generar nuevo código QR</button>
            </div>
          </div>
        </div>`;
    } else {
      waStartCountdown();
      const remaining = Math.max(1, 60 - age);
      html += `
        <div class="wa-qr-container">
          <div class="wa-qr-box">
            <img class="wa-qr" src="${WA_SESSION.qr_data}" alt="Código QR para vincular WhatsApp">
            <div class="wa-qr-timer-bar">
              <div class="wa-qr-timer-text">
                <span class="wa-pulse-dot"></span>
                <span>Expira en <strong id="waQrCountdown">${remaining}s</strong></span>
              </div>
              <button class="btn-o btn-sm" onclick="waRequestConnect()" title="Haz clic para generar un código QR nuevo inmediatamente">🔄 Recargar QR</button>
            </div>
          </div>
        </div>
        <ol class="wa-link-steps">
          <li>Abre WhatsApp en tu teléfono</li>
          <li>Menú <strong>⋮</strong> o <strong>Configuración</strong> → <strong>Dispositivos vinculados</strong></li>
          <li>Toca <strong>Vincular un dispositivo</strong> y escanea este código</li>
        </ol>
        <p class="wa-link-note" style="text-align:center;font-size:12px;">Se renueva automáticamente si no se escanea a tiempo.</p>`;
    }
  } else if (st === 'pending_pairing' && WA_SESSION.pairing_code) {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <div class="wa-pairing-code">${escapeHTML(WA_SESSION.pairing_code)}</div>
      <ol class="wa-link-steps">
        <li>Abre WhatsApp → <strong>Dispositivos vinculados</strong></li>
        <li><strong>Vincular un dispositivo</strong> → <strong>Vincular con el número de teléfono</strong></li>
        <li>Escribe este código</li>
      </ol>
      <div style="text-align:center;margin-top:10px;">
        <button class="btn-o btn-sm" onclick="waRequestConnect()">📷 Volver a código QR</button>
      </div>`;
  } else if (st === 'starting' || st === 'reconnecting') {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    const isReconn = st === 'reconnecting';
    html += `
      <div style="text-align:center;padding:20px 10px;">
        <div style="width:34px;height:34px;margin:0 auto 12px;border:3px solid #e2e8f0;border-top-color:var(--gd);border-radius:50%;animation:waSpin 0.9s linear infinite;"></div>
        <p style="font-weight:700;font-size:15px;margin-bottom:6px;color:var(--bk);">
          ${isReconn ? 'Reconectando con WhatsApp…' : 'Conectando con WhatsApp…'}
        </p>
        <p class="wa-link-note" style="max-width:320px;margin:0 auto 14px;">
          ${isReconn ? 'Consolidando la sesión recién escaneada con WhatsApp. Espera un momento.' : 'Generando credenciales compatibles y preparando el código QR…'}
        </p>
        <button class="btn-o btn-sm" onclick="waRequestConnect()">🔄 Reintentar generación</button>
      </div>`;
  } else {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    if (st === 'disconnected') {
      html += '<p class="wa-link-note">La sesión está desconectada o el puente se reinició. Puedes generar un nuevo código QR cuando estés listo.</p>';
    }
    if (st === 'error' && WA_SESSION.last_error) {
      html += `<p class="wa-link-note" style="color:#b91c1c;background:#fef2f2;padding:8px 12px;border-radius:6px;border:1px solid #fecaca;">⚠️ ${escapeHTML(WA_SESSION.last_error)}</p>`;
    }
    html += `
      <div class="wa-link-actions">
        <button class="btn-p" onclick="waRequestConnect()">📷 Generar código QR</button>
        <button class="btn-o" onclick="waTogglePairing()">🔢 Usar código en su lugar</button>
      </div>
      <div id="waPairingForm" style="display:none;margin-top:12px">
        <label class="fl">Número del WhatsApp a vincular</label>
        <div style="display:flex;gap:8px">
          <input class="fi" id="waPairPhone" placeholder="04121234567" style="max-width:200px">
          <button class="btn-p" onclick="waRequestPairing()">Pedir código</button>
        </div>
      </div>`;
  }
  box.innerHTML = html;
}

async function _waAction(fields, okMsg) {
  const { error } = await sb.from('jjp_wa_sessions')
    .update({ ...fields, requested_at: new Date().toISOString() })
    .eq('profile_id', _waLinkMe);
  if (error) { showToast('No se pudo pedir la acción: ' + error.message, 'err'); return false; }
  if (okMsg) showToast(okMsg);
  return true;
}

async function waRequestConnect() {
  if (WA_SESSION) {
    WA_SESSION.status = 'starting';
    WA_SESSION.qr_data = null;
    WA_SESSION.qr_updated_at = null;
    waRenderLink();
  }
  if (typeof scheduleNextPoll === 'function') {
    _waPollAttempts = 0;
    scheduleNextPoll();
  }
  if (await _waAction({ requested_action: 'connect' }, 'Generando código QR…')) {
    // el servidor procesará la acción y emitirá el nuevo QR
  }
}

function waTogglePairing() {
  const f = document.getElementById('waPairingForm');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function waRequestPairing() {
  const phone = normVePhone(document.getElementById('waPairPhone')?.value);
  if (phone.length !== 12) { showToast('Número inválido (ej: 04121234567)', 'warn'); return; }
  if (await _waAction({ requested_action: 'request_pairing', pairing_phone: phone }, 'Pidiendo código…')) {
    WA_SESSION.status = 'starting'; waRenderLink();
  }
}

async function waLogout() {
  if (!confirm('¿Desvincular tu WhatsApp del CRM? Tendrás que escanear el QR de nuevo para reconectar.')) return;
  await _waAction({ requested_action: 'logout' }, 'Desvinculando…');
}

// Modal de vinculación (waOpenModal/waCloseModal liberan la trampa de foco:
// si no, al cerrar el modal el foco quedaba dentro y no se podía escribir)
function openWaLinkModal() {
  if (typeof waOpenModal === 'function') waOpenModal('waLinkModal');
  else document.getElementById('waLinkModal')?.classList.add('op');
  waRenderLink();
}
function closeWaLinkModal() {
  if (typeof waCloseModal === 'function') waCloseModal('waLinkModal');
  else document.getElementById('waLinkModal')?.classList.remove('op');
}
