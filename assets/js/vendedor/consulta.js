/* ======================================================
   JJ Paper Vendedor — Consulta rápida de existencias
   Busca un producto (nombre/SKU/código/marca) y muestra el stock por
   variante + precio USD/Bs, con accesos directos a Vender / Cotizar.
   ====================================================== */

let CONS = [];

async function initConsulta() {
  CONS = await pfLoad();
  consRender(pfMatch(CONS, ''));
}

function consSearch() {
  consRender(pfMatch(CONS, document.getElementById('consSearch').value.trim()));
}
function consKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = document.getElementById('consSearch').value.trim();
  const hit = pfFindByCode(CONS, code);
  consRender(hit ? [hit.product] : pfMatch(CONS, code));
}
function consScan() {
  pfScanCamera(code => {
    document.getElementById('consSearch').value = code;
    const hit = pfFindByCode(CONS, code);
    consRender(hit ? [hit.product] : pfMatch(CONS, code));
    if (!hit) showToast('Código no está en el catálogo', 'warn');
  });
}

// Abre la lista de PRECIOS al público lista para imprimir. Si hay una búsqueda
// activa, la lleva pre-filtrada (?q=) para no imprimir el catálogo completo.
function consPrintList() {
  const q = (document.getElementById('consSearch')?.value || '').trim();
  window.open('../lista_costos.html' + (q ? '?q=' + encodeURIComponent(q) : ''), '_blank');
}

function consRender(list) {
  const box = document.getElementById('consResults');
  if (!box) return;
  if (!list.length) { box.innerHTML = '<div class="wa-empty">Sin resultados.</div>'; return; }
  box.innerHTML = list.map(p => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${optImg(p.image_url, 120)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px">`
      : `<span style="font-size:26px">${p.emoji || '📦'}</span>`;
    const rows = variants.length
      ? variants.map(v => `<tr>
          <td>${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')}</td>
          <td>${escapeHTML(v.sku || '—')}</td>
          <td class="${pfStockClass(v.stock, v.min_qty)}">${pfStockLabel(v.stock)}</td>
          <td>${pfPriceHtml(v.price_usd)}</td>
        </tr>`).join('')
      : `<tr>
          <td>—</td><td>${escapeHTML(p.sku || '—')}</td>
          <td class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</td>
          <td>${pfPriceHtml(p.price_usd)}</td>
        </tr>`;
    return `<div class="cons-card">
      <div class="cons-head">
        ${img}
        <div style="flex:1;min-width:0"><strong>${escapeHTML(p.name)}</strong>
          <div style="font-size:12px;color:var(--gr)">/${escapeHTML(p.unit || 'unid')}</div></div>
        <div style="display:flex;gap:6px">
          <a class="btn-p sm" href="pos.html?add=${p.id}">🛍️ Vender</a>
          <a class="btn-o sm" href="cotizador.html?add=${p.id}">📋 Cotizar</a>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="admin-table cons-table">
        <thead><tr><th>Marca</th><th>SKU</th><th>Stock</th><th>Precio</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }).join('');
}
