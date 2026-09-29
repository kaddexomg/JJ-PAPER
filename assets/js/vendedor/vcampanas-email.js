/* ======================================================
   JJ Paper Vendedor — Campañas de Email (Gmail)
   Plantillas con variables · Selector de producto/combo ·
   Campañas automatizadas (las despacha wa-server/email-campaigns.js)
   ====================================================== */

let ecContacts = [];      // clientes con email de la cartera
let ecTemplates = [];     // plantillas de email (locales + DB)
let ecCampaigns = [];     // campañas de correo
let ecProducts = [];      // productos para el selector de promociones
let ecCombos = [];        // promociones / combos activos
let ecTab = 'campanas';   // 'campanas' | 'plantillas' | 'detalle'
let ecEditingTplId = null;
let ecViewingCamp = null; // campaña en vista detalle
let ecDetailTargets = []; // destinatarios de la campaña en detalle

const EC_VARS = ['nombre', 'empresa', 'vendedor', 'producto', 'precio', 'descuento', 'link', 'descripcion'];

const EC_STATUS = {
  draft:     ['📝 Borrador', '#6b7280'],
  scheduled: ['⏰ Programada', '#d97706'],
  running:   ['📤 Enviando', '#16604A'],
  paused:    ['⏸️ Pausada', '#b45309'],
  done:      ['✅ Completada', '#15803d'],
  cancelled: ['🚫 Cancelada', '#b91c1c'],
};

const DEFAULT_EMAIL_TEMPLATES = [
  {
    id: 'tpl-email-prod',
    name: '📦 Promoción de Producto Destacado',
    kind: 'producto',
    owner_id: null,
    subject: 'Oferta especial: {{producto}} — JJ Paper',
    body: `Estimado(a) {{nombre}},

Esperamos que se encuentre muy bien. Le saluda {{vendedor}} de JJ Paper.

Le escribimos para presentarle una oportunidad especial en nuestro catálogo:
📦 Producto: {{producto}}
💲 Precio exclusivo: {{precio}}

📝 Detalles:
{{descripcion}}

👉 Puede consultar disponibilidad y gestionar su pedido en línea aquí:
{{link}}

Si requiere una cotización formal o despacho inmediato, quedamos a su entera disposición.

Atentamente,
{{vendedor}}
JJ Paper C.A.`
  },
  {
    id: 'tpl-email-combo',
    name: '🎁 Oferta Combo / Pack Especial',
    kind: 'combo',
    owner_id: null,
    subject: '¡Combo especial para su negocio! {{producto}} — JJ Paper',
    body: `Estimado(a) {{nombre}},

Desde JJ Paper queremos compartirle nuestro combo de temporada diseñado para maximizar el rendimiento de su negocio:

🎁 Promoción: {{producto}}
📝 Incluye: {{descripcion}}
💲 Precio especial: {{precio}}

👉 Vea todos los detalles y confirme su pedido aquí:
{{link}}

¡Contamos con despacho inmediato y asesoría personalizada!

Atentamente,
{{vendedor}}
JJ Paper C.A.`
  },
  {
    id: 'tpl-email-react',
    name: '🔄 Reactivación de Clientes con Descuento',
    kind: 'reactivacion',
    owner_id: null,
    subject: 'Le extrañamos — Descuento exclusivo del {{descuento}}% en su próximo pedido',
    body: `Estimado(a) {{nombre}},

Esperamos que todo marche con gran éxito en {{empresa}}.

Le informamos que tiene disponible un beneficio exclusivo de {{descuento}}% de descuento en su próxima orden con JJ Paper.

👉 Ingrese a nuestro catálogo digital actualizado con precios oficiales aquí:
{{link}}

¿En qué rubros de papelería, suministros u oficina podemos apoyarle esta semana?

Quedamos atentos a su solicitud.

Saludos cordiales,
{{vendedor}}
JJ Paper C.A.`
  },
  {
    id: 'tpl-email-cat',
    name: '🏢 Catálogo Digital y Lista de Precios B2B',
    kind: 'general',
    owner_id: null,
    subject: 'Catálogo digital y lista de precios al día — JJ Paper',
    body: `<b>{Hola|Buen día|Saludos} {{nombre}} 👋</b><br><br>Le escribe <b>{{vendedor}}</b> de <b>JJ Paper C.A.</b>, su distribuidor directo de papelería, insumos de oficina y consumibles en Caracas.<br><br>📦 <b>Tenemos disponibilidad inmediata en:</b><br><br><ul><li>🖨️ <b>Resmas de papel Bond</b> — Carta y Oficio, diferentes gramajes</li><li>🧾 <b>Rollos térmicos POS</b> — 80x70mm y 57x40mm para puntos de venta</li><li>📎 <b>Cintas de embalaje industrial</b> — 48x100m y 48x200m, alto micraje</li><li>📁 <b>Carpetas, archivadores y sobres</b> — Fibra marrón, manila, radiografía</li><li>✏️ <b>Material escolar y de escritorio</b> — Cuadernos, bolígrafos, marcadores</li></ul>✅ <b>¿Por qué elegirnos?</b><br>1️⃣ Catálogo con +900 artículos disponibles<br>2️⃣ Cotizaciones al instante adaptadas a su presupuesto<br>3️⃣ 🚚 Delivery GRATIS en toda Caracas<br>4️⃣ Facturación fiscal formal (RIF J-295375450) en Bs a tasa BCV oficial<br><br>👉 <b>Catálogo digital:</b> <a href="{{link}}">{{link}}</a><br><br>{Quedo a su orden|Estamos para servirle|A su completa disposición} para cualquier cotización o consulta.<br><br><b>{{vendedor}}</b><br>📞 0412-4676073<br><b>JJ Paper C.A.</b> — Distribución directa en Caracas`
  }
];

/* ---------- init ---------- */
async function initEmailCampaigns() {
  await Promise.all([
    loadEcContacts(),
    loadEcTemplates(),
    loadEcCampaigns(),
    loadEcProductsAndCombos()
  ]);
  setEcTab('campanas');

  // Realtime para actualizar progreso en vivo (con debounce para evitar ráfagas)
  let _rtTimer = null;
  sb.channel('email-campaigns-progress')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_email_campaigns' },
      () => {
        if (_rtTimer) clearTimeout(_rtTimer);
        _rtTimer = setTimeout(() => {
          loadEcCampaigns(true);
          if (ecViewingCamp) {
            loadCampTargets(ecViewingCamp.id);
          }
        }, 350);
      })
    .subscribe();
}

async function loadEcProductsAndCombos() {
  try {
    const { data: prods } = await sb.from('jjp_product_variants')
      .select('id,sku,price_usd,variant_name,jjp_products(id,name,description,image_url),jjp_brands(name)')
      .eq('active', true)
      .order('price_usd', { ascending: false })
      .limit(300);
    ecProducts = prods || [];

    const { data: promos } = await sb.from('jjp_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .limit(100);
    ecCombos = promos || [];

    renderEcProductAndComboSelects();
  } catch (e) {
    console.warn('Error cargando catálogo para campañas de email:', e);
  }
}

function renderEcProductAndComboSelects() {
  const pSel = document.getElementById('nc-prod-select');
  if (pSel) {
    pSel.innerHTML = '<option value="">-- Selecciona un producto del catálogo --</option>' +
      ecProducts.map(p => {
        const title = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
        return `<option value="${p.id}">${escapeHTML(title)} — $${(+p.price_usd).toFixed(2)}</option>`;
      }).join('');
  }

  const cSel = document.getElementById('nc-combo-select');
  if (cSel) {
    cSel.innerHTML = '<option value="">-- Selecciona un combo u oferta activa --</option>' +
      ecCombos.map(c => {
        const price = c.price_usd ? ` — $${(+c.price_usd).toFixed(2)}` : '';
        return `<option value="${c.id}">[${c.kind.toUpperCase()}] ${escapeHTML(c.title)}${price}</option>`;
      }).join('');
  }
}

function setEcTab(t) {
  ecTab = t;
  document.querySelectorAll('.of-chip[data-tab]').forEach(c => {
    const on = c.dataset.tab === t;
    c.classList.toggle('on', on);
    c.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('[data-panel]').forEach(p => {
    p.style.display = p.dataset.panel === t ? '' : 'none';
  });
}

/* ================== CONTACTOS / AUDIENCIA ================== */
async function loadEcContacts() {
  const isAdm = SELLER?.role === 'admin';
  let q = sb.from('jjp_customers')
    .select('*')
    .not('email', 'is', null)
    .neq('email', '')
    .order('name');
    
  if (!isAdm && SELLER?.id) {
    q = q.eq('seller_id', SELLER.id);
  }
  const { data, error } = await q;
  if (error) {
    console.error('Error cargando audiencia de correos:', error);
    showToast('Error cargando audiencia: ' + (error.message || error), 'err');
    return;
  }
  ecContacts = (data || []).filter(c => 
    !c.email_opt_out && 
    c.email_status !== 'bounced_hard' && 
    c.email_status !== 'bounced_soft' && 
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || '')
  );

  // Si es Admin, cargar también los prospectos B2B con email válido
  if (isAdm) {
    try {
      const { data: b2bProspects, error: pErr } = await sb.from('jjp_prospects')
        .select('*')
        .not('email', 'is', null)
        .neq('email', '')
        .order('company_name');

      if (!pErr && Array.isArray(b2bProspects)) {
        const normProspects = b2bProspects
          .filter(p => p.email && p.email_status !== 'bounced_hard' && p.email_status !== 'bounced_soft' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()))
          .map(p => ({
            id: p.id,
            name: p.company_name,
            company_name: p.company_name,
            sector: p.sector || 'Otro',
            contact_name: p.contact_name || '',
            contact_role: p.contact_role || '',
            phone: (window.getBestMobilePhone ? window.getBestMobilePhone(p) : (p.phone_2 || p.phone_1 || '')),
            phone_1: p.phone_1,
            phone_2: p.phone_2,
            email: p.email.trim(),
            address: p.address || p.city || 'Caracas',
            city: p.city || 'Caracas',
            notes: p.notes || '',
            status: p.status || 'nuevo',
            is_prospect_b2b: true,
            total_orders: 0,
            tags: ['prospecto_b2b', p.sector ? p.sector.toLowerCase().replace(/\s+/g, '_') : 'otro'],
            ai_analysis: p.ai_analysis || {},
            suggested_subject: p.suggested_subject || null,
            custom_email_body: p.custom_email_body || null,
            custom_wa_body: p.custom_wa_body || null,
            _custom_message: p.custom_email_body || null,
            _custom_subject: p.suggested_subject || null,
            _detected_need: p.ai_analysis?.dolor_operativo || null,
            _detected_sector: p.ai_analysis?.sector_deducido || p.sector || null
          }));
        ecContacts.push(...normProspects);
      }
    } catch (pe) {
      console.warn('Aviso cargando prospectos B2B para emails:', pe);
    }
  }
}

/* ================== PLANTILLAS ================== */
async function loadEcTemplates() {
  let custom = [];
  try {
    const raw = localStorage.getItem('jjp_ec_custom_templates_' + (SELLER?.id || 'default'));
    if (raw) custom = JSON.parse(raw);
  } catch (e) {}

  ecTemplates = [...DEFAULT_EMAIL_TEMPLATES, ...custom];
  renderEcTemplates();
}

function renderEcTemplates() {
  const wrap = document.getElementById('ecTplList');
  if (!wrap) return;
  if (!ecTemplates.length) {
    wrap.innerHTML = '<p class="table-empty">Sin plantillas. Crea la primera. 📝</p>';
    return;
  }
  wrap.innerHTML = ecTemplates.map(t => {
    const mine = t.owner_id === SELLER?.id;
    return `<article class="d-tpl-card">
      <div class="d-tpl-hd">
        <strong>${escapeHTML(t.name)}</strong>
        <span class="d-tag">${t.owner_id ? '👤 mía' : '🌐 global'}${t.kind ? ` · ${t.kind}` : ''}</span>
      </div>
      <div style="font-size:12px;color:#666;font-weight:600;margin-top:2px">Asunto: ${escapeHTML(t.subject || '')}</div>
      <pre class="d-tpl-body" style="max-height:120px">${escapeHTML(t.body)}</pre>
      <div class="td-actions" style="margin-top:auto">
        <button class="btn-o sm" onclick="newEcCampaign('${t.id}')">📣 Usar en campaña</button>
        ${mine ? `<button class="btn-o sm" onclick="openEcTplModal('${t.id}')">✏️ Editar</button>
                  <button class="btn-o sm" onclick="deleteEcTpl('${t.id}')" title="Eliminar plantilla">🗑️</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function openEcTplModal(id = null) {
  ecEditingTplId = id;
  const t = id ? ecTemplates.find(x => x.id === id) : null;
  document.getElementById('tplModalTitle').textContent = t ? `Editar: ${t.name}` : 'Nueva plantilla de email';
  document.getElementById('tp-name').value = t?.name || '';
  document.getElementById('tp-subject').value = t?.subject || '';
  document.getElementById('tp-body').value = t?.body || '';
  ecTplPreview();
  openEcModal('tplModal');
}

function ecTplInsertVar(v) {
  const ta = document.getElementById('tp-body');
  const pos = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, pos) + `{{${v}}}` + ta.value.slice(ta.selectionEnd ?? pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + v.length + 4;
  ecTplPreview();
}

async function ensureGeminiClient() {
  if (window.GeminiClient) return window.GeminiClient;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const isSubdir = window.location.pathname.includes('/admin/') || window.location.pathname.includes('/vendedor/');
    script.src = (isSubdir ? '../assets/js/gemini-client.js?v=' : 'assets/js/gemini-client.js?v=') + Date.now();
    script.onload = () => {
      if (window.GeminiClient) resolve(window.GeminiClient);
      else reject(new Error('Módulo GeminiClient no disponible tras la carga.'));
    };
    script.onerror = () => reject(new Error('No se pudo cargar el motor Gemini AI (gemini-client.js).'));
    document.head.appendChild(script);
  });
}

async function ecTplDraftWithAi() {
  const currentName = document.getElementById('tp-name')?.value?.trim() || document.getElementById('ec-tp-name')?.value?.trim() || '';
  const currentSubj = document.getElementById('tp-subject')?.value?.trim() || document.getElementById('ec-tp-subject')?.value?.trim() || '';
  
  const topic = prompt('✨ ¿Cuál es el Objetivo Principal de este Correo?\n(Ej: Presentación de catálogo, Oferta de resmas, Seguimiento corporativo)', currentName || currentSubj || 'Cotización formal de suministros de papelería al mayor');
  if (!topic || !topic.trim()) return;

  let tone = prompt('🎭 Elige el Tono / Personalidad de la IA para Email:\n1. Corporativo B2B (Alta Gerencia / Compras)\n2. Reactivación / Seguimiento Ejecutivo\n3. Propuesta de Valor (Promoción)\nEscribe el número o describe tu propio tono:', '2');
  
  const toneMap = {
    '1': 'Corporativo B2B (Elegante, directo, Alta Gerencia / Jefatura de Compras)',
    '2': 'Reactivación / Seguimiento Ejecutivo (Preguntar sobre la lista de precios enviada previamente, ofrecer asistencia)',
    '3': 'Propuesta de Valor (Promocional y comercial, enfocado en ahorro y beneficios)'
  };
  tone = toneMap[tone?.trim()] || tone || 'Profesional y Corporativo (Ejecutivo B2B)';

  const historyContext = prompt('📜 Contexto Histórico Adicional (Opcional):\n(Ej: Le enviamos la lista la semana pasada, hoy queremos hacer seguimiento)', 'Haciendo seguimiento a la lista de precios enviada la semana pasada.');

  const btn = document.getElementById('ecAiTplBtn');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Redactando...';
  }

  try {
    await ensureGeminiClient();
    if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');

    const res = await window.GeminiClient.draftCampaignMessage({
      objective: topic.trim(),
      channel: 'email',
      audience: 'todos',
      sellerName: SELLER?.name || '',
      tone: tone,
      historyContext: historyContext || ''
    });

    const nameEl = document.getElementById('tp-name') || document.getElementById('ec-tp-name');
    if (nameEl && !nameEl.value) {
      nameEl.value = topic.slice(0, 35).trim();
    }
    const subjEl = document.getElementById('tp-subject') || document.getElementById('ec-tp-subject');
    if (res.subject && subjEl) {
      subjEl.value = res.subject;
    }
    const bodyEl = document.getElementById('tp-body') || document.getElementById('ec-tp-body');
    if (res.body && bodyEl) {
      bodyEl.value = res.body;
    }
    ecTplPreview();
    if (typeof showToast === 'function') showToast('Plantilla de correo estructurada con IA', 'success');
  } catch (err) {
    alert('Error al redactar plantilla con IA: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

function ecTplApplyPreset(type) {
  const nameEl = document.getElementById('tp-name');
  const subjEl = document.getElementById('tp-subject');
  const bodyEl = document.getElementById('tp-body');
  
  const preset = DEFAULT_EMAIL_TEMPLATES.find(p => p.kind === type || p.id.includes(type));
  if (preset) {
    if (!nameEl.value) nameEl.value = preset.name;
    subjEl.value = preset.subject;
    bodyEl.value = preset.body;
  }
  ecTplPreview();
}

function ecSampleVars(name = 'Distribuidora Alfa, C.A.', extraContext = {}) {
  const bcv = parseFloat(APP.SETTINGS?.rate_bcv) || 0;
  
  let prodName = 'Resma Carta HP 75g (Caja × 10)';
  let prodPrice = '$38.50 USD' + (bcv ? ` (Bs ${ (38.50 * bcv).toFixed(2) })` : '');
  let prodDesc = 'Papel bond de alta blancura ideal para oficinas, colegios y empresas.';
  let prodLink = sellerRefLink() || `${location.origin}/catalogo.html`;
  let discount = APP.SETTINGS?.wa_react_discount || '10';

  if (extraContext.type === 'producto' && extraContext.productId) {
    const p = ecProducts.find(x => x.id === extraContext.productId);
    if (p) {
      prodName = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
      const priceUsd = Number(p.price_usd) || 0;
      prodPrice = `$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '');
      prodDesc = p.jjp_products?.description || '';
      // Ficha directa del producto en el dominio real (nunca Netlify)
      const fb = location.origin + location.pathname.replace(/\/(admin|vendedor)\/.*$/, '').replace(/\/[^/]*$/, '');
      prodLink = p.jjp_products?.id
        ? `${fb}/producto.html?id=${p.jjp_products.id}`
        : `${fb}/catalogo.html?q=${encodeURIComponent(p.jjp_products?.name || '')}`;
    }
  } else if (extraContext.type === 'combo' && extraContext.comboId) {
    const c = ecCombos.find(x => x.id === extraContext.comboId);
    if (c) {
      prodName = c.title || 'Combo Especial';
      const priceUsd = Number(c.price_usd) || 0;
      prodPrice = priceUsd ? (`$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '')) : 'Consultar';
      prodDesc = c.description || '';
      prodLink = `${location.origin}/promociones.html`;
      if (c.badge) discount = c.badge;
    }
  }

  return {
    nombre:      name,
    empresa:     name,
    vendedor:    SELLER?.name || 'su asesor comercial JJ Paper',
    descuento:   discount,
    producto:    prodName,
    precio:      prodPrice,
    descripcion: prodDesc,
    link:        prodLink,
  };
}

function ecRender(body, vars) {
  let str = String(body || '').replace(/\{([^{}]+?)\}/g, (_, choices) => {
    if (choices.startsWith('{') || choices.endsWith('}')) return choices;
    const parts = choices.split('|');
    if (parts.length > 1) {
      return parts[0].trim();
    }
    return choices;
  });
  return str.replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
}

function ecTplPreview() {
  const vars = ecSampleVars();
  const subj = ecRender(document.getElementById('tp-subject')?.value || '', vars);
  const body = ecRender(document.getElementById('tp-body')?.value || '', vars);
  
  const el = document.getElementById('tplPreview');
  if (el) {
    el.innerHTML = `<strong>Asunto:</strong> ${escapeHTML(subj)}<br><hr style="margin:8px 0;border:0;border-top:1px solid #c9e8cd"><div style="white-space:pre-wrap">${escapeHTML(body)}</div>`;
  }
}

async function saveEcTpl() {
  const name = document.getElementById('tp-name').value.trim();
  const subject = document.getElementById('tp-subject').value.trim();
  const body = document.getElementById('tp-body').value.trim();
  if (!name || !subject || !body) { showToast('Nombre, asunto y mensaje son obligatorios', 'warn'); return; }

  let custom = [];
  try {
    const raw = localStorage.getItem('jjp_ec_custom_templates_' + (SELLER?.id || 'default'));
    if (raw) custom = JSON.parse(raw);
  } catch (e) {}

  if (ecEditingTplId) {
    const idx = custom.findIndex(x => x.id === ecEditingTplId);
    if (idx !== -1) {
      custom[idx] = { ...custom[idx], name, subject, body };
    }
  } else {
    custom.push({
      id: 'tpl-custom-' + Date.now(),
      owner_id: SELLER?.id,
      name,
      subject,
      body,
      kind: 'personalizada'
    });
  }

  localStorage.setItem('jjp_ec_custom_templates_' + (SELLER?.id || 'default'), JSON.stringify(custom));
  showToast('Plantilla de email guardada ✔');
  closeEcModal('tplModal');
  loadEcTemplates();
}

async function deleteEcTpl(id) {
  if (!confirm('¿Eliminar esta plantilla?')) return;
  let custom = [];
  try {
    const raw = localStorage.getItem('jjp_ec_custom_templates_' + (SELLER?.id || 'default'));
    if (raw) custom = JSON.parse(raw);
  } catch (e) {}
  custom = custom.filter(x => x.id !== id);
  localStorage.setItem('jjp_ec_custom_templates_' + (SELLER?.id || 'default'), JSON.stringify(custom));
  showToast('Plantilla eliminada');
  loadEcTemplates();
}

/* ================== CAMPAÑAS ================== */
let _loadingEcCampaigns = false;
async function loadEcCampaigns(isBackground = false) {
  if (_loadingEcCampaigns) return;
  _loadingEcCampaigns = true;
  try {
    const isAdm = SELLER?.role === 'admin';
    // Excluir attachments, body y body_html de la lista general para evitar transferir megabytes de base64 y prevenir timeouts
    const fields = 'id, name, subject, kind, status, total, sent_count, failed_count, skipped_count, scheduled_at, created_at, delay_min_s, delay_max_s, owner_id';
    let q = sb.from('jjp_email_campaigns').select(fields).order('created_at', { ascending: false }).limit(50);
    if (!isAdm && SELLER?.id) {
      q = q.eq('owner_id', SELLER.id);
    }
    const { data, error } = await q;
    if (error) {
      console.warn('Aviso cargando campañas de email:', error);
      if (!isBackground && !ecCampaigns.length) {
        showToast('Error cargando campañas de email', 'err');
      }
      return;
    }
    ecCampaigns = data || [];
    renderEcCampaigns();
  } catch (err) {
    console.warn('Excepción cargando campañas:', err);
  } finally {
    _loadingEcCampaigns = false;
  }
}

function renderEcCampaigns() {
  const tbody = document.getElementById('ecCampBody');
  if (!tbody) return;
  if (!ecCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin campañas de email todavía. Lanza la primera con "＋ Nueva campaña". 📣</td></tr>';
    return;
  }
  tbody.innerHTML = ecCampaigns.map(c => {
    const isFuture = c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now();
    const [defLabel, defColor] = EC_STATUS[c.status] || [c.status, '#666'];
    const label = isFuture ? '⏰ Programada' : defLabel;
    const color = isFuture ? '#d97706' : defColor;
    const done = (c.sent_count || 0) + (c.failed_count || 0);
    const pct = c.total ? Math.round(done / c.total * 100) : 0;
    const active = c.status === 'running';
    return `<tr>
      <td>
        <div class="td-name">${escapeHTML(c.name || 'Campaña')}</div>
        <div class="td-sub">Asunto: ${escapeHTML(c.subject || '—')}</div>
        ${isFuture ? `<div class="td-sub" style="color:#d97706;font-weight:600">⏰ Inicia: ${fmtDate(c.scheduled_at)}</div>` : ''}
      </td>
      <td><span class="d-tag">${escapeHTML(c.kind || 'general')}</span></td>
      <td><span style="color:${color};font-weight:600">${label}</span></td>
      <td style="min-width:140px">
        <div class="d-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="d-prog-fill" style="width:${pct}%"></div>
        </div>
        <div class="td-sub">${c.sent_count || 0}/${c.total || 0} enviados${c.failed_count ? ` · ${c.failed_count} fallidos` : ''}</div>
      </td>
      <td style="text-align:center">${c.total || 0}</td>
      <td><div class="td-actions">
        <button class="btn-p sm" onclick="viewCampaignDetail('${c.id}')" title="Ver estatus detallado y destinatarios">📊 Detalle</button>
        ${active ? `<button class="btn-o sm" onclick="setCampStatus('${c.id}','paused')">⏸️ Pausar</button>` : ''}
        ${c.status === 'paused' ? `<button class="btn-p sm" onclick="setCampStatus('${c.id}','running')">▶️ Reanudar</button>` : ''}
        ${(active || c.status === 'paused') ? `<button class="btn-o sm" onclick="cancelEcCampaign('${c.id}')" title="Cancelar campaña">✕</button>` : ''}
        ${['completed','cancelled','paused','completada','cancelada','pausada','programada'].includes(c.status) ? `<button class="btn-o sm d-btn-del" onclick="deleteEcCampaign('${c.id}','${escapeHTML(c.name)}')" title="Eliminar campaña del sistema">🗑️</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

async function setCampStatus(id, status) {
  const { error } = await sb.from('jjp_email_campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo actualizar: ' + error.message, 'err'); return; }
  showToast(status === 'paused' ? 'Campaña pausada ⏸️' : 'Campaña reanudada ▶️');
  loadEcCampaigns();
}

async function cancelEcCampaign(id) {
  if (!confirm('¿Cancelar la campaña? Los correos pendientes NO se enviarán.')) return;
  const { error } = await sb.from('jjp_email_campaigns').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo cancelar: ' + error.message, 'err'); return; }
  showToast('Campaña cancelada');
  loadEcCampaigns();
}

async function deleteEcCampaign(id, name) {
  if (!confirm(`¿Eliminar la campaña "${name}"?\n\nSe borrarán para siempre la campaña y su registro de destinatarios del sistema. Esta acción NO se puede deshacer.`)) return;
  try {
    let ok = false;
    const { data, error } = await sb.rpc('jjp_delete_email_campaign', { p_campaign_id: id });
    if (!error && data === true) {
      ok = true;
    } else {
      await sb.from('jjp_email_campaign_targets').delete().eq('campaign_id', id);
      const { error: e2 } = await sb.from('jjp_email_campaigns').delete().eq('id', id);
      if (!e2) ok = true;
    }
    if (ok) {
      showToast('Campaña de correo eliminada 🗑️');
      if (ecViewingCamp?.id === id) setEcTab('campanas');
      loadEcCampaigns();
    } else {
      showToast('No se pudo eliminar la campaña', 'err');
    }
  } catch (e) {
    showToast('Error al eliminar: ' + e.message, 'err');
  }
}

/* ================== DETALLE DE CAMPAÑA ================== */
async function viewCampaignDetail(id) {
  const c = ecCampaigns.find(x => x.id === id);
  if (!c) return;
  ecViewingCamp = c;
  setEcTab('detalle');
  
  document.getElementById('detCampName').textContent = c.name || 'Detalle de Campaña';
  document.getElementById('detCampSub').textContent = `Tipo: ${c.kind} · Asunto: "${c.subject}" · Creada: ${fmtDate(c.created_at)}`;
  
  await loadCampTargets(id);
}

async function loadCampTargets(campId) {
  const { data, error } = await sb.from('jjp_email_campaign_targets')
    .select('*, customer_id, prospect_id')
    .eq('campaign_id', campId)
    .order('created_at');
    
  if (error) { showToast('Error cargando destinatarios: ' + error.message, 'err'); return; }
  
  // Cruzar con clientes/prospectos para traer el teléfono
  const custIds = data.map(t => t.customer_id).filter(Boolean);
  const prosIds = data.map(t => t.prospect_id).filter(Boolean);
  
  let custMap = {};
  if (custIds.length) {
    const { data: cData } = await sb.from('jjp_customers').select('id, phone').in('id', custIds);
    if (cData) cData.forEach(c => custMap[c.id] = c.phone);
  }
  let prosMap = {};
  if (prosIds.length) {
    const { data: pData } = await sb.from('jjp_prospects').select('id, phone').in('id', prosIds);
    if (pData) pData.forEach(p => prosMap[p.id] = p.phone);
  }

  ecDetailTargets = data.map(t => ({
    ...t,
    phone: (t.customer_id ? custMap[t.customer_id] : prosMap[t.prospect_id]) || null
  }));
  
  renderCampDetail();
}

function renderCampDetail() {
  if (!ecViewingCamp) return;
  const c = ecViewingCamp;
  
  const total = ecDetailTargets.length || c.total || 0;
  const sent = ecDetailTargets.filter(t => t.status === 'sent').length;
  const failed = ecDetailTargets.filter(t => t.status === 'failed').length;
  const skipped = ecDetailTargets.filter(t => t.status === 'skipped').length;
  const pending = ecDetailTargets.filter(t => t.status === 'pending' || t.status === 'sending').length;
  
  const pct = total ? Math.round((sent + failed + skipped) / total * 100) : 0;
  
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statSent').textContent = sent;
  document.getElementById('statFailed').textContent = failed;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statSkipped').textContent = skipped;
  
  const progFill = document.getElementById('detProgFill');
  if (progFill) progFill.style.width = pct + '%';
  document.getElementById('detProgLabel').textContent = `${pct}% completado (${sent}/${total} enviados)`;
  
  const btnRescate = document.getElementById('btnRescateWa');
  if (btnRescate) {
    btnRescate.style.display = failed > 0 ? 'inline-block' : 'none';
  }

  const tbody = document.getElementById('detTargetsBody');
  if (!tbody) return;
  
  if (!ecDetailTargets.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Cargando destinatarios...</td></tr>';
    return;
  }
  
  // Cambiamos Thead para agregar checkbox
  const thead = tbody.parentElement.querySelector('thead tr');
  if (thead && !thead.querySelector('.sel-all')) {
    thead.innerHTML = '<th style="width:40px"><input type="checkbox" class="sel-all" onclick="toggleAllFailedEmails(this)"></th>' + thead.innerHTML;
  }

  tbody.innerHTML = ecDetailTargets.map(t => {
    let stBadge = '<span class="d-tag" style="background:#fef3c7;color:#92400e">⏳ En cola</span>';
    if (t.status === 'sent') stBadge = '<span class="d-tag" style="background:#dcfce7;color:#15803d">✅ Enviado</span>';
    else if (t.status === 'failed') stBadge = '<span class="d-tag" style="background:#fee2e2;color:#b91c1c">❌ Fallido</span>';
    else if (t.status === 'skipped') stBadge = '<span class="d-tag" style="background:#f3f4f6;color:#6b7280">⏭️ Omitido</span>';
    else if (t.status === 'sending') stBadge = '<span class="d-tag" style="background:#e0f2fe;color:#0369a1">📤 Enviando</span>';
    
    const canRescue = t.status === 'failed' && t.phone;
    const checkboxHtml = canRescue ? `<input type="checkbox" class="chk-failed" value="${t.id}">` : `<input type="checkbox" disabled title="No rebotó o no tiene teléfono">`;
    
    return `<tr>
      <td>${checkboxHtml}</td>
      <td>
        <strong>${escapeHTML(t.name || 'Cliente')}</strong>
        ${t.phone ? `<div style="font-size:11px;color:#0284c7;font-weight:600;margin-top:2px">📱 ${t.phone}</div>` : ''}
      </td>
      <td>${escapeHTML(t.to_addr || '—')}</td>
      <td>${stBadge}</td>
      <td>${t.sent_at ? fmtDate(t.sent_at) : '—'}</td>
      <td style="font-size:12px;color:#b91c1c;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHTML(t.error || '')}">${escapeHTML(t.error || '')}</td>
    </tr>`;
  }).join('');
}

function toggleAllFailedEmails(master) {
  document.querySelectorAll('.chk-failed').forEach(chk => chk.checked = master.checked);
}

function rescueFailedToWa() {
  const selectedIds = Array.from(document.querySelectorAll('.chk-failed:checked')).map(chk => chk.value);
  if (!selectedIds.length) {
    showToast('Selecciona al menos un correo fallido para rescatar por WhatsApp.', 'err');
    return;
  }
  
  const rescueTargets = ecDetailTargets.filter(t => selectedIds.includes(t.id));
  
  // Guardamos en sessionStorage para que la página de difusión los recoja si es necesario, 
  // o si no, abrimos CampaignEditor directo en modal!
  const contacts = rescueTargets.map(t => ({
    id: t.customer_id,
    name: t.name,
    phone: t.phone,
    is_prospect: !!t.prospect_id
  }));
  
  if (window.CampaignEditor) {
    window.CampaignEditor.open({
      channel: 'whatsapp',
      contacts: contacts,
      seller: SELLER,
      onLaunch: async (config) => {
        // Redirigir a Difusion.html o lanzar api? Difusión maneja su propia launchWaCampaignFromEditor
        showToast('Abriendo motor de campañas de WhatsApp...', 'ok');
        sessionStorage.setItem('jjp_rescue_contacts', JSON.stringify(contacts));
        window.location.href = 'difusion.html?rescue=1';
      }
    });
  } else {
    sessionStorage.setItem('jjp_rescue_contacts', JSON.stringify(contacts));
    window.location.href = 'difusion.html?rescue=1';
  }
}

function backToCampaigns() {
  ecViewingCamp = null;
  setEcTab('campanas');
}

/* ================== NUEVA CAMPAÑA ================== */
function newEcCampaign(preTplId = null) {
  setEcTab('campanas');
  if (window.CampaignEditor) {
    window.CampaignEditor.open({
      channel: 'email',
      preTplId,
      products: ecProducts,
      combos: ecCombos,
      templates: ecTemplates,
      contacts: ecContacts,
      seller: SELLER,
      onLaunch: async (config) => {
        await launchEmailCampaignFromEditor(config);
      }
    });
    return;
  }
  openEcModal('campModal');
}

async function launchEmailCampaignFromEditor(config) {
  const { name, body, subject, audience, attachOpt, selectedProductOrCombo, customFile, delays } = config;
  const sessionUser = (await sb.auth.getUser())?.data?.user;
  const ownerId = sessionUser?.id || SELLER?.id;

  const attachOpts = String(attachOpt || 'none').split(',').map(s => s.trim()).filter(Boolean);
  let attachments = [];
  let imgSrc = '';

  if (attachOpts.includes('pdf_lista_precios')) {
    try {
      if (typeof docPdfProductos !== 'function') throw new Error('Motor de documentos no disponible.');
      const { base64, filename } = await docPdfProductos({ conStock: false, titulo: 'Lista de Precios Mayorista', returnBase64: true });
      attachments.push({
        filename: filename || 'Lista_de_Precios_JJ_Paper.pdf',
        contentType: 'application/pdf',
        base64: base64
      });
    } catch (e) {
      console.warn('PDF inline attachment notice:', e);
    }
  }

  if (attachOpts.includes('prod_image') && selectedProductOrCombo?.image_url) {
    attachments.push({
      path: selectedProductOrCombo.image_url,
      name: (selectedProductOrCombo.name || 'producto').replace(/[^\w.-]/g, '_') + '.jpg',
      mime: 'image/jpeg'
    });
    imgSrc = selectedProductOrCombo.image_url;
  }

  if (attachOpts.includes('custom_file') && customFile) {
    try {
      if (!/\.(pdf|png|jpe?g|webp)$/i.test(customFile.name)) {
        throw new Error('Formato no permitido (usa PDF o imagen).');
      }
      const mediaPath = `${ownerId}/campaigns/${Date.now()}-${customFile.name.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await sb.storage.from('jjp-email-media')
        .upload(mediaPath, customFile, { contentType: customFile.type || 'application/octet-stream', upsert: true });
      if (upErr) throw new Error('No se pudo subir el archivo: ' + upErr.message);
      attachments.push({ path: mediaPath, name: customFile.name, mime: customFile.type || 'application/octet-stream', size: customFile.size });
    } catch (e) {
      console.warn('Archivo propio no adjuntado:', e);
    }
  }

  let imgHtml = imgSrc
    ? `<div style="margin:14px 0;text-align:center"><img src="${imgSrc}" alt="${escapeHTML(selectedProductOrCombo?.name || '')}" style="max-width:380px;border-radius:10px;border:1px solid #e5e7eb;box-shadow:0 4px 10px rgba(0,0,0,0.06)"></div>`
    : '';

  let htmlBody = body.replace(/\n/g, '<br>');

  let payload = {
    owner_id: ownerId,
    name,
    kind: selectedProductOrCombo?.type || 'general',
    subject: subject || name,
    body,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#333;line-height:1.6;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;border:1px solid #edf2f7;border-radius:12px">${imgHtml}<div>${htmlBody}</div></div>`,
    body_html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#333;line-height:1.6;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;border:1px solid #edf2f7;border-radius:12px">${imgHtml}<div>${htmlBody}</div></div>`,
    attachments,
    status: config.scheduled_at ? 'scheduled' : 'running',
    total: audience.length,
    sent_count: 0,
    failed_count: 0,
    delay_min_s: delays?.min || 15,
    delay_max_s: delays?.max || 45
  };

  if (config.scheduled_at) {
    payload.scheduled_at = config.scheduled_at;
  }

  let { data: camp, error } = await sb.from('jjp_email_campaigns').insert(payload).select('id').single();
  if (error) {
    console.error('Error creando campaña de email:', error);
    showToast('Error creando campaña: ' + error.message, 'err');
    throw error;
  }

  const extra = {
    productId: selectedProductOrCombo?.id,
    type: selectedProductOrCombo?.type || 'general'
  };

  const targets = audience.map(c => ({
    campaign_id: camp.id,
    owner_id: ownerId,
    customer_id: c.id || null,
    to_addr: c.email,
    email: c.email,
    name: c.name,
    status: 'pending',
    vars: {
      ...ecSampleVars(c.name, extra),
      custom_subject: c._custom_subject || null,
      custom_message: c._custom_message || null,
      custom_body: c._custom_message || null,
      detected_need: c._detected_need || null,
      detected_sector: c._detected_sector || null
    }
  }));

  for (let i = 0; i < targets.length; i += 100) {
    let { error: e2 } = await sb.from('jjp_email_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) {
      console.error('Error insertando destinatarios de email:', e2);
      showToast('Error cargando destinatarios: ' + e2.message, 'err');
      break;
    }
  }

  // Actualizar estado en jjp_prospects si la campaña incluyó prospectos B2B
  const b2bTargets = targets.filter(t => audience.find(a => a.id === t.customer_id && a.is_prospect_b2b));
  if (b2bTargets.length > 0) {
    const pIds = b2bTargets.map(t => t.customer_id).filter(Boolean);
    const updatePayload = {
      contacted: true,
      status: 'contactado_email',
      last_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    for (const pid of pIds) {
      sb.from('jjp_prospects').update(updatePayload).eq('id', pid).then(() => {}).catch(e => console.warn('Aviso prospecto email:', e));
    }
  }

  showToast('¡Campaña de email iniciada! 🚀 Despachando por wa-server.');
  loadEcCampaigns();
}

function ecOnTypeChange() {
  const type = document.getElementById('nc-type').value;
  const prodWrap = document.getElementById('nc-prod-wrap');
  const comboWrap = document.getElementById('nc-combo-wrap');
  if (prodWrap) prodWrap.style.display = type === 'producto' ? '' : 'none';
  if (comboWrap) comboWrap.style.display = type === 'combo' ? '' : 'none';
  ecRefresh();
}

function ecGetExtraContext() {
  const type = document.getElementById('nc-type')?.value || 'general';
  const productId = document.getElementById('nc-prod-select')?.value || null;
  const comboId = document.getElementById('nc-combo-select')?.value || null;
  return { type, productId, comboId };
}

function ecAudience() {
  const aud = document.getElementById('nc-aud').value;
  const tag = document.getElementById('nc-tag').value.trim().toLowerCase();
  const inactDays = parseInt(APP.SETTINGS?.wa_react_days, 10) || 60;
  
  let list = ecContacts;
  if (aud === 'inactivos') {
    list = list.filter(c => c.total_orders > 0 && c.last_order_at &&
      (Date.now() - new Date(c.last_order_at).getTime()) > inactDays * 86400e3);
  } else if (aud === 'prospectos') {
    list = list.filter(c => !c.total_orders);
  } else if (aud === 'etiqueta') {
    list = list.filter(c => (c.tags || []).map(t => t.toLowerCase()).includes(tag));
  }
  return list;
}

function ecRefresh() {
  document.getElementById('nc-tag-wrap').style.display =
    document.getElementById('nc-aud').value === 'etiqueta' ? '' : 'none';
  const list = ecAudience();
  const tpl  = ecTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const extra = ecGetExtraContext();

  document.getElementById('ncCount').textContent =
    list.length ? `Se enviará a ${list.length} destinatario(s) con correo verificado.` : 'Ningún cliente con correo coincide con esa audiencia.';
    
  if (tpl) {
    const vars = ecSampleVars(list[0]?.name || 'María González', extra);
    const subj = ecRender(tpl.subject, vars);
    const body = ecRender(tpl.body, vars);
    document.getElementById('ncPreview').innerHTML = `<strong>Asunto:</strong> ${escapeHTML(subj)}<br><hr style="margin:6px 0;border:0;border-top:1px solid #c9e8cd"><div style="white-space:pre-wrap">${escapeHTML(body)}</div>`;
  } else {
    document.getElementById('ncPreview').textContent = '';
  }
  
  document.getElementById('ncLaunchBtn').disabled = !list.length || !tpl;
}

function ecOnAttachChange() {
  const opt = document.getElementById('nc-attach-opt')?.value || 'none';
  const customWrap = document.getElementById('nc-custom-file-wrap');
  const statusEl = document.getElementById('nc-attach-status');
  if (customWrap) customWrap.style.display = opt === 'custom_file' ? '' : 'none';
  
  if (statusEl) {
    if (opt === 'pdf_lista_precios') {
      statusEl.textContent = '📄 Se adjuntará el PDF oficial de Lista de Precios con los precios vigentes en USD y Bs.';
    } else if (opt === 'prod_image') {
      const extra = ecGetExtraContext();
      const prod = ecProducts.find(p => p.id === extra.productId);
      const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
      if (imgUrl) {
        statusEl.textContent = `🖼️ Se adjuntará la imagen de: ${prod.jjp_products?.name || prod.variant_name || 'producto'}`;
      } else {
        statusEl.textContent = '⚠️ El producto seleccionado no tiene imagen registrada; se enviará solo texto.';
      }
    } else if (opt === 'custom_file') {
      statusEl.textContent = '📁 Selecciona un archivo PDF o imagen desde tu equipo.';
    } else {
      statusEl.textContent = '';
    }
  }
}

async function launchEcCampaign() {
  const btn = document.getElementById('ncLaunchBtn');
  const name = document.getElementById('nc-name').value.trim();
  const list = ecAudience();
  const tpl  = ecTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const extra = ecGetExtraContext();
  const attachOpts = String(document.getElementById('nc-attach-opt')?.value || 'none').split(',').map(s => s.trim()).filter(Boolean);

  if (!name) { showToast('El nombre de la campaña es obligatorio', 'warn'); return; }
  if (!tpl)  { showToast('Selecciona una plantilla', 'warn'); return; }
  if (!list.length) { showToast('No hay destinatarios en esta audiencia', 'warn'); return; }

  // Verificar cuenta de correo configurada
  const { data: acct } = await sb.from('jjp_email_accounts')
    .select('email, has_cred')
    .eq('profile_id', SELLER.id)
    .maybeSingle();
    
  if (!acct?.has_cred) {
    showToast('Debes vincular tu cuenta de Gmail en "Correo -> Mi correo" antes de lanzar campañas', 'warn', 6000);
    return;
  }

  btn.disabled = true;
  let attachments = [];

  if (attachOpts.includes('pdf_lista_precios')) {
    btn.textContent = 'Generando catálogo PDF…';
    try {
      if (typeof docPdfProductos !== 'function') throw new Error('Motor de documentos no disponible.');
      const { blob, filename } = await docPdfProductos({ conStock: false, titulo: 'Lista de Precios Mayorista' });
      const mediaFilename = filename || 'Lista_de_Precios_JJ_Paper.pdf';
      const mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${mediaFilename}`;
      const { error: upErr } = await sb.storage.from('jjp-email-media')
        .upload(mediaPath, blob, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error('No se pudo guardar el PDF: ' + upErr.message);
      attachments.push({ path: mediaPath, name: mediaFilename, mime: 'application/pdf', size: blob.size });
    } catch (err) {
      showToast('Error generando PDF: ' + err.message, 'err');
      btn.disabled = false; btn.textContent = '🚀 Lanzar campaña de email';
      return;
    }
  }
  if (attachOpts.includes('prod_image') && extra.productId) {
    const prod = ecProducts.find(x => x.id === extra.productId);
    const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
    if (imgUrl) {
      attachments.push({ path: imgUrl, name: (prod.jjp_products?.name || 'producto') + '.jpg', mime: 'image/jpeg' });
    }
  }
  if (attachOpts.includes('custom_file')) {
    const file = document.getElementById('nc-custom-file')?.files?.[0];
    if (file) {
      btn.textContent = 'Subiendo archivo…';
      try {
        const mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const { error: upErr } = await sb.storage.from('jjp-email-media')
          .upload(mediaPath, file, { contentType: file.type || 'application/octet-stream', upsert: true });
        if (upErr) throw new Error('No se pudo subir el archivo: ' + upErr.message);
        attachments.push({ path: mediaPath, name: file.name, mime: file.type, size: file.size });
      } catch (err) {
        showToast('Error subiendo archivo: ' + err.message, 'err');
        btn.disabled = false; btn.textContent = '🚀 Lanzar campaña de email';
        return;
      }
    }
  }

  btn.textContent = 'Creando campaña…';

  const htmlContent = (tpl.body || '').replace(/\n/g, '<br>');
  const { data: camp, error } = await sb.from('jjp_email_campaigns').insert({
    owner_id: SELLER.id,
    name,
    kind: extra.type || 'general',
    subject: tpl.subject,
    body: tpl.body,
    html: htmlContent,
    body_html: htmlContent,
    status: 'draft',
    total: list.length,
    attachments
  }).select('id').single();

  if (error) {
    showToast('Error creando campaña: ' + error.message, 'err');
    btn.disabled = false; btn.textContent = '🚀 Lanzar campaña de email';
    return;
  }

  const targets = list.map(c => ({
    campaign_id: camp.id,
    owner_id: SELLER.id,
    customer_id: c.id || null,
    to_addr: c.email,
    email: c.email,
    name: c.name || 'Cliente',
    status: 'pending',
    vars: ecSampleVars(c.name, extra),
  }));

  for (let i = 0; i < targets.length; i += 100) {
    const { error: e2 } = await sb.from('jjp_email_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) {
      showToast('Error creando destinatarios: ' + e2.message, 'err');
      break;
    }
  }

  // Activar la campaña
  await sb.from('jjp_email_campaigns').update({
    status: 'running',
    started_at: new Date().toISOString()
  }).eq('id', camp.id);

  btn.disabled = false; btn.textContent = '🚀 Lanzar campaña de email';
  showToast('Campaña de email lanzada 🚀 — el servidor enviará los correos automáticamente');
  closeEcModal('campModal');
  loadEcCampaigns();
}

/* ---------- Modales ---------- */
let ecLastFocus = null;
function openEcModal(id) {
  ecLastFocus = document.activeElement;
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(m.querySelector('.modal-box'));
  m.querySelector('input,textarea,select,button')?.focus();
}
function closeEcModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('op');
  ecLastFocus?.focus?.();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay.op').forEach(m => closeEcModal(m.id));
});
