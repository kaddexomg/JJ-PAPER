/* ======================================================
   JJ Paper Vendedor — Difusión WhatsApp
   Contactos (import masivo) · Plantillas con variables ·
   Campañas automatizadas (las despacha wa-server con throttle)
   ====================================================== */

let dContacts   = [];
let dTemplates  = [];
let dCampaigns  = [];
let dProducts   = [];
let dCombos     = [];
let dTab        = 'campanas';
let editingTplId = null;
let dImportRows  = [];   // preview del import pendiente de confirmar

const D_VARS = ['nombre', 'empresa', 'vendedor', 'producto', 'precio', 'descuento', 'link', 'descripcion'];

const D_CAMP_STATUS = {
  en_cola:    ['⏳ En cola', '#b45309'],
  pending:    ['⏳ En cola', '#b45309'],
  programada: ['⏰ Programada', '#d97706'],
  enviando:   ['📤 Enviando', '#16604A'],
  sending:    ['📤 Enviando', '#16604A'],
  pausada:    ['⏸️ Pausada', '#6b7280'],
  completada: ['✅ Completada', '#15803d'],
  sent:       ['✅ Completada', '#15803d'],
  cancelada:  ['✕ Cancelada', '#b91c1c'],
};

/* ---------- init ---------- */
async function initDifusion() {
  await Promise.all([loadDContacts(), loadDTemplates(), loadDCampaigns(), loadDProductsAndCombos()]);
  setDTab('campanas');
  startCampaignLiveTimers();

  // Progreso en vivo: wa-server actualiza contadores → refresco de la lista y modal
  sb.channel('difusion-progress')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_wa_campaigns' },
      (payload) => {
        loadDCampaigns().then(() => {
          if (currentReportCampaignId && payload.new?.id === currentReportCampaignId) {
            updateReportModalFromCamp(payload.new);
          }
        });
      })
    .subscribe();
}

async function loadDProductsAndCombos() {
  try {
    // Cargar productos para el selector de promociones
    const { data: prods } = await sb.from('jjp_product_variants')
      .select('id,sku,price_usd,variant_name,jjp_products(id,name,description,image_url),jjp_brands(name)')
      .eq('active', true)
      .order('price_usd', { ascending: false })
      .limit(300);
    dProducts = prods || [];

    // Cargar promociones / combos activos
    const { data: promos } = await sb.from('jjp_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .limit(100);
    dCombos = promos || [];

    renderProductAndComboSelects();
  } catch (e) {
    console.warn('Error cargando catálogo para difusión:', e);
  }
}

function renderProductAndComboSelects() {
  const pSel = document.getElementById('nc-prod-select');
  if (pSel) {
    pSel.innerHTML = '<option value="">-- Selecciona un producto del catálogo --</option>' +
      dProducts.map(p => {
        const title = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
        return `<option value="${p.id}">${escapeHTML(title)} — $${(+p.price_usd).toFixed(2)}</option>`;
      }).join('');
  }

  const cSel = document.getElementById('nc-combo-select');
  if (cSel) {
    cSel.innerHTML = '<option value="">-- Selecciona un combo u oferta activa --</option>' +
      dCombos.map(c => {
        const price = c.price_usd ? ` — $${(+c.price_usd).toFixed(2)}` : '';
        return `<option value="${c.id}">[${c.kind.toUpperCase()}] ${escapeHTML(c.title)}${price}</option>`;
      }).join('');
  }
}

function setDTab(t) {
  dTab = t;
  document.querySelectorAll('.of-chip[data-tab]').forEach(c => {
    const on = c.dataset.tab === t;
    c.classList.toggle('on', on);
    c.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('[data-panel]').forEach(p => {
    p.style.display = p.dataset.panel === t ? '' : 'none';
  });
}

/* ================== CONTACTOS ================== */
function getBestMobilePhone(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (typeof window.getBestMobilePhone === 'function') return window.getBestMobilePhone(p);
  const isLand = (num) => /^(?:58|0)?(?:2\d{2})\d{7}$/.test(String(num).replace(/\D/g, ''));
  const isMob = (num) => {
    const d = String(num).replace(/\D/g, '');
    return /^(?:58)?0?4(12|14|24|16|26)\d{7}$/.test(d) || (d.length >= 11 && !d.startsWith('0') && !isLand(d));
  };
  if (isMob(p.phone_2)) return p.phone_2;
  if (isMob(p.phone_1)) return p.phone_1;
  if (isMob(p.phone)) return p.phone;
  return p.phone_2 || p.phone_1 || p.phone || '';
}

async function loadDContacts() {
  const isAdm = SELLER?.role === 'admin';
  // Paginamos (PostgREST limita a 1.000 filas) para no perder contactos en difusión.
  dContacts = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    let q = sb.from('jjp_customers').select('id,name,phone,email,zone,tags,seller_id,wa_opt_out,email_status').order('name').range(from, from + PAGE - 1);
    if (!isAdm && SELLER?.id) q = q.eq('seller_id', SELLER.id);
    const { data, error } = await q;
    if (error) { showToast('Error cargando contactos', 'err'); return; }
    dContacts.push(...(data || []));
    if (!data || data.length < PAGE || from > 12000) break;
    from += PAGE;
  }

  // Si es Admin, cargar también la cartera de Prospectos B2B (jjp_prospects)
  if (isAdm) {
    try {
      const { data: b2bProspects, error: pErr } = await sb.from('jjp_prospects')
        .select('id,company_name,phone_1,phone_2,email,sector,status,contacted,last_contact_at,email_status,contact_name,contact_role,address,city,notes,ai_analysis,suggested_subject,custom_wa_body,custom_email_body')
        .order('company_name');

      if (!pErr && Array.isArray(b2bProspects)) {
        const normProspects = b2bProspects.map(p => {
          const isAlreadyContacted = Boolean(
            p.contacted || 
            p.last_contact_at || 
            (p.status && String(p.status).startsWith('contactado'))
          );
          return {
            id: p.id,
            name: p.company_name,
            company_name: p.company_name,
            sector: p.sector || 'Otro',
            contact_name: p.contact_name || '',
            contact_role: p.contact_role || '',
            phone: getBestMobilePhone(p),
            phone_1: p.phone_1,
            phone_2: p.phone_2,
            email: p.email || '',
            email_status: p.email_status || null,
            address: p.address || p.city || 'Caracas',
            city: p.city || 'Caracas',
            notes: p.notes || '',
            status: p.status || 'nuevo',
            contacted: isAlreadyContacted,
            last_contact_at: p.last_contact_at || null,
            is_prospect_b2b: true,
            total_orders: 0,
            tags: ['prospecto_b2b', p.sector ? p.sector.toLowerCase().replace(/\s+/g, '_') : 'otro'],
            ai_analysis: p.ai_analysis || {},
            suggested_subject: p.suggested_subject || null,
            custom_email_body: p.custom_email_body || null,
            custom_wa_body: p.custom_wa_body || null,
            _custom_message: isAlreadyContacted ? null : (p.custom_wa_body || null),
            _custom_subject: isAlreadyContacted ? null : (p.suggested_subject || null),
            _detected_need: p.ai_analysis?.dolor_operativo || null,
            _detected_sector: p.ai_analysis?.sector_deducido || p.sector || null
          };
        });
        dContacts.push(...normProspects);
      }
    } catch (pe) {
      console.warn('Aviso cargando prospectos B2B para difusión:', pe);
    }
  }

  renderDTagChips();
  renderDContacts();
}

async function toggleOptOut(id) {
  const c = dContacts.find(x => x.id === id);
  if (!c) return;
  const { error } = await sb.from('jjp_customers')
    .update({ wa_opt_out: !c.wa_opt_out, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo actualizar', 'err'); return; }
  c.wa_opt_out = !c.wa_opt_out;
  showToast(c.wa_opt_out ? 'Excluido de difusiones 🔕' : 'Incluido en difusiones 🔔');
  renderDContacts();
}

async function editTags(id) {
  const c = dContacts.find(x => x.id === id);
  if (!c) return;
  const raw = prompt(`Etiquetas de ${c.name} (separadas por coma):`, (c.tags || []).join(', '));
  if (raw === null) return;
  const tags = raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const { error } = await sb.from('jjp_customers')
    .update({ tags, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('No se pudo guardar', 'err'); return; }
  c.tags = tags;
  renderDContacts();
}

/* ---- Etiquetas clickeables (filtro rápido) ---- */
let dActiveTag = null;

function renderDTagChips() {
  const wrap = document.getElementById('dTagChips');
  if (!wrap) return;
  const counts = {};
  dContacts.forEach(c => (c.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.keys(counts).sort();
  if (!tags.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = tags.map(t =>
    `<button class="d-tag d-tag-click ${dActiveTag === t ? 'on' : ''}" onclick="toggleDTagFilter('${escapeHTML(t)}')">🔖 ${escapeHTML(t)} <span style="opacity:.7">(${counts[t]})</span></button>`
  ).join('') + (dActiveTag ? `<button class="d-tag d-tag-click" style="color:#b91c1c;background:#fee2e2" onclick="toggleDTagFilter(null)">✕ Quitar filtro</button>` : '');
}

function toggleDTagFilter(tag) {
  dActiveTag = dActiveTag === tag ? null : (tag || null);
  renderDTagChips();
  renderDContacts();
}

function renderDContacts() {
  const tbody = document.getElementById('dContactsBody');
  const q = normTxt(document.getElementById('dContactSearch')?.value.trim() || '');
  let list = dContacts;
  if (q) list = list.filter(c => normTxt(c.name).includes(q) || (c.phone || '').includes(q.replace(/\D/g, '')) ||
                                 (c.tags || []).some(t => normTxt(t).includes(q)));
  if (dActiveTag) list = list.filter(c => (c.tags || []).includes(dActiveTag));

  const MAX_DISPLAY = 100;
  const isTruncated = list.length > MAX_DISPLAY;
  const displayList = list.slice(0, MAX_DISPLAY);

  document.getElementById('dContactCount').textContent = `${list.length} de ${dContacts.length} contacto(s)${dActiveTag ? ` con etiqueta "${dActiveTag}"` : ''}${isTruncated ? ` (mostrando primeros ${MAX_DISPLAY})` : ''}`;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin contactos. Usa "Importar lista" para cargar tu avance de datos. 📇</td></tr>';
    return;
  }
  tbody.innerHTML = displayList.map(c => `<tr>
    <td>
      <div class="td-name">${escapeHTML(c.name)}</div>
      <div class="td-sub">${escapeHTML(c.phone || '')}</div>
    </td>
    <td>${(c.tags || []).map(t => `<span class="d-tag d-tag-click" onclick="toggleDTagFilter('${escapeHTML(t)}')">${escapeHTML(t)}</span>`).join(' ') || '—'}</td>
    <td>${c.total_orders > 0 ? `${c.total_orders} compra(s)` : '<span class="d-tag" style="background:#fef3c7;color:#92400e">prospecto</span>'}</td>
    <td>${c.last_order_at ? fmtDate(c.last_order_at) : '—'}</td>
    <td><div class="td-actions">
      <button class="btn-o sm" onclick="toggleOptOut('${c.id}')" aria-pressed="${c.wa_opt_out}"
        title="${c.wa_opt_out ? 'Excluido de difusiones — clic para incluir' : 'Incluido en difusiones — clic para excluir'}">
        ${c.wa_opt_out ? '🔕 Excluido' : '🔔 Incluido'}</button>
      <button class="btn-o sm" onclick="editTags('${c.id}')" title="Editar etiquetas">🔖</button>
    </div></td>
  </tr>`).join('') + (isTruncated ? `<tr><td colspan="5" style="text-align:center;padding:12px;color:#6b7280;font-size:12px;background:#f9fafb;">Mostrando 100 de ${list.length} contactos. Usa el buscador superior para filtrar contactos específicos.</td></tr>` : '');
}

/* ---- Import masivo ---- */
function openImportModal() {
  dImportRows = [];
  document.getElementById('di-text').value = '';
  document.getElementById('di-tag').value = '';
  document.getElementById('diPreview').innerHTML = '';
  document.getElementById('diConfirmBtn').disabled = true;
  openDModal('importModal');
}

function diFileChosen(input) {
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('di-text').value = reader.result; diParse(); };
  reader.readAsText(f, 'utf-8');
  input.value = '';
}

function diParse() {
  const tagBase = document.getElementById('di-tag').value.trim().toLowerCase();
  const lines = document.getElementById('di-text').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = []; let bad = 0;

  for (const line of lines) {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length < 2) { bad++; continue; }
    let phoneIdx = 0, best = 0;
    parts.forEach((p, i) => { const d = p.replace(/\D/g, '').length; if (d > best) { best = d; phoneIdx = i; } });
    if (best < 10) { bad++; continue; }
    const phone = parts[phoneIdx];
    const rest  = parts.filter((_, i) => i !== phoneIdx);
    const name  = rest[0] || '';
    if (!name) { bad++; continue; }
    rows.push({ name, phone, city: rest[1] || null, tags: tagBase ? [tagBase] : [] });
  }

  dImportRows = rows.slice(0, 500);
  const prev = document.getElementById('diPreview');
  prev.innerHTML = rows.length
    ? `<p><strong>${rows.length}</strong> contacto(s) listos${bad ? ` · <span style="color:#b45309">${bad} línea(s) ignoradas</span>` : ''}${rows.length > 500 ? ' · <span style="color:#b91c1c">solo se importarán los primeros 500</span>' : ''}</p>
       <ul style="margin:6px 0 0;padding-left:18px;max-height:120px;overflow:auto">${rows.slice(0, 8).map(r =>
         `<li>${escapeHTML(r.name)} — ${escapeHTML(r.phone)}</li>`).join('')}${rows.length > 8 ? '<li>…</li>' : ''}</ul>`
    : `<p style="color:#b45309">Nada que importar todavía. Formato: <code>Nombre, teléfono</code> (una línea por contacto).</p>`;
  document.getElementById('diConfirmBtn').disabled = !dImportRows.length;
}

async function diConfirm() {
  const btn = document.getElementById('diConfirmBtn');
  btn.disabled = true; btn.textContent = 'Importando…';
  const { data, error } = await sb.rpc('jjp_wa_import_contacts', { p_rows: dImportRows });
  btn.disabled = false; btn.textContent = '📥 Importar';
  if (error) { showToast('Error importando: ' + error.message, 'err'); return; }
  showToast(`Importados: ${data.inserted} nuevos · ${data.updated} actualizados` +
            (data.skipped ? ` · ${data.skipped} inválidos` : ''));
  closeDModal('importModal');
  loadDContacts();
}

const DEFAULT_GLOBAL_TEMPLATES = [
  {
    id: 'tpl-promo-prod',
    name: '📦 Propuesta Mayorista: Producto Destacado',
    kind: 'producto',
    owner_id: null,
    body: '{Hola|Buen día|Qué tal} {{nombre}} 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Como importadores y distribuidores mayoristas directos en Caracas, hoy queremos presentarle disponibilidad inmediata y precio preferencial en:\n\n📦 *{{producto}}*\n📝 {{descripcion}}\n💲 *Precio lista mayorista: {{precio}}*\n_(Condiciones comerciales y escala de descuento por volumen / bulto cerrado)_\n\n• 🏭 *Importador directo en Caracas* (inventario real sin intermediarios)\n• 🚚 *Delivery a su sede* y factura fiscal formal a tasa oficial BCV\n• 🔍 *Procura especial:* si requiere algún formato o insumo que no esté en lista, se lo conseguimos.\n\n👉 Ficha completa y pedido en línea: {{link}}\n\n¿Le reservamos unidades o le preparamos una cotización formal para su empresa?'
  },
  {
    id: 'tpl-promo-combo',
    name: '🎁 Combo Operativo con Ahorro por Lote',
    kind: 'combo',
    owner_id: null,
    body: '{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarle 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Armamos este combo especial pensado para optimizar la reposición de su empresa con precio directo de importador:\n\n*🎁 COMBO OPERATIVO: {{producto}}*\n📝 {{descripcion}}\n💲 *Inversión del combo: {{precio}}*\n_(Ahorro directo frente a compras al detal)_\n\n• 🏭 *Importador directo en Caracas*\n• 🚚 *Despacho garantizado en 24h*\n• 🧾 *Facturación formal a Tasa Oficial BCV*\n\n👉 Ver detalles o confirmar pedido directo: {{link}}\n\n¿Le reservamos este combo antes de agotar existencia del lote?'
  },
  {
    id: 'tpl-multi-ofertas',
    name: '🔥 Volante de Ofertas Quincenales (Multi-Producto)',
    kind: 'multi_oferta',
    owner_id: null,
    body: '{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋\n\nLe saluda {{vendedor}} de *JJ Paper C.A.* Armamos una selección exclusiva de ofertas mayoristas con inventario físico para entrega inmediata en Caracas:\n\n*🔥 OFERTAS DESTACADAS DE LA SEMANA:*\n{{productos_oferta}}\n\n• 🏭 Precios directos de importador en Caracas\n• 🚚 Delivery garantizado a su sede\n• 🧾 Facturación fiscal formal a Tasa BCV\n\n👉 Catálogo digital completo: {{link}}\n\n¿Le reservamos disponibilidad de estos artículos para su despacho?'
  },
  {
    id: 'tpl-sector-colegios',
    name: '🏫 Colegios & Universidades — Dotación y Evaluaciones',
    kind: 'sector_colegios',
    owner_id: null,
    body: '{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋\n\nLe saluda {{vendedor}} de *JJ Paper C.A.* Como importadores y distribuidores directos en Caracas, apoyamos la operatividad académica de su institución con precios mayoristas sin intermediarios.\n\n📚 *Propuesta especial para su institución:*\n• 📄 *Resmas de papel Bond (Carta y Oficio)* — Blancura y gramaje óptimo para guías y evaluaciones masivas sin atascos.\n• 🖍️ *Marcadores de pizarra acrílica y borradores* — Alta duración y colores vivos para el cuerpo docente.\n• 📁 *Carpetas de expediente estudiantil y archivo* — Para resguardo reglamentario de matrículas.\n\n💡 *Condición comercial:* Manejamos escala de precios por volumen/bulto y si necesita algún material didáctico o escolar especial fuera de lista, se lo ubicamos directamente.\n\n🚚 Despacho a su sede en Caracas y factura fiscal a tasa BCV.\n\n👉 Catálogo digital: {{link}}\n\n¿Desea que le preparemos una cotización para su próximo ciclo o evaluación?'
  },
  {
    id: 'tpl-sector-clinicas',
    name: '🏥 Clínicas, Salud & Archivo Médico',
    kind: 'sector_salud',
    owner_id: null,
    body: '{Hola|Buen día|Saludos cordiales} {{nombre}} 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Somos distribuidores directos en Caracas especializados en suministros continuos para el sector salud y administrativo.\n\n🏥 *Disponibilidad prioritaria para su sede:*\n• 🗂️ *Sobres de radiografía 14x17 y manila* — Gran formato, alta resistencia para resguardo y entrega de estudios médicos.\n• 📁 *Carpetas de historias médicas con divisiones y gancho* — Cumplimiento reglamentario y archivo a largo plazo.\n• 🧾 *Rollos térmicos certificados libre de polvillo* — 80x70 y 57x40 para cajas, admisiones y equipos de laboratorio.\n\n⚡ Cotización formal al instante, factura fiscal a tasa oficial BCV y despacho express en Caracas.\n\n👉 Revise nuestro inventario mayorista aquí: {{link}}\n\n¿En qué insumos o formatos médicos podemos coordinarles cotización o despacho?'
  },
  {
    id: 'tpl-sector-oficinas',
    name: '🏢 Empresas & Oficinas — Archivo SENIAT y Dotación',
    kind: 'sector_oficinas',
    owner_id: null,
    body: '{Hola|Buen día|Estimado equipo} de {{nombre}} 👋\n\nLe saluda {{vendedor}} de *JJ Paper C.A.*, su aliado mayorista directo para el abastecimiento corporativo en Caracas.\n\n🏢 *Soluciones clave para sus operaciones:*\n• 📁 *Archivadores de palanca y carpetas de fibra marrón* — Protección y resguardo reglamentario de contabilidad a 10 años (exigencia SENIAT/SUDEBAN).\n• 🖨️ *Resmas Bond de alto rendimiento* — Impresiones corporativas nítidas en Carta y Oficio.\n• 📦 *Consumibles de oficina y escritorio* — Bolígrafos por caja, grapas 26/6, notas adhesivas y tijeras.\n\n💼 *Respaldo JJ Paper:* Como importadores, garantizamos precios mayoristas de lista B, factura fiscal legal y delivery gratuito en Caracas.\n\n👉 Catálogo completo: {{link}}\n\n¿Gusta que revisemos su lista de reposición mensual para prepararle una propuesta con ahorro por volumen?'
  },
  {
    id: 'tpl-sector-retail',
    name: '🛒 Supermercados, Comercios & Cajas POS',
    kind: 'sector_retail',
    owner_id: null,
    body: '{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Nos especializamos en garantizar que su línea de cajas y despacho opere al 100% sin quiebres de inventario.\n\n🛒 *Insumos críticos para su comercio:*\n• 🧾 *Rollos térmicos de alta definición (80x70mm / 80x80mm / 57x40mm)* — Papel térmico puro para cajas fiscales y puntos de venta.\n• 📦 *Cintas de embalaje industrial (48x100m y 48x200m)* — Pegado extrafuerte que no se levanta.\n• 💵 *Marcadores detectores de billetes falsos Kores* — Seguridad en punto de cobro.\n\n💰 Precios directos por caja/bulto cerrado con entrega inmediata en Caracas.\n\n👉 Ver catálogo y precios: {{link}}\n\n¿Cuántas cajas o bultos de rollos/cintas estima para su reposición de esta quincena?'
  },
  {
    id: 'tpl-sector-logistica',
    name: '📦 Industrias, Logística & Almacenes',
    kind: 'sector_logistica',
    owner_id: null,
    body: '{Hola|Buen día|Un saludo} {{nombre}} 👋\n\nLe saluda {{vendedor}} de *JJ Paper C.A.* Suministramos a centros de distribución y empresas de logística materiales de empaque y rotulación de alto rendimiento.\n\n📦 *Línea de embalaje pesado:*\n• 📦 *Cintas de embalaje industrial marrón y transparente* — 48mm x 100m y 200m de alto micraje, agarre inmediato sobre cartón corrugado.\n• 🖊️ *Marcadores industriales Servicio 80 y Sharpie* — Tinta indeleble resistente a intemperie y roce.\n• ✂️ *Dispensadores tipo pistola y exactos de trabajo pesado* — Agilizan el cerrado de paletas y paquetes.\n\n🚚 Precios al mayor por bulto cerrado y despacho a su galpón en Caracas.\n\n👉 Catálogo digital: {{link}}\n\n¿Desea que le hagamos llegar una muestra o cotización formal por volumen?'
  },
  {
    id: 'tpl-sector-papelerias',
    name: '📚 Papelerías y Comercios (Mayorista Reventa)',
    kind: 'sector_reventa',
    owner_id: null,
    body: '{Hola|Buen día|Qué tal} {{nombre}} 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Somos importadores directos, lo que le asegura el margen de ganancia que su papelería o tienda necesita para competir y ganar.\n\n📚 *Condiciones de reventa mayorista:*\n• 💵 *Precios oficiales de lista B (distribuidor)* — Acceda a costo mayorista por bulto cerrado.\n• 📦 *Marcas líderes de alta demanda* — Kores, Solita, Sabonis, Report, HP, Chamex, Bic.\n• 🔍 *Sourcing a medida:* Si sus clientes le piden un producto específico que no ve en el mercado, se lo gestionamos.\n\n🚚 Despacho directo a su local en Caracas con factura a tasa oficial BCV.\n\n👉 Consulte la lista mayorista: {{link}}\n\n¿Le reservamos mercancía de alta rotación para su inventario de esta semana?'
  },
  {
    id: 'tpl-sourcing-especial',
    name: '🔍 Búsqueda de Insumos Especiales (Procura)',
    kind: 'sourcing',
    owner_id: null,
    body: '{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋\n\nLe saluda {{vendedor}} de *JJ Paper C.A.*, su importador y distribuidor mayorista en Caracas.\n\nAdemás de nuestro catálogo regular (+900 artículos en resmas, consumibles de caja, archivo y embalaje), ponemos a su disposición nuestro *Servicio de Procura Especial*:\n\n🔍 *¿Requiere un insumo, medida o formato específico para su empresa?*\nSi no lo encuentra en el mercado o no está en nuestra lista de precios, *nuestro equipo de importación se lo ubica y cotiza directamente* con las mejores condiciones comerciales.\n\n• 🚚 Entrega en su sede en Caracas\n• 🧾 Facturación fiscal legal a Tasa Oficial BCV\n• ⚡ Respuesta y cotización en tiempo récord\n\n👉 Revise nuestro catálogo base: {{link}}\n\n¿Qué requerimiento o material tiene abierto actualmente en el que podamos apoyarle?'
  },
  {
    id: 'tpl-reactivacion',
    name: '🔄 Reactivación: Condiciones Mayoristas Preferenciales',
    kind: 'reactivacion',
    owner_id: null,
    body: '{Hola|Buen día|Saludos} {{nombre}} 👋, le saluda {{vendedor}} de *JJ Paper C.A.*\n\nEsperamos que todo marche excelente en su empresa. Pasamos por aquí brevemente para comentarle que tenemos activas *condiciones preferenciales y descuentos por volumen* en su próxima reposición.\n\n📄 Contamos con inventario actualizado de más de 900 productos listos para despacho (resmas, rollos térmicos, cintas de empaque y archivo).\n\n👉 Vea el catálogo actualizado con precios al día aquí: {{link}}\n\n¿En qué podemos apoyarle para coordinar su próximo despacho?'
  },
  {
    id: 'tpl-catalogo-general',
    name: '🏢 Catálogo Digital y Lista de Precios B2B',
    kind: 'general',
    owner_id: null,
    body: '{Hola|Buen día|Saludos} {{nombre}} 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.*, su distribuidor directo de papelería, insumos de oficina y consumibles en Caracas.\n\n📦 *Tenemos disponibilidad inmediata en:*\n\n• 🖨️ *Resmas de papel Bond* — Carta y Oficio, diferentes gramajes\n• 📃 *Rollos térmicos POS* — 80x70mm y 57x40mm para puntos de venta\n• 📎 *Cintas de embalaje industrial* — 48x100m y 48x200m, alto micraje\n• 📁 *Carpetas, archivadores y sobres* — Fibra marrón, manila, radiografía\n• ✏️ *Material escolar y de escritorio* — Cuadernos, bolígrafos, marcadores\n\n✅ *¿Por qué elegirnos?*\n1️⃣ Catálogo con +900 artículos disponibles con precios de lista B (distribuidor)\n2️⃣ Cotizaciones al instante adaptadas a su presupuesto y requerimiento\n3️⃣ 🚚 Delivery GRATIS en toda Caracas a su sede\n4️⃣ Facturación fiscal formal (RIF J-295375450) en Bs a tasa BCV oficial\n5️⃣ 🔍 Si no ve un producto en lista, nuestro equipo de procura se lo ubica directamente\n\n👉 Catálogo digital: {{link}}\n\n{Quedo a su orden|Estamos para servirle|A su completa disposición} para cualquier cotización o consulta.\n\n{{vendedor}}\n📞 0412-4676073\n*JJ Paper C.A.* — Distribución directa en Caracas'
  }
];

/* ================== PLANTILLAS ================== */
async function loadDTemplates() {
  const { data, error } = await sb.from('jjp_wa_templates')
    .select('*').eq('active', true).order('created_at');
  
  const list = data || [];
  // Asegurar que siempre estén disponibles las plantillas base del sistema
  const existingNames = new Set(list.map(x => x.name.toLowerCase()));
  const missingGlobals = DEFAULT_GLOBAL_TEMPLATES.filter(g => !existingNames.has(g.name.toLowerCase()));
  dTemplates = [...list, ...missingGlobals];
  renderDTemplates();
}

function renderDTemplates() {
  const wrap = document.getElementById('dTplList');
  if (!dTemplates.length) {
    wrap.innerHTML = '<p class="table-empty">Sin plantillas. Crea la primera. 📝</p>';
    return;
  }
  wrap.innerHTML = dTemplates.map(t => {
    const mine = t.owner_id === SELLER.id;
    return `<article class="d-tpl-card">
      <div class="d-tpl-hd">
        <strong>${escapeHTML(t.name)}</strong>
        <span class="d-tag">${t.owner_id ? '👤 mía' : '🌐 global'}${t.kind === 'reactivacion' ? ' · 🔄 reactivación' : ''}</span>
      </div>
      <pre class="d-tpl-body">${escapeHTML(t.body)}</pre>
      <div class="td-actions">
        <button class="btn-o sm" onclick="newCampaign('${t.id}')">📣 Usar en campaña</button>
        ${mine ? `<button class="btn-o sm" onclick="openTplModal('${t.id}')">✏️ Editar</button>
                  <button class="btn-o sm" onclick="deleteTpl('${t.id}')" title="Eliminar plantilla">🗑️</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function openTplModal(id = null) {
  editingTplId = id;
  const t = id ? dTemplates.find(x => x.id === id) : null;
  document.getElementById('tplModalTitle').textContent = t ? `Editar: ${t.name}` : 'Nueva plantilla';
  document.getElementById('tp-name').value = t?.name || '';
  document.getElementById('tp-body').value = t?.body || '';
  tplPreview();
  openDModal('tplModal');
}

function tplInsertVar(v) {
  const ta = document.getElementById('tp-body');
  const pos = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, pos) + `{{${v}}}` + ta.value.slice(ta.selectionEnd ?? pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + v.length + 4;
  tplPreview();
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

async function tplDraftWithAi() {
  const currentName = document.getElementById('tp-name')?.value?.trim() || '';
  
  // Custom prompt dialog
  const topic = prompt('✨ ¿Cuál es el Objetivo Principal o Producto de esta Campaña?\n(Ej: Promoción de resmas de papel, Combo escolar, Reactivación)', currentName || 'Promoción especial de papelería al mayor');
  if (!topic || !topic.trim()) return;

  let tone = prompt('🎭 Elige el Tono / Personalidad de la IA:\n1. Formal y Directo B2B (Corporativo)\n2. Reactivación / Seguimiento (Recordار listas previas)\n3. Urgencia / Oferta Limitada\n4. Bienvenida / Primer Contacto\nEscribe el número o describe tu propio tono:', '2');
  
  const toneMap = {
    '1': 'Formal y Directo B2B (Corporativo)',
    '2': 'Reactivación / Seguimiento (Recordar listas previas, ofrecer servicio)',
    '3': 'Urgencia / Oferta Limitada (Sentido de urgencia, inventario limitado)',
    '4': 'Bienvenida / Primer Contacto (Alegre, presentándose por primera vez)'
  };
  tone = toneMap[tone?.trim()] || tone || 'Profesional y Persuasivo (Vendedor Consultivo)';

  const historyContext = prompt('📜 Contexto Histórico Adicional (Opcional):\n¿Qué ha pasado antes con estos clientes?\n(Ej: Ya les envié la lista de precios el viernes pasado, es para que la revisen)', 'Ya les envié la lista de precios la semana pasada.');

  const btn = document.getElementById('waAiTplBtn');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Redactando con IA...';
  }

  try {
    await ensureGeminiClient();
    if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');

    const res = await window.GeminiClient.draftCampaignMessage({
      objective: topic.trim(),
      channel: 'whatsapp',
      audience: 'todos',
      sellerName: SELLER?.name || '',
      tone: tone,
      historyContext: historyContext || ''
    });

    if (!document.getElementById('tp-name').value) {
      document.getElementById('tp-name').value = topic.slice(0, 35).trim();
    }
    if (res.body) {
      document.getElementById('tp-body').value = res.body;
    }
    tplPreview();
    if (typeof showToast === 'function') showToast('Plantilla estructurada exitosamente con IA', 'success');
  } catch (err) {
    alert('Error al redactar plantilla con IA: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

function tplApplyPreset(type) {
  const nameEl = document.getElementById('tp-name');
  const bodyEl = document.getElementById('tp-body');
  if (type === 'promo_producto') {
    if (!nameEl.value) nameEl.value = 'Promoción de Producto';
    bodyEl.value = `{Hola|Qué tal|Buen día} {{nombre}}, espero estés excelente 👋\n\nTe escribe {{vendedor}} de JJ Paper con esta opción de alta rotación para tu negocio:\n\n*📦 {{producto}}*\n*💲 Precio especial: {{precio}}*\n\n👉 Puedes chequear detalles o hacer tu pedido aquí:\n{{link}}\n\n¿Te aparto unas unidades para tu próximo despacho?`;
  } else if (type === 'promo_combo') {
    if (!nameEl.value) nameEl.value = 'Oferta Combo Especial';
    bodyEl.value = `{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarte 👋\n\nTe escribe {{vendedor}} de JJ Paper. Armamos este combo especial pensado para surtir tu negocio:\n\n*🎁 COMBO: {{producto}}*\n📝 Incluye: {{descripcion}}\n*💲 Precio del combo: {{precio}}*\n\n👉 Puedes ver detalles o pedir directamente aquí:\n{{link}}\n\n¿Te apartamos este combo antes de agotar existencia?`;
  } else if (type === 'reactivacion') {
    if (!nameEl.value) nameEl.value = 'Reactivación con Descuento';
    bodyEl.value = `{Hola|Qué tal|Buen día} {{nombre}}, espero que todo marche excelente en tu negocio 👋\n\nTe escribe {{vendedor}} de JJ Paper. Queremos reactivar tus compras con un *{{descuento}}% de descuento* en tu próximo pedido.\n\n👉 Puedes consultar el catálogo con precios actualizados aquí:\n{{link}}\n\n¿En qué podemos apoyarte con tu pedido de esta semana?`;
  }
  tplPreview();
}

function dSampleVars(name = 'Distribuidora Alfa, C.A.', extraContext = {}) {
  const bcv = parseFloat(APP.SETTINGS?.rate_bcv) || 0;
  
  let prodName = 'Resma Carta HP 75g (Caja × 10)';
  let prodPrice = '$38.50 USD' + (bcv ? ` (Bs ${ (38.50 * bcv).toFixed(2) })` : '');
  let prodDesc = 'Papel bond de alta blancura ideal para oficina y colegios.';
  let prodLink = sellerRefLink() || `${location.origin}/catalogo.html`;
  let discount = APP.SETTINGS?.wa_react_discount || '10';

  // El editor puede pasar el objeto completo elegido (del ProductPicker) para que el
  // producto/precio/descripción SIEMPRE sean los reales, sin depender de que el id
  // coincida con dProducts/dCombos.
  const direct = extraContext.selected;
  // Base pública del sitio en uso
  const base = location.origin + location.pathname
    .replace(/\/(admin|vendedor)\/.*$/, '').replace(/\/[^/]*$/, '');
  const ficha = (prodId) => `${base}/catalogo.html?producto=${encodeURIComponent(prodId)}`;
  if (direct) {
    const type = extraContext.type;
    prodName = direct.name || direct.variant_name || direct.title || prodName;
    const priceUsd = Number(direct.final_price_usd ?? direct.price_usd) || 0;
    prodPrice = priceUsd ? (`$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '')) : 'Consultar';
    prodDesc = direct.description || prodDesc;
    const prodId = direct.sku || direct.raw?.sku || direct.raw?.jjp_products?.id || direct.product_id;
    prodLink = type === 'combo'
      ? `${base}/catalogo.html`
      : (prodId ? ficha(prodId) : `${base}/catalogo.html?q=${encodeURIComponent(direct.name || '')}`);
    if (direct.discount_pct) discount = String(direct.discount_pct);
  } else if (extraContext.type === 'producto' && extraContext.productId) {
    const p = dProducts.find(x => x.id === extraContext.productId);
    if (p) {
      prodName = [p.jjp_products?.name, p.jjp_brands?.name, p.variant_name].filter(Boolean).join(' · ');
      const priceUsd = Number(p.price_usd) || 0;
      prodPrice = `$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '');
      prodDesc = p.jjp_products?.description || '';
      prodLink = p.sku ? ficha(p.sku) : (p.jjp_products?.id ? ficha(p.jjp_products.id) : `${base}/catalogo.html?q=${encodeURIComponent(p.jjp_products?.name || '')}`);
    }
  } else if (extraContext.type === 'combo' && extraContext.comboId) {
    const c = dCombos.find(x => x.id === extraContext.comboId);
    if (c) {
      prodName = c.title || 'Combo Especial';
      const priceUsd = Number(c.price_usd) || 0;
      prodPrice = priceUsd ? (`$${priceUsd.toFixed(2)} USD` + (bcv ? ` (Bs ${ (priceUsd * bcv).toFixed(2) })` : '')) : 'Consultar';
      prodDesc = c.description || '';
      prodLink = `${base}/catalogo.html`;
      if (c.badge) discount = c.badge;
    }
  }

  const multiOffersText = extraContext.multiOffersText ||
    '• Resma Carta Report 75g: $4.95 USD\n• Cuaderno 1 Línea 100h: $0.85 USD\n• Marcadores Acrílicos x4: $2.10 USD';

  return {
    nombre:           name,
    empresa:          name,
    vendedor:         SELLER.name || 'su asesor comercial JJ Paper',
    descuento:        discount,
    producto:         prodName,
    precio:           prodPrice,
    descripcion:      prodDesc,
    link:             prodLink,
    productos_oferta: multiOffersText,
  };
}

function ncOnSpeedChange() {
  const mode = document.getElementById('nc-speed-mode')?.value || 'safe';
  const customWrap = document.getElementById('nc-custom-speed-wrap');
  const minIn = document.getElementById('nc-delay-min');
  const maxIn = document.getElementById('nc-delay-max');
  
  if (customWrap) customWrap.style.display = mode === 'custom' ? 'grid' : 'none';
  if (minIn && maxIn) {
    if (mode === 'safe') { minIn.value = 15; maxIn.value = 35; }
    else if (mode === 'ultra_safe') { minIn.value = 30; maxIn.value = 60; }
    else if (mode === 'moderate') { minIn.value = 8; maxIn.value = 18; }
  }
}

function dRender(body, vars) {
  let str = String(body || '').replace(/\{([^{}]+?)\}/g, (_, choices) => {
    if (choices.startsWith('{') || choices.endsWith('}')) return choices;
    const parts = choices.split('|');
    if (parts.length > 1) {
      return parts[0].trim(); // preview toma la primera opción
    }
    return choices;
  });
  return str.replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
}

function tplPreview() {
  document.getElementById('tplPreview').textContent =
    dRender(document.getElementById('tp-body').value, dSampleVars());
}

async function saveTpl() {
  const name = document.getElementById('tp-name').value.trim();
  const body = document.getElementById('tp-body').value.trim();
  if (!name || !body) { showToast('Nombre y mensaje son obligatorios', 'warn'); return; }
  let error;
  if (editingTplId) {
    ({ error } = await sb.from('jjp_wa_templates').update({ name, body }).eq('id', editingTplId));
  } else {
    ({ error } = await sb.from('jjp_wa_templates').insert({ owner_id: SELLER.id, name, body }));
  }
  if (error) { showToast('Error guardando plantilla: ' + error.message, 'err'); return; }
  showToast('Plantilla guardada ✔');
  closeDModal('tplModal');
  loadDTemplates();
}

async function deleteTpl(id) {
  if (!confirm('¿Eliminar esta plantilla? Las campañas ya lanzadas no se afectan.')) return;
  const { error } = await sb.from('jjp_wa_templates').delete().eq('id', id);
  if (error) { showToast('No se pudo eliminar', 'err'); return; }
  showToast('Plantilla eliminada');
  loadDTemplates();
}

/* ================== CAMPAÑAS ================== */
async function loadDCampaigns() {
  const isAdm = SELLER?.role === 'admin';
  let q = sb.from('jjp_wa_campaigns').select('*').order('created_at', { ascending: false }).limit(50);
  if (!isAdm && SELLER?.id) {
    q = q.eq('owner_id', SELLER.id);
  }
  const { data, error } = await q;
  if (error) { showToast('Error cargando campañas', 'err'); return; }
  dCampaigns = data || [];
  renderDCampaigns();
}

function renderDCampaigns() {
  const tbody = document.getElementById('dCampBody');
  if (!dCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin campañas todavía. Lanza la primera con "＋ Nueva campaña". 📣</td></tr>';
    return;
  }
  tbody.innerHTML = dCampaigns.map(c => {
    const isFuture = c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now();
    const [defLabel, defColor] = D_CAMP_STATUS[c.status] || [c.status, '#666'];
    const label = isFuture ? '⏰ Programada' : defLabel;
    const color = isFuture ? '#d97706' : defColor;
    const sent = c.sent_count || 0;
    const failed = c.failed_count || 0;
    const skipped = c.skipped_count || 0;
    const done = sent + failed + skipped;
    const pct = c.total ? Math.round(done / c.total * 100) : 0;
    const active = c.status === 'en_cola' || c.status === 'pending' || c.status === 'enviando' || c.status === 'sending';
    const canDelete = ['completada', 'cancelada', 'pausada', 'programada', 'completed', 'cancelled', 'paused', 'scheduled', 'failed', 'error', 'draft'].includes(c.status) || (!active);
    return `<tr class="d-camp-row" style="cursor:pointer">
      <td>
        <div class="td-name">${escapeHTML(c.name)} ${c.kind === 'reactivacion' ? '🔄' : ''}</div>
        ${c.scheduled_at && isFuture 
          ? `<div class="td-sub" style="color:#d97706;font-weight:600">⏰ Inicia: ${fmtDate(c.scheduled_at)}</div>` 
          : `<div class="td-sub">${fmtDate(c.created_at)}</div>`}
      </td>
      <td>
        <div><span style="color:${color};font-weight:600">${label}</span></div>
        ${active ? renderCampaignLiveBadge(c) : ''}
      </td>
      <td style="min-width:150px">
        <div class="d-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
             aria-label="Progreso de ${escapeHTML(c.name)}">
          <div class="d-prog-fill" style="width:${pct}%"></div>
        </div>
        <div class="td-sub d-camp-stats">
          <span class="d-stat ok">✅ ${sent}</span>
          ${failed ? `<span class="d-stat err">❌ ${failed}</span>` : ''}
          ${skipped ? `<span class="d-stat skip">⏭️ ${skipped}</span>` : ''}
          <span>${pct}%</span>
        </div>
      </td>
      <td style="text-align:center">${c.total || 0}</td>
      <td>
        <span class="d-tag d-tag-click" onclick="openCampaignDetail('${c.id}')" style="cursor:pointer">📊 Reporte</span>
      </td>
      <td><div class="td-actions" style="flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-o sm" onclick="openCampaignDetail('${c.id}')" title="Ver reporte de la campaña">📊</button>
        ${active ? `<button class="btn-o sm" onclick="setCampStatus('${c.id}','pausada')" title="Pausar envíos">⏸️</button>` : ''}
        ${c.status === 'pausada' ? `<button class="btn-p sm" onclick="setCampStatus('${c.id}','pending')" title="Reanudar envíos">▶️</button>` : ''}
        ${(active || c.status === 'pausada') ? `<button class="btn-o sm" onclick="cancelCampaign('${c.id}')" title="Cancelar campaña">✕</button>` : ''}
        ${canDelete ? `<button class="btn-o sm d-btn-del" onclick="deleteCampaign('${c.id}','${escapeHTML(c.name)}')" title="Eliminar campaña del sistema">🗑️</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function renderCampaignLiveBadge(c) {
  const isPause = c.pause_reason === 'batch_pause';
  const nextIso = c.next_send_at || '';
  const initialText = isPause ? '☕ Pausa descanso...' : (nextIso ? '⏳ Calculando...' : '⏳ En proceso...');
  const cls = isPause ? 'batch-pause' : 'interval';
  return `
    <div class="d-live-badge ${cls}" data-camp-id="${c.id}" data-next="${nextIso}" data-pause="${c.pause_reason || ''}" title="Cuenta regresiva en vivo">
      <span class="d-live-icon">${isPause ? '☕' : '⏳'}</span>
      <span class="d-live-txt">${initialText}</span>
    </div>
  `;
}

let _campaignTimerInterval = null;
function startCampaignLiveTimers() {
  if (_campaignTimerInterval) clearInterval(_campaignTimerInterval);
  _campaignTimerInterval = setInterval(updateLiveTimersTick, 1000);
}

function updateLiveTimersTick() {
  const now = Date.now();
  
  // 1. Actualizar badges en la tabla
  document.querySelectorAll('.d-live-badge[data-next]').forEach(el => {
    const nextIso = el.dataset.next;
    const isPause = el.dataset.pause === 'batch_pause';
    const txtEl = el.querySelector('.d-live-txt');
    const iconEl = el.querySelector('.d-live-icon');
    if (!txtEl) return;
    
    if (!nextIso) {
      txtEl.textContent = '⏳ Encolando...';
      return;
    }
    
    const diff = Math.max(0, Math.floor((new Date(nextIso).getTime() - now) / 1000));
    if (diff <= 0) {
      txtEl.textContent = '📤 Enviando mensaje...';
      if (iconEl) iconEl.textContent = '📤';
      return;
    }
    
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    const timeStr = `${m > 0 ? m + 'm ' : ''}${s < 10 ? '0' : ''}${s}s`;
    
    if (isPause) {
      txtEl.textContent = `Pausa: ${timeStr}`;
      if (iconEl) iconEl.textContent = '☕';
    } else {
      txtEl.textContent = `Próximo: ${timeStr}`;
      if (iconEl) iconEl.textContent = '⏳';
    }
  });

  // 2. Actualizar el modal de detalle si está abierto
  if (currentReportCampaignId) {
    const camp = dCampaigns.find(c => c.id === currentReportCampaignId);
    const wrap = document.getElementById('rd-live-timer-wrap');
    if (wrap && camp) {
      const active = camp.status === 'en_cola' || camp.status === 'pending' || camp.status === 'enviando' || camp.status === 'sending';
      if (!active) {
        wrap.style.display = 'none';
      } else {
        wrap.style.display = 'flex';
        const nextIso = camp.next_send_at;
        const isPause = camp.pause_reason === 'batch_pause';
        const digitsEl = document.getElementById('rd-live-timer-digits');
        const labelEl = document.getElementById('rd-live-timer-label');
        const iconEl = document.getElementById('rd-live-timer-icon');
        
        wrap.className = `rd-live-timer ${isPause ? 'batch-pause' : 'interval'}`;
        
        if (!nextIso) {
          if (labelEl) labelEl.textContent = 'Estado de envío:';
          if (digitsEl) digitsEl.textContent = 'Preparando...';
        } else {
          const diff = Math.max(0, Math.floor((new Date(nextIso).getTime() - now) / 1000));
          if (diff <= 0) {
            if (labelEl) labelEl.textContent = 'Estado de envío:';
            if (digitsEl) digitsEl.textContent = 'Enviando ahora...';
            if (iconEl) iconEl.textContent = '📤';
          } else {
            const m = Math.floor(diff / 60);
            const s = diff % 60;
            const timeStr = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
            if (isPause) {
              if (labelEl) labelEl.textContent = 'Pausa anti-bloqueo (descanso humano):';
              if (digitsEl) digitsEl.textContent = timeStr;
              if (iconEl) iconEl.textContent = '☕';
            } else {
              if (labelEl) labelEl.textContent = 'Próximo mensaje en:';
              if (digitsEl) digitsEl.textContent = timeStr;
              if (iconEl) iconEl.textContent = '⏳';
            }
          }
        }
      }
    }
  }
}

function updateReportModalFromCamp(camp) {
  if (!camp || camp.id !== currentReportCampaignId) return;
  const [label, color] = D_CAMP_STATUS[camp.status] || [camp.status, '#666'];
  const sent = camp.sent_count || 0;
  const failed = camp.failed_count || 0;
  const skipped = camp.skipped_count || 0;
  const pending = Math.max(0, (camp.total || 0) - sent - failed - skipped);
  const pct = camp.total ? Math.round((sent + failed + skipped) / camp.total * 100) : 0;

  const st = document.getElementById('rd-status');
  if (st) { st.textContent = label; st.style.color = color; }
  const sEl = document.getElementById('rd-sent'); if (sEl) sEl.textContent = sent;
  const fEl = document.getElementById('rd-failed'); if (fEl) fEl.textContent = failed;
  const skEl = document.getElementById('rd-skipped'); if (skEl) skEl.textContent = skipped;
  const pEl = document.getElementById('rd-pending'); if (pEl) pEl.textContent = pending;
  const pctEl = document.getElementById('rd-pct'); if (pctEl) pctEl.textContent = `${pct}%`;
  const progEl = document.getElementById('rd-prog'); if (progEl) progEl.style.width = `${pct}%`;
}

async function setCampStatus(id, status) {
  const { error } = await sb.from('jjp_wa_campaigns').update({ status }).eq('id', id);
  if (error) { showToast('No se pudo actualizar: ' + error.message, 'err'); return; }
  showToast(status === 'pausada' ? 'Campaña pausada ⏸️' : 'Campaña reanudada ▶️');
  loadDCampaigns();
}

async function cancelCampaign(id) {
  if (!confirm('¿Cancelar la campaña? Los mensajes pendientes NO se enviarán.')) return;
  await setCampStatus(id, 'cancelada');
}

/* ---- Eliminación real (RPC con CASCADE de targets) ---- */
async function deleteCampaign(id, name) {
  if (!confirm(`¿Eliminar la campaña "${name}"?\n\nSe borrarán para siempre la campaña y su registro de destinatarios del sistema. Esta acción NO se puede deshacer.`)) return;
  try {
    let ok = false;
    const { data, error } = await sb.rpc('jjp_delete_campaign', { p_campaign_id: id });
    if (!error && data === true) {
      ok = true;
    } else {
      // Fallback a borrado directo de targets y campaña
      await sb.from('jjp_wa_campaign_targets').delete().eq('campaign_id', id);
      const { error: e2 } = await sb.from('jjp_wa_campaigns').delete().eq('id', id);
      if (!e2) ok = true;
    }
    if (ok) {
      showToast('Campaña eliminada 🗑️');
      if (typeof closeDModal === 'function') closeDModal('reportModal');
      loadDCampaigns();
    } else {
      showToast('No se pudo eliminar la campaña', 'err');
    }
  } catch (e) {
    showToast('Error al eliminar: ' + e.message, 'err');
  }
}

/* ---- Reporte de campaña (resumen) ---- */
let dReportTargets = [];
let currentReportCampaignId = null;

async function openCampaignDetail(id) {
  currentReportCampaignId = id;
  const camp = dCampaigns.find(c => c.id === id);
  if (!camp) return;

  const [label, color] = D_CAMP_STATUS[camp.status] || [camp.status, '#666'];
  const sent = camp.sent_count || 0;
  const failed = camp.failed_count || 0;
  const skipped = camp.skipped_count || 0;
  const pending = Math.max(0, (camp.total || 0) - sent - failed - skipped);
  const pct = camp.total ? Math.round((sent + failed + skipped) / camp.total * 100) : 0;

  document.getElementById('rd-name').textContent = camp.name;
  document.getElementById('rd-status').textContent = label;
  document.getElementById('rd-status').style.color = color;
  document.getElementById('rd-created').textContent = fmtDate(camp.created_at);
  document.getElementById('rd-speed').textContent = camp.delay_min_s && camp.delay_max_s
    ? `Entre ${camp.delay_min_s}s y ${camp.delay_max_s}s por mensaje` : '—';
  document.getElementById('rd-attach').textContent = camp.media_filename || 'Sin adjunto';
  document.getElementById('rd-sent').textContent = sent;
  document.getElementById('rd-failed').textContent = failed;
  document.getElementById('rd-skipped').textContent = skipped;
  document.getElementById('rd-pending').textContent = pending;
  document.getElementById('rd-pct').textContent = `${pct}%`;
  document.getElementById('rd-prog').style.width = `${pct}%`;
  updateLiveTimersTick();

  const failList = document.getElementById('rd-failed-list');
  failList.innerHTML = '<span style="color:#777">Cargando...</span>';
  openDModal('reportModal');

  const { data, error } = await sb.from('jjp_wa_campaign_targets')
    .select('name,phone,status,error,sent_at,message_id,vars')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true });
  if (error) { failList.innerHTML = '<span style="color:#b91c1c">Error cargando detalle: ' + escapeHTML(error.message) + '</span>'; return; }
  dReportTargets = data || [];

  const final = ['sent', 'enviado'].includes(camp.status) || !camp.total || dReportTargets.every(t => t.status !== 'en_cola' && t.status !== 'pending');
  const badge = final ? '✅ Enviado' : '⏳ Enviando';
  const failedOnes = dReportTargets.filter(t => t.status === 'failed' || t.status === 'fallido');
  const skippedOnes = dReportTargets.filter(t => t.status === 'skipped' || t.status === 'omitido');
  const okOnes = dReportTargets.filter(t => t.status === 'sent' || t.status === 'enviado');

  let html = '';
  if (failedOnes.length) {
    html += `<div class="rd-subgroup" style="margin-bottom:14px">
      <h4 style="margin:0 0 8px;color:#b91c1c;font-size:13px">❌ Fallidos (${failedOnes.length})</h4>
      <table class="admin-table"><thead><tr><th>Contacto</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>
      ${failedOnes.map(t => `<tr><td>${escapeHTML(t.name || '—')}<div class="td-sub">${escapeHTML(t.phone || '')}</div></td><td><span style="color:#b91c1c">❌</span></td><td style="color:#b91c1c;font-size:12px">${escapeHTML(t.error || 'Error desconocido')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  if (skippedOnes.length) {
    html += `<div class="rd-subgroup" style="margin-bottom:14px">
      <h4 style="margin:0 0 8px;color:#a16207;font-size:13px">⏭️ Omitidos (${skippedOnes.length})</h4>
      <table class="admin-table"><thead><tr><th>Contacto</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>
      ${skippedOnes.map(t => `<tr><td>${escapeHTML(t.name || '—')}<div class="td-sub">${escapeHTML(t.phone || '')}</div></td><td><span style="color:#a16207">⏭️</span></td><td style="color:#a16207;font-size:12px">${escapeHTML(t.error || 'Omitido')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  if (okOnes.length) {
    html += `<div class="rd-subgroup" style="margin-top:10px">
      <h4 style="margin:0 0 8px;color:#15803d;font-size:13px">✔ Entregados (${okOnes.length})</h4>
      <table class="admin-table"><thead><tr><th>Contacto</th><th>Propuesta IA / Necesidad</th><th>Enviado</th></tr></thead><tbody>
      ${okOnes.slice(0, 50).map(t => `<tr><td>${escapeHTML(t.name || '—')}<div class="td-sub">${escapeHTML(t.phone || '')}</div></td><td>${t.vars?.detected_need ? `<span style="font-size:11px;color:#166534;font-weight:600">🎯 ${escapeHTML(t.vars.detected_need)}</span>` : '<span style="color:#64748b;font-size:11px">Estándar</span>'}</td><td style="font-size:11px;color:#64748b">${t.sent_at ? new Date(t.sent_at).toLocaleTimeString('es-VE', {hour:'2-digit',minute:'2-digit'}) : '—'}</td></tr>`).join('')}
      ${okOnes.length > 50 ? `<tr><td colspan="3" style="text-align:center;color:#64748b;font-size:11px">Mostrando 50 de ${okOnes.length} registros</td></tr>` : ''}
      </tbody></table></div>`;
  } else if (!failedOnes.length && !skippedOnes.length) {
    html += `<p style="color:#64748b;font-size:13px">Despachando campaña en segundo plano...</p>`;
  }

  failList.innerHTML = html;
}

function exportCampaignReport(campaignId) {
  if (!dReportTargets.length) { showToast('Sin datos para exportar', 'warn'); return; }
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Contacto', 'Teléfono', 'Estado', 'Motivo', 'Enviado a']];
  for (const t of dReportTargets) {
    rows.push([esc(t.name), esc(t.phone), esc(t.status), esc(t.error), t.sent_at ? new Date(t.sent_at).toLocaleString('es-VE') : '']);
  }
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-campana-${campaignId.slice(0, 8)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Reporte exportado ⬇️');
}

function deleteCampaignFromReport(id, name) {
  closeDModal('reportModal');
  deleteCampaign(id, name);
}

/* ---- Nueva campaña ---- */
function newCampaign(preTplId = null) {
  setDTab('campanas');
  if (window.CampaignEditor) {
    window.CampaignEditor.open({
      channel: 'whatsapp',
      preTplId,
      products: dProducts,
      combos: dCombos,
      templates: dTemplates,
      contacts: dContacts,
      seller: SELLER,
      onLaunch: async (config) => {
        await launchCampaignFromEditor(config);
      }
    });
    return;
  }
  // Fallback modal tradicional si el editor no estuviera disponible
  openDModal('campModal');
}

async function launchCampaignFromEditor(config) {
  const { name, body, audience, attachOpt, selectedProductOrCombo, customFile, generatedFlyerFile, delays, batchSize, batchPauseM, updateStatus } = config;
  const setStatus = (msg) => {
    if (typeof updateStatus === 'function') updateStatus(msg);
  };
  const sessionUser = (await sb.auth.getUser())?.data?.user;
  const ownerId = sessionUser?.id || SELLER?.id;

  const attachOpts = String(attachOpt || 'none').split(',').map(s => s.trim()).filter(Boolean);

  let mediaPath = null, mediaType = null, mediaMime = null, mediaFilename = null, mediaSize = null;
  let extraMediaPath = null, extraMediaType = null, extraMediaMime = null, extraMediaFilename = null, extraMediaSize = null;

  function assignMedia(m) {
    if (!mediaPath) {
      mediaPath = m.path;
      mediaType = m.type;
      mediaMime = m.mime;
      mediaFilename = m.filename;
      mediaSize = m.size;
    } else if (!extraMediaPath) {
      extraMediaPath = m.path;
      extraMediaType = m.type;
      extraMediaMime = m.mime;
      extraMediaFilename = m.filename;
      extraMediaSize = m.size;
    }
  }

  // 1. Flyer generado con IA o archivo propio subido
  if (generatedFlyerFile) {
    setStatus('🎨 Subiendo flyer promocional...');
    try {
      const fName = generatedFlyerFile.name || `Flyer_${Date.now()}.png`;
      const fPath = `${SELLER.id}/campaigns/${Date.now()}-${fName.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await sb.storage.from('jjp-wa-media')
        .upload(fPath, generatedFlyerFile, { contentType: 'image/png', upsert: true });
      if (!upErr) {
        assignMedia({ path: fPath, type: 'image', mime: 'image/png', filename: fName, size: generatedFlyerFile.size });
      }
    } catch (err) {
      console.warn('Error subiendo flyer:', err);
    }
  } else if (attachOpts.includes('custom_file') && customFile) {
    setStatus('📎 Subiendo archivo adjunto...');
    try {
      const fName = customFile.name;
      const fMime = customFile.type || 'application/octet-stream';
      const fType = customFile.type.startsWith('image/') ? 'image' : 'document';
      const fPath = `${SELLER.id}/campaigns/${Date.now()}-${fName.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await sb.storage.from('jjp-wa-media')
        .upload(fPath, customFile, { contentType: fMime, upsert: true });
      if (!upErr) {
        assignMedia({ path: fPath, type: fType, mime: fMime, filename: fName, size: customFile.size });
      }
    } catch (err) {
      console.warn('Error subiendo archivo propio:', err);
    }
  }

  // 2. Imagen / foto de producto o combo
  if (attachOpts.includes('prod_image') && selectedProductOrCombo?.image_url && (!mediaPath || !extraMediaPath)) {
    setStatus('🖼️ Preparando foto del producto...');
    try {
      const imgUrl = selectedProductOrCombo.image_url;
      const imgResp = await fetch(imgUrl);
      if (imgResp.ok) {
        let imgBlob = await imgResp.blob();
        let mime = imgBlob.type || 'image/jpeg';
        try {
          const comp = await compressImageForWhatsApp(imgBlob);
          if (comp) {
            imgBlob = comp.blob;
            mime = comp.blob.type || 'image/jpeg';
          }
        } catch (e) {}
        const fName = (selectedProductOrCombo.name || 'producto').replace(/[^\w.-]/g, '_') + '.jpg';
        const fPath = `${SELLER.id}/campaigns/${Date.now()}-${fName}`;
        const { error: upErr } = await sb.storage.from('jjp-wa-media')
          .upload(fPath, imgBlob, { contentType: mime, upsert: true });
        if (!upErr) {
          assignMedia({ path: fPath, type: 'image', mime: mime, filename: fName, size: imgBlob.size });
        }
      }
    } catch (err) {
      console.warn('Error subiendo imagen de producto:', err);
    }
  }

  // 3. Lista de precios oficial PDF
  if (attachOpts.includes('pdf_lista_precios') && (!mediaPath || !extraMediaPath)) {
    setStatus('📄 Generando lista de precios PDF...');
    try {
      if (typeof docPdfProductos === 'function') {
        const pdfPromise = docPdfProductos({ conStock: false, titulo: 'Lista de Precios Mayorista' });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo límite generando PDF')), 30000));
        const { blob, filename } = await Promise.race([pdfPromise, timeoutPromise]);
        const pdfFilename = filename || 'Lista_de_Precios_JJ_Paper.pdf';
        const pdfPath = `${SELLER.id}/campaigns/${Date.now()}-${pdfFilename}`;
        const { error: upErr } = await sb.storage.from('jjp-wa-media')
          .upload(pdfPath, blob, { contentType: 'application/pdf', upsert: true });
        if (!upErr) {
          assignMedia({ path: pdfPath, type: 'document', mime: 'application/pdf', filename: pdfFilename, size: blob.size });
        }
      }
    } catch (err) {
      console.error('Error generando/subiendo adjunto:', err);
      const continuar = confirm('⚠️ No se pudo generar el archivo adjunto.\n¿Desea continuar el envío sin adjunto?');
      if (!continuar) throw new Error('Envío cancelado por el usuario.');
    }
  }

  let payload = {
    owner_id: ownerId,
    created_by: ownerId,
    name,
    body,
    message: body,
    status: config.scheduled_at ? 'programada' : 'en_cola',
    total: audience.length,
    delay_min_s: delays?.min || 45,
    delay_max_s: delays?.max || 90,
    batch_size: batchSize || 0,
    batch_pause_m: batchPauseM || 5
  };

  if (config.scheduled_at) {
    payload.scheduled_at = config.scheduled_at;
  }

  if (mediaPath) {
    payload.media_path = mediaPath;
    payload.media_type = mediaType;
    payload.media_mime = mediaMime;
    payload.media_filename = mediaFilename;
    payload.media_size = mediaSize;
  }

  if (extraMediaPath) {
    payload.extra_media_path = extraMediaPath;
    payload.extra_media_type = extraMediaType;
    payload.extra_media_mime = extraMediaMime;
    payload.extra_media_filename = extraMediaFilename;
    payload.extra_media_size = extraMediaSize;
  }

  setStatus('💾 Guardando campaña...');
  let { data: camp, error } = await sb.from('jjp_wa_campaigns').insert(payload).select('id').single();
  if (error) {
    console.error('Error insertando campaña:', error);
    showToast('Error creando campaña: ' + error.message, 'err');
    throw error;
  }

  const extra = {
    productId: selectedProductOrCombo?.id,
    comboId: selectedProductOrCombo?.id,
    type: selectedProductOrCombo?.type || 'general',
    selected: selectedProductOrCombo
  };

  const targets = audience.filter(c => {
    if (!c.phone) return false;
    if (c.wa_opt_out || c.opt_out) return false;
    if (typeof parsePhoneInfo === 'function') {
      const p = parsePhoneInfo(c.phone);
      return p.isValid && p.isMobile && !p.isLandline;
    }
    const d = String(c.phone).replace(/\D/g, '');
    const isLand = /^(?:58|0)?(?:2\d{2})\d{7}$/.test(d);
    return !isLand && d.length >= 10;
  }).map(c => ({
    campaign_id: camp.id,
    owner_id: ownerId,
    customer_id: c.id || null,
    phone: c.phone,
    name: c.name,
    status: 'en_cola',
    vars: {
      ...dSampleVars(c.name, extra),
      custom_message: c._custom_message || null,
      custom_body: c._custom_message || null,
      detected_need: c._detected_need || null,
      detected_sector: c._detected_sector || null
    }
  }));

  for (let i = 0; i < targets.length; i += 100) {
    setStatus(`👥 Guardando destinatarios (${Math.min(i + 100, targets.length)} de ${targets.length})...`);
    let { error: e2 } = await sb.from('jjp_wa_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) {
      console.error('Error insertando destinatarios:', e2);
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
      status: 'contactado_wa',
      last_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    for (const pid of pIds) {
      sb.from('jjp_prospects').update(updatePayload).eq('id', pid).then(() => {}).catch(e => console.warn('Aviso prospecto:', e));
    }
  }

  showToast('¡Campaña lanzada con éxito! 🚀 Despachando en segundo plano.');
  loadDCampaigns();
}

function ncOnTypeChange() {
  const type = document.getElementById('nc-type').value;
  const prodWrap = document.getElementById('nc-prod-wrap');
  const comboWrap = document.getElementById('nc-combo-wrap');
  if (prodWrap) prodWrap.style.display = type === 'producto' ? '' : 'none';
  if (comboWrap) comboWrap.style.display = type === 'combo' ? '' : 'none';
  ncRefresh();
}

function ncGetExtraContext() {
  const type = document.getElementById('nc-type')?.value || 'general';
  const productId = document.getElementById('nc-prod-select')?.value || null;
  const comboId = document.getElementById('nc-combo-select')?.value || null;
  return { type, productId, comboId };
}

function ncAudience() {
  const aud = document.getElementById('nc-aud').value;
  const tag = document.getElementById('nc-tag').value.trim().toLowerCase();
  const inactDays = parseInt(APP.SETTINGS?.wa_react_days, 10) || 60;
  let list = dContacts.filter(c => {
    if (!c.phone || c.wa_opt_out) return false;
    const pInfo = typeof parsePhoneInfo === 'function'
      ? parsePhoneInfo(c.phone)
      : { isMobile: !/^(?:58|0)?(?:2\d{2})\d{7}$/.test((c.phone || '').replace(/\D/g, '')) && (c.phone || '').replace(/\D/g, '').length >= 10 };
    return pInfo.isMobile;
  });
  if (aud === 'email_bounced') {
    list = list.filter(c => {
      const hasBounced = c.email_status === 'bounced' || c.email_status === 'bounced_hard' || c.email_status === 'bounced_soft';
      const noEmail = !c.email || !String(c.email).trim();
      return (hasBounced || noEmail);
    });
  } else if (aud === 'inactivos')  list = list.filter(c => c.total_orders > 0 && c.last_order_at &&
      (Date.now() - new Date(c.last_order_at).getTime()) > inactDays * 86400e3);
  else if (aud === 'prospectos') list = list.filter(c => !c.total_orders);
  else if (aud === 'etiqueta')   list = list.filter(c => (c.tags || []).map(t => t.toLowerCase()).includes(tag));
  return list;
}

function ncRefresh() {
  document.getElementById('nc-tag-wrap').style.display =
    document.getElementById('nc-aud').value === 'etiqueta' ? '' : 'none';
  const list = ncAudience();
  const tpl  = dTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const extra = ncGetExtraContext();

  document.getElementById('ncCount').textContent =
    list.length ? `Se enviará a ${list.length} contacto(s), uno por uno con pausa aleatoria.` : 'Ningún contacto coincide con esa audiencia.';
  document.getElementById('ncPreview').textContent =
    tpl ? dRender(tpl.body, dSampleVars(list[0]?.name || 'María González', extra)) : '';
  document.getElementById('ncLaunchBtn').disabled = !list.length || !tpl;
}

function ncOnAttachChange() {
  const opt = document.getElementById('nc-attach-opt')?.value || 'none';
  const customWrap = document.getElementById('nc-custom-file-wrap');
  const statusEl = document.getElementById('nc-attach-status');
  if (customWrap) customWrap.style.display = opt === 'custom_file' ? '' : 'none';
  
  if (statusEl) {
    if (opt === 'pdf_lista_precios') {
      statusEl.textContent = '📄 Se generará el PDF oficial de Lista de Precios con los colores de JJ Paper y precios vigentes en USD y Bs BCV.';
    } else if (opt === 'prod_image') {
      const extra = ncGetExtraContext();
      const prod = dProducts.find(p => p.id === extra.productId);
      const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
      if (imgUrl) {
        statusEl.textContent = `🖼️ Se adjuntará la imagen de: ${prod.jjp_products?.name || prod.variant_name || 'producto'}`;
      } else {
        statusEl.textContent = '⚠️ El producto seleccionado no tiene imagen registrada; se enviará solo texto o selecciona otra opción.';
      }
    } else if (opt === 'custom_file') {
      statusEl.textContent = '📁 Selecciona un archivo PDF o imagen desde tu equipo.';
    } else {
      statusEl.textContent = '';
    }
  }
}

async function launchCampaign() {
  const btn = document.getElementById('ncLaunchBtn');
  const name = document.getElementById('nc-name').value.trim();
  const list = ncAudience();
  const tpl  = dTemplates.find(t => t.id === document.getElementById('nc-tpl').value);
  const extra = ncGetExtraContext();
  const attachOpt = document.getElementById('nc-attach-opt')?.value || 'none';

  const delayMin = parseInt(document.getElementById('nc-delay-min')?.value, 10) || 15;
  const delayMax = parseInt(document.getElementById('nc-delay-max')?.value, 10) || 35;

  if (!name) { showToast('El nombre de la campaña es obligatorio', 'warn'); return; }
  if (!tpl)  { showToast('Selecciona una plantilla', 'warn'); return; }
  if (!list.length) { showToast('No hay destinatarios en esta audiencia', 'warn'); return; }

  btn.disabled = true;
  let mediaPath = null, mediaType = null, mediaMime = null, mediaFilename = null, mediaSize = null;

  if (attachOpt === 'pdf_lista_precios') {
    btn.textContent = 'Generando catálogo PDF…';
    try {
      if (typeof docPdfProductos !== 'function') throw new Error('Motor de documentos no disponible.');
      const { blob, filename } = await docPdfProductos({ conStock: false, titulo: 'Lista de Precios Mayorista' });
      mediaFilename = filename || 'Lista_de_Precios_JJ_Paper.pdf';
      mediaMime = 'application/pdf';
      mediaType = 'document';
      mediaSize = blob.size;
      mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${mediaFilename}`;
      const { error: upErr } = await sb.storage.from('jjp-wa-media')
        .upload(mediaPath, blob, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error('No se pudo guardar el PDF: ' + upErr.message);
    } catch (err) {
      showToast('Error generando PDF: ' + err.message, 'err');
      btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
      return;
    }
  } else if (attachOpt === 'prod_image' && extra.productId) {
    const prod = dProducts.find(x => x.id === extra.productId);
    const imgUrl = prod?.jjp_products?.image_url || prod?.image_url;
    if (imgUrl) {
      btn.textContent = 'Descargando imagen del producto…';
      try {
        const imgResp = await fetch(imgUrl);
        if (!imgResp.ok) throw new Error('No se pudo descargar la imagen del producto');
        let imgBlob = await imgResp.blob();
        try {
          const comp = await compressImageForWhatsApp(imgBlob);
          if (comp) { imgBlob = comp.blob; mediaMime = comp.blob.type || 'image/jpeg'; }
        } catch (e) { console.warn('no se pudo comprimir imagen de campaña', e); }
        mediaFilename = (prod.jjp_products?.name || prod.variant_name || 'producto').replace(/[^\w.-]/g, '_') + '.jpg';
        mediaType = 'image';
        mediaSize = imgBlob.size;
        mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${mediaFilename}`;
        const { error: upErr } = await sb.storage.from('jjp-wa-media')
          .upload(mediaPath, imgBlob, { contentType: mediaMime, upsert: true });
        if (upErr) throw new Error('No se pudo subir la imagen: ' + upErr.message);
      } catch (err) {
        showToast('Error con la imagen del producto: ' + err.message, 'err');
        btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
        return;
      }
    }
  } else if (attachOpt === 'custom_file') {
    const file = document.getElementById('nc-custom-file')?.files?.[0];
    if (file) {
      btn.textContent = 'Subiendo archivo…';
      try {
        mediaFilename = file.name;
        mediaMime = file.type || 'application/octet-stream';
        mediaType = file.type.startsWith('image/') ? 'image' : 'document';
        mediaSize = file.size;
        mediaPath = `${SELLER.id}/campaigns/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const { error: upErr } = await sb.storage.from('jjp-wa-media')
          .upload(mediaPath, file, { contentType: mediaMime, upsert: true });
        if (upErr) throw new Error('No se pudo subir el archivo: ' + upErr.message);
      } catch (err) {
        showToast('Error subiendo archivo: ' + err.message, 'err');
        btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
        return;
      }
    }
  }

  const sessionUser = (await sb.auth.getUser())?.data?.user;
  const ownerId = sessionUser?.id || SELLER?.id;
  const isRealUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tpl.id);
  
  let payload = {
    owner_id: ownerId,
    created_by: ownerId,
    name,
    template_id: isRealUuid ? tpl.id : null,
    body: tpl.body,
    message: tpl.body,
    status: 'en_cola',
    total: list.length,
    delay_min_s: delayMin,
    delay_max_s: Math.max(delayMin + 1, delayMax)
  };

  if (mediaPath) {
    payload.media_path = mediaPath;
    payload.media_type = mediaType;
    payload.media_mime = mediaMime;
    payload.media_filename = mediaFilename;
    payload.media_size = mediaSize;
  }

  let { data: camp, error } = await sb.from('jjp_wa_campaigns').insert(payload).select('id').single();

  // Nota: con el schema reparado ya no hace falta reintento inteligente.
  // Si falla es un error real, no de schema.
  if (error) {
    console.error('Error creando campaña:', error);
  }

  if (error) {
    console.error('Error final creando campaña:', error);
    showToast('Error creando campaña: ' + (error.message || error.details || JSON.stringify(error)), 'err');
    btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
    return;
  }

  const targets = list.filter(c => {
    if (!c.phone) return false;
    if (c.wa_opt_out || c.opt_out) return false;
    if (typeof parsePhoneInfo === 'function') {
      const p = parsePhoneInfo(c.phone);
      return p.isValid && p.isMobile && !p.isLandline;
    }
    const d = String(c.phone).replace(/\D/g, '');
    const isLand = /^(?:58|0)?(?:2\d{2})\d{7}$/.test(d);
    return !isLand && d.length >= 10;
  }).map(c => ({
    campaign_id: camp.id,
    owner_id: ownerId,
    customer_id: c.id || null,
    phone: c.phone,
    name: c.name,
    status: 'en_cola',
    vars: dSampleVars(c.name, extra),
  }));

  for (let i = 0; i < targets.length; i += 100) {
    let { error: e2 } = await sb.from('jjp_wa_campaign_targets').insert(targets.slice(i, i + 100));
    if (e2) {
      console.error('Error insertando destinatarios:', e2);
      showToast('Error cargando destinatarios: ' + e2.message, 'err');
      break;
    }
  }

  btn.disabled = false; btn.textContent = '🚀 Lanzar campaña';
  showToast('Campaña lanzada 🚀 — wa-server la despachará automáticamente con su adjunto');
  closeDModal('campModal');
  loadDCampaigns();
}

/* ---------- modales (foco + ESC, convención a11y del proyecto) ---------- */
let dLastFocus = null;
function openDModal(id) {
  dLastFocus = document.activeElement;
  const m = document.getElementById(id);
  m.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(m.querySelector('.modal-box'));
  m.querySelector('input,textarea,select,button')?.focus();
}
function closeDModal(id) {
  document.getElementById(id).classList.remove('op');
  dLastFocus?.focus?.();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay.op').forEach(m => closeDModal(m.id));
});

/* ---- Compresión de imagen para adjuntos de campaña (WhatsApp ~5MB) ---- */
async function compressImageForWhatsApp(blob, maxSide = 1200) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const toBlob = (t, q) => new Promise(res => canvas.toBlob(res, t, q));
    let out = await toBlob('image/webp', 0.82);
    if (out) return { blob: out };
    out = await toBlob('image/jpeg', 0.85);
    if (out) return { blob: out };
  } catch (e) { console.warn('compressImageForWhatsApp: fallback al original', e); }
  return null;
}

