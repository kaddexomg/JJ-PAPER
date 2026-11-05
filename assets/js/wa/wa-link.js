/* ======================================================
   JJ Paper — CRM WhatsApp · vinculación de cuenta (QR / código)
   Habla con jjp_wa_sessions; el wa-server local ejecuta las acciones.
   ====================================================== */

let WA_SESSION = null;   // fila de jjp_wa_sessions del perfil activo
let _waLinkMe = null;
let _waLinkTargetName = null;

// Sondeo de respaldo inteligente: sondea activamente mientras el modal está abierto o conectando
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
  if (_waPollAttempts > 300) {
    console.warn('[wa-link] Sondeo pausado tras inactividad prolongada.');
    return;
  }

  // Sondeo cada 1.5s mientras conecta o espera escaneo de QR para reflejar el estado al instante
  const delay = isActivelyConnecting ? 1500 : 3500;
  _waPollInterval = setTimeout(async () => {
    await waLoadSession();
    scheduleNextPoll();
  }, delay);
}

async function waLinkInit(profileId) {
  _waLinkMe = profileId;
  await waLoadSession();

  // Suscripción de respaldo
  try {
    sb.channel('wa-link-' + profileId)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jjp_wa_sessions', filter: `profile_id=eq.${profileId}` },
        payload => {
          if (payload.new && payload.new.profile_id === _waLinkMe) {
            WA_SESSION = payload.new;
            waRenderLink();
          }
        })
      .subscribe();
  } catch (_) {}

  // Iniciar sondeo inicial controlado
  scheduleNextPoll();
}

async function waLoadSession() {
  if (!_waLinkMe) return;
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
  const st = WA_SESSION?.status || 'disconnected';
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
    const remaining = Math.max(1, 60 - (age % 60));
    const cdEl = document.getElementById('waQrCountdown');
    if (cdEl) cdEl.textContent = remaining + 's';
  }, 1000);
}

function waRenderLink() {
  waRenderChip();
  if (typeof waUpdateConnectionUI === 'function') waUpdateConnectionUI();
  const box = document.getElementById('waLinkBody');
  if (!box) return;

  if (!WA_SESSION) {
    box.innerHTML = `
      <div style="text-align:center;padding:16px 8px;">
        <p class="wa-link-note" style="margin-bottom:14px;color:#475569;">Esta cuenta está lista para vincularse con WhatsApp.</p>
        <button class="btn-p" onclick="waRequestConnect(true)" style="padding:10px 20px;font-size:14px;font-weight:600;">📷 Generar código QR</button>
      </div>`;
    return;
  }
  if (!WA_SESSION.enabled) {
    box.innerHTML = '<p class="wa-link-note" style="color:#b91c1c;padding:10px;background:#fef2f2;border-radius:6px;">⛔ Esta sesión de WhatsApp está deshabilitada en la administración. Actívala en el menú de sesiones.</p>';
    return;
  }

  const st = WA_SESSION.status || 'disconnected';
  let html = `<p class="wa-link-state" style="font-weight:700;font-size:14px;margin-bottom:10px;">${WA_SESSION_LABEL[st] || escapeHTML(st || '')}</p>`;

  // 1. Si la cuenta YA ESTÁ CONECTADA
  if (st === 'connected') {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <div style="padding:8px 0;">
        <p class="wa-link-note" style="font-size:13.5px;margin-bottom:6px;">
          Cuenta vinculada: <strong>${escapeHTML(WA_SESSION.wa_name || _waLinkTargetName || 'Vendedor')}</strong>
          · <strong>${escapeHTML(waPrettyPhone(WA_SESSION.wa_number || ''))}</strong>
        </p>
        <p class="wa-link-note" style="color:#16a34a;font-weight:600;margin-bottom:16px;">
          ✅ Sesión permanente y sincronizada en tiempo real 24/7.
        </p>
        <div style="text-align:center;margin-top:16px;">
          <button class="btn-o" onclick="waLogout()" style="color:#b91c1c;border-color:#fca5a5;padding:6px 14px;font-size:12px;">🔌 Desvincular esta cuenta</button>
        </div>
      </div>`;
  }
  // 2. Si hay un código QR listo para escanear
  else if (st === 'pending_qr' && WA_SESSION.qr_data) {
    waStartCountdown();
    const age = WA_SESSION.qr_updated_at 
      ? Math.max(0, Math.floor((Date.now() - new Date(WA_SESSION.qr_updated_at).getTime()) / 1000))
      : 0;
    const remaining = Math.max(1, 60 - (age % 60));
    html += `
      <div class="wa-qr-container" style="text-align:center;padding:8px 0;">
        <div class="wa-qr-box" style="display:inline-block;padding:12px;background:#fff;border-radius:12px;border:1.5px solid #e2e8f0;box-shadow:0 4px 14px rgba(0,0,0,0.07);">
          <img class="wa-qr" src="${WA_SESSION.qr_data}" alt="Código QR para vincular WhatsApp" style="width:260px;height:260px;display:block;margin:0 auto;image-rendering:pixelated;border-radius:4px;">
          <div class="wa-qr-timer-bar" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div class="wa-qr-timer-text" style="font-size:12px;color:#475569;display:flex;align-items:center;gap:6px;">
              <span class="wa-pulse-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;animation:waPulse 1.5s infinite;"></span>
              <span>Rotación activa · <strong id="waQrCountdown">${remaining}s</strong></span>
            </div>
            <button class="btn-o btn-sm" onclick="waRequestConnect(true)" title="Generar un código QR nuevo inmediatamente" style="font-size:11px;padding:4px 8px;">🔄 Renovar QR</button>
          </div>
        </div>
      </div>
      <ol class="wa-link-steps" style="margin:14px 0 10px 18px;font-size:13px;color:#334155;line-height:1.6;">
        <li>Abre WhatsApp en tu teléfono</li>
        <li>Toca <strong>Menú ⋮</strong> o <strong>Configuración</strong> → <strong>Dispositivos vinculados</strong></li>
        <li>Toca <strong>Vincular un dispositivo</strong> y apunta la cámara a este código</li>
      </ol>
      <p class="wa-link-note" style="text-align:center;font-size:11.5px;color:#64748b;margin-top:6px;">
        💡 El código se renueva automáticamente cada minuto sin interrumpir la espera.
      </p>`;
  }
  // 3. Emparejamiento por código numérico de 8 caracteres
  else if (st === 'pending_pairing' && WA_SESSION.pairing_code) {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <div style="text-align:center;padding:14px 0;">
        <div class="wa-pairing-code" style="font-size:28px;font-weight:800;letter-spacing:4px;color:#0f172a;background:#f8fafc;padding:12px 18px;border-radius:8px;display:inline-block;border:1.5px solid #cbd5e1;">${escapeHTML(WA_SESSION.pairing_code)}</div>
        <ol class="wa-link-steps" style="margin:16px 0 12px 18px;text-align:left;font-size:13px;color:#334155;line-height:1.6;">
          <li>Abre WhatsApp → <strong>Dispositivos vinculados</strong></li>
          <li>Toca <strong>Vincular un dispositivo</strong> → <strong>Vincular con el número de teléfono</strong></li>
          <li>Escribe este código de 8 dígitos en tu WhatsApp</li>
        </ol>
        <button class="btn-o btn-sm" onclick="waRequestConnect(true)" style="margin-top:8px;">📷 Cambiar a código QR</button>
      </div>`;
  }
  // 4. Conectando / Iniciando generación en VPS
  else if (st === 'starting') {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <div style="text-align:center;padding:24px 10px;">
        <div style="width:36px;height:36px;margin:0 auto 12px;border:3px solid #e2e8f0;border-top-color:#059669;border-radius:50%;animation:waSpin 0.9s linear infinite;"></div>
        <p style="font-weight:700;font-size:15px;margin-bottom:6px;color:#0f172a;">
          Generando código QR con WhatsApp…
        </p>
        <p class="wa-link-note" style="max-width:340px;margin:0 auto 16px;font-size:12.5px;color:#64748b;">
          El servidor VPS está negociando el canal seguro con WhatsApp. El código QR aparecerá en pantalla en unos instantes.
        </p>
        <button class="btn-o btn-sm" onclick="waRequestConnect(true)">🔄 Forzar regeneración</button>
      </div>`;
  }
  // 5. Reconectando enlace guardado
  else if (st === 'reconnecting') {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    html += `
      <div style="text-align:center;padding:20px 10px;">
        <div style="width:32px;height:32px;margin:0 auto 12px;border:3px solid #e2e8f0;border-top-color:#0284c7;border-radius:50%;animation:waSpin 0.9s linear infinite;"></div>
        <p style="font-weight:700;font-size:14px;margin-bottom:6px;color:#0f172a;">
          Reconectando con tu teléfono…
        </p>
        <p class="wa-link-note" style="max-width:320px;margin:0 auto 14px;font-size:12px;color:#64748b;">
          Reanudando enlace guardado con WhatsApp. Si tu teléfono cambió de sesión, pulsa para generar un código QR nuevo:
        </p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="btn-p btn-sm" onclick="waRequestConnect(true)">📷 Generar nuevo código QR</button>
          <button class="btn-o btn-sm" onclick="waLogout()">🔌 Desvincular</button>
        </div>
      </div>`;
  }
  // 6. Sin vincular / desconectado / error
  else {
    if (_waCountdownTimer) { clearInterval(_waCountdownTimer); _waCountdownTimer = null; }
    if (st === 'error' && WA_SESSION.last_error) {
      html += `<p class="wa-link-note" style="color:#b91c1c;background:#fef2f2;padding:8px 12px;border-radius:6px;border:1px solid #fecaca;margin-bottom:12px;font-size:12px;">⚠️ ${escapeHTML(WA_SESSION.last_error)}</p>`;
    } else {
      html += `<p class="wa-link-note" style="font-size:13px;margin-bottom:14px;color:#475569;">
        Esta cuenta no está vinculada. Pulsa el botón para generar el código QR y escanearlo con la aplicación de WhatsApp de tu teléfono.
      </p>`;
    }
    html += `
      <div class="wa-link-actions" style="text-align:center;padding:6px 0;">
        <button class="btn-p" onclick="waRequestConnect(true)" style="padding:10px 22px;font-size:14px;font-weight:600;">📷 Generar código QR</button>
        <div style="margin-top:10px;">
          <button class="btn-o btn-sm" onclick="waTogglePairing()" style="font-size:12px;">🔢 Vincular con número de teléfono (código numérico)</button>
        </div>
      </div>
      <div id="waPairingForm" style="display:none;margin-top:14px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;text-align:left;">
        <label class="fl" style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Número de teléfono a vincular</label>
        <div style="display:flex;gap:8px">
          <input class="fi" id="waPairPhone" placeholder="04121234567" style="max-width:200px">
          <button class="btn-p btn-sm" onclick="waRequestPairing()">Pedir código</button>
        </div>
      </div>`;
  }
  box.innerHTML = html;
}

async function _waAction(fields, okMsg) {
  if (!_waLinkMe) {
    showToast('Perfil no seleccionado', 'err');
    return false;
  }
  const payload = {
    ...fields,
    requested_at: new Date().toISOString(),
    enabled: true
  };
  // 1. Intentar update primero (respetando permisos RLS)
  let { data, error } = await sb.from('jjp_wa_sessions')
    .update(payload)
    .eq('profile_id', _waLinkMe)
    .select('profile_id');

  // 2. Si no había fila previa, insertar
  if (!error && (!data || data.length === 0)) {
    const resIns = await sb.from('jjp_wa_sessions').insert({
      profile_id: _waLinkMe,
      ...payload
    });
    error = resIns.error;
  }

  if (error) { showToast('No se pudo pedir la acción: ' + error.message, 'err'); return false; }
  if (okMsg) showToast(okMsg);
  return true;
}

async function waRequestConnect(forceNew = true) {
  if (WA_SESSION) {
    WA_SESSION.status = 'starting';
    WA_SESSION.qr_data = null;
    WA_SESSION.qr_updated_at = null;
    waRenderLink();
  }
  _waPollAttempts = 0;
  scheduleNextPoll();
  const payload = { requested_action: 'connect' };
  if (forceNew) payload.force_qr = true;
  await _waAction(payload, 'Generando código QR…');
}

function waTogglePairing() {
  const f = document.getElementById('waPairingForm');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function waRequestPairing() {
  const phone = normVePhone(document.getElementById('waPairPhone')?.value);
  if (phone.length !== 12) { showToast('Número inválido (ej: 04121234567)', 'warn'); return; }
  if (await _waAction({ requested_action: 'request_pairing', pairing_phone: phone }, 'Pidiendo código…')) {
    if (WA_SESSION) WA_SESSION.status = 'starting';
    waRenderLink();
    _waPollAttempts = 0;
    scheduleNextPoll();
  }
}

async function waLogout() {
  if (!confirm('¿Desvincular WhatsApp de esta cuenta? Tendrás que escanear el código QR de nuevo para reconectar.')) return;
  await _waAction({ requested_action: 'logout' }, 'Desvinculando…');
  if (WA_SESSION) {
    WA_SESSION.status = 'disconnected';
    WA_SESSION.wa_number = null;
    WA_SESSION.wa_name = null;
    WA_SESSION.qr_data = null;
    waRenderLink();
  }
}

// Modal de vinculación: acepta targetProfileId y targetName opcionales
function openWaLinkModal(targetProfileId, targetName) {
  if (targetProfileId) {
    _waLinkMe = targetProfileId;
    _waLinkTargetName = targetName;
  } else if (!_waLinkMe && typeof WA_ME !== 'undefined' && WA_ME?.id) {
    _waLinkMe = WA_ME.id;
    _waLinkTargetName = WA_ME.name;
  }

  const titleEl = document.getElementById('waLinkTitle');
  if (titleEl) {
    titleEl.textContent = _waLinkTargetName ? `🔗 Vincular WhatsApp: ${_waLinkTargetName}` : '🔗 Mi cuenta de WhatsApp';
  }

  if (typeof waOpenModal === 'function') waOpenModal('waLinkModal');
  else document.getElementById('waLinkModal')?.classList.add('op');

  _waPollAttempts = 0;
  waLoadSession().then(() => {
    scheduleNextPoll();
    // Si la sesión no está conectada, ni generando QR, generar de una vez
    if (WA_SESSION && WA_SESSION.status !== 'connected' && WA_SESSION.status !== 'pending_qr' && WA_SESSION.status !== 'starting') {
      waRequestConnect(true);
    }
  });
}

function closeWaLinkModal() {
  if (typeof waCloseModal === 'function') waCloseModal('waLinkModal');
  else document.getElementById('waLinkModal')?.classList.remove('op');
  // Al cerrar el modal de vinculación, si estábamos en el panel admin, restaurar _waLinkMe al usuario logueado
  if (typeof WA_ME !== 'undefined' && WA_ME?.id) {
    _waLinkMe = WA_ME.id;
    _waLinkTargetName = WA_ME.name;
  }
}
