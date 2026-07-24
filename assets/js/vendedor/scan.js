/* ======================================================
   JJ Paper — Teléfono como pistola de código (para ventas/cotización)
   Escanea en bucle y manda cada código a jjp_pos_scans; la PC (POS/cotizador)
   lo recibe por Realtime y lo agrega al ticket. NO toca inventario/conteo.
   ====================================================== */

let SCAN_ACTIVE = false, SCAN_LAST = '', SCAN_LASTAT = 0, SCAN_COUNT = 0, SCAN_STREAM = null;

async function initScan() {
  const u = document.getElementById('scanUser');
  if (u) u.textContent = SELLER?.name || '';
  startCam();
}

function scanBeep() {
  try { navigator.vibrate?.(80); } catch (e) {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.1);
  } catch (e) {}
}

async function scanSend(code) {
  code = String(code || '').trim();
  if (!code) return;
  const now = Date.now();
  if (code === SCAN_LAST && now - SCAN_LASTAT < 1500) return;   // anti-doble lectura
  SCAN_LAST = code; SCAN_LASTAT = now;
  const { error } = await sb.from('jjp_pos_scans').insert({ owner_id: SELLER.id, code });
  if (error) { showToast('No se pudo enviar: ' + error.message, 'err'); return; }
  SCAN_COUNT++;
  const c = document.getElementById('scanCount'); if (c) c.textContent = SCAN_COUNT;
  const l = document.getElementById('scanLast'); if (l) l.textContent = code;
  scanBeep();
}

function scanManualSend() {
  const el = document.getElementById('scanManual');
  scanSend(el.value);
  el.value = '';
}

async function startCam() {
  const state = document.getElementById('scanState');
  if (!('BarcodeDetector' in window)) {
    if (state) state.textContent = '⚠️ Este navegador no lee por cámara. Usa el campo manual abajo.';
    return;
  }
  try { SCAN_STREAM = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { if (state) state.textContent = '⚠️ Sin permiso de cámara. Actívalo o usa el campo manual.'; return; }

  const v = document.getElementById('scanVideo');
  v.srcObject = SCAN_STREAM; SCAN_ACTIVE = true;
  if (state) state.textContent = '📷 Apunta al código de barras';
  const det = new window.BarcodeDetector();
  const loop = async () => {
    if (!SCAN_ACTIVE) return;
    try { const c = await det.detect(v); if (c && c.length) scanSend(c[0].rawValue); } catch (e) {}
    requestAnimationFrame(loop);
  };
  v.onloadedmetadata = () => loop();
}
