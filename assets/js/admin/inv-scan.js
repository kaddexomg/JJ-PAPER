/* ======================================================
   JJ Paper Admin — Modo conteo con escáner de cámara
   Escanea con la cámara del teléfono/tablet (BarcodeDetector).
   - Código conocido  → suma 1 al conteo de esa variante.
   - Código nuevo     → lo vincula a un producto (buscas por nombre)
                        y así construyes tu base de códigos.
   Al guardar, escribe el conteo en jjp_product_variants.stock.
   Reutiliza de inventory.js: invRows, renderInventory(), sb,
   showToast(), escapeHTML(), normTxt(), optImg().
   ====================================================== */

let scanStream   = null;      // MediaStream de la cámara
let scanDetector = null;      // BarcodeDetector
let scanTimer    = null;      // loop de detección
let scanActive   = null;      // variante en conteo { row, counted }
let scanPending  = null;      // código sin vincular (esperando elección)
const scanSeen   = {};        // code -> última vez visto (re-arma tras salir de cuadro)

// ---- Abrir / cerrar ----
async function invScanOpen() {
  const ov = document.getElementById('scanOverlay');
  if (!ov) return;
  ov.classList.add('op');
  document.body.style.overflow = 'hidden';
  scanSetStatus('Iniciando cámara…');
  await scanStartCamera();
}

function invScanClose() {
  scanCommitActive();                 // guarda el conteo en curso
  const ov = document.getElementById('scanOverlay');
  if (ov) ov.classList.remove('op');
  document.body.style.overflow = '';
  scanStopCamera();
  scanActive = null; scanPending = null;
  Object.keys(scanSeen).forEach(k => delete scanSeen[k]);
  scanRenderActive();
  scanRenderLink();
  renderInventory();                  // refresca la tabla de abajo
}

// ---- Cámara + detección ----
async function scanStartCamera() {
  const video = document.getElementById('scanVideo');
  if (!('BarcodeDetector' in window)) {
    scanSetStatus('⚠️ Tu navegador no soporta escaneo por cámara. Usa Chrome en Android, o escribe/pega el código abajo.');
    return;
  }
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    scanDetector = new BarcodeDetector({
      formats: formats.length
        ? formats
        : ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','codabar','itf']
    });
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false
    });
    video.srcObject = scanStream;
    await video.play();
    scanSetStatus('Apunta al código de barras…');
    scanLoop();
  } catch (e) {
    console.error(e);
    scanSetStatus('⚠️ No se pudo abrir la cámara (revisa permisos). Puedes escribir el código abajo.');
  }
}

function scanStopCamera() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const video = document.getElementById('scanVideo');
  if (video) video.srcObject = null;
}

function scanLoop() {
  const video = document.getElementById('scanVideo');
  scanTimer = setInterval(async () => {
    if (!scanDetector || !video || video.readyState < 2) return;
    let codes = [];
    try { codes = await scanDetector.detect(video); } catch (e) { return; }
    const now = Date.now();
    const nowCodes = new Set();
    for (const b of codes) {
      const code = (b.rawValue || '').trim();
      if (!code) continue;
      nowCodes.add(code);
      // Cuenta una vez por presentación: solo si no estaba ya "visto"
      if (scanSeen[code] == null) scanHandleCode(code);
      scanSeen[code] = now;
    }
    // Re-arma códigos que salieron del cuadro (>700ms sin verse)
    for (const c of Object.keys(scanSeen))
      if (now - scanSeen[c] > 700) delete scanSeen[c];
  }, 250);
}

// ---- Lógica de escaneo ----
function scanHandleCode(code) {
  scanBeep();
  if (navigator.vibrate) navigator.vibrate(60);

  // Si estamos esperando vincular un código, ignora nuevos hasta resolver
  if (scanPending) { scanSetStatus(`Vincula primero el código ${scanPending}…`); return; }

  const row = invRows.find(r => (r.barcode || '').trim() === code);
  if (row) {
    if (scanActive && scanActive.row.id === row.id) {
      scanActive.counted += 1;                    // mismo producto → +1
    } else {
      scanCommitActive();                         // cambia de producto → guarda el anterior
      scanActive = { row, counted: 1 };
    }
    scanSetStatus(`✓ ${row.jjp_products?.name || ''}`);
    scanRenderActive();
  } else {
    scanPending = code;                           // código desconocido → vincular
    scanRenderLink();
    scanSetStatus(`Código nuevo: ${code}`);
  }
}

// Guarda el conteo del item activo (stock = contado)
async function scanCommitActive() {
  const a = scanActive;
  if (!a) return;
  scanActive = null;
  const n = a.counted;
  const prev = a.row.stock;
  a.row.stock = n;                                 // optimista en memoria
  // RPC con razón "conteo físico" → el kardex registra el ajuste del conteo
  let { error } = await sb.rpc('jjp_set_stock', { p_variant_id: a.row.id, p_stock: n, p_reason: 'conteo físico' });
  if (error) {
    ({ error } = await sb.from('jjp_product_variants').update({ stock: n }).eq('id', a.row.id));
  }
  if (error) {
    a.row.stock = prev;
    showToast('Error guardando conteo: ' + error.message, 'err');
  } else {
    showToast(`Conteo guardado: ${a.row.jjp_products?.name || ''} = ${n}`);
  }
}

// ---- Vincular código nuevo a una variante ----
function scanLinkSearch(q) {
  const box = document.getElementById('scanLinkResults');
  if (!box) return;
  const term = normTxt(q);
  if (term.length < 2) { box.innerHTML = '<p class="scan-hint">Escribe al menos 2 letras…</p>'; return; }
  const hits = invRows.filter(r =>
    normTxt(r.jjp_products?.name).includes(term) ||
    normTxt(r.jjp_brands?.name).includes(term) ||
    normTxt(r.sku).includes(term)
  ).slice(0, 30);
  if (!hits.length) { box.innerHTML = '<p class="scan-hint">Sin coincidencias.</p>'; return; }
  box.innerHTML = hits.map(r => `
    <button class="scan-hit" onclick="scanDoLink('${r.id}')">
      <span class="scan-hit-name">${escapeHTML(r.jjp_products?.name || '—')}</span>
      <span class="scan-hit-sub">${escapeHTML(invLabel(r))} · SKU ${escapeHTML(r.sku || '—')}</span>
    </button>`).join('');
}

async function scanDoLink(variantId) {
  const row = invRows.find(r => r.id === variantId);
  if (!row || !scanPending) return;
  const code = scanPending;
  const { error } = await sb.from('jjp_product_variants').update({ barcode: code }).eq('id', variantId);
  if (error) { showToast('Error vinculando código: ' + error.message, 'err'); return; }
  row.barcode = code;                              // en memoria → próximos escaneos lo reconocen
  showToast(`Código ${code} vinculado a ${row.jjp_products?.name || ''}`);
  scanPending = null;
  scanCommitActive();
  scanActive = { row, counted: 1 };                // arranca el conteo del recién vinculado
  scanRenderLink();
  scanRenderActive();
  scanSetStatus(`✓ ${row.jjp_products?.name || ''}`);
}

function scanCancelLink() {
  scanPending = null;
  scanRenderLink();
  scanSetStatus('Apunta al código de barras…');
}

// ---- Entrada manual (teclado / pegar) ----
function scanManualSubmit(ev) {
  ev.preventDefault();
  const inp = document.getElementById('scanManualInput');
  const code = (inp.value || '').trim();
  if (!code) return;
  inp.value = '';
  delete scanSeen[code];
  scanHandleCode(code);
}

// ---- Ajuste manual del número contado ----
function scanSetCounted(v) {
  if (!scanActive) return;
  const n = parseInt(v);
  if (!isNaN(n) && n >= 0) scanActive.counted = n;
}
function scanBump(delta) {
  if (!scanActive) return;
  scanActive.counted = Math.max(0, scanActive.counted + delta);
  scanRenderActive();
}
async function scanSaveActive() {
  await scanCommitActive();
  scanRenderActive();
  renderInventory();
}

// ---- Render de paneles ----
function scanSetStatus(t) {
  const el = document.getElementById('scanStatus');
  if (el) el.textContent = t;
}

function scanRenderActive() {
  const el = document.getElementById('scanActive');
  if (!el) return;
  if (!scanActive) { el.innerHTML = '<p class="scan-hint">Ningún producto en conteo todavía.</p>'; return; }
  const r = scanActive.row, p = r.jjp_products || {};
  el.innerHTML = `
    <div class="scan-item">
      <div class="scan-item-thumb">${p.image_url ? `<img src="${optImg(p.image_url,120)}" alt="">` : (p.emoji || '📦')}</div>
      <div class="scan-item-info">
        <div class="scan-item-name">${escapeHTML(p.name || '—')}</div>
        <div class="scan-item-sub">${escapeHTML(invLabel(r))} · SKU ${escapeHTML(r.sku || '—')}</div>
        <div class="scan-item-sub">Código: ${escapeHTML(r.barcode || '—')}</div>
      </div>
    </div>
    <div class="scan-count-row">
      <span>Contados:</span>
      <button class="qb" onclick="scanBump(-1)">−</button>
      <input type="number" min="0" class="fi scan-count-in" value="${scanActive.counted}" onchange="scanSetCounted(this.value)">
      <button class="qb" onclick="scanBump(1)">+</button>
      <button class="btn-p sm" onclick="scanSaveActive()">💾 Guardar</button>
    </div>`;
}

function scanRenderLink() {
  const el = document.getElementById('scanLink');
  if (!el) return;
  if (!scanPending) { el.classList.remove('op'); el.innerHTML = ''; return; }
  el.classList.add('op');
  el.innerHTML = `
    <div class="scan-link-head">
      <strong>Código nuevo: ${escapeHTML(scanPending)}</strong>
      <button class="btn-ghost sm" onclick="scanCancelLink()">Cancelar</button>
    </div>
    <p class="scan-hint">Busca el producto al que pertenece este código para vincularlo:</p>
    <input type="text" class="fi" placeholder="Nombre, marca o SKU…" oninput="scanLinkSearch(this.value)" autofocus>
    <div class="scan-link-results" id="scanLinkResults"></div>`;
}

// ---- Puente teléfono → PC (Realtime jjp_scan_events) ----
// El teléfono (admin/escaner.html) inserta un evento por cada código escaneado.
// La PC lo recibe aquí y lo pasa a scanHandleCode() como un escaneo local.
let scanBridgeCh   = null;
const scanRemoteSeen = {};   // code -> última vez procesado (dedup de inserts repetidos)

function scanStartBridge() {
  if (scanBridgeCh) return;                         // ya suscrito
  if (typeof CURRENT_PROFILE === 'undefined' || !CURRENT_PROFILE?.id) return;
  scanBridgeCh = sb.channel('scan-bridge-' + CURRENT_PROFILE.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_scan_events',
        filter: 'owner_id=eq.' + CURRENT_PROFILE.id },
      payload => scanOnRemote(payload.new))
    .subscribe();
}

function scanOnRemote(row) {
  const code = (row?.code || '').trim();
  if (!code) return;
  const now = Date.now();
  if (scanRemoteSeen[code] && now - scanRemoteSeen[code] < 400) return;  // dedup ráfaga
  scanRemoteSeen[code] = now;
  // Abre el overlay al primer escaneo remoto para que se vea el conteo activo
  const ov = document.getElementById('scanOverlay');
  if (ov && !ov.classList.contains('op')) {
    ov.classList.add('op');
    document.body.style.overflow = 'hidden';
    scanStopCamera();                               // sin cámara local: el teléfono escanea
    scanSetStatus('📲 Escaneando desde el teléfono…');
  }
  scanHandleCode(code);
}

// Muestra la dirección de la página móvil del escáner (para abrirla en el teléfono)
function invScanPhoneLink() {
  const url = (typeof siteURL === 'function')
    ? siteURL('admin/escaner.html')
    : location.origin + location.pathname.replace(/[^/]*$/, 'escaner.html');
  if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
  showToast('En tu teléfono abre (ya se copió): ' + url, 'ok', 8000);
}

// Pitido corto vía WebAudio (sin archivos)
let _scanAudioCtx = null;
function scanBeep() {
  try {
    _scanAudioCtx = _scanAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _scanAudioCtx.createOscillator(), g = _scanAudioCtx.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(_scanAudioCtx.destination);
    o.start(); o.stop(_scanAudioCtx.currentTime + 0.08);
  } catch (e) {}
}
