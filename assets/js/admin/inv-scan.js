/* ======================================================
   JJ Paper Admin — Modo conteo con escáner
   Escanea con la cámara de la PC o, mejor, con el teléfono
   (admin/escaner.html) que envía cada código por Realtime.

   - Código conocido    → suma 1 al acumulado de esa variante.
   - Código desconocido → cola "por vincular" o alta manual, SIN frenar el conteo.

   PERSISTENCIA (lo importante):
   Cada unidad contada se escribe de inmediato en jjp_count_tally vía el
   RPC jjp_count_add (delta, no total). El navegador es sólo una caché.
   Por eso recargar la página, cambiar de equipo o volver a escanear un
   código ya contado NUNCA reinicia ni borra el conteo: siempre suma.
   Si la red falla, el delta queda en una cola local y se reintenta solo.

   Reutiliza de inventory.js: invRows, renderInventory(), sb,
   showToast(), escapeHTML(), normTxt(), optImg(), invLabel().
   ====================================================== */

let scanStream   = null;      // MediaStream de la cámara
let scanDetector = null;      // BarcodeDetector
let scanTimer    = null;      // loop de detección
let scanActive   = null;      // última variante contada { row }
const scanSeen   = {};        // code -> última vez visto (re-arma tras salir de cuadro)

const SCAN_SESSION = 'default';         // permite varios inventarios en paralelo
const LS_TALLY     = 'jjpCountTally';   // caché del acumulado
const LS_QUEUE     = 'jjpCountQueue';   // deltas pendientes de subir

// Acumulado de la sesión: variantId -> { n, name, sku }
let scanTally = {};
// Deltas que no se pudieron subir: [{ variantId, delta }]
let scanQueue = [];
// Cola de códigos desconocidos, en orden: [{ code, at, seen, device, remote }]
let scanUnknown = [];

// Quién cuenta desde esta PC (login compartido: la etiqueta distingue a cada quien)
let scanDevice = localStorage.getItem('jjpCountDevicePC') || 'PC';
let scanConflicts = 0;                    // variantes contadas por 2+ personas
let scanLastRemote = '';                  // última actividad de otra persona

function scanSetDevice() {
  const v = prompt('¿Con qué nombre cuentas desde esta PC? (ej: Caja, Depósito, Ana)', scanDevice);
  if (v == null) return;
  scanDevice = (v.trim() || 'PC').slice(0, 32);
  localStorage.setItem('jjpCountDevicePC', scanDevice);
  scanRenderProgress();
}

// ---- Caché local (sobrevive recargas y cortes de red) ----
function scanLoadLocal() {
  try { scanTally = JSON.parse(localStorage.getItem(LS_TALLY) || '{}') || {}; } catch (e) { scanTally = {}; }
  try { scanQueue = JSON.parse(localStorage.getItem(LS_QUEUE) || '[]') || []; } catch (e) { scanQueue = []; }
}
function scanSaveLocal() {
  try {
    localStorage.setItem(LS_TALLY, JSON.stringify(scanTally));
    localStorage.setItem(LS_QUEUE, JSON.stringify(scanQueue));
  } catch (e) {}
}
scanLoadLocal();

// ---- Sincronía con la base: la DB manda ----
async function scanSyncTally() {
  const { data, error } = await sb.from('jjp_count_tally')
    .select('variant_id,counted').eq('session_key', SCAN_SESSION).limit(5000);
  if (error || !data) return;                 // sin migración aplicada → sigue en local
  for (const t of data) {
    const row = invRows.find(r => r.id === t.variant_id);
    scanTally[t.variant_id] = {
      n: t.counted,
      name: row?.jjp_products?.name || scanTally[t.variant_id]?.name || '',
      sku:  row?.sku || scanTally[t.variant_id]?.sku || '',
    };
    if (row) row.stock = t.counted;           // la tabla de abajo refleja el conteo real
  }
  scanSaveLocal();
  scanRenderProgress();
}

// ---- Suma / resta persistente ----
// Optimista en pantalla, autoritativo en la base. Si la base falla,
// el delta queda encolado y se reintenta: no se pierde ninguna unidad.
async function scanCountApply(row, delta, source = 'pc') {
  if (!row || !delta) return scanTally[row?.id]?.n ?? 0;
  const id   = row.id;
  const prev = scanTally[id]?.n ?? 0;
  const next = Math.max(0, prev + delta);

  scanTally[id] = { n: next, name: row.jjp_products?.name || '', sku: row.sku || '' };
  row.stock = next;
  scanSaveLocal();
  scanRenderActive();
  scanRenderProgress();

  // p_source = canal (pc/búsqueda/manual); p_by = quién cuenta (etiqueta).
  // Ambos alimentan la bitácora jjp_count_log para auditar y detectar cruces.
  const { data, error } = await sb.rpc('jjp_count_add', {
    p_variant_id: id, p_delta: delta, p_session: SCAN_SESSION, p_source: source, p_by: scanDevice
  });

  if (error) {
    // Fallback para bases sin la migración: escribe el total directo
    const fb = await sb.rpc('jjp_set_stock', { p_variant_id: id, p_stock: next, p_reason: 'conteo físico' });
    if (fb.error) {
      scanQueue.push({ variantId: id, delta, source });   // se reintenta después
      scanSaveLocal();
      showToast('Sin conexión: el conteo quedó guardado y se subirá solo', 'warn', 4000);
    }
    return next;
  }

  if (typeof data === 'number' && data !== next) { // otra pestaña o el teléfono contó también
    scanTally[id].n = data;
    row.stock = data;
    scanSaveLocal();
    scanRenderActive();
    scanRenderProgress();
  }
  return scanTally[id].n;
}

// Fija el total exacto (edición manual del número)
async function scanCountSet(row, total) {
  if (!row) return;
  const n = Math.max(0, parseInt(total) || 0);
  scanTally[row.id] = { n, name: row.jjp_products?.name || '', sku: row.sku || '' };
  row.stock = n;
  scanSaveLocal();
  scanRenderActive();
  scanRenderProgress();
  const { error } = await sb.rpc('jjp_count_set', {
    p_variant_id: row.id, p_total: n, p_session: SCAN_SESSION, p_source: 'manual', p_by: scanDevice
  });
  if (error) await sb.rpc('jjp_set_stock', { p_variant_id: row.id, p_stock: n, p_reason: 'conteo físico' });
}

// Reintenta los deltas que quedaron sin subir
async function scanFlushQueue() {
  if (!scanQueue.length) return;
  const pend = scanQueue.slice();
  scanQueue = [];
  scanSaveLocal();
  for (const q of pend) {
    const { error } = await sb.rpc('jjp_count_add', {
      p_variant_id: q.variantId, p_delta: q.delta, p_session: SCAN_SESSION,
      p_source: q.source || 'pc', p_note: 'subido de la cola offline'
    });
    if (error) scanQueue.push(q);
  }
  scanSaveLocal();
  if (!scanQueue.length) { await scanSyncTally(); showToast(`${pend.length} conteo(s) pendientes subidos`, 'ok'); }
}
setInterval(scanFlushQueue, 20000);
window.addEventListener('online', scanFlushQueue);

// ---- Abrir / cerrar ----
async function invScanOpen() {
  const ov = document.getElementById('scanOverlay');
  if (!ov) return;
  ov.classList.add('op');
  document.body.style.overflow = 'hidden';
  scanSetStatus('Iniciando cámara…');
  await scanSyncTally();             // acumulado real desde la base
  await scanFlushQueue();
  await scanLoadUnknownRemote();     // códigos sin vincular que mandaron los teléfonos
  await scanLoadConflicts();         // ¿algo contado por 2+ personas?
  scanRenderProgress();
  await scanDrainPending();          // recupera lo escaneado con la PC cerrada (legado)
  await scanStartCamera();
  scanStartLogFeed();                // refleja en vivo lo que cuentan los teléfonos
}

async function invScanClose() {
  const ov = document.getElementById('scanOverlay');
  if (ov) ov.classList.remove('op');
  document.body.style.overflow = '';
  scanStopCamera();
  scanActive = null;
  Object.keys(scanSeen).forEach(k => delete scanSeen[k]);
  scanRenderActive();
  scanRenderUnknown();
  renderInventory();                  // refresca la tabla de abajo
}

// Cierra el overlay. El acumulado NO se borra: sigue en la base y en la
// caché local, así que retomar el inventario mañana suma donde quedó.
async function invScanFinish() {
  const pend = scanUnknown.length;
  if (pend && !confirm(`Quedan ${pend} código(s) sin vincular. ¿Cerrar de todos modos?`)) return;
  await scanFlushQueue();
  await invScanClose();
  const { productos, unidades } = scanTotals();
  if (productos) showToast(`Conteo guardado: ${productos} producto(s), ${unidades} unidad(es). Puedes retomarlo cuando quieras.`, 'ok', 6000);
}

// Borra el acumulado y empieza un inventario desde cero (pide confirmación doble)
async function invScanReset() {
  const { productos, unidades } = scanTotals();
  if (!confirm(`Vas a BORRAR el conteo de ${productos} producto(s) / ${unidades} unidad(es) y empezar de cero.\n\nEl stock actual de cada producto NO se toca. ¿Continuar?`)) return;
  if (!confirm('Esto no se puede deshacer. ¿Seguro?')) return;
  await sb.from('jjp_count_tally').delete().eq('session_key', SCAN_SESSION);
  scanTally = {}; scanQueue = []; scanActive = null;
  scanSaveLocal();
  scanRenderActive(); scanRenderProgress();
  showToast('Conteo reiniciado', 'ok');
}

// ---- Cámara + detección ----
async function scanStartCamera() {
  const video = document.getElementById('scanVideo');
  if (!('BarcodeDetector' in window)) {
    scanSetStatus('⚠️ Este navegador no escanea por cámara. Usa el teléfono (📲) o escribe el código abajo.');
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
    scanSetStatus('⚠️ No se pudo abrir la cámara (revisa permisos). Usa el teléfono o escribe el código abajo.');
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
    for (const b of codes) {
      const code = (b.rawValue || '').trim();
      if (!code) continue;
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
// Devuelve el resultado del escaneo (lo usa el puente para responderle al teléfono)
function scanHandleCode(code, source = 'pc') {
  scanBeep();
  if (navigator.vibrate) navigator.vibrate(60);

  const row = invRows.find(r => (r.barcode || '').trim() === code);

  if (!row) {
    // Código desconocido: NO frena el conteo. Se encola para vincularlo
    // a un producto existente o darlo de alta manualmente.
    if (!scanUnknown.some(u => u.code === code)) scanUnknown.push({ code, at: Date.now() });
    scanRenderUnknown();
    scanSetStatus(`❓ Código nuevo: ${code} — vincúlalo o créalo, sigue contando`);
    return { ok: false, kind: 'nuevo', msg: 'Código no registrado — vincúlalo o créalo en la PC' };
  }

  scanActive = { row };
  const total = (scanTally[row.id]?.n ?? 0) + 1;     // preview inmediato
  scanCountApply(row, +1, source);                   // persiste en la base
  const name = row.jjp_products?.name || '';
  scanSetStatus(`✓ ${name} — ${total}`);
  scanRenderActive();
  return { ok: true, kind: 'contado', name, counted: total };
}

// ---- Vincular códigos de la cola ----
let scanLinking = null;      // código de la cola que se está vinculando

function scanStartLink(code) {
  scanLinking = code;
  scanNewOpenFor = null;
  scanBrowsing = null;
  scanRenderUnknown();
}
function scanCancelLink() {
  scanLinking = null;
  scanRenderUnknown();
}
function scanDropUnknown(code) {
  scanResolveUnknown(code);                        // no vuelve a aparecer desde la base
  scanUnknown = scanUnknown.filter(u => u.code !== code);
  if (scanLinking === code) scanLinking = null;
  scanRenderUnknown();
}

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
  if (!hits.length) { box.innerHTML = '<p class="scan-hint">Sin coincidencias. Usa “➕ Crear producto nuevo”.</p>'; return; }
  box.innerHTML = hits.map(r => `
    <button class="scan-hit" onclick="scanDoLink('${r.id}')">
      <span class="scan-hit-name">${escapeHTML(r.jjp_products?.name || '—')}</span>
      <span class="scan-hit-sub">${escapeHTML(invLabel(r))} · SKU ${escapeHTML(r.sku || '—')} · contadas: ${scanTally[r.id]?.n ?? 0}</span>
    </button>`).join('');
}

async function scanDoLink(variantId) {
  const row = invRows.find(r => r.id === variantId);
  if (!row || !scanLinking) return;
  const code = scanLinking;
  // Vía RPC: si el código estaba en otro producto se lo quita, y todo queda
  // en la bitácora para poder revisarlo y deshacerlo en Control del conteo.
  let { error } = await sb.rpc('jjp_barcode_assign', {
    p_variant_id: variantId, p_code: code, p_note: 'vinculado al escanear'
  });
  if (error) {   // base sin la migración de control
    ({ error } = await sb.from('jjp_product_variants').update({ barcode: code }).eq('id', variantId));
  }
  if (error) { showToast('Error vinculando código: ' + error.message, 'err'); return; }
  const robado = invRows.find(r => r.id !== variantId && (r.barcode || '') === code);
  if (robado) robado.barcode = null;               // el código ya no le pertenece
  row.barcode = code;                              // en memoria → próximos escaneos lo reconocen
  showToast(`Código ${code} vinculado a ${row.jjp_products?.name || ''}`);
  scanResolveUnknown(code);                        // sale de la cola compartida
  scanUnknown = scanUnknown.filter(u => u.code !== code);
  scanLinking = null;
  scanActive = { row };
  await scanCountApply(row, +1, 'pc');             // el escaneo que lo destapó también cuenta
  scanRenderUnknown();
  scanRenderActive();
  scanSetStatus(`✓ ${row.jjp_products?.name || ''} — ${scanTally[row.id]?.n ?? 0}`);
}

// ======================================================
//  Alta manual de productos que no están en la lista de precios
// ======================================================
let scanNewOpenFor = null;      // código que se está dando de alta ('' = alta libre)
let scanCats  = null;           // categorías cacheadas
let scanBrandsList = null;      // marcas cacheadas

async function scanNewOpen(code) {
  scanNewOpenFor = code || '';
  scanLinking = null;
  scanBrowsing = null;
  if (!scanCats) {
    const { data } = await sb.from('jjp_categories').select('id,name').order('sort_order');
    scanCats = data || [];
  }
  if (!scanBrandsList) {
    const { data } = await sb.from('jjp_brands').select('id,name').order('name');
    scanBrandsList = data || [];
  }
  scanRenderUnknown();
  setTimeout(() => document.getElementById('scanNewName')?.focus(), 50);
}
function scanNewCancel() {
  scanNewOpenFor = null;
  scanRenderUnknown();
}

// SKU sugerido a partir del nombre, único contra lo que ya existe
function scanSuggestSKU(name) {
  const base = normTxt(name).replace(/[^a-z0-9]+/g, '').slice(0, 8).toUpperCase() || 'PROD';
  const used = new Set(invRows.map(r => (r.sku || '').toUpperCase()));
  for (let i = 1; i < 1000; i++) {
    const sku = `JJP-${base}-${String(i).padStart(3, '0')}`;
    if (!used.has(sku)) return sku;
  }
  return `JJP-${base}-${Date.now().toString().slice(-5)}`;
}
function scanNewAutoSKU() {
  const name = document.getElementById('scanNewName')?.value || '';
  const sku  = document.getElementById('scanNewSKU');
  if (sku && !sku.dataset.touched) sku.value = name.trim() ? scanSuggestSKU(name) : '';
}

async function scanNewSubmit(ev) {
  ev.preventDefault();
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const name  = g('scanNewName');
  const code  = g('scanNewCode');
  const sku   = g('scanNewSKU') || scanSuggestSKU(name);
  const price = parseFloat(g('scanNewPrice')) || 0;
  const cost  = parseFloat(g('scanNewCost'));
  const qty   = Math.max(0, parseInt(g('scanNewQty')) || 0);
  const catId = g('scanNewCat')   || null;
  const brId  = g('scanNewBrand') || null;
  const vname = g('scanNewVariant') || null;

  if (!name) { showToast('El nombre es obligatorio', 'warn'); return; }
  if (code && invRows.some(r => (r.barcode || '').trim() === code)) {
    showToast('Ese código de barras ya está asignado a otro producto', 'warn'); return;
  }
  if (invRows.some(r => (r.sku || '').toUpperCase() === sku.toUpperCase())) {
    showToast('Ese SKU ya existe — cámbialo', 'warn'); return;
  }

  const btn = document.getElementById('scanNewSave');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  // 1) Producto padre
  const { data: prod, error: e1 } = await sb.from('jjp_products')
    .insert({ name, price_usd: price, category_id: catId, brand_id: brId, active: true, emoji: '📦' })
    .select('id,name,description,unit,emoji,tag,featured,active,image_url,min_qty,jjp_categories(slug,name)')
    .single();
  if (e1) {
    showToast('Error creando producto: ' + e1.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Crear y contar'; }
    return;
  }

  // 2) Variante (la fila real del inventario)
  const { data: v, error: e2 } = await sb.from('jjp_product_variants')
    .insert({
      product_id: prod.id, brand_id: brId, variant_name: vname,
      sku, barcode: code || null, price_usd: price,
      cost_usd: isNaN(cost) ? null : cost, stock: 0, active: true
    })
    .select('id,sku,barcode,variant_name,cost_usd,price_usd,margin_pct,stock,min_qty,active,brand_id,product_id')
    .single();
  if (e2) {
    showToast('Error creando la variante: ' + e2.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Crear y contar'; }
    return;
  }

  // 3) Entra al inventario en memoria (sin recargar: sigues escaneando)
  const row = { ...v, jjp_products: prod, jjp_brands: brId ? { name: scanBrandsList.find(b => b.id === brId)?.name } : null };
  invRows.unshift(row);
  invPopulateBrandFilter?.();

  if (code) scanResolveUnknown(code);              // sale de la cola compartida
  scanUnknown = scanUnknown.filter(u => u.code !== code);
  scanNewOpenFor = null;
  scanActive = { row };
  if (qty > 0) await scanCountApply(row, qty, 'manual');
  else { scanRenderActive(); scanRenderProgress(); }

  scanRenderUnknown();
  showToast(`✓ ${name} creado (SKU ${sku})${qty ? ` con ${qty} unidad(es)` : ''}`, 'ok', 5000);
  scanSetStatus(`✓ ${name} — ${scanTally[row.id]?.n ?? 0}`);
  if (btn) { btn.disabled = false; btn.textContent = '💾 Crear y contar'; }
}

function scanNewForm() {
  const code = scanNewOpenFor || '';
  const cats = (scanCats || []).map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  const brs  = (scanBrandsList || []).map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
  return `
    <div class="scan-link-head">
      <strong>➕ Producto nuevo${code ? ` — código ${escapeHTML(code)}` : ''}</strong>
      <button class="btn-ghost sm" onclick="scanNewCancel()">Cancelar</button>
    </div>
    <p class="scan-hint">Para lo que NO está en la lista de precios. Se crea al instante y sigues contando.</p>
    ${code ? `<button class="btn-ghost scan-wide" onclick="scanStartLink('${escapeHTML(code)}')">🔍 Espera: mejor búscalo en mi lista de precios</button>` : ''}
    <form class="scan-new-form" onsubmit="scanNewSubmit(event)">
      <label>Nombre *
        <input type="text" class="fi" id="scanNewName" required autocomplete="off"
          oninput="scanNewAutoSKU()" placeholder="Ej: Cuaderno rayado 100 hojas">
      </label>
      <label>Código de barras
        <input type="text" class="fi" id="scanNewCode" value="${escapeHTML(code)}" autocomplete="off"
          placeholder="Escanéalo o escríbelo">
      </label>
      <label>SKU
        <input type="text" class="fi" id="scanNewSKU" autocomplete="off"
          oninput="this.dataset.touched=1" placeholder="Se sugiere solo">
      </label>
      <label>Presentación
        <input type="text" class="fi" id="scanNewVariant" autocomplete="off" placeholder="Ej: caja x12 (opcional)">
      </label>
      <label>Marca
        <select class="fi" id="scanNewBrand"><option value="">Genérica / sin marca</option>${brs}</select>
      </label>
      <label>Categoría
        <select class="fi" id="scanNewCat"><option value="">Sin categoría</option>${cats}</select>
      </label>
      <label>Precio USD
        <input type="number" step="0.01" min="0" class="fi" id="scanNewPrice" value="0">
      </label>
      <label>Costo USD
        <input type="number" step="0.01" min="0" class="fi" id="scanNewCost" placeholder="opcional">
      </label>
      <label>Cantidad contada
        <input type="number" min="0" class="fi" id="scanNewQty" value="1">
      </label>
      <button class="btn-p" type="submit" id="scanNewSave">💾 Crear y contar</button>
    </form>`;
}

// ======================================================
//  Buscador universal: un solo campo para todo
//  - dígitos  → código de barras (Enter cuenta)
//  - letras   → busca en tu lista de precios y cuentas con un toque
//  Sirve para lo que no tiene código de barras o cuyo código no lee.
// ======================================================
function scanIsCode(v) { return /^\d{6,}$/.test(v.trim()); }

// Búsqueda por palabras (todas deben aparecer) sobre nombre+marca+presentación+SKU.
// Mejor que substring simple: "cuaderno rayado" ya no exige el orden exacto.
function scanTokens(q) { return normTxt(q).split(/\s+/).filter(t => t.length >= 2); }
function scanRowText(r) {
  return normTxt(`${r.jjp_products?.name || ''} ${r.jjp_brands?.name || ''} ${r.variant_name || ''} ${r.sku || ''}`);
}
function scanMatch(r, tokens) { const t = scanRowText(r); return tokens.every(tok => t.includes(tok)); }
function scanRankHits(hits, tokens) {
  const first = tokens[0] || '';
  return hits.sort((a, b) => {
    const an = normTxt(a.jjp_products?.name), bn = normTxt(b.jjp_products?.name);
    const as = an.startsWith(first) ? 0 : 1, bs = bn.startsWith(first) ? 0 : 1;
    if (as !== bs) return as - bs;
    return an.localeCompare(bn);
  });
}

// ======================================================
//  Explorar sin código: elegir por PRODUCTO (para lo que no tiene barra)
//  Categoría → toca el producto (con foto/emoji) y suma 1. No hace falta
//  escribir ni escanear.
// ======================================================
let scanBrowsing = null;   // null | { cat: <nombre categoría> }

function scanBrowseOpen() {
  scanBrowsing = { cat: null };
  scanLinking = null; scanNewOpenFor = null;
  scanBrowseRender();
}
function scanBrowseClose() { scanBrowsing = null; scanRenderUnknown(); }
function scanBrowsePick(cat) { scanBrowsing = { cat }; scanBrowseRender(); }

function scanCatOf(r) { return r.jjp_products?.jjp_categories?.name || 'Sin categoría'; }

function scanBrowseCats() {
  const map = new Map();
  for (const r of invRows) { const c = scanCatOf(r); map.set(c, (map.get(c) || 0) + 1); }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function scanBrowseItems(list) {
  if (!list.length) return '<p class="scan-hint">Sin productos.</p>';
  return list.slice(0, 200).map(r => {
    const p = r.jjp_products || {};
    const n = scanTally[r.id]?.n ?? 0;
    const thumb = p.image_url
      ? `<img src="${optImg(p.image_url, 48)}" style="width:26px;height:26px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:6px" alt="">`
      : (p.emoji || '📦') + ' ';
    return `
    <button class="scan-hit" onclick="scanPickRow('${r.id}')">
      <span class="scan-hit-name">${thumb}${escapeHTML(p.name || '—')}</span>
      <span class="scan-hit-sub">${escapeHTML(invLabel(r))} · SKU ${escapeHTML(r.sku || '—')}${n > 0 ? ` · contadas: ${n}` : ''}</span>
    </button>`;
  }).join('');
}

function scanBrowseRender() {
  const el = document.getElementById('scanLink');
  if (!el || !scanBrowsing) return;
  el.classList.add('op');
  if (!scanBrowsing.cat) {
    const cats = scanBrowseCats();
    el.innerHTML = `
      <div class="scan-link-head">
        <strong>📖 Elegir por producto (sin código)</strong>
        <button class="btn-ghost sm" onclick="scanBrowseClose()">Cerrar</button>
      </div>
      <p class="scan-hint">Para lo que no tiene código de barras: elige la categoría y toca el producto para sumar 1.</p>
      <div class="scan-link-results">
        ${cats.map(([c, n]) => `
          <button class="scan-hit" onclick="scanBrowsePick('${escapeHTML(c)}')">
            <span class="scan-hit-name">${escapeHTML(c)}</span>
            <span class="scan-hit-sub">${n} producto(s)</span>
          </button>`).join('')}
      </div>`;
    return;
  }
  const cat = scanBrowsing.cat;
  const list = invRows.filter(r => scanCatOf(r) === cat)
    .sort((a, b) => normTxt(a.jjp_products?.name).localeCompare(normTxt(b.jjp_products?.name)));
  el.innerHTML = `
    <div class="scan-link-head">
      <strong>📖 ${escapeHTML(cat)}</strong>
      <button class="btn-ghost sm" onclick="scanBrowseOpen()">← Categorías</button>
    </div>
    <input type="text" class="fi scan-big-in" placeholder="Filtrar dentro de ${escapeHTML(cat)}…"
      oninput="scanBrowseFilter(this.value)" autocomplete="off">
    <div class="scan-link-results" id="scanBrowseList">${scanBrowseItems(list)}</div>`;
}

function scanBrowseFilter(q) {
  const box = document.getElementById('scanBrowseList');
  if (!box || !scanBrowsing?.cat) return;
  const tokens = scanTokens(q);
  let list = invRows.filter(r => scanCatOf(r) === scanBrowsing.cat);
  if (tokens.length) list = list.filter(r => scanMatch(r, tokens));
  list.sort((a, b) => normTxt(a.jjp_products?.name).localeCompare(normTxt(b.jjp_products?.name)));
  box.innerHTML = scanBrowseItems(list);
}

// Puntúa un producto contra la consulta: exacto (SKU/código) manda, luego
// sufijo de código, empieza-con, incluye y cobertura de todas las palabras.
function scanScore(r, q, toks) {
  const nq = normTxt(q), digits = q.replace(/\D/g, '');
  const name = normTxt(r.jjp_products?.name), sku = normTxt(r.sku),
        brand = normTxt(r.jjp_brands?.name), vn = normTxt(r.variant_name);
  const bc = String(r.barcode || '');
  let s = 0;
  if (sku && sku === nq) s += 1000;
  if (bc && bc === q.trim()) s += 1000;
  if (bc && digits.length >= 4 && bc.endsWith(digits)) s += 500;   // código parcial
  if (sku && sku.startsWith(nq)) s += 230;
  if (name.startsWith(nq)) s += 200;
  if (nq.length >= 2 && name.includes(nq)) s += 90;
  if (nq.length >= 2 && brand.includes(nq)) s += 30;
  if (toks.length) {
    let tok = 0, all = true;
    for (const t of toks) {
      if (name.includes(t)) tok += 45; else if (brand.includes(t)) tok += 18;
      else if (sku.includes(t)) tok += 22; else if (vn.includes(t)) tok += 15; else { all = false; break; }
    }
    if (all) s += tok + 25;
  }
  return s;
}
function scanSearchHits(q) {
  const toks = scanTokens(q);
  const out = [];
  for (const r of invRows) { const s = scanScore(r, q, toks); if (s > 0) out.push([s, r]); }
  out.sort((a, b) => b[0] - a[0] ||
    normTxt(a[1].jjp_products?.name).localeCompare(normTxt(b[1].jjp_products?.name)));
  return out.slice(0, 25).map(x => x[1]);
}

function scanOmni(v) {
  const box = document.getElementById('scanSearchResults');
  if (!box) return;
  const q = (v || '').trim();
  if (!q) { box.innerHTML = ''; box.classList.remove('op'); return; }
  if (q.length < 2) { box.innerHTML = ''; box.classList.remove('op'); return; }

  const hits = scanSearchHits(q);
  box.classList.add('op');
  if (!hits.length) {
    box.innerHTML = scanIsCode(q)
      ? `<p class="scan-hint">Código no registrado. Pulsa Enter para contarlo — quedará por vincular.</p>`
      : `<p class="scan-hint">Nada con “${escapeHTML(q)}” en tu lista de precios.</p>
         <button class="btn-ghost scan-wide" onclick="scanBrowseOpen()">📖 Explorar por categoría (sin código)</button>
         <button class="btn-p scan-wide" onclick="scanNewOpen('')">➕ Crear producto nuevo</button>`;
    return;
  }
  box.innerHTML = hits.map(r => {
    const n = scanTally[r.id]?.n ?? 0;
    const bc = r.barcode ? ` · ${escapeHTML(r.barcode)}` : ' · sin código';
    return `
    <button class="scan-hit" onclick="scanPickRow('${r.id}')">
      <span class="scan-hit-name">${escapeHTML(r.jjp_products?.name || '—')}</span>
      <span class="scan-hit-sub">${escapeHTML(invLabel(r))} · SKU ${escapeHTML(r.sku || '—')}${bc}</span>
      <span class="scan-hit-n">${n > 0 ? `lleva ${n} · +1` : '+1'}</span>
    </button>`;
  }).join('');
}

// Cuenta un producto elegido de la búsqueda (sin escanear nada)
async function scanPickRow(id) {
  const row = invRows.find(r => r.id === id);
  if (!row) return;
  scanActive = { row };
  scanBeep();
  const total = (scanTally[row.id]?.n ?? 0) + 1;
  scanSetStatus(`✓ ${row.jjp_products?.name || ''} — ${total}`);
  await scanCountApply(row, +1, 'busqueda');
  const inp = document.getElementById('scanManualInput');
  if (inp) { inp.value = ''; inp.focus(); }
  scanOmni('');
}

// ---- Entrada manual (teclado / lector USB / pegar) ----
function scanManualSubmit(ev) {
  ev.preventDefault();
  const inp = document.getElementById('scanManualInput');
  const q = (inp.value || '').trim();
  if (!q) return;

  // Código exacto de un producto conocido → cuenta directo
  const byCode = invRows.find(r => (r.barcode || '').trim() === q);
  if (byCode) { inp.value = ''; scanOmni(''); delete scanSeen[q]; scanHandleCode(q); return; }

  if (scanIsCode(q)) {                       // código no registrado → a la cola
    inp.value = ''; scanOmni('');
    delete scanSeen[q];
    scanHandleCode(q);
    return;
  }

  // Texto: si la búsqueda dejó un único candidato, cuéntalo
  const tokens = scanTokens(q);
  const hits = tokens.length ? invRows.filter(r => scanMatch(r, tokens)) : [];
  if (hits.length === 1) { scanPickRow(hits[0].id); return; }
  scanOmni(q);                               // varios o ninguno: que elija
}

// ---- Ajuste manual del número contado ----
function scanSetCounted(v) {
  if (scanActive) scanCountSet(scanActive.row, v);
}
function scanBump(delta) {
  if (scanActive) scanCountApply(scanActive.row, delta, 'manual');
}

// ---- Render de paneles ----
function scanSetStatus(t) {
  const el = document.getElementById('scanStatus');
  if (el) el.textContent = t;
}

function scanTotals() {
  const ids = Object.keys(scanTally);
  return {
    productos: ids.length,
    unidades: ids.reduce((a, k) => a + (scanTally[k]?.n || 0), 0),
  };
}

function scanRenderActive() {
  const el = document.getElementById('scanActive');
  if (!el) return;
  if (!scanActive) { el.innerHTML = '<p class="scan-hint">Ningún producto en conteo todavía.</p>'; return; }
  const r = scanActive.row, p = r.jjp_products || {};
  const n = scanTally[r.id]?.n ?? 0;
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
      <span>Contadas:</span>
      <button class="qb" onclick="scanBump(-1)" aria-label="Restar uno">−</button>
      <input type="number" min="0" class="fi scan-count-in" value="${n}"
        onchange="scanSetCounted(this.value)" aria-label="Unidades contadas">
      <button class="qb" onclick="scanBump(1)" aria-label="Sumar uno">+</button>
      <button class="qb" onclick="scanBump(5)" aria-label="Sumar cinco">+5</button>
      <button class="qb" onclick="scanBump(10)" aria-label="Sumar diez">+10</button>
      <span class="scan-hint">se guarda solo</span>
    </div>`;
}

// Cola de códigos sin vincular + alta manual
function scanRenderUnknown() {
  const el = document.getElementById('scanLink');
  if (!el) return;

  // Si el operador está explorando por categoría, no lo interrumpas
  if (scanBrowsing) { scanBrowseRender(); return; }

  // Alta manual. Siempre deja salida hacia la búsqueda: si el producto sí
  // existía en la lista de precios, no debe quedarse atrapado creando uno nuevo.
  if (scanNewOpenFor !== null) {
    el.classList.add('op');
    el.innerHTML = scanNewForm();
    return;
  }

  if (scanLinking) {
    el.classList.add('op');
    el.innerHTML = `
      <div class="scan-link-head">
        <strong>🔍 ¿A qué producto pertenece ${escapeHTML(scanLinking)}?</strong>
        <button class="btn-ghost sm" onclick="scanCancelLink()">Cancelar</button>
      </div>
      <p class="scan-hint">Búscalo en tu lista de precios. Al elegirlo, el código queda guardado y suma 1.</p>
      <input type="text" class="fi scan-big-in" placeholder="Nombre, marca o SKU…"
        oninput="scanLinkSearch(this.value)" autofocus>
      <div class="scan-link-results" id="scanLinkResults"></div>
      <button class="btn-ghost scan-wide" onclick="scanNewOpen('${escapeHTML(scanLinking)}')">➕ No está en la lista: crear producto nuevo</button>`;
    return;
  }

  if (!scanUnknown.length) { el.classList.remove('op'); el.innerHTML = ''; return; }
  el.classList.add('op');
  el.innerHTML = `
    <div class="scan-link-head">
      <strong>${scanUnknown.length} código(s) sin identificar</strong>
      <span class="scan-hint">Puedes seguir contando</span>
    </div>
    <div class="scan-link-results">
      ${scanUnknown.map(u => `
        <div class="scan-unknown-card">
          <code>${escapeHTML(u.code)}</code>
          ${(u.seen > 1 || u.device) ? `<div class="scan-hint">${u.seen > 1 ? `visto ${u.seen}× ` : ''}${u.device ? `· desde ${escapeHTML(u.device)}` : ''}</div>` : ''}
          <button class="btn-p scan-wide" onclick="scanStartLink('${escapeHTML(u.code)}')">🔍 Buscarlo en mi lista de precios</button>
          <div class="scan-unknown-alt">
            <button class="btn-ghost sm" onclick="scanNewOpen('${escapeHTML(u.code)}')">➕ Crear nuevo</button>
            <button class="btn-ghost sm" onclick="scanDropUnknown('${escapeHTML(u.code)}')">✕ Descartar</button>
          </div>
        </div>`).join('')}
    </div>`;
}

// Avance del inventario + totales globales de la sesión
function scanRenderProgress() {
  const el = document.getElementById('scanProgress');
  if (!el) return;
  const total  = invRows.length;
  const hechos = invRows.filter(r => r.stock >= 0).length;
  const pct    = total ? Math.round(hechos / total * 100) : 0;
  const { productos, unidades } = scanTotals();
  const pend = scanQueue.length;
  el.innerHTML = `
    <div class="scan-who-row">
      <span class="scan-hint">Contando como <b>${escapeHTML(scanDevice)}</b></span>
      <button class="btn-ghost sm" onclick="scanSetDevice()" title="Cambiar tu nombre de contador">✏️ Cambiar</button>
    </div>
    <div class="scan-prog-bar"><span style="width:${pct}%"></span></div>
    <div class="scan-prog-txt">${hechos} de ${total} variantes contadas (${pct}%)</div>
    <div class="scan-tot-grid">
      <div class="scan-tot"><b>${productos}</b><span>productos contados</span></div>
      <div class="scan-tot"><b>${unidades}</b><span>unidades escaneadas</span></div>
      <div class="scan-tot"><b>${total - hechos}</b><span>sin contar</span></div>
    </div>
    ${scanLastRemote ? `<div class="scan-hint" style="color:var(--brand,#16604A)">📲 ${escapeHTML(scanLastRemote)}</div>` : ''}
    ${scanConflicts ? `<div class="scan-hint" style="color:var(--danger)">⚠️ ${scanConflicts} producto(s) contados por 2+ personas — <a href="conteo.html" target="_blank">revisar cruces</a></div>` : ''}
    ${pend ? `<div class="scan-hint" style="color:var(--danger)">⏳ ${pend} conteo(s) esperando conexión — no se pierden</div>` : ''}
    <div class="scan-tot-actions">
      <button class="btn-ghost sm" onclick="scanBrowseOpen()" title="Contar productos que no tienen código de barras">📖 Sin código</button>
      <button class="btn-ghost sm" onclick="scanNewOpen('')">➕ Producto nuevo</button>
      <button class="btn-ghost sm" onclick="scanShowDetail()">📋 Ver detalle</button>
      <button class="btn-ghost sm" onclick="invScanReset()" title="Borrar el conteo y empezar de cero">♻️ Reiniciar conteo</button>
    </div>`;
}

// Detalle de todo lo contado en la sesión (y export rápido)
function scanShowDetail() {
  scanBrowsing = null;
  const ids = Object.keys(scanTally).sort((a, b) => (scanTally[b].n || 0) - (scanTally[a].n || 0));
  if (!ids.length) { showToast('Todavía no has contado nada', 'warn'); return; }
  const { productos, unidades } = scanTotals();
  const el = document.getElementById('scanLink');
  if (!el) return;
  el.classList.add('op');
  el.innerHTML = `
    <div class="scan-link-head">
      <strong>📋 ${productos} producto(s) · ${unidades} unidad(es)</strong>
      <button class="btn-ghost sm" onclick="scanRenderUnknown()">Cerrar</button>
    </div>
    <div class="scan-link-results">
      ${ids.map(id => {
        const t = scanTally[id];
        return `<div class="scan-unknown-row">
          <span style="flex:1">${escapeHTML(t.name || '—')}<br><small style="color:var(--gr)">SKU ${escapeHTML(t.sku || '—')}</small></span>
          <strong>${t.n}</strong>
        </div>`;
      }).join('')}
    </div>
    <button class="btn-ghost sm" onclick="scanExportCount()">⬇️ Descargar CSV del conteo</button>`;
}

function scanExportCount() {
  const ids = Object.keys(scanTally);
  if (!ids.length) return;
  const esc = s => { s = String(s ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ids.map(id => {
    const t = scanTally[id], r = invRows.find(x => x.id === id);
    return [esc(t.name), esc(t.sku), esc(r?.barcode || ''), esc(invLabel(r || {})), t.n].join(',');
  });
  const blob = new Blob(['﻿' + 'producto,sku,codigo,presentacion,contadas\n' + lines.join('\n')],
    { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jjpaper_conteo_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---- Puente teléfono ⇄ PC (Realtime jjp_scan_events) ----
// El teléfono (admin/escaner.html) inserta un evento por cada código.
// La PC lo procesa, lo marca como atendido y le devuelve el resultado
// escribiéndolo en la misma fila (result) — el teléfono lo ve en vivo.
let scanBridgeCh   = null;
let scanBridgeOk   = false;
const scanRemoteSeen = {};   // code -> última vez procesado (dedup de inserts repetidos)

function scanStartBridge() {
  if (scanBridgeCh) return;                         // ya suscrito
  const uid = (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id) || null;
  if (!uid) return;
  scanBridgeCh = sb.channel('scan-bridge-' + uid)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_scan_events',
        filter: 'owner_id=eq.' + uid },
      payload => scanOnRemote(payload.new))
    .subscribe(status => {
      scanBridgeOk = status === 'SUBSCRIBED';
      scanRenderBridge();
      // Al (re)conectar, recupera lo que llegó mientras estuvo caído
      if (scanBridgeOk) scanDrainPending();
    });

  // Si la pestaña estuvo en segundo plano, Realtime pudo perder eventos
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scanDrainPending(); scanFlushQueue(); scanLoadUnknownRemote(); }
  });

  scanStartLogFeed();   // refleja en vivo lo que cuentan los teléfonos
}

function scanRenderBridge() {
  const el = document.getElementById('scanBridgeState');
  if (!el) return;
  el.textContent = scanFeedOk ? '📲 En vivo' : (scanBridgeOk ? '📲 Puente activo' : '📲 Conectando…');
  el.className = 'scan-bridge ' + ((scanFeedOk || scanBridgeOk) ? 'on' : 'off');
}

// ======================================================
//  Feed en vivo del conteo (todos los que cuentan a la vez)
//  El teléfono ahora cuenta directo por RPC (jjp_count_scan), así que la
//  PC ya no recibe el puente de eventos: en su lugar escucha jjp_count_log.
//  Cada INSERT trae variant_id + counted_after + counted_by → reflejamos
//  el conteo de todos sin recargar y avisamos si otra persona sumó.
// ======================================================
let scanFeedCh = null;
let scanFeedOk = false;

function scanStartLogFeed() {
  if (scanFeedCh) return;
  const uid = (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id) || null;
  if (!uid) return;
  scanFeedCh = sb.channel('count-feed-' + uid)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_count_log',
        filter: 'owner_id=eq.' + uid },
      payload => scanOnLogEvent(payload.new))
    .subscribe(status => { scanFeedOk = status === 'SUBSCRIBED'; scanRenderBridge(); });
}

function scanOnLogEvent(row) {
  if (!row || row.session_key !== SCAN_SESSION || !row.variant_id) return;
  const id = row.variant_id;
  const rowObj = invRows.find(r => r.id === id);

  // Refleja el acumulado autoritativo que dejó la base
  if (typeof row.counted_after === 'number') {
    scanTally[id] = {
      n: row.counted_after,
      name: rowObj?.jjp_products?.name || scanTally[id]?.name || '',
      sku:  rowObj?.sku || scanTally[id]?.sku || '',
    };
    if (rowObj) rowObj.stock = row.counted_after;
    scanSaveLocal();
    scanRenderProgress();
    if (scanActive && scanActive.row.id === id) scanRenderActive();
  }

  // Aviso de otra persona (lo propio ya se pintó localmente)
  const mine = row.counted_by && row.counted_by === scanDevice;
  if (!mine && row.delta > 0) {
    const quien = row.counted_by || 'otro equipo';
    const nombre = rowObj?.jjp_products?.name || 'un producto';
    scanLastRemote = `${quien}: +${row.delta} ${nombre} (${row.counted_after ?? '?'})`;
    scanRenderProgress();
    // Refresca cruces de vez en cuando (no en cada evento)
    if (Math.random() < 0.15) scanLoadConflicts().then(scanRenderProgress);
  }
}

// Códigos sin vincular que los teléfonos dejaron en jjp_count_unknown.
// Los mezcla con los que detectó la cámara local, sin duplicar.
async function scanLoadUnknownRemote() {
  const { data, error } = await sb.from('jjp_count_unknown')
    .select('code,device,seen,last_at')
    .eq('session_key', SCAN_SESSION).is('resolved_at', null)
    .order('last_at', { ascending: false }).limit(200);
  if (error || !data) return;                 // base sin migración → sigue solo con lo local
  for (const u of data) {
    const code = (u.code || '').trim();
    if (!code || scanUnknown.some(x => x.code === code)) continue;
    scanUnknown.push({ code, at: Date.now(), seen: u.seen, device: u.device, remote: true });
  }
  scanRenderUnknown();
}

// Marca un desconocido como resuelto (al vincularlo o crearlo)
async function scanResolveUnknown(code) {
  if (!code) return;
  await sb.rpc('jjp_count_unknown_resolve', { p_code: code, p_session: SCAN_SESSION });
}

async function scanLoadConflicts() {
  const { count, error } = await sb.from('jjp_count_conflicts')
    .select('variant_id', { count: 'exact', head: true })
    .eq('session_key', SCAN_SESSION);
  if (!error) scanConflicts = count || 0;
}

// Procesa los eventos que el teléfono envió y esta PC todavía no atendió
// (PC cerrada, pestaña dormida, Realtime caído). Se ejecuta al abrir el modo
// conteo, al reconectar y al volver a la pestaña.
async function scanDrainPending() {
  const uid = (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id) || null;
  if (!uid) return;
  const { data, error } = await sb.from('jjp_scan_events')
    .select('id,code,created_at')
    .eq('owner_id', uid).is('handled_at', null)
    .gte('created_at', new Date(Date.now() - 6 * 3600e3).toISOString())
    .order('created_at', { ascending: true }).limit(500);
  if (error || !data?.length) return;
  scanSetStatus(`📲 Recuperando ${data.length} escaneo(s) del teléfono…`);
  for (const ev of data) await scanProcessEvent(ev);
  scanSetStatus(`📲 ${data.length} escaneo(s) recuperados`);
}

function scanOnRemote(row) {
  const code = (row?.code || '').trim();
  if (!code) return;
  const now = Date.now();
  // Dedup de ráfaga: el mismo código dos veces en <400ms es una doble lectura
  if (scanRemoteSeen[code] && now - scanRemoteSeen[code] < 400) { scanAckEvent(row.id, { ok: true, kind: 'dup', msg: 'Lectura repetida, ignorada' }); return; }
  scanRemoteSeen[code] = now;
  scanProcessEvent(row);
}

async function scanProcessEvent(ev) {
  // Abre el overlay al primer escaneo remoto para que se vea el conteo activo
  const ov = document.getElementById('scanOverlay');
  if (ov && !ov.classList.contains('op')) {
    ov.classList.add('op');
    document.body.style.overflow = 'hidden';
    scanStopCamera();                               // sin cámara local: el teléfono escanea
    scanSetStatus('📲 Escaneando desde el teléfono…');
    await scanSyncTally();
    scanRenderProgress();
  }
  const res = scanHandleCode((ev.code || '').trim(), 'telefono');
  await scanAckEvent(ev.id, res);
}

// Le responde al teléfono escribiendo el resultado en la misma fila
async function scanAckEvent(id, result) {
  if (!id) return;
  await sb.from('jjp_scan_events')
    .update({ handled_at: new Date().toISOString(), result: result || null })
    .eq('id', id);
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
