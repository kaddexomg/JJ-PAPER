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

/* ---------- ESTUDIO FOTOGRÁFICO MULTI-FUENTE EN FOTOS FALTANTES ---------- */
let _mpStudioVariantId = null;
let _mpStudioProdId = null;
let _mpStudioSelectedImg = null;

async function mpGenerarConIA(variantId, productoNombre) {
  _mpStudioVariantId = variantId;
  _mpStudioSelectedImg = null;

  try {
    const { data: v, error: eVar } = await sb
      .from('jjp_product_variants')
      .select('id, product_id, sku, price_usd, jjp_products(name, description, brand_id, category_id)')
      .eq('id', variantId)
      .single();
    if (eVar) throw eVar;
    _mpStudioProdId = v.product_id;
    const prodName = v.jjp_products?.name || productoNombre;

    let modal = document.getElementById('mpAiModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mpAiModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#f8fafc">
          <div>
            <h3 style="margin:0;font-size:16px;color:#0f172a;display:flex;align-items:center;gap:8px">
              <span>📸 Estudio Fotográfico de Producto</span>
              <span style="font-size:11px;font-weight:600;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px">IA Multi-Fuente</span>
            </h3>
            <p style="margin:4px 0 0;font-size:13px;color:#64748b;font-weight:500">${escapeHTML(prodName)}</p>
          </div>
          <button onclick="document.getElementById('mpAiModal').style.display='none'" style="border:none;background:none;font-size:20px;cursor:pointer;color:#94a3b8">✕</button>
        </div>

        <!-- Barra de búsqueda / afinamiento -->
        <div style="padding:12px 20px;background:#fff;border-bottom:1px solid #f1f5f9;display:flex;gap:10px;align-items:center">
          <div style="flex:1;position:relative">
            <input type="text" id="mpStudioSearchInput" value="${escapeHTML(prodName)}"
                   style="width:100%;padding:8px 12px 8px 32px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;outline:none"
                   placeholder="Escribe término de búsqueda exacto (ej. Marcador Expo rojo pizarra)...">
            <span style="position:absolute;left:10px;top:9px;font-size:13px;color:#94a3b8">🔍</span>
          </div>
          <button class="btn-s" style="padding:8px 14px;background:#0f172a;color:#fff;border-radius:8px;border:none;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px"
                  onclick="mpStudioEjecutarBusqueda()">
            Buscar Fotos
          </button>
        </div>

        <!-- Pestañas de origen -->
        <div style="display:flex;padding:0 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;gap:8px">
          <button id="mpTabWebBtn" class="of-chip on" style="border:none;padding:10px 14px;font-size:12.5px;cursor:pointer;background:none;font-weight:600;border-bottom:2px solid #065f46;color:#065f46"
                  onclick="mpStudioSwitchTab('web')">
            🌐 Fotos Reales de la Web (<span id="mpWebCount">...</span>)
          </button>
          <button id="mpTabAiBtn" class="of-chip" style="border:none;padding:10px 14px;font-size:12.5px;cursor:pointer;background:none;font-weight:500;color:#64748b"
                  onclick="mpStudioSwitchTab('ai')">
            🤖 Fotografía con IA (Fondo Blanco)
          </button>
        </div>

        <!-- Contenedor de contenido -->
        <div style="flex:1;overflow-y:auto;padding:18px 20px;">
          <!-- Panel Web -->
          <div id="mpPanelWeb">
            <div id="mpWebSpinner" style="text-align:center;padding:40px 0;color:#64748b">
              <div style="font-size:28px;margin-bottom:8px">⏳</div>
              <div style="font-size:13px;font-weight:500">Consultando fotografías reales del producto en distribuidores...</div>
            </div>
            <div id="mpWebGrid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:14px;"></div>
          </div>

          <!-- Panel IA -->
          <div id="mpPanelAi" style="display:none;text-align:center;padding:10px 0">
            <p style="font-size:12.5px;color:#64748b;margin:0 0 12px">Fotografía hiperrealista del <strong>objeto físico individual</strong> sobre fondo blanco puro #FFFFFF (sin cajas ni renders).</p>
            <div style="position:relative;width:280px;height:280px;margin:0 auto 14px;border-radius:10px;overflow:hidden;border:1px solid #cbd5e1;background:#f8fafc;display:flex;align-items:center;justify-content:center">
              <img id="mpAiImg" src="" alt="Generando..." style="max-width:100%;max-height:100%;object-fit:contain">
            </div>
            <button class="btn-ghost" style="padding:6px 12px;font-size:12px" onclick="mpStudioGenerarIA()">
              🔄 Regenerar otra versión fotográfica
            </button>
          </div>
        </div>

        <!-- Barra de acción inferior -->
        <div style="padding:14px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:12.5px;color:#475569" id="mpStudioStatus">
            Selecciona una fotografía para asignarla al producto.
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn-ghost" style="padding:8px 16px" onclick="document.getElementById('mpAiModal').style.display='none'">
              Cancelar
            </button>
            <button id="mpStudioSaveBtn" class="btn-p" style="padding:8px 20px;background:#065f46;color:#fff;border-radius:6px;border:none;cursor:pointer;font-weight:600"
                    disabled onclick="mpStudioGuardar()">
              ✅ Asignar Foto al Producto
            </button>
          </div>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
    mpStudioEjecutarBusqueda();
  } catch (err) {
    showToast('Error abriendo estudio: ' + err.message, 'err');
  }
}

function mpStudioSwitchTab(tab) {
  const panelWeb = document.getElementById('mpPanelWeb');
  const panelAi = document.getElementById('mpPanelAi');
  const tabWeb = document.getElementById('mpTabWebBtn');
  const tabAi = document.getElementById('mpTabAiBtn');

  if (tab === 'web') {
    panelWeb.style.display = 'block';
    panelAi.style.display = 'none';
    tabWeb.style.borderBottom = '2px solid #065f46';
    tabWeb.style.color = '#065f46';
    tabWeb.style.fontWeight = '600';
    tabAi.style.borderBottom = 'none';
    tabAi.style.color = '#64748b';
    tabAi.style.fontWeight = '500';
  } else {
    panelWeb.style.display = 'none';
    panelAi.style.display = 'block';
    tabAi.style.borderBottom = '2px solid #065f46';
    tabAi.style.color = '#065f46';
    tabAi.style.fontWeight = '600';
    tabWeb.style.borderBottom = 'none';
    tabWeb.style.color = '#64748b';
    tabWeb.style.fontWeight = '500';

    if (!document.getElementById('mpAiImg').src || document.getElementById('mpAiImg').src.includes('data:')) {
      mpStudioGenerarIA();
    }
  }
}

async function mpStudioEjecutarBusqueda() {
  const qInput = document.getElementById('mpStudioSearchInput');
  const q = (qInput?.value || '').trim();
  if (!q) return;

  const spinner = document.getElementById('mpWebSpinner');
  const grid = document.getElementById('mpWebGrid');
  const countEl = document.getElementById('mpWebCount');

  if (spinner) spinner.style.display = 'block';
  if (grid) grid.innerHTML = '';
  if (countEl) countEl.textContent = '...';

  try {
    await sb.from('jjp_server_control').update({
      command: `search_images:${q}`,
      command_at: new Date().toISOString()
    }).eq('id', 1);

    let results = [];
    for (let i = 0; i < 14; i++) {
      await new Promise(r => setTimeout(r, 500));
      const { data: ctrl } = await sb.from('jjp_server_control').select('command_res').eq('id', 1).maybeSingle();
      if (ctrl?.command_res?.type === 'search_images' && ctrl.command_res.ok && Array.isArray(ctrl.command_res.results)) {
        results = ctrl.command_res.results;
        break;
      }
    }

    if (spinner) spinner.style.display = 'none';

    if (!results || results.length === 0) {
      if (grid) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:30px;color:#64748b;background:#f8fafc;border-radius:8px">
            <p style="margin:0 0 8px;font-size:14px">No encontramos fotos web exactas con "${escapeHTML(q)}".</p>
            <p style="margin:0;font-size:12px;color:#94a3b8">Prueba ajustando el término arriba o usa la pestaña <strong>🤖 Fotografía con IA</strong>.</p>
          </div>`;
      }
      if (countEl) countEl.textContent = '0';
      return;
    }

    if (countEl) countEl.textContent = results.length;

    grid.innerHTML = results.map((r, idx) => `
      <div class="mp-img-card" id="mp-card-${idx}" style="cursor:pointer;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;transition:all .15s ease"
           onclick="mpStudioSelectImage('${escapeJsStr(r.image || r.thumbnail)}', ${idx}, '${escapeJsStr(r.title)}')">
        <div style="width:100%;height:130px;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:8px">
          <img src="${r.thumbnail || r.image}" alt="${escapeHTML(r.title)}" style="max-width:100%;max-height:100%;object-fit:contain"
               onerror="this.parentElement.parentElement.style.display='none'">
        </div>
        <div style="padding:8px;border-top:1px solid #f1f5f9;font-size:11px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHTML(r.title)}">
          ${escapeHTML(r.title)}
        </div>
      </div>
    `).join('');

    if (results[0]) {
      mpStudioSelectImage(results[0].image || results[0].thumbnail, 0, results[0].title);
    }
  } catch (err) {
    if (spinner) spinner.style.display = 'none';
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;color:#b91c1c;padding:20px;text-align:center">Aviso en búsqueda: ${err.message}</div>`;
  }
}

function mpStudioSelectImage(imgUrl, idx = null, title = '') {
  _mpStudioSelectedImg = imgUrl;

  document.querySelectorAll('.mp-img-card').forEach(c => {
    c.style.borderColor = '#e2e8f0';
    c.style.boxShadow = 'none';
  });

  if (idx !== null) {
    const card = document.getElementById(`mp-card-${idx}`);
    if (card) {
      card.style.borderColor = '#065f46';
      card.style.boxShadow = '0 0 0 2px rgba(6,95,70,0.2)';
    }
  }

  const saveBtn = document.getElementById('mpStudioSaveBtn');
  const statusEl = document.getElementById('mpStudioStatus');
  if (saveBtn) saveBtn.disabled = false;
  if (statusEl) {
    statusEl.innerHTML = `✅ Foto seleccionada: <strong style="color:#0f172a">${escapeHTML(title || 'Imagen elegida')}</strong>`;
  }
}

async function mpStudioGenerarIA() {
  const qInput = document.getElementById('mpStudioSearchInput');
  const prodName = (qInput?.value || '').trim();
  const imgEl = document.getElementById('mpAiImg');
  if (!imgEl) return;

  imgEl.alt = 'Diseñando fotografía del producto con IA...';

  let objectPrompt = `A single ${prodName}, standalone physical stationery office product, isolated on pure solid white background #FFFFFF, sharp focus on branding, natural drop shadow, commercial product photography, 8k uhd, NO BOX, NO CARTON, NO PACKAGING, ONLY THE ITEM`;
  try {
    if (window.GeminiClient) {
      const sys = `You are a commercial catalog photographer. Output a 1-sentence prompt for Flux describing ONLY the physical stationery object itself on pure white background #FFFFFF. Strictly NO boxes, NO carton packaging, NO 3D render look. Pure real catalog photography.`;
      const aiPrompt = await window.GeminiClient.callGemini({ prompt: prodName, systemInstruction: sys, temperature: 0.1 });
      if (aiPrompt && aiPrompt.length > 10 && !aiPrompt.includes('Error')) {
        objectPrompt = aiPrompt.replace(/^["'`]|["'`]$/g, '').trim();
      }
    }
  } catch (_) {}

  const seed = Math.abs(hashCode(prodName + '_' + Date.now()));
  const aiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(objectPrompt.slice(0, 360))}?width=800&height=800&model=flux&nologo=true&seed=${seed}`;

  imgEl.src = aiUrl;
  imgEl.onload = () => {
    mpStudioSelectImage(aiUrl, null, `Foto generada con IA (${prodName})`);
  };
}

async function mpStudioGuardar() {
  if (!_mpStudioSelectedImg || !_mpStudioProdId || !_mpStudioVariantId) return;

  const btn = document.getElementById('mpStudioSaveBtn');
  const statusEl = document.getElementById('mpStudioStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando en catálogo… ⏳'; }
  if (statusEl) statusEl.textContent = 'Procesando imagen, optimizando a WebP y guardando...';

  try {
    await sb.from('jjp_server_control').update({
      command: `save_product_image:${JSON.stringify({ product_id: _mpStudioProdId, image_url: _mpStudioSelectedImg })}`,
      command_at: new Date().toISOString()
    }).eq('id', 1);

    let success = false;
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      const { data: ctrl } = await sb.from('jjp_server_control').select('command_res').eq('id', 1).maybeSingle();
      if (ctrl?.command_res?.type === 'save_product_image') {
        success = ctrl.command_res.ok;
        break;
      }
    }

    if (!success) {
      const resp = await fetch(_mpStudioSelectedImg);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      const escala = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * escala);
      cv.height = Math.round(bmp.height * escala);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const webpBlob = await new Promise(res => cv.toBlob(res, 'image/webp', 0.85));

      const path = `${_mpStudioProdId}.webp`;
      await sb.storage.from('jjp-products').upload(path, webpBlob, { upsert: true, contentType: 'image/webp' });
      const { data: { publicUrl } } = sb.storage.from('jjp-products').getPublicUrl(path);
      const url = `${publicUrl}?v=${Date.now()}`;

      await Promise.all([
        sb.from('jjp_products').update({ image_url: url }).eq('id', _mpStudioProdId),
        sb.from('jjp_product_variants').update({ image_url: url }).eq('id', _mpStudioVariantId)
      ]);
    }

    document.getElementById('mpAiModal').style.display = 'none';
    mpRows = mpRows.filter(r => r.variant_id !== _mpStudioVariantId);
    mpRender();
    showToast('🎉 ¡Foto de producto vinculada exitosamente!', 'ok');
  } catch (e) {
    alert('Error al guardar foto: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Asignar Foto al Producto'; }
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

function escapeJsStr(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
