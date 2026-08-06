/* ======================================================
   JJ Paper Vendedor — Personalización de precios
   Permite al vendedor definir sus propios precios base para productos
   y variantes, los cuales se guardarán en jjp_seller_prices.
   ====================================================== */

let PRODS = [];
let SELLER_PRICES = {}; // mapa de { 'p::id' o 'v::id' -> precio }

async function initProducts() {
  await loadSellerPrices();
  PRODS = await pfLoad(true); // Forzar carga limpia
  prodRender(pfMatch(PRODS, ''));
}

async function loadSellerPrices() {
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id;
  if (!sellerId) return;
  
  const { data, error } = await sb.from('jjp_seller_prices')
    .select('product_id,variant_id,price_usd')
    .eq('seller_id', sellerId);
    
  if (error) {
    console.error('Error cargando precios del vendedor:', error);
    showToast('Error al cargar precios personalizados', 'err');
    return;
  }
  
  SELLER_PRICES = {};
  (data || []).forEach(sp => {
    const key = sp.variant_id ? `v::${sp.variant_id}` : `p::${sp.product_id}`;
    SELLER_PRICES[key] = sp.price_usd;
  });
}

function prodSearch() {
  const q = document.getElementById('prodSearch').value.trim();
  prodRender(pfMatch(PRODS, q));
}

function prodRender(list) {
  const box = document.getElementById('prodResults');
  if (!box) return;
  if (!list.length) { box.innerHTML = '<div class="wa-empty">Sin resultados en el catálogo.</div>'; return; }
  
  box.innerHTML = list.map(p => {
    const variants = (p.jjp_product_variants || []).filter(v => v.active);
    const img = p.image_url
      ? `<img src="${optImg(p.image_url, 120)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px">`
      : `<span style="font-size:26px">${p.emoji || '📦'}</span>`;
      
    let rowsHtml = '';
    
    if (variants.length) {
      rowsHtml = variants.map(v => {
        const vKey = `v::${v.id}`;
        const hasCustom = SELLER_PRICES[vKey] !== undefined;
        const currentPrice = hasCustom ? SELLER_PRICES[vKey] : v.price_usd;
        
        return `<tr>
          <td>${escapeHTML(v.jjp_brands?.name || v.variant_name || 'Variante')}</td>
          <td>${escapeHTML(v.sku || '—')}</td>
          <td><span class="${pfStockClass(v.stock, v.min_qty)}">${pfStockLabel(v.stock)}</span></td>
          <td>
            <div style="font-size:11px;color:var(--gr);margin-bottom:2px">Catálogo: ${fmtPrice(v.price_usd)}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:12px;color:var(--gr)">$</span>
              <input type="number" step="0.01" min="0" class="fi" value="${currentPrice}" id="price-${p.id}-${v.id}" style="width:75px;font-size:12px;padding:3px 6px;margin:0;height:26px;border-color:${hasCustom ? 'var(--gm)' : '#ddd'}">
              <button class="btn-p sm" onclick="savePrice('${p.id}', '${v.id}')" title="Guardar precio personalizado">💾</button>
              ${hasCustom ? `<button class="btn-o sm" onclick="resetPrice('${p.id}', '${v.id}')" title="Restablecer al precio original" style="color:var(--dc,#dc3c3c)">↩️</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');
    } else {
      const pKey = `p::${p.id}`;
      const hasCustom = SELLER_PRICES[pKey] !== undefined;
      const currentPrice = hasCustom ? SELLER_PRICES[pKey] : p.price_usd;
      
      rowsHtml = `<tr>
        <td>—</td>
        <td>${escapeHTML(p.sku || '—')}</td>
        <td><span class="${pfStockClass(p.stock, p.min_qty)}">${pfStockLabel(p.stock)}</span></td>
        <td>
          <div style="font-size:11px;color:var(--gr);margin-bottom:2px">Catálogo: ${fmtPrice(p.price_usd)}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:var(--gr)">$</span>
            <input type="number" step="0.01" min="0" class="fi" value="${currentPrice}" id="price-${p.id}-null" style="width:75px;font-size:12px;padding:3px 6px;margin:0;height:26px;border-color:${hasCustom ? 'var(--gm)' : '#ddd'}">
            <button class="btn-p sm" onclick="savePrice('${p.id}', null)" title="Guardar precio personalizado">💾</button>
            ${hasCustom ? `<button class="btn-o sm" onclick="resetPrice('${p.id}', null)" title="Restablecer al precio original" style="color:var(--dc,#dc3c3c)">↩️</button>` : ''}
          </div>
        </td>
      </tr>`;
    }
    
    return `<div class="cons-card">
      <div class="cons-head">
        ${img}
        <div style="flex:1;min-width:0">
          <strong>${escapeHTML(p.name)}</strong>
          <div style="font-size:12px;color:var(--gr)">/${escapeHTML(p.unit || 'unid')}</div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table cons-table">
          <thead>
            <tr>
              <th>Marca</th>
              <th>SKU</th>
              <th>Stock</th>
              <th>Tu precio personalizado</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

async function savePrice(pid, vid) {
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id;
  if (!sellerId) {
    showToast('No se identificó el vendedor', 'err');
    return;
  }
  
  const isVariant = vid !== 'null' && vid !== null && vid !== undefined;
  const inputId = isVariant ? `price-${pid}-${vid}` : `price-${pid}-null`;
  const el = document.getElementById(inputId);
  if (!el) return;
  
  const val = parseFloat(el.value);
  if (isNaN(val) || val < 0) {
    showToast('Ingresa un precio válido', 'warn');
    return;
  }
  
  const roundedVal = +val.toFixed(2);
  
  // Upsert en jjp_seller_prices
  const record = {
    seller_id: sellerId,
    product_id: pid,
    variant_id: isVariant ? vid : null,
    price_usd: roundedVal,
    updated_at: new Date().toISOString()
  };
  
  // Para upsert en Supabase necesitamos la clave única, o hacemos una lógica inteligente
  // de buscar y luego insertar/actualizar, o usamos el endpoint normal.
  // Como tiene índices únicos, podemos usar upsert si configuramos el constraint onConflict.
  // El onConflict por defecto de la DB si es único funciona con upsert.
  // Si no, podemos hacer un select y luego update/insert. Hagámoslo con select por seguridad si no sabemos el nombre del constraint.
  
  const query = sb.from('jjp_seller_prices')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('product_id', pid);
    
  if (isVariant) query.eq('variant_id', vid);
  else query.is('variant_id', null);
  
  const { data, error } = await query.maybeSingle();
  
  if (error) {
    console.error('Error buscando precio existente:', error);
    showToast('Error al guardar el precio', 'err');
    return;
  }
  
  let success = false;
  if (data?.id) {
    // Actualizar
    const { error: updErr } = await sb.from('jjp_seller_prices')
      .update({ price_usd: roundedVal, updated_at: new Date().toISOString() })
      .eq('id', data.id);
    if (!updErr) success = true;
    else console.error('Error actualizando precio:', updErr);
  } else {
    // Insertar
    const { error: insErr } = await sb.from('jjp_seller_prices').insert(record);
    if (!insErr) success = true;
    else console.error('Error insertando precio:', insErr);
  }
  
  if (success) {
    showToast('✅ Precio personalizado guardado');
    await loadSellerPrices();
    // Forzar recarga en el buscador de productos universal
    await pfLoad(true);
    // Refrescar render
    prodSearch();
  } else {
    showToast('No se pudo guardar el precio', 'err');
  }
}

async function resetPrice(pid, vid) {
  const sellerId = SELLER?.id || CURRENT_PROFILE?.id;
  if (!sellerId) return;
  
  const isVariant = vid !== 'null' && vid !== null && vid !== undefined;
  
  const query = sb.from('jjp_seller_prices')
    .delete()
    .eq('seller_id', sellerId)
    .eq('product_id', pid);
    
  if (isVariant) query.eq('variant_id', vid);
  else query.is('variant_id', null);
  
  const { error } = await query;
  
  if (error) {
    console.error('Error eliminando precio personalizado:', error);
    showToast('Error al restablecer el precio', 'err');
  } else {
    showToast('↩️ Precio restablecido al catálogo');
    await loadSellerPrices();
    // Forzar recarga en el buscador de productos universal
    await pfLoad(true);
    // Refrescar render
    prodSearch();
  }
}
