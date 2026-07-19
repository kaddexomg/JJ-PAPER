/* ======================================================
   JJ Paper Admin — Control del conteo
   Corregir lo que salió mal durante el inventario y saber
   cuánto vale lo contado.

   - Ajustar cantidades, quitar del conteo.
   - Arreglar códigos cruzados: ver a qué producto apunta cada
     código, moverlo al correcto o quitarlo. Todo queda en la
     bitácora jjp_barcode_log y se puede deshacer.
   - Valorización a costo y a precio de venta, en USD y en Bs.

   Usa de config.js: getBcvRate(), fmtBs(); de toast.js: showToast().
   ====================================================== */

const CC_SESSION = 'default';

let ccRows   = [];      // filas de jjp_count_valued
let ccSearch = '';
let ccSort   = 'valor'; // valor | cantidad | nombre | reciente
let ccOnlyProblem = false;

// ---- Carga ----
async function ccLoad() {
  const tb = document.getElementById('ccBody');
  if (tb) tb.innerHTML = `<tr><td colspan="8" class="table-empty">Cargando conteo…</td></tr>`;

  const { data, error } = await sb.from('jjp_count_valued')
    .select('*').eq('session_key', CC_SESSION).limit(5000);
  if (error) {
    if (tb) tb.innerHTML = `<tr><td colspan="8" class="table-empty">No se pudo cargar (¿falta aplicar la migración SQL?): ${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  ccRows = data || [];
  ccRenderStats();
  ccRender();
  ccLoadCounters();
  ccLoadConflicts();
  ccLoadDupes();
  ccLoadLog();
  ccLoadMoves();
}

// ---- Quién contó (varias personas a la vez) ----
async function ccLoadCounters() {
  const el = document.getElementById('ccCounters');
  if (!el) return;
  const { data, error } = await sb.from('jjp_count_counters')
    .select('*').eq('session_key', CC_SESSION).order('unidades', { ascending: false });
  if (error || !data?.length) { el.innerHTML = ''; return; }
  if (data.length < 2 && data[0]?.quien === '(sin nombre)') { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="table-top"><h3>👥 Quién contó</h3>
      <span style="font-size:12px;color:var(--gr)">Aporte de cada persona en este conteo</span></div>
    <div class="cc-val-grid" style="margin-bottom:0">
      ${data.map(c => `
        <div class="cc-val">
          <div class="cc-val-l">${escapeHTML(c.quien)}</div>
          <div class="cc-val-n">${(c.unidades || 0).toLocaleString('es-VE')}</div>
          <div class="cc-val-bs">${c.productos} producto(s) · ${c.movimientos} movimiento(s)</div>
        </div>`).join('')}
    </div>`;
}

// ---- Cruces: mismo producto contado por 2+ personas ----
async function ccLoadConflicts() {
  const el = document.getElementById('ccConflicts');
  if (!el) return;
  const { data, error } = await sb.from('jjp_count_conflicts')
    .select('*').eq('session_key', CC_SESSION).order('ultimo', { ascending: false }).limit(100);
  if (error) { el.innerHTML = ''; return; }
  if (!data?.length) {
    el.innerHTML = `<div class="cc-ok">✓ Ningún producto fue contado por dos personas distintas.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="cc-alert">
      <strong>⚠️ ${data.length} producto(s) contados por 2+ personas</strong>
      <p class="cc-hint">Suma colaborativa: puede ser correcto (dos aportes), pero revisa que no sea el mismo estante contado dos veces. Si sobró, ajusta la cantidad o usa 🔀 para mover.</p>
      ${data.map(d => `
        <div class="cc-dupe-row">
          <div style="flex:1">
            <strong>${escapeHTML(d.product_name || '—')}</strong>
            <div class="td-sub">${escapeHTML(d.brand_name || 'Genérica')} · SKU ${escapeHTML(d.sku || '—')} · total contado: <b>${d.total}</b></div>
            <div class="td-sub">👥 ${escapeHTML(d.quienes || '—')}</div>
          </div>
          <button class="btn-ghost sm" onclick="ccSearch=''; document.querySelector('.srch input').value='${escapeHTML(d.sku || d.product_name || '')}'; ccOnSearch('${escapeHTML(d.sku || d.product_name || '')}')">Ver</button>
        </div>`).join('')}
    </div>`;
}

// ---- Valorización ----
function ccTotals() {
  const t = { productos: ccRows.length, unidades: 0, costo: 0, venta: 0, sinCosto: 0 };
  for (const r of ccRows) {
    t.unidades += r.counted || 0;
    t.costo    += parseFloat(r.costo_total_usd) || 0;
    t.venta    += parseFloat(r.venta_total_usd) || 0;
    if (r.cost_usd == null || parseFloat(r.cost_usd) === 0) t.sinCosto++;
  }
  return t;
}

function ccRenderStats() {
  const t = ccTotals();
  const rate = (typeof getBcvRate === 'function') ? getBcvRate() : 0;
  const bs = usd => rate ? (usd * rate) : 0;
  const nBs = n => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };

  set('cc-prod',  t.productos);
  set('cc-unid',  t.unidades.toLocaleString('es-VE'));
  set('cc-costo', `$${t.costo.toFixed(2)}`);
  set('cc-venta', `$${t.venta.toFixed(2)}`);
  set('cc-costo-bs', rate ? `Bs ${nBs(bs(t.costo))}` : 'sin tasa');
  set('cc-venta-bs', rate ? `Bs ${nBs(bs(t.venta))}` : 'sin tasa');

  const margen = t.costo > 0 ? ((t.venta / t.costo - 1) * 100) : null;
  set('cc-margen', margen === null ? '—' : `${margen.toFixed(1)}%`);

  const rateEl = document.getElementById('ccRateInfo');
  if (rateEl) rateEl.textContent = rate ? `Tasa BCV: Bs ${nBs(rate)} por USD` : 'Tasa BCV no disponible';

  // Aviso honesto: sin costos cargados, la valorización a costo no significa nada
  const warn = document.getElementById('ccCostWarn');
  if (warn) {
    if (t.sinCosto) {
      warn.style.display = '';
      warn.innerHTML = `⚠️ <strong>${t.sinCosto} de ${t.productos}</strong> productos contados no tienen costo cargado,
        así que el total a costo está incompleto. Cárgalos en
        <a href="productos.html">Productos</a> o por CSV para que la valorización sea real.`;
    } else warn.style.display = 'none';
  }
}

// ---- Tabla ----
function ccFiltered() {
  const q = normTxt(ccSearch);
  let list = ccRows.filter(r => {
    if (ccOnlyProblem && !ccIsProblem(r)) return false;
    if (!q) return true;
    return normTxt(r.product_name).includes(q)
        || normTxt(r.brand_name).includes(q)
        || normTxt(r.sku).includes(q)
        || normTxt(r.barcode).includes(q);
  });
  const num = v => parseFloat(v) || 0;
  list.sort((a, b) =>
    ccSort === 'cantidad' ? b.counted - a.counted :
    ccSort === 'nombre'   ? String(a.product_name).localeCompare(String(b.product_name)) :
    ccSort === 'reciente' ? new Date(b.updated_at) - new Date(a.updated_at) :
    num(b.venta_total_usd) - num(a.venta_total_usd));
  return list;
}

// Señales de que algo pudo salir cruzado o quedar a medias
function ccIsProblem(r) {
  return !r.barcode                                   // contado sin código
    || r.cost_usd == null || parseFloat(r.cost_usd) === 0  // sin costo
    || parseFloat(r.price_usd) === 0;                 // sin precio
}

function ccRender() {
  const tb = document.getElementById('ccBody');
  if (!tb) return;
  const list = ccFiltered();
  const cnt = document.getElementById('ccCount');
  if (cnt) cnt.textContent = `${list.length} producto${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8" class="table-empty">${ccRows.length ? 'Sin resultados con ese filtro' : 'Todavía no hay nada contado'}</td></tr>`;
    return;
  }

  const rate = (typeof getBcvRate === 'function') ? getBcvRate() : 0;
  tb.innerHTML = list.map(r => {
    const venta = parseFloat(r.venta_total_usd) || 0;
    const costo = parseFloat(r.costo_total_usd) || 0;
    const sub = [r.brand_name, r.variant_name].filter(Boolean).join(' · ') || 'Genérica';
    const flags = [];
    if (!r.barcode) flags.push('<span class="badge badge-yellow" title="Contado sin código de barras">sin código</span>');
    if (r.cost_usd == null || parseFloat(r.cost_usd) === 0) flags.push('<span class="badge badge-gray" title="Falta el costo">sin costo</span>');
    if (parseFloat(r.price_usd) === 0) flags.push('<span class="badge badge-red" title="Precio en cero">sin precio</span>');

    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(r.product_name || '—')}</div>
        <div class="td-sub">${escapeHTML(sub)} · SKU ${escapeHTML(r.sku || '—')}</div>
        ${flags.length ? `<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">${flags.join('')}</div>` : ''}
      </td>
      <td>
        ${r.barcode
          ? `<code class="cc-code">${escapeHTML(r.barcode)}</code>`
          : `<span style="color:var(--gr);font-size:12px">—</span>`}
      </td>
      <td class="cc-qty-cell">
        <button class="qb" onclick="ccBump('${r.variant_id}',-1)" aria-label="Restar uno">−</button>
        <input type="number" min="0" class="fi cc-qty" value="${r.counted}"
          onchange="ccSetQty('${r.variant_id}', this.value)" aria-label="Unidades contadas">
        <button class="qb" onclick="ccBump('${r.variant_id}',1)" aria-label="Sumar uno">+</button>
      </td>
      <td style="text-align:right">${r.cost_usd != null ? '$' + parseFloat(r.cost_usd).toFixed(2) : '—'}</td>
      <td style="text-align:right">$${parseFloat(r.price_usd).toFixed(2)}</td>
      <td style="text-align:right">${costo ? '$' + costo.toFixed(2) : '—'}</td>
      <td style="text-align:right">
        <strong>$${venta.toFixed(2)}</strong>
        ${rate ? `<div class="cc-bs">Bs ${(venta * rate).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</div>` : ''}
      </td>
      <td>
        <div class="cc-actions">
          <button class="btn-ghost sm" onclick="ccFixCode('${r.variant_id}')" title="Corregir el código de barras">🔗</button>
          <button class="btn-ghost sm" onclick="ccTransferOpen('${r.variant_id}')" title="Mover unidades contadas a otro producto (conteo cruzado)">🔀</button>
          <button class="btn-ghost sm" onclick="ccRemove('${r.variant_id}')" title="Quitar del conteo (vuelve a 'sin contar')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ---- Edición de cantidades ----
async function ccSetQty(variantId, value) {
  const n = Math.max(0, parseInt(value) || 0);
  const row = ccRows.find(r => r.variant_id === variantId);
  if (!row) return;
  const prev = row.counted;
  row.counted = n;
  ccRecalc(row);
  ccRenderStats(); ccRender();

  const { error } = await sb.rpc('jjp_count_set', {
    p_variant_id: variantId, p_total: n, p_session: CC_SESSION
  });
  if (error) {
    row.counted = prev; ccRecalc(row); ccRenderStats(); ccRender();
    showToast('No se pudo guardar: ' + error.message, 'err');
  } else {
    showToast(`${row.product_name}: ${prev} → ${n}`, 'ok');
  }
}

function ccBump(variantId, delta) {
  const row = ccRows.find(r => r.variant_id === variantId);
  if (row) ccSetQty(variantId, Math.max(0, row.counted + delta));
}

function ccRecalc(row) {
  row.costo_total_usd = row.counted * (parseFloat(row.cost_usd) || 0);
  row.venta_total_usd = row.counted * (parseFloat(row.price_usd) || 0);
}

// Quitar del conteo: distinto de poner 0 (0 = "conté y no hay";
// quitar = "esto nunca debió contarse", vuelve a sin control)
async function ccRemove(variantId) {
  const row = ccRows.find(r => r.variant_id === variantId);
  if (!row) return;
  if (!confirm(`Quitar "${row.product_name}" del conteo.\n\nSus ${row.counted} unidad(es) contadas se descartan y el producto vuelve a "sin contar". ¿Continuar?`)) return;
  const { error } = await sb.rpc('jjp_count_remove', { p_variant_id: variantId, p_session: CC_SESSION });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  ccRows = ccRows.filter(r => r.variant_id !== variantId);
  ccRenderStats(); ccRender();
  showToast(`"${row.product_name}" quitado del conteo`, 'ok');
}

// ======================================================
//  Corregir códigos cruzados
// ======================================================
let ccFixing = null;

function ccFixCode(variantId) {
  ccFixing = ccRows.find(r => r.variant_id === variantId) || null;
  ccRenderFix();
  document.getElementById('ccFixPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function ccFixCancel() { ccFixing = null; ccRenderFix(); }

function ccRenderFix() {
  const el = document.getElementById('ccFixPanel');
  if (!el) return;
  if (!ccFixing) { el.classList.remove('op'); el.innerHTML = ''; return; }
  const r = ccFixing;
  const sub = [r.brand_name, r.variant_name].filter(Boolean).join(' · ') || 'Genérica';
  el.classList.add('op');
  el.innerHTML = `
    <div class="cc-fix-head">
      <div>
        <strong>🔗 Código de: ${escapeHTML(r.product_name)}</strong>
        <div class="td-sub">${escapeHTML(sub)} · SKU ${escapeHTML(r.sku || '—')}</div>
      </div>
      <button class="btn-ghost sm" onclick="ccFixCancel()">Cerrar</button>
    </div>
    <p class="cc-hint">Código actual: ${r.barcode ? `<code class="cc-code">${escapeHTML(r.barcode)}</code>` : '<em>ninguno</em>'}</p>
    <div class="cc-fix-row">
      <input type="text" class="fi" id="ccNewCode" placeholder="Escanea o escribe el código correcto…"
        value="" autocomplete="off">
      <button class="btn-p" onclick="ccAssign()">Asignar</button>
    </div>
    <p class="cc-hint">Si ese código estaba en otro producto, se le quita a ese y se le pone a este. Queda registrado abajo y puedes deshacerlo.</p>
    ${r.barcode ? `<button class="btn-ghost cc-wide" onclick="ccClearCode()">✕ Quitarle el código a este producto</button>` : ''}`;
  setTimeout(() => document.getElementById('ccNewCode')?.focus(), 50);
}

async function ccAssign() {
  if (!ccFixing) return;
  const code = (document.getElementById('ccNewCode')?.value || '').trim();
  if (!code) { showToast('Escribe o escanea un código', 'warn'); return; }

  const owner = ccRows.find(r => r.barcode === code && r.variant_id !== ccFixing.variant_id);
  if (owner && !confirm(`El código ${code} está ahora en "${owner.product_name}".\n\nSe lo quitaremos y se lo pondremos a "${ccFixing.product_name}". ¿Continuar?`)) return;

  const { data, error } = await sb.rpc('jjp_barcode_assign', {
    p_variant_id: ccFixing.variant_id, p_code: code, p_note: 'corrección desde control del conteo'
  });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }

  ccFixing.barcode = code;
  if (data?.stolen_from) {
    const victim = ccRows.find(r => r.variant_id === data.stolen_from);
    if (victim) victim.barcode = null;
  }
  showToast(`Código ${code} → ${ccFixing.product_name}`, 'ok');
  ccFixing = null;
  ccRenderFix(); ccRender(); ccLoadDupes(); ccLoadLog();
}

async function ccClearCode() {
  if (!ccFixing || !ccFixing.barcode) return;
  if (!confirm(`Quitar el código ${ccFixing.barcode} de "${ccFixing.product_name}"?\n\nEl conteo no se toca; sólo deja de reconocerse al escanear.`)) return;
  const { error } = await sb.rpc('jjp_barcode_clear', { p_variant_id: ccFixing.variant_id });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  ccFixing.barcode = null;
  showToast('Código quitado', 'ok');
  ccFixing = null;
  ccRenderFix(); ccRender(); ccLoadDupes(); ccLoadLog();
}

// ======================================================
//  Transferir unidades: el arreglo del conteo cruzado
//  "Conté (o el escáner contó) en el producto que no era."
// ======================================================
let ccTransferFrom = null;   // fila de origen
let ccAllVariants  = null;   // catálogo completo para elegir destino

async function ccTransferOpen(variantId) {
  ccTransferFrom = ccRows.find(r => r.variant_id === variantId) || null;
  if (!ccTransferFrom) return;
  if (!ccAllVariants) {
    const { data } = await sb.from('jjp_product_variants')
      .select('id,sku,barcode,variant_name,jjp_products(name),jjp_brands(name)')
      .limit(3000);
    ccAllVariants = data || [];
  }
  ccRenderTransfer();
  document.getElementById('ccTransferPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function ccTransferCancel() { ccTransferFrom = null; ccRenderTransfer(); }

function ccRenderTransfer() {
  const el = document.getElementById('ccTransferPanel');
  if (!el) return;
  if (!ccTransferFrom) { el.classList.remove('op'); el.innerHTML = ''; return; }
  const r = ccTransferFrom;
  el.classList.add('op');
  el.innerHTML = `
    <div class="cc-fix-head">
      <div>
        <strong>🔀 Mover unidades de: ${escapeHTML(r.product_name)}</strong>
        <div class="td-sub">Tiene ${r.counted} contada(s) · SKU ${escapeHTML(r.sku || '—')}</div>
      </div>
      <button class="btn-ghost sm" onclick="ccTransferCancel()">Cerrar</button>
    </div>
    <p class="cc-hint">Para cuando se contó aquí lo que era de otro producto. Las unidades salen de este y entran al que elijas; ambos movimientos quedan en la bitácora.</p>
    <div class="cc-fix-row">
      <input type="number" class="fi" id="ccTransQty" min="1" max="${r.counted}" value="1"
        style="max-width:110px" aria-label="Unidades a mover">
      <input type="text" class="fi" id="ccTransSearch" placeholder="¿A qué producto van? Nombre, SKU o código…"
        oninput="ccTransferSearch(this.value)" autocomplete="off">
    </div>
    <div class="scan-link-results" id="ccTransResults"></div>`;
  setTimeout(() => document.getElementById('ccTransSearch')?.focus(), 50);
}

function ccTransferSearch(q) {
  const box = document.getElementById('ccTransResults');
  if (!box || !ccTransferFrom) return;
  const term = normTxt(q);
  if (term.length < 2) { box.innerHTML = '<p class="cc-hint">Escribe al menos 2 letras…</p>'; return; }
  const hits = (ccAllVariants || []).filter(v =>
    v.id !== ccTransferFrom.variant_id && (
      normTxt(v.jjp_products?.name).includes(term) ||
      normTxt(v.jjp_brands?.name).includes(term) ||
      normTxt(v.sku).includes(term) ||
      normTxt(v.barcode).includes(term)
    )).slice(0, 20);
  if (!hits.length) { box.innerHTML = '<p class="cc-hint">Sin coincidencias.</p>'; return; }
  box.innerHTML = hits.map(v => {
    const sub = [v.jjp_brands?.name, v.variant_name].filter(Boolean).join(' · ') || 'Genérica';
    const ya = ccRows.find(r => r.variant_id === v.id);
    return `
    <button class="scan-hit" onclick="ccTransferDo('${v.id}')">
      <span class="scan-hit-name">${escapeHTML(v.jjp_products?.name || '—')}</span>
      <span class="scan-hit-sub">${escapeHTML(sub)} · SKU ${escapeHTML(v.sku || '—')}${ya ? ` · lleva ${ya.counted} contadas` : ' · aún sin contar'}</span>
    </button>`;
  }).join('');
}

async function ccTransferDo(toId) {
  if (!ccTransferFrom) return;
  const qty = Math.max(1, parseInt(document.getElementById('ccTransQty')?.value) || 1);
  const dest = (ccAllVariants || []).find(v => v.id === toId);
  const destName = dest?.jjp_products?.name || 'el producto elegido';
  if (qty > ccTransferFrom.counted) {
    showToast(`Sólo hay ${ccTransferFrom.counted} contadas en el origen`, 'warn'); return;
  }
  if (!confirm(`Mover ${qty} unidad(es):\n\n${ccTransferFrom.product_name}  →  ${destName}\n\n¿Continuar?`)) return;

  const { error } = await sb.rpc('jjp_count_transfer', {
    p_from: ccTransferFrom.variant_id, p_to: toId, p_qty: qty, p_session: CC_SESSION
  });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(`${qty} unidad(es) movidas a ${destName}`, 'ok', 5000);
  ccTransferFrom = null;
  await ccLoad();               // recarga todo: totales, tabla y bitácora
}

// ======================================================
//  Bitácora de movimientos del conteo (con deshacer)
// ======================================================
let ccMovesSource = '';

const CC_SRC_BADGE = {
  pc:            ['badge-green',  '💻 PC'],
  telefono:      ['badge-blue',   '📲 Teléfono'],
  manual:        ['badge-yellow', '✍️ Manual'],
  busqueda:      ['badge-green',  '🔍 Búsqueda'],
  transferencia: ['badge-blue',   '🔀 Transferencia'],
  reverso:       ['badge-red',    '↩️ Reverso'],
  historico:     ['badge-gray',   '📦 Histórico'],
};

function ccOnMovesSource(v) { ccMovesSource = v; ccLoadMoves(); }

async function ccLoadMoves() {
  const el = document.getElementById('ccMovesBody');
  if (!el) return;
  let q = sb.from('jjp_count_log_view')
    .select('*').eq('session_key', CC_SESSION)
    .order('created_at', { ascending: false }).limit(200);
  if (ccMovesSource) q = q.eq('source', ccMovesSource);
  const { data, error } = await q;
  if (error) {
    el.innerHTML = `<tr><td colspan="7" class="table-empty">Bitácora de movimientos no disponible (¿falta la migración?).</td></tr>`;
    return;
  }
  if (!data?.length) {
    el.innerHTML = `<tr><td colspan="7" class="table-empty">Sin movimientos${ccMovesSource ? ' de ese origen' : ''}.</td></tr>`;
    return;
  }
  el.innerHTML = data.map(m => {
    const d = new Date(m.created_at);
    const cuando = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' }) + ' ' +
                   d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const [cls, label] = CC_SRC_BADGE[m.source] || ['badge-gray', escapeHTML(m.source)];
    const delta = m.delta > 0
      ? `<strong style="color:var(--gd,#2f7d32)">+${m.delta}</strong>`
      : `<strong style="color:var(--danger,#c0392b)">${m.delta}</strong>`;
    const deshecho = !!m.reverted_by;
    const esReverso = !!m.reverts;
    return `<tr${deshecho ? ' style="opacity:.5"' : ''}>
      <td style="font-size:12px;white-space:nowrap">${cuando}</td>
      <td><div class="td-name">${escapeHTML(m.product_name || '—')}</div>
        <div class="td-sub">SKU ${escapeHTML(m.sku || '—')}</div></td>
      <td style="text-align:center">${delta}</td>
      <td style="text-align:center">${m.counted_after ?? '—'}</td>
      <td>${m.counted_by ? escapeHTML(m.counted_by) : '<span style="color:var(--gr)">—</span>'}</td>
      <td><span class="badge ${cls}">${label}</span>
        ${m.note ? `<div class="td-sub">${escapeHTML(m.note)}</div>` : ''}
        ${deshecho ? '<div class="td-sub">✓ deshecho</div>' : ''}</td>
      <td>${(!deshecho && !esReverso && m.delta !== 0)
        ? `<button class="btn-ghost sm" onclick="ccRevertMove('${m.id}', ${m.delta}, '${escapeHTML(m.product_name || '')}')">↩️ Deshacer</button>`
        : ''}</td>
    </tr>`;
  }).join('');
}

async function ccRevertMove(logId, delta, name) {
  const verbo = delta > 0 ? `restar ${delta}` : `devolver ${-delta}`;
  if (!confirm(`Deshacer este movimiento de "${name}" (${verbo} unidad(es)). ¿Continuar?`)) return;
  const { error } = await sb.rpc('jjp_count_revert', { p_log_id: logId });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Movimiento deshecho', 'ok');
  await ccLoad();
}

// ---- Códigos repartidos en más de un producto ----
async function ccLoadDupes() {
  const el = document.getElementById('ccDupes');
  if (!el) return;
  const { data, error } = await sb.from('jjp_barcode_dupes').select('*').limit(100);
  if (error) { el.innerHTML = ''; return; }
  if (!data?.length) {
    el.innerHTML = `<div class="cc-ok">✓ Ningún código está repetido en dos productos.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="cc-alert">
      <strong>⚠️ ${data.length} código(s) apuntan a más de un producto</strong>
      <p class="cc-hint">Al escanearlos, el conteo puede caer en el producto equivocado. Usa 🔗 para dejar cada código en uno solo.</p>
      ${data.map(d => `
        <div class="cc-dupe-row">
          <code class="cc-code">${escapeHTML(d.barcode)}</code>
          <span>${escapeHTML(d.productos)}</span>
        </div>`).join('')}
    </div>`;
}

// ---- Bitácora de códigos (con deshacer) ----
async function ccLoadLog() {
  const el = document.getElementById('ccLogBody');
  if (!el) return;
  const { data, error } = await sb.from('jjp_barcode_log')
    .select('*').order('created_at', { ascending: false }).limit(50);
  if (error) {
    el.innerHTML = `<tr><td colspan="4" class="table-empty">Bitácora no disponible.</td></tr>`;
    return;
  }
  if (!data?.length) {
    el.innerHTML = `<tr><td colspan="4" class="table-empty">Sin cambios de códigos registrados. Lo que corrijas desde aquí quedará listado para poder deshacerlo.</td></tr>`;
    return;
  }
  el.innerHTML = data.map(l => {
    const d = new Date(l.created_at);
    const cuando = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' }) + ' ' +
                   d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const row = ccRows.find(r => r.variant_id === l.variant_id);
    const cls = l.action === 'vincular' ? 'badge-green' : 'badge-yellow';
    const puedeDeshacer = l.prev_code && l.variant_id;
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${cuando}</td>
      <td>${escapeHTML(row?.product_name || '(producto fuera del conteo)')}</td>
      <td>
        <span class="badge ${cls}">${escapeHTML(l.action)}</span>
        ${l.prev_code ? `<code class="cc-code">${escapeHTML(l.prev_code)}</code> →` : ''}
        ${l.code ? `<code class="cc-code">${escapeHTML(l.code)}</code>` : '<em>ninguno</em>'}
        ${l.note ? `<div class="td-sub">${escapeHTML(l.note)}</div>` : ''}
      </td>
      <td>${puedeDeshacer
        ? `<button class="btn-ghost sm" onclick="ccUndo('${l.variant_id}','${escapeHTML(l.prev_code)}')">↩️ Deshacer</button>`
        : ''}</td>
    </tr>`;
  }).join('');
}

async function ccUndo(variantId, prevCode) {
  if (!confirm(`Devolver el código ${prevCode} a este producto?`)) return;
  const { error } = await sb.rpc('jjp_barcode_assign', {
    p_variant_id: variantId, p_code: prevCode, p_note: 'deshacer'
  });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Cambio deshecho', 'ok');
  await ccLoad();
}

// ---- Filtros ----
let ccTimer;
function ccOnSearch(v) { clearTimeout(ccTimer); ccTimer = setTimeout(() => { ccSearch = v; ccRender(); }, 250); }
function ccOnSort(v)   { ccSort = v; ccRender(); }
function ccOnProblem(v) { ccOnlyProblem = !!v; ccRender(); }

// ---- Exportar la valorización ----
function ccExport() {
  const list = ccFiltered();
  if (!list.length) { showToast('Nada que exportar', 'warn'); return; }
  const rate = (typeof getBcvRate === 'function') ? getBcvRate() : 0;
  const esc = s => { s = String(s ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = 'producto,marca,presentacion,sku,codigo,contadas,costo_unit_usd,precio_unit_usd,costo_total_usd,venta_total_usd,venta_total_bs';
  const lines = list.map(r => [
    esc(r.product_name), esc(r.brand_name || ''), esc(r.variant_name || ''),
    esc(r.sku || ''), esc(r.barcode || ''), r.counted,
    r.cost_usd ?? '', r.price_usd,
    (parseFloat(r.costo_total_usd) || 0).toFixed(2),
    (parseFloat(r.venta_total_usd) || 0).toFixed(2),
    rate ? (parseFloat(r.venta_total_usd) * rate).toFixed(2) : '',
  ].join(','));
  const t = ccTotals();
  lines.push(['TOTAL', '', '', '', '', t.unidades, '', '', t.costo.toFixed(2), t.venta.toFixed(2),
    rate ? (t.venta * rate).toFixed(2) : ''].join(','));
  const blob = new Blob(['﻿' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jjpaper_conteo_valorizado_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast(`${list.length} productos exportados`, 'ok');
}
