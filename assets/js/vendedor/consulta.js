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
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a class="btn-p sm" href="pos.html?add=${p.id}">🛍️ Vender</a>
          <a class="btn-o sm" href="cotizador.html?add=${p.id}">📋 Cotizar</a>
          <button class="btn-send sm" onclick="fichaAbrir(event,'${p.id}')"
                  title="Enviar foto + reseña + enlace de compra al cliente">📤 Ficha</button>
          <button class="btn-o sm" onclick="consEdit('${p.id}')" title="Edición rápida">✏️</button>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="admin-table cons-table">
        <thead><tr><th>Marca</th><th>SKU</th><th>Stock</th><th>Precio</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

let editingProdId = null;

function consEdit(pid) {
  const p = CONS.find(x => x.id === pid);
  if (!p) return;
  editingProdId = pid;
  document.getElementById('editProdName').value = p.name || '';
  document.getElementById('editProdDesc').value = p.description || '';
  
  const variants = (p.jjp_product_variants || []).filter(v => v.active);
  const vBox = document.getElementById('editProdVariants');
  if (variants.length) {
    vBox.innerHTML = '<h4 style="margin:10px 0 6px;font-size:13px">Precios de variantes</h4>' + variants.map(v => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="flex:1;font-size:12px">${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')}</span>
        <input type="number" step="0.01" class="fi val-price" data-vid="${v.id}" value="${v.price_usd}" style="width:90px;font-size:12px;padding:4px;height:28px;margin:0">
      </div>
    `).join('');
  } else {
    vBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="flex:1;font-size:12px">Precio base</span>
        <input type="number" step="0.01" id="editBasePrice" value="${p.price_usd || 0}" style="width:90px;font-size:12px;padding:4px;height:28px;margin:0" class="fi">
      </div>
    `;
  }
  
  document.getElementById('editProdModal').classList.add('op');
}

function closeConsEdit() {
  document.getElementById('editProdModal').classList.remove('op');
}

async function consSave() {
  if (!editingProdId) return;
  const btn = document.getElementById('btnSaveProd');
  btn.disabled = true; btn.textContent = 'Guardando...';
  
  const newName = document.getElementById('editProdName').value.trim();
  const newDesc = document.getElementById('editProdDesc').value.trim();
  
  if (!newName) {
    showToast('El nombre es obligatorio', 'warn');
    btn.disabled = false; btn.textContent = '💾 Guardar';
    return;
  }
  
  // 1. Guardar cambios en el producto
  const pUpdates = { name: newName, description: newDesc };
  const p = CONS.find(x => x.id === editingProdId);
  const hasVariants = (p?.jjp_product_variants || []).filter(v => v.active).length > 0;
  
  if (!hasVariants) {
    const baseP = parseFloat(document.getElementById('editBasePrice')?.value);
    if (!isNaN(baseP) && baseP >= 0) pUpdates.price_usd = baseP;
  }
  
  const { error: errP } = await sb.from('jjp_products').update(pUpdates).eq('id', editingProdId);
  if (errP) {
    console.error('Error actualizando producto:', errP);
    showToast('Error al actualizar producto', 'err');
    btn.disabled = false; btn.textContent = '💾 Guardar';
    return;
  }
  
  // 2. Guardar cambios en variantes
  if (hasVariants) {
    const inputs = document.querySelectorAll('#editProdVariants .val-price');
    for (const input of inputs) {
      const vid = input.getAttribute('data-vid');
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        const { error: errV } = await sb.from('jjp_product_variants').update({ price_usd: val }).eq('id', vid);
        if (errV) {
          console.error('Error actualizando variante:', vid, errV);
        }
      }
    }
  }
  
  showToast('✅ Producto actualizado correctamente');
  closeConsEdit();
  await initConsulta();
  btn.disabled = false; btn.textContent = '💾 Guardar';
}
