/* ======================================================
   JJ Paper Admin — Ajuste de precios por brecha cambiaria
   Sugiere precio de venta = base × factor (USDT/BCV) para
   conservar el margen de cada producto. Se cobra a BCV.
   El admin revisa y aplica (por producto o todos).
   ====================================================== */

let prRows   = [];
let prFactor = 1;
let prSearch = '';

async function loadPricing() {
  await loadSettings();
  const s = APP.SETTINGS || {};
  prFactor = parseFloat(s.rate_factor) || 1;

  // Tarjetas de tasas
  setTxt('pr-bcv',  s.rate_bcv ? `Bs ${(+s.rate_bcv).toFixed(2)}` : '—');
  setTxt('pr-usdt', s.usdt_rate ? `Bs ${(+s.usdt_rate).toFixed(2)}` : '—');
  setTxt('pr-monitor', s.rate_monitor ? `Bs ${(+s.rate_monitor).toFixed(2)}` : '—');
  setTxt('pr-eur', s.rate_eur ? `Bs ${(+s.rate_eur).toFixed(2)}` : '—');
  setTxt('pr-gap',  s.rate_gap_pct ? `${(+s.rate_gap_pct).toFixed(1)}%` : '—');
  setTxt('pr-factor', prFactor.toFixed(4));
  setTxt('pr-updated', s.rates_updated_iso ? fmtDate(s.rates_updated_iso) : '—');

  // Variantes (base + precio actual + margen)
  const tbody = document.getElementById('prBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Cargando…</td></tr>`;
  const out = [], CHUNK = 1000;
  const sel = 'id,base_price_usd,price_usd,margin_pct,variant_name,'
    + 'jjp_products(name),jjp_brands(name)';
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb.from('jjp_product_variants')
      .select(sel).order('price_usd', { ascending: false }).range(from, from + CHUNK - 1);
    if (error) { showToast('Error cargando precios', 'err'); break; }
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  prRows = out;
  renderPricing();
}

function prSuggested(r) {
  const base = Number(r.base_price_usd ?? r.price_usd) || 0;
  return +(base * prFactor).toFixed(2);
}

function prFiltered() {
  const q = normTxt(prSearch);
  if (!q) return prRows;
  return prRows.filter(r =>
    normTxt(r.jjp_products?.name).includes(q) || normTxt(r.jjp_brands?.name).includes(q));
}

function renderPricing() {
  const tbody = document.getElementById('prBody');
  if (!tbody) return;
  const rows = prFiltered();
  const cnt = document.getElementById('prCount');
  if (cnt) cnt.textContent = `${rows.length} productos`;

  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Sin resultados</td></tr>`; return; }

  tbody.innerHTML = rows.slice(0, 400).map(r => {
    const base = Number(r.base_price_usd ?? r.price_usd) || 0;
    const now  = Number(r.price_usd) || 0;
    const sug  = prSuggested(r);
    const diff = sug - now;
    const applied = Math.abs(diff) < 0.005;
    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(r.jjp_products?.name || '—')}</div>
        <div class="td-sub">${escapeHTML([r.jjp_brands?.name, r.variant_name].filter(Boolean).join(' · ') || 'Genérica')}</div>
      </td>
      <td style="text-align:center">${r.margin_pct != null ? (+r.margin_pct).toFixed(0) + '%' : '—'}</td>
      <td style="text-align:right">
        <input type="number" step="0.01" min="0" class="fi" style="width:90px;text-align:right"
               value="${base.toFixed(2)}" onchange="prSetBase('${r.id}', this.value)" title="Precio comercial base (a la par)">
      </td>
      <td style="text-align:right">${fmtPrice(now)}</td>
      <td style="text-align:right"><strong style="color:${applied ? 'var(--gr)' : 'var(--gd)'}">${fmtPrice(sug)}</strong>
        ${applied ? '' : `<div class="td-sub" style="color:${diff>0?'#c08a00':'#0a7'}">${diff>0?'+':''}${fmtPrice(diff)}</div>`}</td>
      <td style="text-align:center">
        <button class="btn-p sm" ${applied ? 'disabled style="opacity:.4"' : ''} onclick="prApply('${r.id}')">Aplicar</button>
      </td>
    </tr>`;
  }).join('');
}

async function prSetBase(id, val) {
  const r = prRows.find(x => x.id === id);
  if (!r) return;
  const base = parseFloat(val);
  if (isNaN(base) || base < 0) return;
  const prev = r.base_price_usd;
  r.base_price_usd = base;
  const { error } = await sb.from('jjp_product_variants').update({ base_price_usd: base }).eq('id', id);
  if (error) { r.base_price_usd = prev; showToast('Error guardando base', 'err'); return; }
  renderPricing();
}

async function prApply(id) {
  const r = prRows.find(x => x.id === id);
  if (!r) return;
  const sug = prSuggested(r);
  const prev = r.price_usd;
  r.price_usd = sug;
  const { error } = await sb.from('jjp_product_variants').update({ price_usd: sug }).eq('id', id);
  if (error) { r.price_usd = prev; showToast('Error aplicando precio', 'err'); return; }
  showToast(`Precio aplicado: ${fmtPrice(sug)}`);
  renderPricing();
}

async function prApplyAll() {
  const rows = prFiltered().filter(r => Math.abs(prSuggested(r) - (Number(r.price_usd) || 0)) >= 0.005);
  if (!rows.length) { showToast('No hay cambios que aplicar', 'warn'); return; }
  if (!confirm(`Aplicar el precio sugerido a ${rows.length} producto(s)? Se cobra a BCV; el ajuste protege tu margen.`)) return;
  let ok = 0;
  for (const r of rows) {
    const sug = prSuggested(r);
    const { error } = await sb.from('jjp_product_variants').update({ price_usd: sug }).eq('id', r.id);
    if (!error) { r.price_usd = sug; ok++; }
  }
  showToast(`✅ ${ok} precio(s) actualizado(s)`);
  renderPricing();
}

// Recaptura la base = precio actual (cuando cambiaste tus precios comerciales)
async function prRebaseAll() {
  if (!confirm('¿Fijar el precio ACTUAL como nueva base comercial de todos los productos filtrados? (Reinicia el ajuste por brecha)')) return;
  const rows = prFiltered();
  let ok = 0;
  for (const r of rows) {
    const { error } = await sb.from('jjp_product_variants').update({ base_price_usd: r.price_usd }).eq('id', r.id);
    if (!error) { r.base_price_usd = r.price_usd; ok++; }
  }
  showToast(`Base actualizada en ${ok} producto(s)`);
  renderPricing();
}

function prOnSearch(v) { prSearch = v; renderPricing(); }
function setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
