/* ======================================================
   JJ Paper — Cola de fotos faltantes

   Lee la vista jjp_missing_photos: productos sin imagen, ordenados por
   plata inmovilizada (stock ya contado × precio). Un producto contado
   que está en el estante sin foto no se vende, así que la lista arranca
   por lo que más cuesta tener parado.

   Cada renglón trae un botón de cámara: se elige el producto ANTES de
   sacar la foto, así que no hay forma de que la imagen termine en el
   producto equivocado. Eso es lo que el clasificador con IA no puede
   garantizar — ver el REPORTE_SUBIDA.csv y los SKU que inventó.
   ====================================================== */

let mpRows     = [];
let mpFiltro   = '';
let mpCategoria = '';
let mpSoloContados = true;   // arranca en lo que ya está contado: lo urgente
let mpTimer;

async function mpLoad() {
  const body = document.getElementById('mpTableBody');
  const { data, error } = await sb
    .from('jjp_missing_photos')
    .select('*')
    .order('usd_parado', { ascending: false })
    .limit(1000);

  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty">Error: ${error.message}</td></tr>`;
    return;
  }
  mpRows = data || [];
  mpFillCategorias();
  mpRender();
}

function mpFillCategorias() {
  const sel = document.getElementById('mpCatSel');
  if (!sel || sel.dataset.listo) return;
  const cats = [...new Set(mpRows.map(r => r.categoria))].sort();
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  sel.dataset.listo = '1';
}

function mpFiltradas() {
  const q = mpFiltro.trim().toLowerCase();
  return mpRows.filter(r => {
    if (mpSoloContados && !(r.stock > 0)) return false;
    if (mpCategoria && r.categoria !== mpCategoria) return false;
    if (q && !`${r.producto} ${r.sku}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function mpRender() {
  const body  = document.getElementById('mpTableBody');
  const rows  = mpFiltradas();
  const total = rows.reduce((s, r) => s + Number(r.usd_parado || 0), 0);

  document.getElementById('mpCount').textContent =
    `${rows.length} sin foto · ${fmtPrice(total)} inmovilizados`;
  document.getElementById('mp-sinfoto').textContent   = mpRows.length;
  document.getElementById('mp-contados').textContent  = mpRows.filter(r => r.stock > 0).length;
  document.getElementById('mp-usd').textContent       =
    fmtPrice(mpRows.reduce((s, r) => s + Number(r.usd_parado || 0), 0));

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty">
      ${mpSoloContados
        ? '🎉 Todo lo contado ya tiene foto. Destildá el filtro para ver el resto.'
        : 'No hay productos sin foto con ese filtro.'}
    </td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => `
    <tr id="mp-row-${r.variant_id}">
      <td><strong>${escapeHTML(r.producto)}</strong></td>
      <td><code style="font-size:12px">${escapeHTML(r.sku || '—')}</code></td>
      <td>${escapeHTML(r.categoria)}</td>
      <td style="text-align:right">${r.stock > 0 ? r.stock : '<span style="color:var(--gr)">—</span>'}</td>
      <td style="text-align:right">${
        Number(r.usd_parado) > 0
          ? `<strong>${fmtPrice(r.usd_parado)}</strong>`
          : '<span style="color:var(--gr)">—</span>'}</td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn-s" style="padding:6px 10px;font-size:12.5px;margin-right:6px;background:#065f46;color:#fff;border-radius:6px;border:none;cursor:pointer"
                onclick="mpGenerarConIA('${r.variant_id}', '${escapeJsStr(r.producto)}')">
          🤖 Generar IA
        </button>
        <label class="btn-p" style="cursor:pointer;padding:6px 12px;font-size:13px;display:inline-block">
          📷 Foto
          <input type="file" accept="image/*" capture="environment" hidden
                 onchange="mpSubir('${r.variant_id}', this)">
        </label>
      </td>
    </tr>`).join('');
}

/* ---------- Subida de una foto a su variante ---------- */
// Se comprime en el navegador antes de subir: las fotos del teléfono
// vienen de 8–16 MB y Storage corta la conexión con esos tamaños.
async function mpComprimir(file, maxSide = 1400) {
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width  = Math.round(bmp.width  * escala);
    cv.height = Math.round(bmp.height * escala);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/webp', 0.85));
    if (blob) return { blob, ext: 'webp' };
  } catch (e) {
    console.warn('mpComprimir: se sube el archivo original', e);
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return { blob: file, ext };
}

async function mpSubir(variantId, input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';                                  // permite reintentar el mismo archivo

  const fila = document.getElementById(`mp-row-${variantId}`);
  const dato = mpRows.find(r => r.variant_id === variantId);
  if (fila) fila.style.opacity = '.5';
  showToast('Subiendo foto...', 'info');

  try {
    // Necesitamos el product_id: la vista sólo trae la variante.
    const { data: v, error: eVar } = await sb
      .from('jjp_product_variants')
      .select('product_id')
      .eq('id', variantId)
      .single();
    if (eVar) throw eVar;

    const { blob, ext } = await mpComprimir(file);
    const path = `${v.product_id}.${ext}`;
    const { error: eUp } = await sb.storage.from('jjp-products')
      .upload(path, blob, { upsert: true, contentType: blob.type });
    if (eUp) throw eUp;

    const { data: { publicUrl } } = sb.storage.from('jjp-products').getPublicUrl(path);
    // Cache-busting: el path se reusa al re-subir, si no queda la vieja.
    const url = `${publicUrl}?v=${Date.now()}`;

    // Variante y producto a la vez (hoy la relación es 1:1)
    const [rv, rp] = await Promise.all([
      sb.from('jjp_product_variants').update({ image_url: url }).eq('id', variantId),
      sb.from('jjp_products').update({ image_url: url }).eq('id', v.product_id),
    ]);
    if (rv.error || rp.error) throw (rv.error || rp.error);

    // Sale de la cola sin recargar toda la tabla
    mpRows = mpRows.filter(r => r.variant_id !== variantId);
    mpRender();
    showToast(`✓ Foto guardada: ${dato?.producto || 'producto'}`, 'ok');
  } catch (e) {
    if (fila) fila.style.opacity = '';
    showToast('Error al subir: ' + (e.message || e), 'err');
  }
}

/* ---------- Controles ---------- */
function mpOnSearch(v) { clearTimeout(mpTimer); mpTimer = setTimeout(() => { mpFiltro = v; mpRender(); }, 250); }
function mpOnCat(v)    { mpCategoria = v; mpRender(); }
function mpOnSolo(v)   { mpSoloContados = !!v; mpRender(); }

function escapeJsStr(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/* ---------- Generación de Packshot con IA ---------- */
async function mpGenerarConIA(variantId, productoNombre) {
  const dato = mpRows.find(r => r.variant_id === variantId);
  const fila = document.getElementById(`mp-row-${variantId}`);
  if (fila) fila.style.opacity = '.6';

  showToast(`🤖 Diseñando packshot para "${productoNombre}"...`, 'info');

  try {
    // 1. Obtener datos de la variante y producto
    const { data: v, error: eVar } = await sb
      .from('jjp_product_variants')
      .select('id, product_id, sku, price_usd, jjp_products(name, description, brand_id, category_id)')
      .eq('id', variantId)
      .single();
    if (eVar) throw eVar;

    const prodId = v.product_id;
    const prodName = v.jjp_products?.name || productoNombre;

    // 2. Generar prompt fotográfico limpio
    const cleanPrompt = `Commercial retail packshot of office stationery and supply: ${prodName}, isolated centered front hero angle on solid seamless pure white background #FFFFFF, soft natural contact shadow, crisp pristine commercial product packaging, professional advertising photography, 8k uhd`;
    const seed = Math.abs(hashCode(prodName + '_' + variantId));
    const aiImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt.slice(0, 380))}?width=800&height=800&model=flux&nologo=true&seed=${seed}`;

    // 3. Modal de previsualización para aprobación del usuario
    let modal = document.getElementById('mpAiModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mpAiModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px);';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:440px;width:100%;padding:20px;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 10px;font-size:16px;color:#1e293b">📸 Previsualización de Packshot IA</h3>
        <p style="margin:0 0 14px;font-size:13px;color:#64748b">${escapeHTML(prodName)}</p>
        <div style="position:relative;width:280px;height:280px;margin:0 auto 16px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:center">
          <img id="mpAiImgPreview" src="${aiImageUrl}" alt="Packshot IA" style="max-width:100%;max-height:100%;object-fit:contain"
               onload="document.getElementById('mpAiConfirmBtn').disabled = false;"
               onerror="this.alt='Error cargando imagen de IA. Intenta de nuevo.';">
        </div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn-s" style="padding:8px 16px;background:#f1f5f9;color:#475569;border-radius:6px;border:none;cursor:pointer"
                  onclick="document.getElementById('mpAiModal').style.display='none';">
            Cancelar
          </button>
          <button id="mpAiConfirmBtn" class="btn-p" style="padding:8px 18px;background:#065f46;color:#fff;border-radius:6px;border:none;cursor:pointer;font-weight:600"
                  onclick="mpGuardarPackshotIA('${variantId}', '${prodId}', '${escapeJsStr(aiImageUrl)}')">
            ✅ Aprobar y Guardar
          </button>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
  } catch (err) {
    if (fila) fila.style.opacity = '';
    showToast('Error generando imagen: ' + err.message, 'err');
  }
}

async function mpGuardarPackshotIA(variantId, productId, imageUrl) {
  const modal = document.getElementById('mpAiModal');
  const btn = document.getElementById('mpAiConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando en catálogo… ⏳'; }

  try {
    // Descargar imagen generada como Blob
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error('No se pudo descargar la imagen generada de IA');
    const blob = await resp.blob();

    // Comprimir / normalizar a WebP
    const { blob: webpBlob, ext } = await mpComprimir(new File([blob], 'packshot.jpg', { type: 'image/jpeg' }));
    const path = `${productId}.${ext}`;

    const { error: eUp } = await sb.storage.from('jjp-products')
      .upload(path, webpBlob, { upsert: true, contentType: webpBlob.type });
    if (eUp) throw eUp;

    const { data: { publicUrl } } = sb.storage.from('jjp-products').getPublicUrl(path);
    const url = `${publicUrl}?v=${Date.now()}`;

    // Actualizar producto y variante
    const [rv, rp] = await Promise.all([
      sb.from('jjp_product_variants').update({ image_url: url }).eq('id', variantId),
      sb.from('jjp_products').update({ image_url: url }).eq('id', productId)
    ]);
    if (rv.error || rp.error) throw (rv.error || rp.error);

    if (modal) modal.style.display = 'none';
    mpRows = mpRows.filter(r => r.variant_id !== variantId);
    mpRender();
    showToast('🎉 ¡Packshot de IA guardado exitosamente en el catálogo!', 'ok');
  } catch (e) {
    alert('Error al guardar packshot en Supabase Storage: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Aprobar y Guardar'; }
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
