/* ======================================================
   JJ Paper — Generador de Documentos Corporativos & Hoja Membretada con IA
   assets/js/admin/documentos.js
   
   Soporte para:
   - Nota de Entrega / Despacho conectada al Catálogo Real (jjp_products)
     y a Pedidos / Cotizaciones existentes
   - Recibo de Pago / Comprobante de Cobro
   - Ficha Informativa / Carta de Presentación Oficial
   - Forma Libre / Hoja Membretada Corporativa
   - Copiloto Redactor de Documentos con IA (Gemini en vivo)
   - Libertad de Diseño (Color tema, tamaño tipográfico, alineación,
     encabezados personalizables, edición directa en hoja)
   ====================================================== */

let docState = {
  template: 'nota_entrega',    // 'nota_entrega' | 'recibo_pago' | 'ficha_empresa' | 'forma_libre'
  pageFormat: 'carta',         // 'carta' | 'forma_continua'
  colorMode: 'color',          // 'color' | 'bw'
  accentColor: '#16604A',
  fontSize: '12px',
  textAlign: 'justify',
  customDocBadge: '',
  
  // Metadatos comunes
  docNumber: '',
  docDate: new Date().toISOString().split('T')[0],
  docCondition: 'Contado',
  
  // Datos del Cliente
  clientId: null,
  clientName: '',
  clientRif: '',
  clientPhone: '',
  clientAddress: '',
  clientContact: '',
  
  // Datos específicos: Nota de Entrega
  driverName: '',
  driverCi: '',
  driverPlate: '',
  dispatchDestination: '',
  deliveryNotes: 'Mercancía revisada y chequeada en almacén a entera conformidad.',
  showPricesInNota: false,
  items: [
    { sku: 'RES-CARTA-75', qty: 10, unit: 'Caja x 10', description: 'Resma de Papel Bond Carta 75g HP / Report', price_usd: 42.00, obs: 'Bulto sellado' },
    { sku: 'ROL-80X70', qty: 5, unit: 'Caja x 50', description: 'Rollo Térmico 80x70mm para Puntos de Venta (POS)', price_usd: 35.00, obs: 'Línea de caja' }
  ],
  
  // Datos específicos: Recibo de Pago
  receiptAmountUsd: 150.00,
  receiptExchangeRate: 0,
  receiptAmountBs: 0,
  receiptConcept: 'Cancelación de factura y despacho de mercancía al mayor',
  paymentMethod: 'Transferencia',
  bankOrigin: 'Banesco',
  bankDestination: 'Banesco JJ Paper',
  paymentRef: '',
  previousBalance: 0,
  currentPayment: 150.00,
  remainingBalance: 0,
  
  // Datos específicos: Ficha de Empresa
  showBankAccounts: true,
  showShippingPolicies: true,
  showCatalogLinks: true,
  
  // Datos específicos: Forma Libre
  freeTitle: 'COMUNICADO OFICIAL DE DISTRIBUCIÓN',
  freeRecipient: 'A NUESTROS DISTINGUIDOS CLIENTES Y COMERCIOS ALIADOS',
  freeSignRole: 'DIRECCIÓN COMERCIAL & ADMINISTRACIÓN',
  freeBody: `Por medio de la presente, JJ PAPER, C.A. hace constar que se encuentra a total disposición de su distinguida empresa para garantizar el suministro mayorista continuo y prioritario de papelería corporativa, resmas de papel bond, consumibles térmicos para puntos de venta y suministros de embalaje e higiene institucional.\n\nContamos con despacho directo en 24 horas a su sede en Caracas y envíos a nivel nacional, facturación fiscal formal a Tasa Oficial BCV y asesoría comercial dedicada.\n\nQuedamos atentos a sus requerimientos y pedidos a través de nuestros canales oficiales de atención.`
};

let _catalogItemsCache = [];
let _recentDocsMap = new Map();

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  generateDocNumber();
  
  if (typeof updateExchangeRate === 'function') {
    try { await updateExchangeRate(); } catch(_) {}
  }
  const rate = (typeof getRate === 'function') ? getRate() : 36.5;
  docState.receiptExchangeRate = rate;
  calculateReceiptBs();

  setupCustomerAutocomplete();
  setupCatalogProductAutocomplete();
  loadCatalogCacheForDocs();
  loadRecentOrdersAndQuotes();

  renderItemsTableInput();
  renderDocumentPreview();
});

// Generador de correlativo
function generateDocNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const prefixes = {
    nota_entrega: 'NE',
    recibo_pago: 'REC',
    ficha_empresa: 'INF',
    forma_libre: 'COM'
  };
  const pfx = prefixes[docState.template] || 'DOC';
  docState.docNumber = `${pfx}-${year}-${rand}`;
  const inputEl = document.getElementById('fieldDocNumber');
  if (inputEl) inputEl.value = docState.docNumber;
}

// Cambio de plantilla
function setTemplate(tpl) {
  docState.template = tpl;
  generateDocNumber();
  
  document.querySelectorAll('.tpl-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tpl === tpl);
  });

  document.getElementById('secNotaEntrega').style.display = (tpl === 'nota_entrega') ? 'block' : 'none';
  document.getElementById('secReciboPago').style.display = (tpl === 'recibo_pago') ? 'block' : 'none';
  document.getElementById('secFichaEmpresa').style.display = (tpl === 'ficha_empresa') ? 'block' : 'none';
  document.getElementById('secFormaLibre').style.display = (tpl === 'forma_libre') ? 'block' : 'none';

  renderDocumentPreview();
}

// Controles de Libertad de Diseño
function setPageFormat(fmt) {
  docState.pageFormat = fmt;
  document.getElementById('docPreviewPaper').className = `doc-paper-sheet fmt-${fmt} mode-${docState.colorMode}`;
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.fmt === fmt);
  });
}

function setColorMode(mode) {
  docState.colorMode = mode;
  document.getElementById('docPreviewPaper').className = `doc-paper-sheet fmt-${docState.pageFormat} mode-${mode}`;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function setDocAccentColor(color) {
  docState.accentColor = color || '#16604A';
  document.documentElement.style.setProperty('--doc-c', docState.accentColor);
  renderDocumentPreview();
}

function setDocFontSize(size) {
  docState.fontSize = size || '12px';
  document.documentElement.style.setProperty('--doc-font-size', docState.fontSize);
  renderDocumentPreview();
}

function setDocTextAlign(align) {
  docState.textAlign = align || 'justify';
  document.documentElement.style.setProperty('--doc-text-align', docState.textAlign);
  renderDocumentPreview();
}

// Autocompletado de Clientes
function setupCustomerAutocomplete() {
  const input = document.getElementById('clientSearchInput');
  const list = document.getElementById('clientSearchResults');
  if (!input || !list) return;

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      list.style.display = 'none';
      return;
    }
    timer = setTimeout(() => searchCustomers(q), 220);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });
}

async function searchCustomers(q) {
  const list = document.getElementById('clientSearchResults');
  try {
    const { data, error } = await sb.from('jjp_customers')
      .select('id,name,rif,phone,address,email')
      .or(`name.ilike.%${q}%,rif.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);

    if (error || !data || !data.length) {
      list.innerHTML = `<div class="ac-item-empty">No se encontraron clientes coincidentes</div>`;
      list.style.display = 'block';
      return;
    }

    list.innerHTML = data.map(c => `
      <div class="ac-item" onclick="selectCustomer(${JSON.stringify(c).replace(/"/g, '&quot;')})">
        <strong>${escapeHTML(c.name)}</strong>
        <span>RIF: ${escapeHTML(c.rif || 'S/R')} · Tel: ${escapeHTML(c.phone || 'S/T')}</span>
      </div>
    `).join('');
    list.style.display = 'block';
  } catch (err) {
    console.warn('Error buscando clientes:', err);
  }
}

function selectCustomer(c) {
  docState.clientId = c.id;
  docState.clientName = c.name || '';
  docState.clientRif = c.rif || '';
  docState.clientPhone = c.phone || '';
  docState.clientAddress = c.address || '';
  
  document.getElementById('fieldClientName').value = docState.clientName;
  document.getElementById('fieldClientRif').value = docState.clientRif;
  document.getElementById('fieldClientPhone').value = docState.clientPhone;
  document.getElementById('fieldClientAddress').value = docState.clientAddress;
  
  document.getElementById('clientSearchInput').value = '';
  document.getElementById('clientSearchResults').style.display = 'none';
  renderDocumentPreview();
}

// ======================================================
// CONEXIÓN REAL CON EL CATÁLOGO DE PRODUCTOS Y PEDIDOS
// ======================================================
async function loadCatalogCacheForDocs() {
  try {
    const { data: prods } = await sb
      .from('jjp_products')
      .select('id,name,sku,unit,price_usd,stock,active,jjp_product_variants(id,variant_name,sku,price_usd,stock,active)')
      .eq('active', true)
      .order('name', { ascending: true })
      .range(0, 1500);

    const flat = [];
    for (const p of (prods || [])) {
      const variants = Array.isArray(p.jjp_product_variants) ? p.jjp_product_variants.filter(v => v.active !== false) : [];
      if (variants.length > 0) {
        for (const v of variants) {
          const vLabel = v.variant_name || '';
          const fullName = vLabel && vLabel.toLowerCase() !== 'estándar' && vLabel.toLowerCase() !== 'unica' && vLabel.toLowerCase() !== p.name.toLowerCase()
            ? `${p.name} — ${vLabel}`
            : p.name;
          flat.push({
            id: v.id || p.id,
            sku: v.sku || p.sku || '',
            name: fullName,
            unit: p.unit || 'Unidad',
            brand: '',
            price_usd: Number(v.price_usd || p.price_usd || 0),
            stock: Number(v.stock ?? p.stock ?? 0)
          });
        }
      } else {
        flat.push({
          id: p.id,
          sku: p.sku || '',
          name: p.name,
          unit: p.unit || 'Unidad',
          brand: '',
          price_usd: Number(p.price_usd || 0),
          stock: Number(p.stock || 0)
        });
      }
    }
    _catalogItemsCache = flat;
  } catch (err) {
    console.warn('Error cargando catálogo para documentos:', err);
  }
}

function setupCatalogProductAutocomplete() {
  const input = document.getElementById('catalogProductSearchInput');
  const list = document.getElementById('catalogProductSearchResults');
  if (!input || !list) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      list.style.display = 'none';
      return;
    }
    searchCatalogProductsForDoc(q);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim().toLowerCase();
    if (q) searchCatalogProductsForDoc(q);
    else if (_catalogItemsCache.length > 0) {
      renderCatalogResultsList(_catalogItemsCache.slice(0, 12));
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });
}

async function searchCatalogProductsForDoc(q) {
  if (_catalogItemsCache.length === 0) {
    await loadCatalogCacheForDocs();
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const matches = _catalogItemsCache.filter(item => {
    const hay = `${item.name} ${item.sku} ${item.brand} ${item.unit}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  }).slice(0, 15);

  renderCatalogResultsList(matches);
}

function renderCatalogResultsList(items) {
  const list = document.getElementById('catalogProductSearchResults');
  if (!list) return;

  if (!items || items.length === 0) {
    list.innerHTML = `<div class="ac-item-empty">No se encontraron productos en el catálogo</div>`;
    list.style.display = 'block';
    return;
  }

  list.innerHTML = items.map((p, idx) => {
    const safeJson = JSON.stringify(p).replace(/"/g, '&quot;');
    const priceTxt = p.price_usd > 0 ? `$${p.price_usd.toFixed(2)}` : 'Consultar';
    return `
      <div class="ac-item" onclick="selectCatalogProductForDoc(${safeJson})">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong>${escapeHTML(p.name)}</strong>
          <span style="background:#e6f4ea;color:#137333;padding:2px 6px;border-radius:4px;font-weight:700;font-size:10.5px">${priceTxt}</span>
        </div>
        <span>SKU: ${escapeHTML(p.sku || 'S/C')} · Unidad: ${escapeHTML(p.unit || 'Und')} ${p.brand ? '· Marca: ' + escapeHTML(p.brand) : ''}</span>
      </div>
    `;
  }).join('');
  list.style.display = 'block';
}

function selectCatalogProductForDoc(p) {
  if (!p) return;
  // Si el ítem ya existe por SKU/nombre, sumar cantidad; si no, agregarlo
  const existingIdx = docState.items.findIndex(it =>
    (p.sku && it.sku === p.sku) || (it.description.toLowerCase() === p.name.toLowerCase())
  );

  if (existingIdx >= 0) {
    docState.items[existingIdx].qty = (Number(docState.items[existingIdx].qty) || 0) + 1;
  } else {
    docState.items.push({
      sku: p.sku || '',
      qty: 1,
      unit: p.unit || 'Unidad',
      description: p.name,
      price_usd: Number(p.price_usd || 0),
      obs: p.sku ? `Cód: ${p.sku}` : ''
    });
  }

  const input = document.getElementById('catalogProductSearchInput');
  const list = document.getElementById('catalogProductSearchResults');
  if (input) input.value = '';
  if (list) list.style.display = 'none';

  renderItemsTableInput();
  renderDocumentPreview();
  if (typeof showToast === 'function') {
    showToast(`Agregado a Nota de Entrega: ${p.name}`, 'ok');
  }
}

async function loadRecentOrdersAndQuotes() {
  const sel = document.getElementById('recentOrderSelect');
  if (!sel) return;
  try {
    const [ordRes, quoRes] = await Promise.all([
      sb.from('jjp_orders').select('id,order_number,client_name,rif,phone,address,items,total_usd,created_at').order('created_at', { ascending: false }).limit(20),
      sb.from('jjp_quotes').select('id,quote_number,client_name,rif,phone,items,estimated_total_usd,created_at').order('created_at', { ascending: false }).limit(20)
    ]);

    _recentDocsMap.clear();
    const opts = ['<option value="">— Seleccionar pedido o cotización para cargar renglones —</option>'];

    for (const o of (ordRes.data || [])) {
      const key = `ord:${o.id}`;
      _recentDocsMap.set(key, { type: 'order', doc: o });
      opts.push(`<option value="${key}">🛒 Pedido #${escapeHTML(o.order_number)} — ${escapeHTML(o.client_name || 'Cliente')} ($${Number(o.total_usd || 0).toFixed(2)})</option>`);
    }
    for (const q of (quoRes.data || [])) {
      const key = `quo:${q.id}`;
      _recentDocsMap.set(key, { type: 'quote', doc: q });
      opts.push(`<option value="${key}">📋 Cotización #${escapeHTML(q.quote_number)} — ${escapeHTML(q.client_name || 'Cliente')} ($${Number(q.estimated_total_usd || 0).toFixed(2)})</option>`);
    }

    sel.innerHTML = opts.join('');
  } catch (err) {
    console.warn('Error cargando pedidos/cotizaciones recientes:', err);
  }
}

function loadItemsFromOrderOrQuote(key) {
  if (!key || !_recentDocsMap.has(key)) return;
  const { type, doc } = _recentDocsMap.get(key);

  if (doc.client_name) {
    docState.clientName = doc.client_name;
    const el = document.getElementById('fieldClientName');
    if (el) el.value = docState.clientName;
  }
  if (doc.rif) {
    docState.clientRif = doc.rif;
    const el = document.getElementById('fieldClientRif');
    if (el) el.value = docState.clientRif;
  }
  if (doc.phone) {
    docState.clientPhone = doc.phone;
    const el = document.getElementById('fieldClientPhone');
    if (el) el.value = docState.clientPhone;
  }
  if (doc.address) {
    docState.clientAddress = doc.address;
    const el = document.getElementById('fieldClientAddress');
    if (el) el.value = docState.clientAddress;
  }

  let rawItems = doc.items;
  if (typeof rawItems === 'string') {
    try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
  }
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    docState.items = rawItems.map(it => ({
      sku: it.sku || '',
      qty: Number(it.qty || it.quantity || 1),
      unit: it.unit || 'Unidad',
      description: it.name || it.description || 'Producto',
      price_usd: Number(it.price_usd || it.price || 0),
      obs: it.sku ? `Cód: ${it.sku}` : ''
    }));
  }

  renderItemsTableInput();
  renderDocumentPreview();
  if (typeof showToast === 'function') {
    showToast(`Cargados ${docState.items.length} renglones de ${type === 'order' ? 'Pedido' : 'Cotización'}`, 'ok');
  }
}

// ======================================================
// COPILOTO IA DE DOCUMENTOS (GEMINI EN VIVO)
// ======================================================
function applyAiQuickPrompt(promptText) {
  const input = document.getElementById('docAiPromptInput');
  if (input) {
    input.value = promptText;
    runDocAiAssistant();
  }
}

async function runDocAiAssistant() {
  const input = document.getElementById('docAiPromptInput');
  const statusEl = document.getElementById('docAiStatus');
  const btn = document.getElementById('docAiRunBtn');
  const prompt = (input?.value || '').trim();

  if (!prompt) {
    if (typeof showToast === 'function') showToast('Escribe qué documento o cambio deseas pedirle a la IA', 'warn');
    return;
  }

  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = '⏳ El Copiloto IA está redactando y estructurando el documento...';
  }
  if (btn) btn.disabled = true;

  try {
    const sampleCatalog = _catalogItemsCache.slice(0, 35).map(p => `${p.name} (${p.unit}, $${p.price_usd})`).join('; ');
    const sysPrompt = `Eres el Director de Comunicaciones y Operaciones de JJ PAPER, C.A. (RIF J-29537545-0, distribuidor mayorista de papelería, resmas, rollos térmicos y suministros de oficina en Caracas).
El usuario está en el Estudio de Documentos Corporativos y solicita: "${prompt}".
Estado actual del documento:
- Plantilla actual: ${docState.template} (opciones válidas: "nota_entrega", "recibo_pago", "ficha_empresa", "forma_libre")
- Cliente actual: ${docState.clientName || 'No especificado'} (RIF: ${docState.clientRif || 'S/R'})
- Título actual: ${docState.freeTitle}
- Cuerpo actual: ${docState.freeBody}
- Muestra real del catálogo: ${sampleCatalog}

Responde ÚNICAMENTE con un objeto JSON válido (sin bloques markdown \`\`\`json) con los campos que correspondan actualizar:
{
  "template": "forma_libre" | "nota_entrega" | "recibo_pago" | "ficha_empresa",
  "customDocBadge": "TÍTULO DEL RECUADRO SUPERIOR",
  "clientName": "Nombre del cliente si se menciona en la instrucción",
  "freeTitle": "TÍTULO DEL COMUNICADO O DOCUMENTO",
  "freeRecipient": "A QUIÉN VA DIRIGIDO",
  "freeBody": "Párrafos formales, impecables y bien redactados separados por \\n\\n",
  "freeSignRole": "CARGO QUE FIRMA",
  "deliveryNotes": "Observaciones o cláusula de conformidad para nota de entrega",
  "items": [
    { "qty": 10, "unit": "Unidad/Caja", "description": "Nombre exacto del producto", "price_usd": 42.00, "obs": "Observación" }
  ]
}
Solo incluye "items" si el usuario pide explícitamente agregar productos o armar una nota de entrega.`;

    let parsed = null;
    if (window.GeminiClient && typeof window.GeminiClient.callGemini === 'function') {
      const raw = await window.GeminiClient.callGemini(sysPrompt, { temperature: 0.4, maxTokens: 1200 });
      const jsonMatch = String(raw || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    }

    if (parsed) {
      if (parsed.template && ['nota_entrega', 'recibo_pago', 'ficha_empresa', 'forma_libre'].includes(parsed.template)) {
        setTemplate(parsed.template);
      }
      if (parsed.customDocBadge) {
        docState.customDocBadge = parsed.customDocBadge;
        const el = document.getElementById('fieldCustomBadge');
        if (el) el.value = parsed.customDocBadge;
      }
      if (parsed.clientName && !docState.clientName) {
        docState.clientName = parsed.clientName;
        const el = document.getElementById('fieldClientName');
        if (el) el.value = parsed.clientName;
      }
      if (parsed.freeTitle) {
        docState.freeTitle = parsed.freeTitle;
        const el = document.getElementById('fieldFreeTitle');
        if (el) el.value = parsed.freeTitle;
      }
      if (parsed.freeRecipient) {
        docState.freeRecipient = parsed.freeRecipient;
        const el = document.getElementById('fieldFreeRecipient');
        if (el) el.value = parsed.freeRecipient;
      }
      if (parsed.freeBody) {
        docState.freeBody = parsed.freeBody;
        const el = document.getElementById('fieldFreeBody');
        if (el) el.value = parsed.freeBody;
      }
      if (parsed.freeSignRole) {
        docState.freeSignRole = parsed.freeSignRole;
        const el = document.getElementById('fieldFreeSignRole');
        if (el) el.value = parsed.freeSignRole;
      }
      if (parsed.deliveryNotes) {
        docState.deliveryNotes = parsed.deliveryNotes;
        const el = document.getElementById('fieldDeliveryNotes');
        if (el) el.value = parsed.deliveryNotes;
      }
      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        docState.items = parsed.items.map(it => ({
          sku: it.sku || '',
          qty: Number(it.qty || 1),
          unit: it.unit || 'Unidad',
          description: it.description || it.name || 'Producto',
          price_usd: Number(it.price_usd || 0),
          obs: it.obs || ''
        }));
        renderItemsTableInput();
      }

      renderDocumentPreview();
      if (statusEl) {
        statusEl.textContent = '✅ Documento redactado y actualizado en vivo por IA.';
        setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
      }
      if (typeof showToast === 'function') showToast('Documento actualizado con IA', 'ok');
    } else {
      throw new Error('No se pudo estructurar la respuesta IA');
    }
  } catch (err) {
    console.warn('Fallback local en runDocAiAssistant:', err);
    // Fallback local inteligente si el usuario pide comunicado/oferta
    setTemplate('forma_libre');
    docState.freeTitle = 'PROPUESTA COMERCIAL Y SUMINISTRO CORPORATIVO';
    docState.freeRecipient = docState.clientName ? `ATENCIÓN: ${docState.clientName.toUpperCase()}` : 'A QUIEN PUEDA INTERESAR';
    docState.freeBody = `Estimados señores:\n\nReciban un cordial saludo en nombre de JJ PAPER, C.A. (RIF J-29537545-0). En atención a su solicitud (${prompt}), ponemos a su disposición nuestra línea mayorista de papelería corporativa, resmas de papel bond, rollos térmicos y suministros de oficina con disponibilidad inmediata en nuestro almacén principal.\n\nGarantizamos despacho prioritario en 24 horas en la Gran Caracas, precios competitivos al mayor y facturación fiscal conforme a la Tasa Oficial BCV vigente.\n\nAgradeciendo de antemano su preferencia, quedamos a su entera disposición.`;
    const bodyEl = document.getElementById('fieldFreeBody');
    if (bodyEl) bodyEl.value = docState.freeBody;
    renderDocumentPreview();
    if (statusEl) {
      statusEl.textContent = '✅ Plantilla ejecutiva aplicada.';
      setTimeout(() => { statusEl.style.display = 'none'; }, 3500);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Actualización de campos de texto comunes
function updateFormField(field, val) {
  docState[field] = val;
  renderDocumentPreview();
}

// Gestión de renglones de Nota de Entrega
function addDocItem() {
  docState.items.push({
    sku: '',
    qty: 1,
    unit: 'Unidad',
    description: 'Nuevo Producto / Suministro',
    price_usd: 0,
    obs: ''
  });
  renderItemsTableInput();
  renderDocumentPreview();
}

function clearDocItems() {
  docState.items = [];
  renderItemsTableInput();
  renderDocumentPreview();
}

function removeDocItem(idx) {
  docState.items.splice(idx, 1);
  renderItemsTableInput();
  renderDocumentPreview();
}

function updateDocItem(idx, key, val) {
  if (docState.items[idx]) {
    if (key === 'qty' || key === 'price_usd') {
      docState.items[idx][key] = Number(val) || 0;
    } else {
      docState.items[idx][key] = val;
    }
    renderDocumentPreview();
  }
}

function renderItemsTableInput() {
  const container = document.getElementById('itemsInputList');
  const countBadge = document.getElementById('notaItemCountBadge');
  if (countBadge) countBadge.textContent = docState.items.length;
  if (!container) return;

  if (docState.items.length === 0) {
    container.innerHTML = `<div style="padding:10px;text-align:center;font-size:11.5px;color:#64748b;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;margin-bottom:6px">Sin renglones. Busca un producto del catálogo arriba o haz clic en "+ Fila Manual".</div>`;
    return;
  }

  container.innerHTML = docState.items.map((it, idx) => `
    <div class="item-input-row" style="display:flex;gap:5px;margin-bottom:6px;align-items:center;">
      <input type="number" min="1" value="${it.qty}" style="width:55px;padding:5px 6px;font-size:12px" class="fi" oninput="updateDocItem(${idx}, 'qty', this.value)" title="Cantidad" placeholder="Cant">
      <input type="text" value="${escapeHTML(it.unit)}" style="width:78px;padding:5px 6px;font-size:11.5px" class="fi" oninput="updateDocItem(${idx}, 'unit', this.value)" title="Unidad" placeholder="Unidad">
      <input type="text" value="${escapeHTML(it.description)}" style="flex:1;padding:5px 8px;font-size:12px" class="fi" oninput="updateDocItem(${idx}, 'description', this.value)" placeholder="Descripción del producto">
      <input type="text" value="${escapeHTML(it.obs || '')}" style="width:92px;padding:5px 6px;font-size:11.5px" class="fi" oninput="updateDocItem(${idx}, 'obs', this.value)" placeholder="Observación">
      <button type="button" class="btn-del-row" onclick="removeDocItem(${idx})" title="Eliminar">✕</button>
    </div>
  `).join('');
}

// Cálculos de Recibo de Pago
function updateReceiptUsd(usd) {
  docState.receiptAmountUsd = Number(usd) || 0;
  docState.currentPayment = docState.receiptAmountUsd;
  calculateReceiptBs();
  renderDocumentPreview();
}

function updateReceiptRate(rate) {
  docState.receiptExchangeRate = Number(rate) || 1;
  calculateReceiptBs();
  renderDocumentPreview();
}

function calculateReceiptBs() {
  docState.receiptAmountBs = docState.receiptAmountUsd * (docState.receiptExchangeRate || 1);
  const bsEl = document.getElementById('fieldReceiptBs');
  if (bsEl) bsEl.value = docState.receiptAmountBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Renderizado de la Hoja Membretada en Vivo
function renderDocumentPreview() {
  const sheet = document.getElementById('docPreviewPaper');
  if (!sheet) return;

  const s = window.APP?.SETTINGS || {};
  const bName = s.business_name || 'JJ PAPER, C.A.';
  const bRif = s.rif || 'J-29537545-0';
  const bAddr = s.address || 'AV. EL CORTIJO. QTA NEVERI N 58. URB. LOS ROSALES CARACAS DISTRITO FEDERAL';
  const bPhone = s.phone_display || '+58 412 2830185 / 0212 7531777';
  const bEmail = s.email || 'jjpaper1@gmail.com';
  const rateVal = docState.receiptExchangeRate || 36.5;

  let bodyHTML = '';

  if (docState.template === 'nota_entrega') {
    bodyHTML = renderNotaEntregaHTML();
  } else if (docState.template === 'recibo_pago') {
    bodyHTML = renderReciboPagoHTML(rateVal);
  } else if (docState.template === 'ficha_empresa') {
    bodyHTML = renderFichaEmpresaHTML(bName, bRif, bAddr, bPhone, bEmail);
  } else {
    bodyHTML = renderFormaLibreHTML();
  }

  const defaultTitles = {
    nota_entrega: 'NOTA DE ENTREGA / DESPACHO',
    recibo_pago: 'RECIBO DE PAGO OFICIAL',
    ficha_empresa: 'FICHA INFORMATIVA CORPORATIVA',
    forma_libre: docState.freeTitle || 'COMUNICADO OFICIAL'
  };
  const badgeTitle = (docState.customDocBadge || '').trim() || defaultTitles[docState.template];

  sheet.innerHTML = `
    <!-- Encabezado Membretado Oficial -->
    <header class="doc-header">
      <div class="doc-brand-block">
        <img src="../assets/img/logo.svg" alt="JJ Paper" class="doc-logo-img">
        <div class="doc-company-info">
          <h1 class="doc-company-title">${escapeHTML(bName)}</h1>
          <div class="doc-rif">RIF: ${escapeHTML(bRif)}</div>
          <div class="doc-address">${escapeHTML(bAddr)}</div>
          <div class="doc-contacts">
            <span>📞 ${escapeHTML(bPhone)}</span> · <span>✉️ ${escapeHTML(bEmail)}</span>
          </div>
        </div>
      </div>
      <div class="doc-meta-box">
        <div class="doc-meta-title">${escapeHTML(badgeTitle)}</div>
        <div class="doc-meta-row">
          <span class="lbl">Nº Control / Doc:</span>
          <span class="val highlight">${escapeHTML(docState.docNumber)}</span>
        </div>
        <div class="doc-meta-row">
          <span class="lbl">Fecha de Emisión:</span>
          <span class="val">${formatDateES(docState.docDate)}</span>
        </div>
        <div class="doc-meta-row">
          <span class="lbl">Tasa Oficial BCV:</span>
          <span class="val">Bs ${rateVal.toFixed(2)}/USD</span>
        </div>
      </div>
    </header>

    <!-- Datos del Cliente / Destinatario -->
    <section class="doc-client-section">
      <div class="client-grid">
        <div>
          <span class="c-lbl">Razón Social / Destinatario:</span>
          <strong class="c-val">${escapeHTML(docState.clientName || 'CLIENTE AL MOSTRADOR / PARTICULAR')}</strong>
        </div>
        <div>
          <span class="c-lbl">RIF / C.I.:</span>
          <span class="c-val">${escapeHTML(docState.clientRif || 'V-XXXXXXXX / J-XXXXXXXX-X')}</span>
        </div>
        <div>
          <span class="c-lbl">Teléfono / WhatsApp:</span>
          <span class="c-val">${escapeHTML(docState.clientPhone || 'No especificado')}</span>
        </div>
        <div class="full-col">
          <span class="c-lbl">Dirección de Entrega / Domicilio:</span>
          <span class="c-val">${escapeHTML(docState.clientAddress || 'Caracas, Venezuela')}</span>
        </div>
      </div>
    </section>

    <!-- Contenido Específico de la Plantilla -->
    <div class="doc-main-body">
      ${bodyHTML}
    </div>

    <!-- Pie de Página Institucional -->
    <footer class="doc-footer">
      <div class="doc-footer-legal">
        ${docState.template === 'nota_entrega' ? 'La firma y sello en esta nota constituyen prueba fehaciente de recepción de la mercancía a entera conformidad.' : 'Documento emitido conforme a las políticas comerciales oficiales de JJ PAPER, C.A.'}
      </div>
      <div class="doc-footer-bottom">
        <div>Portal Web: <strong>jjpaper.pages.dev/catalogo</strong> · Catálogo Oficial JJ Paper</div>
        <div>Página 1 de 1</div>
      </div>
    </footer>
  `;
}

function renderNotaEntregaHTML() {
  const totalBultos = docState.items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
  const totalUsd = docState.items.reduce((acc, it) => acc + ((Number(it.qty) || 0) * (Number(it.price_usd) || 0)), 0);
  const showPrices = !!docState.showPricesInNota;

  return `
    <!-- Bloque de Transporte -->
    <div class="doc-dispatch-info">
      <div class="dispatch-col">
        <span>Conductor / Chofer: <strong>${escapeHTML(docState.driverName || 'Transporte JJ Paper')}</strong></span>
        <span>C.I.: <strong>${escapeHTML(docState.driverCi || 'V-XXXXXXXX')}</strong></span>
      </div>
      <div class="dispatch-col">
        <span>Vehículo / Placa: <strong>${escapeHTML(docState.driverPlate || 'OFICIAL DE REPARTO')}</strong></span>
        <span>Destino: <strong>${escapeHTML(docState.dispatchDestination || 'Almacén / Sede del Cliente')}</strong></span>
      </div>
    </div>

    <!-- Tabla de Mercancía -->
    <table class="doc-table">
      <thead>
        <tr>
          <th style="width:36px;text-align:center">#</th>
          <th style="width:65px;text-align:center">CANT.</th>
          <th style="width:95px;text-align:center">UNIDAD</th>
          <th>DESCRIPCIÓN DE LA MERCANCÍA / PRODUCTO</th>
          ${showPrices ? '<th style="width:85px;text-align:right">P. UNIT ($)</th><th style="width:95px;text-align:right">SUBTOTAL ($)</th>' : '<th style="width:135px;text-align:center">OBSERVACIÓN / CÓD</th>'}
        </tr>
      </thead>
      <tbody>
        ${docState.items.map((it, idx) => {
          const sub = (Number(it.qty) || 0) * (Number(it.price_usd) || 0);
          return `
          <tr>
            <td style="text-align:center">${idx + 1}</td>
            <td style="text-align:center;font-weight:700">${it.qty}</td>
            <td style="text-align:center">${escapeHTML(it.unit)}</td>
            <td style="font-weight:600">${escapeHTML(it.description)}</td>
            ${showPrices
              ? `<td style="text-align:right">$${Number(it.price_usd || 0).toFixed(2)}</td><td style="text-align:right;font-weight:700">$${sub.toFixed(2)}</td>`
              : `<td style="text-align:center;color:#555">${escapeHTML(it.obs || it.sku || '—')}</td>`
            }
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right;font-weight:700">TOTAL UNIDADES ENTREGADAS:</td>
          <td colspan="${showPrices ? 3 : 2}" style="font-weight:800;color:var(--doc-c);display:flex;justify-content:space-between">
            <span>${totalBultos} unidades / bultos</span>
            ${showPrices ? `<span>TOTAL VALORADO: $${totalUsd.toFixed(2)} USD</span>` : ''}
          </td>
        </tr>
      </tfoot>
    </table>

    <div class="doc-notes-callout">
      <strong>Observaciones de Entrega:</strong> ${escapeHTML(docState.deliveryNotes)}
    </div>

    <!-- Firmas de Entrega -->
    <div class="doc-signatures-grid">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">DESPACHADO POR (ALMACÉN)</div>
        <div class="sig-sub">JJ PAPER, C.A.</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">TRANSPORTADO POR (CHOFER)</div>
        <div class="sig-sub">Nombre y C.I.</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">RECIBIDO CONFORME (CLIENTE)</div>
        <div class="sig-sub">Firma, Sello, C.I., Fecha y Hora</div>
      </div>
    </div>
  `;
}

function renderReciboPagoHTML(rateVal) {
  const usdFmt = docState.receiptAmountUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bsFmt = (docState.receiptAmountUsd * rateVal).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `
    <div class="receipt-amount-banner">
      <div class="ramount-item">
        <span class="rlbl">Monto en Divisas (USD):</span>
        <span class="rval usd">$${usdFmt}</span>
      </div>
      <div class="ramount-item">
        <span class="rlbl">Monto en Bolívares (BCV):</span>
        <span class="rval bs">Bs ${bsFmt}</span>
      </div>
    </div>

    <div class="receipt-concept-card">
      <div class="rc-row">
        <strong>Hemos recibido de:</strong>
        <span>${escapeHTML(docState.clientName || 'Cliente Particular')} (RIF: ${escapeHTML(docState.clientRif || 'S/R')})</span>
      </div>
      <div class="rc-row">
        <strong>Por concepto de:</strong>
        <span>${escapeHTML(docState.receiptConcept)}</span>
      </div>
      <div class="rc-grid-details">
        <div><strong>Método de Pago:</strong> ${escapeHTML(docState.paymentMethod)}</div>
        <div><strong>Banco Emisor:</strong> ${escapeHTML(docState.bankOrigin || 'Banesco')}</div>
        <div><strong>Banco Receptor:</strong> ${escapeHTML(docState.bankDestination || 'Banesco JJ Paper')}</div>
        <div><strong>Nº de Referencia / Comprobante:</strong> <span style="font-family:monospace;font-weight:800;color:var(--doc-c)">${escapeHTML(docState.paymentRef || 'S/REF')}</span></div>
      </div>
    </div>

    <div class="doc-signatures-grid" style="margin-top:40px;">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">EMITIDO POR (CAJA / COBRANZAS)</div>
        <div class="sig-sub">JJ PAPER, C.A. · Administración</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">ENTREGADO POR (CLIENTE)</div>
        <div class="sig-sub">Firma y C.I. del Pagador</div>
      </div>
    </div>
  `;
}

function renderFichaEmpresaHTML(bName, bRif, bAddr, bPhone, bEmail) {
  return `
    <div class="company-card-presentation">
      <h2 style="font-size:16px;color:var(--doc-c);font-weight:800;margin-bottom:8px">Presentación Institucional y Condiciones de Suministro</h2>
      <p style="font-size:12px;color:#333;line-height:1.6;margin-bottom:14px">
        <strong>JJ PAPER, C.A.</strong> es una empresa mayorista líder dedicada a la importación y distribución directa de suministros de papelería corporativa, resmas de papel bond de alta blancura, consumibles de caja para puntos de venta (POS), archivadores y productos de embalaje en la Gran Caracas y a nivel nacional.
      </p>

      <div class="company-data-box">
        <h3 style="font-size:13px;font-weight:800;color:var(--doc-c);margin-bottom:8px;border-bottom:1.5px solid #d8e5df;padding-bottom:4px">🏛️ Datos Fiscales & Corporativos</h3>
        <ul style="font-size:12px;list-style:none;line-height:1.7;padding:0">
          <li>• <strong>Razón Social:</strong> ${escapeHTML(bName)}</li>
          <li>• <strong>Registro de Información Fiscal (RIF):</strong> ${escapeHTML(bRif)}</li>
          <li>• <strong>Domicilio Fiscal:</strong> ${escapeHTML(bAddr)}</li>
          <li>• <strong>Teléfonos de Contacto:</strong> ${escapeHTML(bPhone)}</li>
          <li>• <strong>Correo Electrónico:</strong> ${escapeHTML(bEmail)}</li>
        </ul>
      </div>

      <div class="company-data-box" style="margin-top:12px;">
        <h3 style="font-size:13px;font-weight:800;color:var(--doc-c);margin-bottom:8px;border-bottom:1.5px solid #d8e5df;padding-bottom:4px">💳 Cuentas Bancarias Oficiales para Pagos</h3>
        <div style="font-size:11.5px;color:#222;display:grid;grid-template-columns:1fr 1fr;gap:10px;line-height:1.5">
          <div style="background:#f9fbf9;padding:8px 10px;border-radius:6px;border:1px solid #d9e6df">
            <strong>BANESCO BANCO UNIVERSAL</strong><br>
            Cuenta Corriente en Bolívares (Bs)<br>
            Nº: 0134-XXXX-XX-XXXXXXXXXX<br>
            A nombre de: JJ PAPER, C.A.<br>
            RIF: ${escapeHTML(bRif)}
          </div>
          <div style="background:#f9fbf9;padding:8px 10px;border-radius:6px;border:1px solid #d9e6df">
            <strong>BANCO MERCANTIL</strong><br>
            Cuenta Corriente en Bolívares (Bs)<br>
            Nº: 0105-XXXX-XX-XXXXXXXXXX<br>
            A nombre de: JJ PAPER, C.A.<br>
            RIF: ${escapeHTML(bRif)}
          </div>
        </div>
      </div>

      <div class="company-data-box" style="margin-top:12px;">
        <h3 style="font-size:13px;font-weight:800;color:var(--doc-c);margin-bottom:8px;border-bottom:1.5px solid #d8e5df;padding-bottom:4px">🚚 Políticas de Despacho & Pedidos</h3>
        <ul style="font-size:11.5px;list-style:none;line-height:1.6;padding:0;color:#333">
          <li>• <strong>Despacho en Caracas:</strong> Entrega garantizada en la sede de su empresa en 24 a 48 horas tras confirmación de pedido.</li>
          <li>• <strong>Envíos Nacionales:</strong> Despachos por encomienda con guía prepagada o cobro en destino (Tealca, MRW, Fletes GAG).</li>
          <li>• <strong>Facturación:</strong> Factura fiscal formal con desglose de IVA y equivalente en bolívares a Tasa Oficial BCV del día.</li>
          <li>• <strong>Catálogo Digital:</strong> Acceso público sin registro en <code>https://jjpaper.pages.dev/catalogo</code></li>
        </ul>
      </div>
    </div>
  `;
}

function renderFormaLibreHTML() {
  const paragraphs = (docState.freeBody || '').split('\n').filter(p => p.trim());

  return `
    <div class="free-form-content">
      <div class="free-recipient-header">
        <strong>DIRIGIDO A:</strong> ${escapeHTML(docState.freeRecipient)}
      </div>

      <div class="free-paragraphs">
        ${paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}
      </div>

      <div class="doc-signatures-grid" style="margin-top:50px;">
        <div class="sig-box" style="margin:0 auto;max-width:300px;grid-column:1/-1">
          <div class="sig-line" style="width:240px"></div>
          <div class="sig-role">${escapeHTML(docState.freeSignRole || 'DIRECCIÓN COMERCIAL & ADMINISTRACIÓN')}</div>
          <div class="sig-sub">JJ PAPER, C.A.</div>
        </div>
      </div>
    </div>
  `;
}

function formatDateES(dStr) {
  if (!dStr) return '--/--/----';
  const parts = dStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dStr;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Acciones: Imprimir
function printDocument() {
  window.print();
}

// Acciones: Compartir por WhatsApp
function shareDocumentWhatsApp() {
  let msg = '';
  const rateVal = docState.receiptExchangeRate || 36.5;

  if (docState.template === 'nota_entrega') {
    const totalBultos = docState.items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
    msg = `📦 *NOTA DE ENTREGA / DESPACHO | JJ PAPER, C.A.*\n\n` +
          `📋 *Nº de Nota:* ${docState.docNumber}\n` +
          `📅 *Fecha:* ${formatDateES(docState.docDate)}\n` +
          `🏢 *Cliente:* ${docState.clientName || 'Cliente Particular'}\n` +
          `📍 *Dirección de Entrega:* ${docState.clientAddress || 'Caracas'}\n` +
          `🚚 *Chofer:* ${docState.driverName || 'Transporte JJ Paper'} (Placa: ${docState.driverPlate || 'OFICIAL'})\n\n` +
          `*📦 RESUMEN DE MERCANCÍA ENTREGADA (${totalBultos} unidades):*\n` +
          docState.items.map((it) => `• *${it.qty} ${it.unit}* - ${it.description}`).join('\n') + `\n\n` +
          `✨ *Observaciones:* ${docState.deliveryNotes}\n` +
          `📞 Contacto Almacén: +58 412 2830185\n` +
          `🌐 Catálogo Digital: https://jjpaper.pages.dev/catalogo`;
  } else if (docState.template === 'recibo_pago') {
    const usdFmt = docState.receiptAmountUsd.toFixed(2);
    const bsFmt = (docState.receiptAmountUsd * rateVal).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    msg = `🧾 *COMPROBANTE DE PAGO OFICIAL | JJ PAPER, C.A.*\n\n` +
          `📋 *Nº de Recibo:* ${docState.docNumber}\n` +
          `📅 *Fecha:* ${formatDateES(docState.docDate)}\n` +
          `🏢 *Cliente:* ${docState.clientName || 'Cliente'}\n` +
          `💵 *Monto:* $${usdFmt} USD (Bs ${bsFmt} a Tasa BCV: ${rateVal.toFixed(2)})\n` +
          `💳 *Método de Pago:* ${docState.paymentMethod} (${docState.bankOrigin || 'Banesco'})\n` +
          `🔖 *Referencia:* ${docState.paymentRef || 'S/REF'}\n` +
          `📝 *Concepto:* ${docState.receiptConcept}\n\n` +
          `✅ Pago procesado y registrado a entera conformidad en administración.\n` +
          `JJ PAPER, C.A. · RIF: J-29537545-0`;
  } else {
    msg = `🏛️ *COMUNICADO OFICIAL | JJ PAPER, C.A.*\n\n` +
          `📋 *Documento:* ${docState.docNumber}\n` +
          `📅 *Fecha:* ${formatDateES(docState.docDate)}\n` +
          `🏢 *Dirigido a:* ${docState.freeRecipient || docState.clientName || 'Estimados Clientes'}\n\n` +
          `${docState.freeBody}\n\n` +
          `🌐 Portal Oficial: https://jjpaper.pages.dev/catalogo`;
  }

  const phone = (docState.clientPhone || '').replace(/\D/g, '');
  const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}
