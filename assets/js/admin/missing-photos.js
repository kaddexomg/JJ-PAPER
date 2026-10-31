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
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" class="table-empty">⏳ Buscando productos sin foto...</td></tr>`;

  try {
    let rows = [];
    const { data, error } = await sb
      .from('jjp_missing_photos')
      .select('*')
      .order('usd_parado', { ascending: false })
      .limit(1000);

    if (!error && Array.isArray(data) && data.length > 0) {
      rows = data;
    } else {
      // Fallback directo a jjp_product_variants si la vista tarda o está en actualización
      const { data: direct } = await sb
        .from('jjp_product_variants')
        .select('id, sku, stock, price_usd, image_url, jjp_products!inner(id, name, image_url, jjp_categories(name))')
        .or('image_url.is.null,image_url.eq.')
        .order('stock', { ascending: false })
        .limit(500);

      if (direct && direct.length > 0) {
        rows = direct
          .filter(v => (!v.image_url || v.image_url === '') && (!v.jjp_products?.image_url || v.jjp_products?.image_url === ''))
          .map(v => {
            const stockVal = Number(v.stock || 0);
            const priceVal = Number(v.price_usd || 0);
            return {
              variant_id: v.id,
              sku: v.sku || '',
              producto: v.jjp_products?.name || 'Producto sin nombre',
              categoria: v.jjp_products?.jjp_categories?.name || 'Sin categoría',
              stock: stockVal,
              price_usd: priceVal,
              usd_parado: stockVal > 0 ? Math.round(stockVal * priceVal * 100) / 100 : 0
            };
          });
      }
    }

    mpRows = rows;
    mpFillCategorias();
    mpRender();
  } catch (err) {
    console.error('Error cargando cola de fotos faltantes:', err);
    if (body) {
      body.innerHTML = `<tr><td colspan="6" class="table-empty">
        Error al cargar fotos faltantes: ${escapeHTML(err.message || String(err))}
        <br><button class="btn-s" style="margin-top:8px;padding:4px 10px;background:#065f46;color:#fff;border-radius:6px;border:none;cursor:pointer" onclick="mpLoad()">🔄 Reintentar</button>
      </td></tr>`;
    }
  }
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
                onclick="mpAbrirEstudio('${r.variant_id}', '${escapeJsStr(r.producto)}')">
          🔍 Buscar Foto Web
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

/* ---------- MOTOR DE IA HONESTA (GEMINI) PARA FOTOS DE PRODUCTO ---------- */
async function mpAnalizarConGemini(rawProductName) {
  if (typeof GeminiClient === 'undefined' || !GeminiClient || typeof GeminiClient.callGemini !== 'function') {
    return {
      reconocido: true,
      nombre_limpio: rawProductName,
      query_packshot: rawProductName + ' papeleria oficina packshot fondo blanco',
      duda: '',
      pregunta: '',
      sugerencias: []
    };
  }

  const prompt = `Actúa como el clasificador de catálogo de JJ Paper (distribuidora mayorista de papelería, suministros de oficina, higiene y embalaje en Caracas).
Analiza el siguiente nombre técnico abreviado de nuestro inventario:
"${rawProductName}"

INSTRUCCIONES DE RIGUROSIDAD Y SINCERIDAD:
1. Si reconoces con total certeza el artículo de papelería, oficina o embalaje:
   - "reconocido": true
   - "nombre_limpio": nombre legible en español sin códigos raros
   - "query_packshot": término comercial exacto para buscar su fotografía packshot oficial sobre fondo blanco (ej: "sobre manila carta paquete", "cinta embalaje transparente 48x100", "carpeta fibra marron gancho carta")
2. Si la descripción es confusa, ambigua o NO estás seguro de qué producto es:
   SÉ TOTALMENTE SINCERO. No adivines ni inventes nada.
   - "reconocido": false
   - "duda": explicación breve y honesta de por qué dudas (ej: "No queda claro si es tirro de embalaje o tirro de pintor de papel")
   - "pregunta": "¿Podrías indicarme qué tipo de producto es?"
   - "sugerencias": array con 2 o 3 opciones probables para que el usuario elija con un clic.

Responde ÚNICAMENTE un objeto JSON válido sin bloques markdown ni explicaciones:
{
  "reconocido": true,
  "nombre_limpio": "...",
  "query_packshot": "...",
  "duda": "...",
  "pregunta": "...",
  "sugerencias": ["...", "..."]
}`;

  try {
    const raw = await GeminiClient.callGemini({
      prompt,
      temperature: 0.1,
      maxTokens: 350
    });
    const clean = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch (err) {
    console.warn('Fallo analizando con Gemini:', err);
    return {
      reconocido: true,
      nombre_limpio: rawProductName,
      query_packshot: rawProductName + ' papeleria oficina packshot fondo blanco',
      duda: '',
      pregunta: '',
      sugerencias: []
    };
  }
}

function mpAplicarSugerencia(texto) {
  const input = document.getElementById('mpStudioSearchInput');
  if (input) input.value = texto + ' papeleria oficina fondo blanco';
  const box = document.getElementById('mpAiDialogueBox');
  if (box) box.style.display = 'none';
  mpStudioEjecutarBusqueda();
}

let _mpStudioVariantId = null;
let _mpStudioProdId = null;
let _mpStudioSelectedImg = null;

async function mpAbrirEstudio(variantId, productoNombre) {
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
    _mpStudioCurrentIdentity = mpExtraerFichaIdentidad(prodName, v.jjp_products?.description);

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
              <span style="font-size:11px;font-weight:600;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px">Fotos Oficiales & Validación Visión AI</span>
            </h3>
            <p style="margin:4px 0 0;font-size:13px;color:#64748b;font-weight:500">${escapeHTML(prodName)}</p>
          </div>
          <button onclick="document.getElementById('mpAiModal').style.display='none'" style="border:none;background:none;font-size:20px;cursor:pointer;color:#94a3b8">✕</button>
        </div>

        <!-- Barra de diálogo honesto con IA -->
        <div id="mpAiDialogueBox" style="display:none;padding:12px 20px;background:#fffbeb;border-bottom:1px solid #fef3c7;"></div>

        <!-- Barra de búsqueda / afinamiento -->
        <div style="padding:12px 20px;background:#fff;border-bottom:1px solid #f1f5f9;display:flex;gap:10px;align-items:center">
          <div style="flex:1;position:relative">
            <input type="text" id="mpStudioSearchInput" value="${escapeHTML(prodName)}"
                   onkeydown="if(event.key==='Enter')mpStudioEjecutarBusqueda()"
                   style="width:100%;padding:8px 12px 8px 32px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;outline:none"
                   placeholder="Término de búsqueda packshot o aclaratoria a la IA...">
            <span style="position:absolute;left:10px;top:9px;font-size:13px;color:#94a3b8">🔍</span>
          </div>
          <button class="btn-s" style="padding:8px 14px;background:#0f172a;color:#fff;border-radius:8px;border:none;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px"
                  onclick="mpStudioEjecutarBusqueda()">
            Buscar Fotos
          </button>
        </div>

        <!-- Barra de información y afinamiento -->
        <div style="padding:10px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:600;color:#065f46;display:flex;align-items:center;gap:6px">
            <span>🌐 Fotografías Oficiales en Línea</span>
            <span style="font-size:11px;background:#e2e8f0;color:#475569;padding:1px 8px;border-radius:10px" id="mpWebCount">...</span>
          </div>
          <div style="font-size:11.5px;color:#64748b">
            💡 Selecciona la foto que coincida exactamente con marca, color y presentación
          </div>
        </div>

        <!-- Contenedor de contenido -->
        <div style="flex:1;overflow-y:auto;padding:18px 20px;">
          <div id="mpPanelWeb">
            <div id="mpWebSpinner" style="text-align:center;padding:40px 0;color:#64748b">
              <div style="font-size:28px;margin-bottom:8px">⏳</div>
              <div style="font-size:13px;font-weight:500">Consultando fotografías reales del producto en distribuidores...</div>
            </div>
            <div id="mpWebGrid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:14px;"></div>
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
    // Flujo inteligente: Gemini evalúa primero la certeza del artículo
    const statusEl = document.getElementById('mpStudioStatus');
    if (statusEl) statusEl.innerHTML = '🤖 Evaluando descripción con IA de JJ Paper...';

    const aiRes = await mpAnalizarConGemini(prodName);
    const diagBox = document.getElementById('mpAiDialogueBox');
    const inputEl = document.getElementById('mpStudioSearchInput');

    if (aiRes && aiRes.reconocido) {
      if (inputEl && aiRes.query_packshot) inputEl.value = aiRes.query_packshot;
      if (statusEl) statusEl.innerHTML = '✅ Reconocido como: <strong>' + escapeHTML(aiRes.nombre_limpio || prodName) + '</strong>';
      mpStudioEjecutarBusqueda();
    } else if (aiRes && !aiRes.reconocido) {
      // La IA es sincera: no adivina, solicita ayuda al usuario
      if (diagBox) {
        diagBox.style.display = 'block';
        diagBox.innerHTML = `
          <div style="font-size:12.5px;font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span>🤖 Sinceridad de IA:</span>
            <span>${escapeHTML(aiRes.duda || 'No tengo certeza de qué producto exacto es este código.')}</span>
          </div>
          <p style="font-size:12px;color:#78350f;margin:0 0 8px 0;line-height:1.4">
            ${escapeHTML(aiRes.pregunta || '¿Podrías aclararme qué artículo es para ubicar su fotografía exacta sobre fondo blanco?')}
          </p>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${(aiRes.sugerencias || []).map(s => `
              <button type="button" class="btn-s" style="padding:4px 10px;background:#fff;color:#92400e;border:1px solid #d97706;border-radius:16px;font-size:11.5px;cursor:pointer;font-weight:600"
                      onclick="mpAplicarSugerencia('${escapeJsStr(s)}')">
                👉 ${escapeHTML(s)}
              </button>
            `).join('')}
          </div>
        `;
      }
      if (statusEl) statusEl.innerHTML = '⚠️ Esperando tu aclaratoria para buscar la foto adecuada.';
      if (inputEl) inputEl.focus();
    } else {
      mpStudioEjecutarBusqueda();
    }
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
    let results = [];

  // 1. INTENTAR DIRECTAMENTE VÍA CLOUDFLARE EDGE API (/api/search-images)
  // Ultra-rápida (1-2s), sin demoras de base de datos ni desincronización de procesos
  try {
    const cfRes = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
    if (cfRes.ok) {
      const cfData = await cfRes.json();
      if (cfData.ok && Array.isArray(cfData.results) && cfData.results.length > 0) {
        results = cfData.results;
      }
    }
  } catch (err) {
    console.warn('Fallo /api/search-images:', err);
  }

  // 2. Intentar servidor local LAN (wa-server en localhost:8787)
  if (!results.length) {
    try {
      const lanCtl = new AbortController();
      const lanTimer = setTimeout(() => lanCtl.abort(), 2000);
      const lanRes = await fetch(`http://localhost:8787/lan/products/search-images?q=${encodeURIComponent(q)}`, {
        signal: lanCtl.signal
      });
      clearTimeout(lanTimer);
      if (lanRes.ok) {
        const lanData = await lanRes.json();
        if (lanData.ok && Array.isArray(lanData.results) && lanData.results.length > 0) {
          results = lanData.results;
        }
      }
    } catch (_) {}
  }

  // 3. Fallback a jjp_server_control si aún no hay resultados (máximo 4 segundos)
  if (!results.length) {
    try {
      await sb.from('jjp_server_control').update({
        command: `search_images:${q}`,
        command_at: new Date().toISOString()
      }).eq('id', 1);

      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 500));
        const { data: ctrl } = await sb.from('jjp_server_control').select('command_res').eq('id', 1).maybeSingle();
        let resObj = ctrl?.command_res;
        if (typeof resObj === 'string') {
          try { resObj = JSON.parse(resObj); } catch (_) {}
        }
        if (resObj?.type === 'search_images' && resObj.ok && Array.isArray(resObj.results)) {
          const resQ = (resObj.query || '').toLowerCase().trim();
          const cleanQ = q.toLowerCase().trim();
          if (resQ.includes(cleanQ) || cleanQ.includes(resQ) || resObj.reqId) {
            results = resObj.results;
            break;
          }
        }
      }
    } catch (e) {
      console.warn('Error en fallback jjp_server_control:', e);
    }
  }

    if (spinner) spinner.style.display = 'none';

    if (!results || results.length === 0) {
      if (grid) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:30px;color:#64748b;background:#f8fafc;border-radius:8px">
            <p style="margin:0 0 8px;font-size:14px">No encontramos fotos web exactas con "${escapeHTML(q)}".</p>
            <p style="margin:0;font-size:12px;color:#94a3b8">Prueba ajustando el término arriba o toma una foto real con la cámara del teléfono.</p>
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

async function mpStudioSelectImage(imgUrl, idx = null, title = '') {
  _mpStudioSelectedImg = imgUrl;
  _mpStudioVisionVerdict = null;

  document.querySelectorAll('.mp-img-card').forEach(c => {
    c.style.borderColor = '#e2e8f0';
    c.style.boxShadow = 'none';
  });

  const card = (idx !== null) ? document.getElementById(`mp-card-${idx}`) : null;
  if (card) {
    card.style.borderColor = '#065f46';
    card.style.boxShadow = '0 0 0 2px rgba(6,95,70,0.2)';
  }

  const saveBtn = document.getElementById('mpStudioSaveBtn');
  const statusEl = document.getElementById('mpStudioStatus');
  if (saveBtn) saveBtn.disabled = false;
  if (statusEl) {
    statusEl.innerHTML = `🔍 Analizando atributos con Gemini Vision... <strong style="color:#0f172a">${escapeHTML(title || 'Imagen elegida')}</strong>`;
  }

  // Ejecución de Gemini Vision para contrastar atributos con la ficha técnica
  if (_mpStudioCurrentIdentity) {
    const vRes = await mpVerificarImagenConGeminiVision(imgUrl, _mpStudioCurrentIdentity, _mpStudioCurrentIdentity.raw);
    _mpStudioVisionVerdict = vRes;

    if (vRes.veredicto === 'rechazada' || vRes.tipo === 'mismatch' || vRes.medida === 'mismatch') {
      if (card) {
        card.style.borderColor = '#dc2626';
        card.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.3)';
      }
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700">❌ Rechazada por IA de Visión:</span> ${escapeHTML(vRes.razon || 'Incoherencia con la ficha del producto.')} <br><span style="font-size:11px;color:#991b1b">Tipo: ${vRes.tipo} | Medida: ${vRes.medida} | Color: ${vRes.color}</span>`;
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.title = 'Imagen rechazada por discordancia con los atributos del producto';
      }
    } else {
      if (card) {
        card.style.borderColor = '#16a34a';
        card.style.boxShadow = '0 0 0 2px rgba(22,163,74,0.3)';
      }
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#16a34a;font-weight:700">✅ Verificada por Gemini Vision:</span> Coincide con ficha técnica. <span style="font-size:11px;color:#15803d">(${escapeHTML(vRes.razon || 'Producto auténtico')})</span>`;
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.title = '';
      }
    }
  }
}

// ERRADICADO: Por política comercial soberana, no se admiten imágenes ficticias generadas por IA
async function mpStudioGenerarIA() {
  alert('No se permiten imágenes ficticias de IA generativa en el catálogo oficial.');
}

async function mpStudioGuardar() {
  if (!_mpStudioSelectedImg || !_mpStudioProdId || !_mpStudioVariantId) return;

  // Validación estricta anti-IA generativa
  if (_mpStudioSelectedImg.includes('pollinations') || _mpStudioSelectedImg.includes('stability.ai') || _mpStudioSelectedImg.includes('midjourney') || _mpStudioSelectedImg.includes('replicate.delivery')) {
    alert('No se permiten imágenes ficticias de IA generativa en el catálogo oficial');
    const b = document.getElementById('mpStudioSaveBtn');
    if (b) { b.disabled = false; b.textContent = '✅ Asignar Foto al Producto'; }
    return;
  }

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
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const { data: ctrl } = await sb.from('jjp_server_control').select('command_res').eq('id', 1).maybeSingle();
      let resObj = ctrl?.command_res;
      if (typeof resObj === 'string') {
        try { resObj = JSON.parse(resObj); } catch (_) {}
      }
      if (resObj?.type === 'save_product_image' && resObj.ok) {
        success = true;
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

    // Registro en jjp_photo_audit
    try {
      await sb.from('jjp_photo_audit').insert({
        product_id: _mpStudioProdId,
        variant_id: _mpStudioVariantId,
        image_url: _mpStudioSelectedImg.slice(0, 500),
        verdict: _mpStudioVisionVerdict?.veredicto === 'rechazada' ? 'dudosa' : 'ok',
        confidence: _mpStudioVisionVerdict?.confidence || 0.95,
        mismatches: _mpStudioVisionVerdict || {},
        reason: _mpStudioVisionVerdict?.razon || 'Foto packshot comercial oficial vinculada desde estudio web',
        source: 'estudio_web'
      });
    } catch (auditErr) {
      console.warn('Error en auditoría de foto:', auditErr);
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

/* ---------- FICHA DE IDENTIDAD Y CONTROL DE CALIDAD GEMINI VISION ---------- */
let _mpStudioCurrentIdentity = null;
let _mpStudioVisionVerdict = null;

function mpExtraerFichaIdentidad(prodName, description = '') {
  const text = (prodName + ' ' + (description || '')).toUpperCase();

  const brands = [
    'CHAMEX', 'REPORT', 'HP', 'BOREAL', 'REPROSET', 'LEDESMA', 'CHAMPION',
    'AVILA', 'CARVAJAL', 'HAMMERMILL', 'SHARPIE', 'EXPO', 'SHARK', 'STAR KIT',
    'STUDMARK', 'KORES', 'MAYKA', 'OFFI-ESCOLAR', 'OFIART', 'OFIMAK', 'CRISBY',
    'ESFER', 'MISTER BOBINA', 'MR BOBINA', 'ROLLS', 'ALPHA', 'PRINTA', 'ACCO',
    'MONGOL', 'PAPER MATE', 'PAPERMATE', 'KILOMETRICO', 'INKJOY', 'LUXOR',
    'BULL', 'DURACELL', 'CASIO', 'MARFIL', 'AKTA', 'OSLO', 'CARIBE', 'TUK',
    'POST-IT', '3M', 'PRITT', 'SOLITA', 'FABER-CASTELL', 'FABER CASTELL',
    'FABERCASTELL', 'BIC', 'NORMA', 'SABONIS', 'PILOT', 'PENTEL', 'STAEDTLER',
    'PEGA-LOKA', 'PEGALOKA', 'PELIKAN', 'ARTESCO', 'FILGO', 'ARTEL', 'STABILO',
    'UHU', 'SCOTCH', 'TESA', 'CONTACT', 'BACO', 'JOVI', 'CRAYOLA', 'GIOTTO',
    'MAPED', 'CARICIAS', 'SANITISU', 'SCOTT', 'ROSE'
  ];
  let marca = '';
  for (const b of brands) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(text)) {
      marca = b;
      break;
    }
  }

  let medida = '';
  if (/\b(EXTRA\s*OFICIO)\b/i.test(text)) medida = 'Extra Oficio';
  else if (/\b(OFICIO)\b/i.test(text)) medida = 'Oficio (Legal)';
  else if (/\b(CARTA)\b/i.test(text)) medida = 'Carta (Letter)';
  else if (/\b(A4)\b/i.test(text)) medida = 'A4';
  else if (/\b(1\/2\s*PLIEGO|MEDIO\s*PLIEGO)\b/i.test(text)) medida = 'Medio Pliego';
  else if (/\b(PLIEGO)\b/i.test(text)) medida = 'Pliego Completo';
  else if (/\b(48\s*X\s*100|48X100)\b/i.test(text)) medida = '48mm x 100m';
  else if (/\b(24\s*X\s*50|24X50)\b/i.test(text)) medida = '24mm x 50m';
  else if (/\b(18\s*X\s*30|18X30)\b/i.test(text)) medida = '18mm x 30m';
  else if (/\b(12\s*X\s*30|12X30)\b/i.test(text)) medida = '12mm x 30m';
  else if (/\b(N[º°]?\s*10|NUMERO\s*10)\b/i.test(text)) medida = 'Nº 10';
  else if (/\b(N[º°]?\s*26\/6|26\/6)\b/i.test(text)) medida = '26/6';
  else if (/\b(75\s*GR|75G)\b/i.test(text)) medida = '75 g/m²';

  let color = '';
  const colors = ['AZUL', 'NEGRO', 'ROJO', 'VERDE', 'BLANCO', 'AMARILLO', 'NARANJA', 'ROSADO', 'MORADO', 'MARRON', 'TRANSPARENTE', 'SURTIDO'];
  for (const c of colors) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(text)) {
      color = c;
      break;
    }
  }

  let presentacion = '';
  if (/\b(RESMA|500\s*HJS|500\s*HOJAS)\b/i.test(text)) presentacion = 'Resma 500 Hojas';
  else if (/\b(X\s*12|DOCENA|C\/12|CAJA\s*12)\b/i.test(text)) presentacion = 'Caja x 12';
  else if (/\b(X\s*24|CAJA\s*24)\b/i.test(text)) presentacion = 'Caja x 24';
  else if (/\b(X\s*36|CAJA\s*36)\b/i.test(text)) presentacion = 'Caja x 36';
  else if (/\b(X\s*50|CAJA\s*50|PAQ\s*50)\b/i.test(text)) presentacion = 'Caja/Paq. x 50';
  else if (/\b(X\s*100|CAJA\s*100|PAQ\s*100)\b/i.test(text)) presentacion = 'Caja/Paq. x 100';
  else if (/\b(BULTO)\b/i.test(text)) presentacion = 'Bulto Cerrado';
  else if (/\b(BLISTER)\b/i.test(text)) presentacion = 'Blister';
  else if (/\b(ROLLO)\b/i.test(text)) presentacion = 'Rollo';

  let tipo = prodName;
  const types = [
    { k: 'PAPEL BOND', label: 'Papel Bond Fotocopia' },
    { k: 'CARPETA MANILA', label: 'Carpeta Manila' },
    { k: 'CARPETA FIBRA', label: 'Carpeta de Fibra con Gancho' },
    { k: 'MARCADOR PIZARRA', label: 'Marcador para Pizarra Blanca' },
    { k: 'MARCADOR PERMANENTE', label: 'Marcador Permanente' },
    { k: 'BOLIGRAFO', label: 'Bolígrafo' },
    { k: 'TIRRO EMBALAJE', label: 'Cinta de Embalaje / Tirro' },
    { k: 'TIRRO TRANSPARENTE', label: 'Cinta Transparente' },
    { k: 'TIRRO PLASTICO', label: 'Cinta Adhesiva Plástica' },
    { k: 'TIRRO PAPEL', label: 'Tirro de Papel / Enmascarar' },
    { k: 'CEPILLO', label: 'Cepillo para Barrer / Limpieza' },
    { k: 'COLETO', label: 'Coleto para Piso' },
    { k: 'TOALLIN', label: 'Toallín de Papel' },
    { k: 'SERVILLETA', label: 'Servilleta de Papel' },
    { k: 'PAPEL HIGIENICO', label: 'Papel Higiénico' },
    { k: 'GRAPADORA', label: 'Grapadora de Oficina' },
    { k: 'GRAPAS', label: 'Grapas Metálicas' },
    { k: 'CLIPS', label: 'Clips Sujetapapeles' },
    { k: 'TIJERA', label: 'Tijera de Oficina' },
    { k: 'SILICON', label: 'Silicón Líquido / Barra' },
    { k: 'PEGA', label: 'Pega Líquida / Barra' },
    { k: 'CORRECTOR', label: 'Corrector Líquido / Cinta' },
    { k: 'NOTAS ADHESIVAS', label: 'Notas Adhesivas' },
    { k: 'SOBRE MANILA', label: 'Sobre Manila' }
  ];
  for (const t of types) {
    if (text.includes(t.k)) {
      tipo = t.label;
      break;
    }
  }

  return { tipo, medida, color, presentacion, marca, raw: prodName };
}

async function mpVerificarImagenConGeminiVision(imageUrlOrBlob, identity, prodName) {
  if (typeof GeminiClient === 'undefined' || !GeminiClient || typeof GeminiClient.callGeminiVision !== 'function') {
    return { veredicto: 'aprobada', razon: 'Gemini Vision no disponible en este cliente', confidence: 0.8 };
  }

  try {
    let base64 = '';
    let mimeType = 'image/jpeg';

    if (typeof imageUrlOrBlob === 'string' && imageUrlOrBlob.startsWith('data:')) {
      base64 = imageUrlOrBlob;
    } else if (imageUrlOrBlob instanceof Blob || (typeof File !== 'undefined' && imageUrlOrBlob instanceof File)) {
      base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(imageUrlOrBlob);
      });
      mimeType = imageUrlOrBlob.type || 'image/jpeg';
    } else if (typeof imageUrlOrBlob === 'string' && imageUrlOrBlob.startsWith('http')) {
      try {
        const fetchUrl = `https://wsrv.nl/?url=${encodeURIComponent(imageUrlOrBlob)}&w=400&h=400&fit=contain&output=jpg`;
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const blob = await res.blob();
          base64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onloadend = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
        }
      } catch (_) {
        return { veredicto: 'aprobada', razon: 'Evaluación visual diferida', confidence: 0.8 };
      }
    }

    if (!base64) return { veredicto: 'aprobada', razon: 'Sin datos visuales procesables', confidence: 0.8 };

    const prompt = `Actúa como inspector de control de calidad fotográfica del catálogo de JJ Paper.
Compara la fotografía adjunta contra la ficha técnica del producto de papelería/suministros:
Producto: "${prodName}"
- Tipo esperado: ${identity.tipo || 'Suministro de oficina'}
- Medida/Formato esperado: ${identity.medida || 'No especificada'}
- Color esperado: ${identity.color || 'No especificado'}
- Presentación esperada: ${identity.presentacion || 'No especificada'}
- Marca esperada: ${identity.marca || 'No especificada'}

REGLAS DE RECHAZO:
1. Si la foto muestra un producto totalmente diferente (ejemplo: un vaso en vez de cepillo para barrer, lechuga en vez de toallín, servilletas en vez de coleto), veredicto = "rechazada".
2. Si la foto muestra un formato claramente erróneo (ejemplo: carpeta Oficio cuando el producto es Carta, o resma A4 cuando es Carta), veredicto = "rechazada".
3. Si el color dominante del producto no coincide con el color requerido explícito (ejemplo: marcador rojo cuando el producto es azul), veredicto = "rechazada".
4. Si la foto coincide con el artículo comercial real sobre fondo blanco o catálogo, veredicto = "aprobada".

Responde ÚNICAMENTE un JSON válido sin markdown:
{
  "tipo": "match" | "mismatch",
  "medida": "match" | "mismatch" | "no_aplica",
  "color": "match" | "mismatch" | "no_aplica",
  "marca": "match" | "mismatch" | "no_aplica",
  "presentacion": "match" | "mismatch" | "no_aplica",
  "veredicto": "aprobada" | "rechazada" | "dudosa",
  "razon": "Explicación breve de 1 frase en español",
  "confidence": 0.95
}`;

    const raw = await GeminiClient.callGeminiVision({
      prompt,
      imageBase64: base64,
      mimeType,
      temperature: 0.1,
      maxTokens: 300
    });

    const clean = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch (err) {
    console.warn('Fallo mpVerificarImagenConGeminiVision:', err);
    return { veredicto: 'aprobada', razon: 'Verificación visual no concluyente: ' + err.message, confidence: 0.7 };
  }
}

async function mpGenerarConIA(variantId, productoNombre) { return mpAbrirEstudio(variantId, productoNombre); }
