/* ======================================================
   JJ Paper — CRM WhatsApp · vinculación de cuenta (QR / código)
   Habla con jjp_wa_sessions; el wa-server local ejecuta las acciones.
   ====================================================== */

let WA_SESSION = null;   // mi fila de jjp_wa_sessions
let _waLinkMe = null;

async function waLinkInit(profileId) {
  _waLinkMe = profileId;
  await waLoadSession();

  // Estado de la sesión en vivo (QR rota ~60s, el server reescribe la fila)
  sb.channel('wa-link-' + profileId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jjp_wa_sessions', filter: `profile_id=eq.${profileId}` },
      payload => { WA_SESSION = payload.new; waRenderLink(); })
    .subscribe();
}

async function waLoadSession() {
  const { data, error } = await sb.from('jjp_wa_sessions')
    .select('*').eq('profile_id', _waLinkMe).maybeSingle();
  if (error) { showToast('Error cargando sesión WhatsApp', 'err'); return; }
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

function waRenderLink() {
  waRenderChip();
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
    html += `
      <p class="wa-link-note">Cuenta vinculada: <strong>${escapeHTML(WA_SESSION.wa_name || '')}</strong>
      · ${escapeHTML(waPrettyPhone(WA_SESSION.wa_number || ''))}</p>
      <p class="wa-link-note">Los chats se sincronizan mientras el wa-server esté corriendo en la PC de la tienda.</p>
      <button class="btn-o" onclick="waLogout()">🔌 Desvincular esta cuenta</button>`;
  } else if (st === 'pending_qr' && WA_SESSION.qr_data) {
    html += `
      <img class="wa-qr" src="${WA_SESSION.qr_data}" alt="Código QR para vincular WhatsApp">
      <ol class="wa-link-steps">
        <li>Abre WhatsApp en tu teléfono</li>
        <li>Menú <strong>⋮</strong> → <strong>Dispositivos vinculados</strong></li>
        <li>Toca <strong>Vincular un dispositivo</strong> y escanea este código</li>
      </ol>
      <p class="wa-link-note">El QR se renueva solo cada minuto. No cierres esta ventana.</p>`;
  } else if (st === 'pending_pairing' && WA_SESSION.pairing_code) {
    html += `
      <div class="wa-pairing-code">${escapeHTML(WA_SESSION.pairing_code)}</div>
      <ol class="wa-link-steps">
        <li>Abre WhatsApp → <strong>Dispositivos vinculados</strong></li>
        <li><strong>Vincular un dispositivo</strong> → <strong>Vincular con el número de teléfono</strong></li>
        <li>Escribe este código</li>
      </ol>`;
  } else if (st === 'starting') {
    html += '<p class="wa-link-note">Conectando con WhatsApp…</p>';
  } else {
    if (st === 'disconnected') {
      html += '<p class="wa-link-note">La sesión está vinculada pero el puente no responde. Verifica que el <strong>wa-server</strong> esté corriendo en la PC de la tienda (npm start).</p>';
    }
    if (st === 'error' && WA_SESSION.last_error) {
      html += `<p class="wa-link-note">⚠️ ${escapeHTML(WA_SESSION.last_error)}</p>`;
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
  if (await _waAction({ requested_action: 'connect' }, 'Generando QR… (necesita el wa-server encendido)')) {
    WA_SESSION.status = 'starting'; waRenderLink();
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
