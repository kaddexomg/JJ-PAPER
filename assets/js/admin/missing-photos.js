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
      <td style="text-align:center">
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

function mpExportCSV() {
  const rows = mpFiltradas();
  const csv = ['SKU;PRODUCTO;CATEGORIA;STOCK;USD_PARADO',
    ...rows.map(r => [r.sku, String(r.producto).replace(/;/g, ','), r.categoria,
                      r.stock > 0 ? r.stock : '', r.usd_parado].join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'faltan-fotos.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
