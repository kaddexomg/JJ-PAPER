/**
 * ============================================================================
 * JJ Paper — Marcador Telefónico y Bitácora de Llamadas B2B ($0 Inversión)
 * Utiliza Headset de la PC + Enlace Móvil de Windows / WhatsApp Call
 * Cero costo telefónico, registro instantáneo en CRM y sincronización en vivo.
 * ============================================================================
 */

(function () {
  'use strict';

  if (window.JJDialer) return;

  let callTimerInterval = null;
  let callSeconds = 0;
  let currentTarget = null; // { id, name, company, phone, type: 'prospect'|'customer' }

  function formatPhoneForDialing(raw) {
    if (!raw) return '';
    let cleaned = raw.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '58' + cleaned.substring(1);
    else if (!cleaned.startsWith('58') && cleaned.length === 10) cleaned = '58' + cleaned;
    return cleaned;
  }

  function formatTime(s) {
    const mins = Math.floor(s / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function startTimer() {
    stopTimer();
    callSeconds = 0;
    const el = document.getElementById('jjDialerTimer');
    if (el) el.textContent = '00:00';
    callTimerInterval = setInterval(() => {
      callSeconds++;
      if (el) el.textContent = formatTime(callSeconds);
    }, 1000);
  }

  function stopTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
  }

  function openDialer({ id, name, company, phone, type = 'prospect' }) {
    currentTarget = { id, name, company, phone, type };
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

    const cleanNumber = formatPhoneForDialing(phone);
    const displayPhone = phone || 'Sin número registrado';

    modal.innerHTML = `
      <div class="modal-box" style="max-width:480px;width:92%;background:var(--theme-bg-surface-solid, #ffffff);color:var(--theme-text-main, #0f172a);border-radius:18px;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,0.35);border:1px solid var(--theme-border-subtle, #e2e8f0)" onclick="event.stopPropagation()">
        
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);padding-bottom:14px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px;background:rgba(16,185,129,0.12);padding:6px;border-radius:10px">🎧</span>
            <div>
              <h3 style="margin:0;font-size:17px;font-weight:800;color:var(--theme-text-main, #0f172a)">Marcador Comercial JJ Paper</h3>
              <div style="font-size:11.5px;color:var(--theme-accent, #047857);font-weight:600">Llamadas con Headset (Windows 7 Compatible · $0 Inversión)</div>
            </div>
          </div>
          <button type="button" class="btn-g sm" onclick="window.JJDialer.close()" style="border-radius:8px">✕</button>
        </div>

        <!-- Target Info -->
        <div style="background:var(--theme-item-bg, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:12px;padding:12px 14px;margin-bottom:16px">
          <div style="font-size:15px;font-weight:800;color:var(--theme-text-main, #0f172a)">${escapeHTML(company || 'Empresa')}</div>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">👤 Contacto: <strong style="color:var(--theme-text-main, #334155)">${escapeHTML(name || 'No especificado')}</strong></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;font-size:14px">
            <span>📞 <strong style="color:#0284c7;font-family:monospace">${escapeHTML(displayPhone)}</strong></span>
            <span id="jjDialerTimer" style="font-family:monospace;font-weight:800;font-size:14px;background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:6px">00:00</span>
          </div>
        </div>

        <!-- Disparadores de Llamada Gratuita Windows 7 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <button type="button" class="btn-p" onclick="window.JJDialer.triggerWaCall('${cleanNumber}')" style="background:#059669;border-color:#059669;padding:10px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
            <span>💬 Llamar / WhatsApp Web</span>
          </button>
          <button type="button" class="btn-p" onclick="window.JJDialer.triggerTelCall('${cleanNumber}')" style="background:#0284c7;border-color:#0284c7;padding:10px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
            <span>📞 Marcar (MicroSIP / tel:)</span>
          </button>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:14px">
          <button type="button" class="btn-o sm" onclick="window.JJDialer.copyNumber('${displayPhone}')" style="font-size:11.5px;padding:4px 10px">
            📋 Copiar Número
          </button>
          <button type="button" class="btn-o sm" onclick="window.JJDialer.showQr('${cleanNumber}')" style="font-size:11.5px;padding:4px 10px">
            📱 QR para Celular
          </button>
        </div>
        <div id="jjDialerQrBox" style="display:none;text-align:center;padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:12px;border:1px solid #cbd5e1">
          <img id="jjDialerQrImg" src="" alt="QR Teléfono" style="width:140px;height:140px;border-radius:8px">
          <div style="font-size:11px;color:#64748b;margin-top:4px">Apunta la cámara del celular para marcar sin teclear</div>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:-6px;margin-bottom:14px;text-align:center">
          💡 En Windows 7, usa tu headset con WhatsApp Web en el navegador o vincula un softphone gratuito (MicroSIP).
        </div>

        <!-- Registro de Resultado de Llamada -->
        <div style="margin-bottom:14px">
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px;color:var(--theme-text-main, #334155)">Resultado de la Llamada:</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11.5px">
            <button type="button" class="of-chip on" data-call-res="contactado_interesado" onclick="window.JJDialer.selectOutcome(this)">✅ Contactado (Interesado)</button>
            <button type="button" class="of-chip" data-call-res="pedir_cotizacion" onclick="window.JJDialer.selectOutcome(this)">📋 Pidió Cotización</button>
            <button type="button" class="of-chip" data-call-res="rellamar" onclick="window.JJDialer.selectOutcome(this)">⏳ Ocupado (Volver a llamar)</button>
            <button type="button" class="of-chip" data-call-res="no_contesta" onclick="window.JJDialer.selectOutcome(this)">🚫 No contesta / Buzón</button>
            <button type="button" class="of-chip" data-call-res="equivocado" onclick="window.JJDialer.selectOutcome(this)">❌ Número Inválido / Cambio</button>
            <button type="button" class="of-chip" data-call-res="dejo_recado" onclick="window.JJDialer.selectOutcome(this)">🗣️ Se dejó recado</button>
          </div>
        </div>

        <!-- Notas de la Llamada -->
        <div style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;color:var(--theme-text-main, #334155)">Notas / Acuerdos de la Conversación:</label>
          <textarea id="jjDialerNotes" class="fi" rows="2" placeholder="Ej: Hablé con Lic. Martínez. Piden cotización de 50 resmas y cinta. Rellamar el jueves..." style="width:100%;font-size:12.5px;resize:vertical"></textarea>
        </div>

        <!-- Acciones Inferiores -->
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
          <button type="button" class="btn-g" onclick="window.JJDialer.close()" style="font-size:12.5px">Cancelar</button>
          <button type="button" class="btn-p" onclick="window.JJDialer.saveCallLog()" style="padding:8px 18px;font-size:13px;font-weight:800;background:var(--theme-accent, #16604a)">💾 Guardar en Bitácora CRM</button>
        </div>
      </div>
    `;
  }

  function triggerTelCall(phone) {
    if (!phone) {
      if (typeof showToast === 'function') showToast('No hay número de teléfono válido para marcar.', 'warn');
      return;
    }
    startTimer();
    // Protocolo tel: que Windows despacha a Enlace Móvil o softphone gratuito
    window.location.href = `tel:+${phone}`;
    if (typeof showToast === 'function') showToast('Llamada iniciada con headset vía Windows… 📞', 'info');
  }

  function triggerWaCall(phone) {
    if (!phone) {
      if (typeof showToast === 'function') showToast('No hay número para WhatsApp.', 'warn');
      return;
    }
    startTimer();
    const url = `https://wa.me/${phone}`;
    window.open(url, '_blank');
  }

  function selectOutcome(btn) {
    document.querySelectorAll('#jjDialerModal .of-chip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }

  async function saveCallLog() {
    if (!currentTarget) return;
    const selectedBtn = document.querySelector('#jjDialerModal .of-chip.on');
    const outcomeCode = selectedBtn ? selectedBtn.getAttribute('data-call-res') : 'contactado';
    const outcomeText = selectedBtn ? selectedBtn.textContent.trim() : 'Llamada realizada';
    const notesInput = (document.getElementById('jjDialerNotes')?.value || '').trim();
    const duration = formatTime(callSeconds);

    stopTimer();

    const timestamp = new Date().toLocaleString('es-VE');
    const callSummary = `[Llamada ${timestamp} | ${duration}]: ${outcomeText}. ${notesInput}`;

    try {
      if (currentTarget.type === 'prospect') {
        const p = (typeof prospectsList !== 'undefined') ? prospectsList.find(x => x.id === currentTarget.id) : null;
        const currentNotes = (p && p.notes) ? p.notes : '';
        const newNotes = currentNotes ? `${callSummary}\n${currentNotes}` : callSummary;

        let newStatus = 'contactado_llamada';
        if (outcomeCode === 'contactado_interesado' || outcomeCode === 'pedir_cotizacion') {
          newStatus = 'interesado';
        } else if (outcomeCode === 'equivocado') {
          newStatus = 'rebotado';
        }

        const updatePayload = {
          notes: newNotes,
          status: newStatus,
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
        showToast('Llamada registrada exitosamente en la bitácora comercial. ✅');
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
    currentTarget = null;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function copyNumber(num) {
    if (!num) return;
    navigator.clipboard.writeText(num).then(() => {
      if (typeof showToast === 'function') showToast(`Número ${num} copiado al portapapeles. 📋`);
    });
  }

  function showQr(cleanPhone) {
    const box = document.getElementById('jjDialerQrBox');
    const img = document.getElementById('jjDialerQrImg');
    if (!box || !img) return;

    if (box.style.display === 'block') {
      box.style.display = 'none';
      return;
    }

    const telUri = `tel:+${cleanPhone}`;
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(telUri)}`;
    box.style.display = 'block';
  }

  window.JJDialer = {
    open: openDialer,
    close,
    triggerTelCall,
    triggerWaCall,
    copyNumber,
    showQr,
    selectOutcome,
    saveCallLog
  };
})();
