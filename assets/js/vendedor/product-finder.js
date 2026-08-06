/* ======================================================
   JJ Paper — Buscador universal de productos (reusable)
   Usado por POS, cotizador y consulta de existencias.
   Busca por nombre, SKU (producto/variante), código de barras y marca.
   Requiere: sb, normTxt, fmtPrice, toBs (de config.js).
   ====================================================== */

let PF_PRODUCTS = null;

async function pfLoad(force) {
  if (PF_PRODUCTS && !force) return PF_PRODUCTS;
  const { data, error } = await sb.from('jjp_products')
    .select('id,name,sku,price_usd,unit,emoji,image_url,stock,min_qty,jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,stock,min_qty,active,jjp_brands(name))')
    .eq('active', true).order('name');
  if (error) { if (typeof showToast === 'function') showToast('Error cargando productos', 'err'); return PF_PRODUCTS || []; }
  
  let products = data || [];
  
  // Cargar precios personalizados del vendedor si está logueado
  const sellerId = (typeof SELLER !== 'undefined' && SELLER?.id) || (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id);
  if (sellerId) {
    try {
      const { data: sellerPrices, error: spError } = await sb.from('jjp_seller_prices')
        .select('product_id,variant_id,price_usd')
        .eq('seller_id', sellerId);
      
      if (!spError && sellerPrices && sellerPrices.length > 0) {
        // Crear mapa para búsquedas rápidas
        const customPrices = {};
        sellerPrices.forEach(sp => {
          const key = sp.variant_id ? `v::${sp.variant_id}` : `p::${sp.product_id}`;
          customPrices[key] = sp.price_usd;
        });
        
        // Aplicar precios personalizados sobre el catálogo en memoria
        products.forEach(p => {
          const pKey = `p::${p.id}`;
          if (customPrices[pKey] !== undefined) {
            p.price_usd = customPrices[pKey];
          }
          if (p.jjp_product_variants) {
            p.jjp_product_variants.forEach(v => {
              const vKey = `v::${v.id}`;
              if (customPrices[vKey] !== undefined) {
                v.price_usd = customPrices[vKey];
              }
            });
          }
        });
      }
    } catch (err) {
      console.error('Error aplicando precios personalizados:', err);
    }
  }

  PF_PRODUCTS = products;
  return PF_PRODUCTS;
}

function pfNorm(s) { return typeof normTxt === 'function' ? normTxt(String(s || '')) : String(s || '').toLowerCase(); }

// Filtra por nombre / sku / código / marca
function pfMatch(list, term) {
  const q = pfNorm(term);
  if (!q) return (list || []).slice(0, 40);
  const lc = String(term || '').trim().toLowerCase();
  return (list || []).filter(p => {
    if (pfNorm(p.name).includes(q)) return true;
    if ((p.sku || '').toLowerCase().includes(lc)) return true;
    return (p.jjp_product_variants || []).some(v => v.active && (
      (v.sku || '').toLowerCase().includes(lc) ||
      (v.barcode || '').toLowerCase().includes(lc) ||
      pfNorm(v.jjp_brands?.name || v.variant_name || '').includes(q)));
  }).slice(0, 40);
}

// Match EXACTO por código de barras o SKU (para escaneo). Devuelve {product, variant} o null.
function pfFindByCode(list, code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  for (const p of list || []) {
    for (const v of (p.jjp_product_variants || [])) {
      if (v.active && ((v.barcode || '').toLowerCase() === c || (v.sku || '').toLowerCase() === c))
        return { product: p, variant: v };
    }
    if ((p.sku || '').toLowerCase() === c) return { product: p, variant: null };
  }
  return null;
}

// Nivel de existencia → clase de color
function pfStockClass(stock, min) {
  const s = Number(stock), m = Number(min) || 0;
  if (!Number.isFinite(s)) return '';
  if (s <= 0) return 'pf-out';
  if (s <= m || s <= 3) return 'pf-low';
  return 'pf-ok';
}
function pfStockLabel(stock) {
  const s = Number(stock);
  if (!Number.isFinite(s)) return 'stock —';
  if (s <= 0) return '⛔ sin stock';
  return `stock ${s}`;
}

// Precio USD + Bs a tasa viva
function pfPriceHtml(usd) {
  const bs = (typeof toBs === 'function') ? toBs(usd) : null;
  return `${fmtPrice(usd)}${bs ? ` · Bs ${Number(bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : ''}`;
}

/* ---------- Puente teléfono → PC (teléfono como pistola de código) ---------- */
// El POS/cotizador de la PC llama a esto; cada código que el teléfono manda
// (tabla jjp_pos_scans, vía Realtime) dispara onCode(code). RLS ya limita a lo
// del propio vendedor. NO afecta inventario ni conteo.
function pfPhoneBridge(onCode) {
  const owner = (typeof SELLER !== 'undefined' && SELLER?.id) || (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.id) || 'me';
  // Rescata escaneos recientes que llegaron antes de abrir la caja
  sb.from('jjp_pos_scans').select('id,code').eq('consumed', false)
    .gte('created_at', new Date(Date.now() - 120000).toISOString())
    .order('created_at', { ascending: true })
    .then(({ data }) => (data || []).forEach(r => { onCode(r.code); sb.from('jjp_pos_scans').update({ consumed: true }).eq('id', r.id); }));

  return sb.channel('pos-scan-' + owner)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_pos_scans' },
      p => { onCode(p.new.code); sb.from('jjp_pos_scans').update({ consumed: true }).eq('id', p.new.id); })
    .subscribe();
}

// URL de la página del teléfono-escáner (para el QR / enlace en la PC)
function pfPhoneScanUrl() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'scan.html';
}

/* ---------- Escaneo con cámara (API nativa BarcodeDetector) ---------- */
async function pfScanCamera(onCode) {
  if (!('BarcodeDetector' in window)) {
    if (typeof showToast === 'function') showToast('Este navegador no lee código por cámara. Usa un lector físico.', 'warn', 5000);
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { if (typeof showToast === 'function') showToast('No se pudo abrir la cámara (permisos)', 'err'); return; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
  overlay.innerHTML = `<video autoplay playsinline muted style="max-width:100%;max-height:80vh"></video>
    <p style="color:#fff;margin-top:12px;font-size:14px">Apunta al código de barras…</p>
    <button style="margin-top:12px;padding:10px 20px;border-radius:8px;border:none;background:#fff;font-size:15px;cursor:pointer">Cancelar</button>`;
  document.body.appendChild(overlay);
  const video = overlay.querySelector('video');
  video.srcObject = stream;

  let stop = false;
  const cleanup = () => { stop = true; stream.getTracks().forEach(t => t.stop()); overlay.remove(); };
  overlay.querySelector('button').onclick = cleanup;

  const detector = new window.BarcodeDetector();
  const tick = async () => {
    if (stop) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        cleanup();
        onCode(value);
        return;
      }
    } catch (e) { /* frame sin código */ }
    requestAnimationFrame(tick);
  };
  video.onloadedmetadata = () => tick();
}
