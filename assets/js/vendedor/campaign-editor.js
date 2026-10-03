/**
 * JJ Paper — Editor Chat-Like de Campañas (WhatsApp y Email)
 * assets/js/vendedor/campaign-editor.js
 *
 * Flujo Completo Asistido por IA:
 * - Análisis prospecto por prospecto (detecta necesidad, rubro y qué ofrecerle)
 * - Redacción hiper-personalizada por cliente (WhatsApp y Email)
 * - Formato comercial de alto impacto (*Negritas*, emojis de negocio, viñetas, dobles saltos)
 * - Mención y adjunto de la Lista de Precios Mayorista Oficial (PDF)
 * - Variaciones anti-spam (Spintax) y ritmo humano (45-90s aleatorio + descansos)
 * - Selección de prospectos individuales de la cartera con búsqueda y filtros
 * - Revisión, edición manual y regeneración con IA cliente por cliente antes de enviar
 */

window.CampaignEditor = (() => {
  let activeOverlay = null;
  let currentConfig = null;
  let editorMode = 'ai'; // 'ai' | 'template'
  let selectedAudienceList = [];
  let selectedProductOrCombo = null;
  let selectedProductsList = [];
  let generatedFlyerFile = null;
  let cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set(), details: new Map() };
  let recentQuotesMap = new Map();   // customer_id | phone | email -> quote
  let recentRepliesMap = new Map();  // customer_id | phone | email -> reply
  let knownNoWaPhones = new Set();
  let cooldownHours = 72;
  let cooldownLoading = null;
  let currentLoadedCooldownHours = null;
  let currentLoadedChannel = null;

  // Estado del flujo IA
  let activePreviewIdx = 0;
  let activeRightTab = 'simulator'; // 'simulator' | 'prospects'
  let isAnalyzingBatch = false;
  let manualSelectedIds = null; // null = filtro automático; Set = selección manual de IDs
  let pickerDraftIds = new Set();
  let pickerSearchQuery = '';
  let pickerQuickFilter = 'todos';
  let editingCustomerIdx = -1;

  function isMobileNum(num) {
    if (!num) return false;
    const d = String(num).replace(/\D/g, '');
    const isLandline = /^(?:58|0)?(?:2\d{2})\d{7}$/.test(d);
    const isVeMobile = /^(?:58)?0?4(12|14|24|16|26)\d{7}$/.test(d);
    const isIntlMobile = d.length >= 11 && !d.startsWith('0') && !isLandline;
    return (isVeMobile || isIntlMobile) && !isLandline;
  }

  function getBestMobilePhone(p) {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (isMobileNum(p.phone_2)) return p.phone_2;
    if (isMobileNum(p.phone_1)) return p.phone_1;
    if (isMobileNum(p.phone)) return p.phone;
    return p.phone_2 || p.phone_1 || p.phone || '';
  }

  window.isLikelyMobile = isMobileNum;
  window.getBestMobilePhone = getBestMobilePhone;

  function normPhoneKey(p) {
    return String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  }

  // Descarga contactos con envíos recientes para respetar cooldown anti-spam,
  // cotizaciones activas de los últimos 30 días y respuestas recibidas
  async function reloadCooldown(force = false) {
    const isEmail = currentConfig?.channel === 'email';
    const hoursSelectVal = document.getElementById('ceCooldownHours')?.value;
    const hours = hoursSelectVal !== undefined ? parseInt(hoursSelectVal, 10) : parseInt(APP?.SETTINGS?.[isEmail ? 'email_camp_cooldown_h' : 'wa_camp_cooldown_h'] || 72, 10);
    cooldownHours = hours;

    if (!force && currentLoadedCooldownHours === hours && currentLoadedChannel === currentConfig?.channel && cooldownExcluded.customer.size > 0) {
      return;
    }
    currentLoadedCooldownHours = hours;
    currentLoadedChannel = currentConfig?.channel;

    cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set(), details: new Map() };
    recentQuotesMap = new Map();
    recentRepliesMap = new Map();
    knownNoWaPhones = new Set();

    // 1. Cargar envíos recientes de campañas si cooldown está activo (> 0 horas)
    if (hours > 0) {
      const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
      const table = isEmail ? 'jjp_email_campaign_targets' : 'jjp_wa_campaign_targets';
      const valueField = isEmail ? 'to_addr' : 'phone';
      try {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from(table)
            .select(`customer_id, ${valueField}, sent_at, created_at, status`)
            .gte('created_at', cutoff)
            .range(from, from + 999);
          if (error) break;
          for (const r of data || []) {
            const timeAt = r.sent_at || r.created_at;
            if (r.customer_id) {
              cooldownExcluded.customer.add(r.customer_id);
              cooldownExcluded.details.set(r.customer_id, { at: timeAt, channel: isEmail ? 'email' : 'wa' });
            }
            if (isEmail && r.to_addr) {
              const ek = String(r.to_addr).toLowerCase().trim();
              cooldownExcluded.email.add(ek);
              cooldownExcluded.details.set(ek, { at: timeAt, channel: 'email' });
            } else if (!isEmail && r.phone) {
              const pk = normPhoneKey(r.phone);
              cooldownExcluded.phone.add(pk);
              cooldownExcluded.details.set(pk, { at: timeAt, channel: 'wa' });
            }
          }
          if (!data || data.length < 1000) break;
        }
      } catch (ce) {
        console.warn('Aviso cargando cooldown de campañas:', ce);
      }
    }

    // 2. Cargar cotizaciones de los últimos 30 días para saber a quién se le ha cotizado
    try {
      const quoteCutoff = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
      const { data: qData } = await sb.from('jjp_quotes')
        .select('id, quote_number, client_name, customer_id, phone, email, estimated_total_usd, status, created_at')
        .gte('created_at', quoteCutoff)
        .order('created_at', { ascending: false })
        .limit(1000);
      for (const q of qData || []) {
        if (q.customer_id && !recentQuotesMap.has(q.customer_id)) recentQuotesMap.set(q.customer_id, q);
        if (q.phone) {
          const pk = normPhoneKey(q.phone);
          if (!recentQuotesMap.has(pk)) recentQuotesMap.set(pk, q);
        }
        if (q.email) {
          const ek = String(q.email).toLowerCase().trim();
          if (!recentQuotesMap.has(ek)) recentQuotesMap.set(ek, q);
        }
      }
    } catch (qe) {
      console.warn('Aviso cargando cotizaciones recientes:', qe);
    }

    // 3. Cargar respuestas recientes (Gmail y WhatsApp) de los últimos 30 días
    try {
      const replyCutoff = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
      const { data: eReplies } = await sb.from('jjp_emails')
        .select('id, customer_id, from_addr, to_addr, subject, snippet, created_at')
        .eq('direction', 'in')
        .gte('created_at', replyCutoff)
        .order('created_at', { ascending: false })
        .limit(500);
      for (const er of eReplies || []) {
        if (er.customer_id && !recentRepliesMap.has(er.customer_id)) {
          recentRepliesMap.set(er.customer_id, { channel: 'email', subject: er.subject, at: er.created_at, snippet: er.snippet });
        }
        const m = /<([^>]+)>/.exec(er.from_addr || '');
        const addr = (m ? m[1] : er.from_addr || '').toLowerCase().trim();
        if (addr && !recentRepliesMap.has(addr)) {
          recentRepliesMap.set(addr, { channel: 'email', subject: er.subject, at: er.created_at, snippet: er.snippet });
        }
      }
    } catch (re) {
      console.warn('Aviso cargando respuestas de correo:', re);
    }
  }

  function initModal() {
    if (document.getElementById('campEditorOverlay')) return;

    const div = document.createElement('div');
    div.id = 'campEditorOverlay';
    div.className = 'camp-editor-overlay';
    div.innerHTML = `
      <div class="camp-editor-modal">
        <!-- Topbar -->
        <div class="ce-topbar">
          <div class="ce-title-box">
            <span class="ce-channel-badge" id="ceBadge">📱 WhatsApp</span>
            <input type="text" class="ce-name-input" id="ceCampName" placeholder="Nombre de la campaña..." value="Nueva Campaña">
          </div>
          <button class="ce-close-btn" onclick="CampaignEditor.close()" title="Cerrar">✕</button>
        </div>

        <!-- Body -->
        <div class="ce-body">
          <!-- Config Panel (Left) -->
          <div class="ce-config-pane">
            <!-- Selector de Modo de Creación -->
            <div class="ce-mode-tabs">
              <button type="button" class="ce-mode-tab active" id="ceTabModeAi" onclick="CampaignEditor.setEditorMode('ai')">
                🤖 Modo IA Personalizado
              </button>
              <button type="button" class="ce-mode-tab" id="ceTabModeTpl" onclick="CampaignEditor.setEditorMode('template')">
                📝 Plantilla Base
              </button>
            </div>

            <!-- Plantilla Base (Visible en Modo Plantilla) -->
            <div class="ce-section" id="ceSectionTemplate" style="display:none;">
              <div class="ce-section-title">
                <span>📝 Plantilla Base</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTemplateSelect" onchange="CampaignEditor.onTemplateChange()"></select>
              </div>
            </div>

            <!-- Enfoque Comercial y Catálogo -->
            <div class="ce-section">
              <div class="ce-section-title">
                <span>🎯 Enfoque Comercial y Catálogo</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTypeSelect" onchange="CampaignEditor.onTypeChange()">
                  <option value="general">📣 General / Propuesta según Rubro del Cliente</option>
                  <option value="producto">📦 Promoción de un Producto Específico</option>
                  <option value="multi_oferta">🔥 Ofertas / Catálogo Multi-Producto (Sin límite)</option>
                  <option value="combo">🎁 Promoción de un Combo / Oferta Especial</option>
                  <option value="reactivacion">😴 Reactivación de Clientes Inactivos</option>
                </select>
              </div>
              
              <div id="cePickerTriggerWrap" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">
                <button type="button" class="ce-var-btn" style="flex:1; min-width:115px; background:#f0fdf4; color:#166534; border-color:#86efac; font-weight:600; padding:6px 10px;" onclick="CampaignEditor.openCatalogPicker('product')">
                  📦 1 Producto
                </button>
                <button type="button" class="ce-var-btn" style="flex:1; min-width:125px; background:#fff7ed; color:#c2410c; border-color:#fed7aa; font-weight:600; padding:6px 10px;" onclick="CampaignEditor.openCatalogPicker('multi')">
                  🔥 Multi-Ofertas
                </button>
                <button type="button" class="ce-var-btn" style="flex:1; min-width:180px; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-weight:700; padding:6px 10px;" onclick="CampaignEditor.openAiOfferBuilderModal()">
                  🤖 Cargar con IA / Archivo
                </button>
                <button type="button" class="ce-var-btn" style="flex:1; min-width:115px; background:#fdf2f8; color:#9d174d; border-color:#fbcfe8; font-weight:600; padding:6px 10px;" onclick="CampaignEditor.openCatalogPicker('combo')">
                  🎁 Combo / Promo
                </button>
              </div>

              <div id="ceSelectedCardWrap" style="display:none; margin-top:8px;"></div>

              <!-- Estrategia B2B: Sector, Tono y Gancho de Propuesta Comercial -->
              <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #cbd5e1; display:flex; flex-direction:column; gap:8px;">
                <div>
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:2px">🏢 Sector / Rubro Objetivo:</label>
                  <select class="ce-select" id="ceTargetSector" onchange="CampaignEditor.onSectorStrategyChange()">
                    <option value="auto" selected>🎯 Detección Inteligente (según cada cuenta)</option>
                    <option value="colegios">🏫 Colegios, Universidades & Educación</option>
                    <option value="clinicas">🏥 Clínicas, Salud & Archivo Médico</option>
                    <option value="oficinas">🏢 Empresas, Oficinas & Corporativo</option>
                    <option value="retail">🛒 Supermercados, Abastos & Cajas POS</option>
                    <option value="logistica">📦 Industrias, Almacenes & Logística</option>
                    <option value="papelerias">📚 Papelerías & Comercios (Mayorista Reventa)</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:2px">🎭 Tono & Actitud Comercial:</label>
                  <select class="ce-select" id="ceCommercialTone">
                    <option value="socio_estrategico" selected>💼 Ejecutivo & Socio Estratégico (Seguridad y Factura BCV)</option>
                    <option value="oportunidad_mayorista">🔥 Oferta Mayorista & Volumen (Actitud de Cierre y Ahorro)</option>
                    <option value="cercano_consultivo">🤝 Cercano, Asesor y Resolutivo (Atención directa y Sourcing)</option>
                    <option value="institucional_formal">🏢 Institucional Formal (Procura y Compras)</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:2px">⭐ Propuesta de Valor / Gancho Principal:</label>
                  <select class="ce-select" id="ceValueHook">
                    <option value="importador_directo" selected>🏭 Importador Directo en Caracas (Mejores precios sin intermediarios)</option>
                    <option value="escala_volumen">📦 Escala y Descuento por Volumen (Ahorro por bulto/caja)</option>
                    <option value="sourcing_especial">🔍 Búsqueda de Insumos Especiales ("Te conseguimos lo que no esté en lista")</option>
                    <option value="despacho_express">🚚 Despacho Express 24h + Facturación Fiscal BCV</option>
                    <option value="ahorro_mensual">💰 Optimización de Presupuesto Mensual de Suministros</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Audiencia y Destinatarios -->
            <div class="ce-section">
              <div class="ce-section-title">
                <span>📇 Audiencia y Destinatarios</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceAudienceSelect" onchange="CampaignEditor.onAudienceChange()">
                  <option value="todos">🌐 Toda la Cartera (Clientes + Prospectos B2B)</option>
                  <option value="prospectos_b2b">🎯 Solo Cartera de Prospectos B2B (Leads Corporativos)</option>
                  <option value="solo_clientes">🏢 Solo Cartera Clientes Formales (jjp_customers)</option>
                  <option value="con_cotizacion">📑 Clientes con Cotización Reciente (Hacer Seguimiento)</option>
                  <option value="respondieron">💬 Clientes/Prospectos que han Respondido</option>
                  <option value="inactivos">😴 Inactivos (sin compras &gt;30d)</option>
                  <option value="prospectos">🆕 Clientes sin compras</option>
                  <option value="email_bounced">⚠️ Clientes con Email Rebotado / Sin Email</option>
                  <option value="sector">🏢 Filtrar por Sector B2B...</option>
                  <option value="etiqueta">🔖 Por etiqueta / zona...</option>
                </select>
              </div>
              <div class="ce-field-group" id="ceSectorWrap" style="display:none; margin-top:4px;">
                <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:2px">Selecciona el sector B2B:</label>
                <select class="ce-select" id="ceSectorSelect" onchange="CampaignEditor.onAudienceChange()"></select>
              </div>
              <div class="ce-field-group" id="ceTagWrap" style="display:none;">
                <input type="text" class="ce-input" id="ceTagInput" placeholder="Ej: 004, mayoristas..." oninput="CampaignEditor.onAudienceChange()">
              </div>

              <div style="margin-top:6px; display:flex; gap:6px;">
                <button type="button" class="ce-var-btn" style="flex:1; background:#f8fafc; border-color:#cbd5e1; font-weight:700; padding:6px 10px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="CampaignEditor.openProspectPicker()">
                  <span>👥 Seleccionar / Ver Destinatarios</span>
                  <span class="ce-badge-pill" id="ceSelectedProspectsBadge">0</span>
                </button>
              </div>
              
              <!-- Filtro Anti-Fatiga y Cooldown Avanzado -->
              <div style="margin-top:10px; padding:10px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px;">
                <div style="font-size:12px; font-weight:700; color:#1e293b; margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">
                  <span>🛡️ Filtro Anti-Fatiga y Cooldown</span>
                  <span class="ce-badge-pill" id="ceCooldownBadge" style="background:#fee2e2;color:#991b1b;display:none;">0 omitidos</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                  <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#1e293b;cursor:pointer;font-weight:600;">
                    <input type="checkbox" id="ceApplyCooldown" onchange="CampaignEditor.onAudienceChange()" checked>
                    <span>Omitir contactados recientemente:</span>
                  </label>
                  <select class="ce-select" id="ceCooldownHours" onchange="CampaignEditor.onAudienceChange()" style="font-size:12px; padding:4px 8px; background:#fff;">
                    <option value="24">⏱️ En las últimas 24 horas (1 día)</option>
                    <option value="72" selected>⏱️ En los últimos 3 días (72h — Recomendado)</option>
                    <option value="168">⏱️ En los últimos 7 días (1 semana)</option>
                    <option value="360">⏱️ En los últimos 15 días (2 semanas)</option>
                    <option value="720">⏱️ En los últimos 30 días (1 mes)</option>
                  </select>
                  <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#0369a1;cursor:pointer;margin-top:2px;">
                    <input type="checkbox" id="ceExcludeQuoted" onchange="CampaignEditor.onAudienceChange()">
                    <span>📑 Omitir clientes con cotización reciente (&lt;30d)</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Adjuntos de Campaña -->
            <div class="ce-section">
              <div class="ce-section-title">
                <span>📎 Adjuntos de Campaña</span>
              </div>
              <div class="ce-field-group">
                <div id="ceAttachCheckboxes" style="margin-top:2px;">
                  <label style="display:flex;align-items:center;font-size:12.5px;color:#1e293b;padding:4px 0;cursor:pointer;font-weight:600">
                    <input type="checkbox" id="ceAttachPdf" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px" checked>
                    <span>📄 Adjuntar Lista de Precios PDF Oficial (+900 arts)</span>
                  </label>
                  <label style="display:flex;align-items:center;font-size:12.5px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachImg" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>🖼️ Ficha / Foto del Producto o Flyer</span>
                  </label>
                  <label style="display:flex;align-items:center;font-size:12.5px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachFile" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>📁 Subir Archivo Propio (PDF / Imagen)</span>
                  </label>
                </div>
              </div>
              <div id="ceCustomFileWrap" style="display:none; margin-top:6px;">
                <input type="file" id="ceCustomFileInput" class="ce-input" accept=".pdf,image/*" onchange="CampaignEditor.onCustomFileChange(this)">
              </div>
            </div>

            <!-- Ritmo Humano y Anti-Baneo -->
            <div class="ce-section" id="ceSecuritySection">
              <div class="ce-section-title">
                <span>🛡️ Ritmo Humano y Anti-Baneo WA</span>
              </div>
              <div class="ce-field-group">
                <label style="font-size:11px;color:#475569;font-weight:600;display:block;margin-bottom:2px">Intervalo entre cada mensaje:</label>
                <select class="ce-select" id="ceSpeedSelect">
                  <option value="human" selected>☕ Humano natural (45 - 90 seg aleatorio)</option>
                  <option value="safe">🐢 Seguro y prudente (25 - 55 seg aleatorio)</option>
                  <option value="ultra_safe">🛡️ Máxima protección (60 - 120 seg aleatorio)</option>
                  <option value="fast">⚡ Moderado (15 - 30 seg aleatorio)</option>
                </select>
              </div>
              <div class="ce-field-group" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
                <div>
                  <label style="font-size:11px;color:#475569;font-weight:600;display:block;margin-bottom:2px">Pausa cada:</label>
                  <select class="ce-select" id="ceBatchSizeSelect">
                    <option value="10" selected>10 mensajes</option>
                    <option value="15">15 mensajes</option>
                    <option value="20">20 mensajes</option>
                    <option value="5">5 mensajes (cauteloso)</option>
                    <option value="0">Sin pausa larga</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;color:#475569;font-weight:600;display:block;margin-bottom:2px">Descanso de:</label>
                  <select class="ce-select" id="ceBatchPauseSelect">
                    <option value="5" selected>☕ 5 minutos</option>
                    <option value="10">☕ 10 minutos</option>
                    <option value="15">☕ 15 minutos</option>
                    <option value="3">☕ 3 minutos</option>
                  </select>
                </div>
              </div>
              <div style="font-size:11px;color:#166534;margin-top:4px;line-height:1.3;background:#f0fdf4;padding:6px 8px;border-radius:6px;border:1px solid #bbf7d0">
                🛡️ <strong>Protección Anti-Baneo activa</strong>: Mensajes únicos generados por IA + Spintax dinámico + descansos humanos.
              </div>
            </div>

            <!-- Programación Opcional -->
            <div class="ce-section" id="ceScheduleSection">
              <div class="ce-section-title">
                <span>📅 Programar Envío (Opcional)</span>
              </div>
              <div class="ce-field-group">
                <label style="font-size:11px;color:#475569;font-weight:600;display:block;margin-bottom:2px">Fecha y hora de inicio:</label>
                <input type="datetime-local" class="ce-input" id="ceScheduledAt" style="font-size:12px">
                <div style="font-size:10.5px;color:#64748b;margin-top:3px;line-height:1.3">
                  ⏰ Déjalo vacío para iniciar de inmediato al despachar.
                </div>
              </div>
            </div>
          </div>

          <!-- Panel Derecho: Simulador y Análisis IA -->
          <div class="ce-chat-pane" id="ceChatPane">
            <!-- Barra de Flujo IA Superior -->
            <div class="ce-ai-flow-bar" id="ceAiFlowBar">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:20px">✨</span>
                  <div>
                    <div style="font-weight:700;font-size:13px;color:#16604A">Análisis Inteligente por Cliente</div>
                    <div style="font-size:11px;color:#475569" id="ceAiFlowStatusTxt">Examina el rubro de cada prospecto, detecta su necesidad y redacta su propuesta única.</div>
                  </div>
                </div>
                <button type="button" class="ce-ai-analyze-btn" id="ceStartAiAnalysisBtn" onclick="CampaignEditor.openAiToneModal()">
                  ⚡ Analizar y Redactar con IA (<span id="ceAnalyzeCountSpan">0</span>)
                </button>
              </div>
              <div class="ce-progress-bar-wrap" id="ceAiProgressWrap" style="display:none;margin-top:6px;">
                <div class="ce-progress-bar" id="ceAiProgressBar" style="width:0%"></div>
                <div class="ce-progress-label" id="ceAiProgressLabel">Iniciando análisis...</div>
              </div>
            </div>

            <!-- Subpestañas Derechas (Simulador vs Lista de Prospectos) -->
            <div class="ce-right-subtabs" id="ceRightSubtabs">
              <button type="button" class="ce-subtab active" id="ceSubtabSim" onclick="CampaignEditor.switchRightTab('simulator')">
                📱 Simulador en Vivo
              </button>
              <button type="button" class="ce-subtab" id="ceSubtabCards" onclick="CampaignEditor.switchRightTab('prospects')">
                👥 Prospectos Analizados (<span id="ceAnalyzedCountBadge">0/0</span>)
              </button>
            </div>

            <!-- Vista 1: Simulador -->
            <div id="ceSimulatorWrap" style="display:flex;flex-direction:column;flex:1;min-height:0">
              <!-- Stepper de Navegación de Clientes -->
              <div class="ce-sim-stepper" id="ceSimStepper">
                <button type="button" class="ce-stepper-btn" onclick="CampaignEditor.stepPreviewCustomer(-1)">◀ Anterior</button>
                <span id="ceStepperLabel">Destinatario 1 de 1</span>
                <button type="button" class="ce-stepper-btn" onclick="CampaignEditor.stepPreviewCustomer(1)">Siguiente ▶</button>
              </div>

              <div class="ce-chat-header">
                <div class="ce-chat-avatar">👤</div>
                <div class="ce-chat-meta">
                  <div class="ce-chat-client-name" id="cePreviewClientName">Cliente JJ Paper</div>
                  <div class="ce-chat-client-sub" id="cePreviewClientSub">Vista previa interactiva en tiempo real</div>
                </div>
                <div id="cePreviewNeedBadgeWrap"></div>
              </div>

              <div class="ce-chat-viewport" id="ceChatViewport">
                <div class="ce-bubble-container">
                  <div class="ce-bubble" id="ceBubble">
                    <div id="ceEmailSubjectHeader" class="ce-email-subject-badge" style="display:none;"></div>
                    <div id="ceBubbleAttachment" class="ce-bubble-attachment-preview" style="display:none;"></div>
                    <div class="ce-bubble-text" id="ceBubbleText"></div>
                    <div class="ce-bubble-footer">
                      <span id="ceBubbleTime">10:45 AM</span>
                      <span class="ce-checkmarks" id="ceCheckmarks">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Acciones Rápidas para el Cliente Activo -->
              <div id="ceActiveCustomerActions" style="padding:8px 14px;background:#ffffff;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span style="font-size:11.5px;color:#64748b" id="ceCustomerActionNote">💡 Mensaje personalizado único para este cliente.</span>
                <div style="display:flex;gap:6px">
                  <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.editActiveCustomerMessage()">✏️ Editar este mensaje</button>
                  <button type="button" class="ce-card-action-btn primary" onclick="CampaignEditor.regenerateActiveCustomer()">🔄 Regenerar con IA</button>
                </div>
              </div>

              <!-- Área de Redacción y Variables (Modo Plantilla) -->
              <div class="ce-composer-area" id="ceComposerArea" style="display:none;">
                <div class="ce-ai-toolbar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                  <button type="button" id="ceAiDraftBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);color:#166534;border-color:#86efac;font-weight:700" onclick="CampaignEditor.aiDraftTemplate()" title="Redactar o personalizar plantilla con IA">🪄 Redactar con IA</button>
                  <button type="button" id="ceAiSpintaxBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%);color:#991b1b;border-color:#fecaca;font-weight:700" onclick="CampaignEditor.aiAntiSpamSpintax()" title="Generar Spintax anti-baneo automático">🛡️ Variar Anti-Spam IA</button>
                  <button type="button" id="ceAiFlyerBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);color:#1e40af;border-color:#bfdbfe;font-weight:700" onclick="CampaignEditor.aiDesignFlyer()" title="Diseñar Flyer gráfico del producto con IA">🎨 Diseñar Flyer con IA</button>
                  <button type="button" id="ceAiSectorBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#faf5ff 0%,#f3e8ff 100%);color:#6b21a8;border-color:#d8b4fe;font-weight:700" onclick="CampaignEditor.aiSectorPitch()" title="Generar propuesta estructurada por sector con IA">🎯 Abordaje B2B por Sector</button>
                </div>

                <div class="ce-variables-toolbar">
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('nombre')">👤 {{nombre}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('empresa')">🏢 {{empresa}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('vendedor')">💼 {{vendedor}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('producto')">📦 {{producto}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('precio')">💲 {{precio}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('descuento')">🔖 {{descuento}}</button>
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('link')">🔗 {{link}}</button>
                  <button type="button" class="ce-var-btn" style="background:#fef3c7;color:#92400e;border-color:#fcd34d" onclick="CampaignEditor.insertSpintax()" title="Variar saludos para evitar bloqueos">🎲 Spintax</button>
                </div>

                <div id="ceEmailSubjectField" style="display:none; margin-bottom:4px;">
                  <input type="text" id="ceSubjectInput" class="ce-input" placeholder="Asunto del correo electrónico..." oninput="CampaignEditor.updatePreview()">
                </div>

                <textarea class="ce-textarea" id="ceMessageInput" placeholder="Escribe el mensaje de la campaña..." oninput="CampaignEditor.updatePreview()"></textarea>
              </div>
            </div>

            <!-- Vista 2: Lista de Tarjetas de Prospectos Analizados -->
            <div id="ceCardsContainer" class="ce-cards-container" style="display:none;"></div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ce-footer">
          <div class="ce-footer-summary" id="ceFooterSummary">
            Destinatarios: <strong>0 clientes</strong>
          </div>
          <div class="ce-footer-actions">
            <button class="ce-btn-cancel" onclick="CampaignEditor.close()">Cancelar</button>
            <button class="ce-btn-launch" id="ceLaunchBtn" onclick="CampaignEditor.launch()">🚀 Lanzar Campaña</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    activeOverlay = div;
  }

  /* ---------------- GESTIÓN DE MODOS (IA vs PLANTILLA) ---------------- */
  function setEditorMode(mode = 'ai') {
    editorMode = mode;
    const tabAi = document.getElementById('ceTabModeAi');
    const tabTpl = document.getElementById('ceTabModeTpl');
    const secTpl = document.getElementById('ceSectionTemplate');
    const aiBar = document.getElementById('ceAiFlowBar');
    const rightSubtabs = document.getElementById('ceRightSubtabs');
    const simStepper = document.getElementById('ceSimStepper');
    const activeActions = document.getElementById('ceActiveCustomerActions');
    const composerArea = document.getElementById('ceComposerArea');

    if (mode === 'ai') {
      tabAi?.classList.add('active');
      tabTpl?.classList.remove('active');
      if (secTpl) secTpl.style.display = 'none';
      if (aiBar) aiBar.style.display = 'flex';
      if (rightSubtabs) rightSubtabs.style.display = 'flex';
      if (simStepper) simStepper.style.display = 'flex';
      if (activeActions) activeActions.style.display = 'flex';
      if (composerArea) composerArea.style.display = 'none';
      // Por defecto activar PDF oficial en modo IA
      const pdfChk = document.getElementById('ceAttachPdf');
      if (pdfChk && !pdfChk.checked) {
        pdfChk.checked = true;
        onAttachChange();
      }
    } else {
      tabAi?.classList.remove('active');
      tabTpl?.classList.add('active');
      if (secTpl) secTpl.style.display = 'block';
      if (aiBar) aiBar.style.display = 'none';
      if (rightSubtabs) rightSubtabs.style.display = 'none';
      if (simStepper) simStepper.style.display = 'none';
      if (activeActions) activeActions.style.display = 'none';
      if (composerArea) composerArea.style.display = 'flex';
      switchRightTab('simulator');
    }

    updatePreview();
  }

  function switchRightTab(tab = 'simulator') {
    activeRightTab = tab;
    const subSim = document.getElementById('ceSubtabSim');
    const subCards = document.getElementById('ceSubtabCards');
    const simWrap = document.getElementById('ceSimulatorWrap');
    const cardsWrap = document.getElementById('ceCardsContainer');

    if (tab === 'simulator') {
      subSim?.classList.add('active');
      subCards?.classList.remove('active');
      if (simWrap) simWrap.style.display = 'flex';
      if (cardsWrap) cardsWrap.style.display = 'none';
      updatePreview();
    } else {
      subSim?.classList.remove('active');
      subCards?.classList.add('active');
      if (simWrap) simWrap.style.display = 'none';
      if (cardsWrap) cardsWrap.style.display = 'flex';
      renderProspectCards();
    }
  }

  /* ---------------- APERTURA Y CONFIGURACIÓN INICIAL ---------------- */
  async function open(config = {}) {
    initModal();
    currentConfig = config;
    selectedProductOrCombo = null;
    generatedFlyerFile = null;
    activePreviewIdx = 0;
    manualSelectedIds = null;
    pickerDraftIds = new Set();
    isAnalyzingBatch = false;
    currentLoadedCooldownHours = null;
    currentLoadedChannel = null;

    // Normalizar números móviles en contactos
    if (Array.isArray(config.contacts)) {
      config.contacts.forEach(c => {
        if (!c.phone || (config.channel !== 'email' && !isMobileNum(c.phone))) {
          const best = getBestMobilePhone(c);
          if (best) c.phone = best;
        }
      });
    }

    // Auto-cargar catálogo completo usando DataService (o fallback sin límite restrictivo)
    if ((!config.products || config.products.length === 0) && typeof sb !== 'undefined') {
      try {
        if (typeof DataService !== 'undefined' && DataService.getProducts) {
          const dsProds = await DataService.getProducts();
          if (dsProds && dsProds.length > 0) {
            config.products = dsProds;
          }
        }
        if (!config.products || config.products.length === 0) {
          const { data: prods } = await sb.from('jjp_products')
            .select('id,sku,name,price_usd,price_b,price_c_bs,price_d_bs,unit,description,image_url,stock,jjp_product_variants(id,sku,variant_name,price_usd,price_b,stock,active,jjp_brands(name))')
            .eq('active', true)
            .order('name');
          config.products = prods || [];
        }
      } catch (e) {
        console.warn('Aviso cargando productos en CampaignEditor:', e);
      }
    }
    if ((!config.combos || config.combos.length === 0) && typeof sb !== 'undefined') {
      try {
        const { data: promos } = await sb.from('jjp_promos')
          .select('*')
          .eq('active', true)
          .order('sort_order')
          .limit(100);
        config.combos = promos || [];
      } catch (e) {
        console.warn('Aviso cargando combos en CampaignEditor:', e);
      }
    }
    if ((!config.templates || config.templates.length === 0) && typeof sb !== 'undefined') {
      try {
        const { data: tpls } = await sb.from('jjp_wa_templates')
          .select('*')
          .order('name', { ascending: true });
        config.templates = tpls || [];
      } catch (e) {
        console.warn('Aviso cargando plantillas en CampaignEditor:', e);
      }
    }

    if (document.getElementById('ceScheduledAt')) {
      document.getElementById('ceScheduledAt').value = '';
    }

    const isEmail = config.channel === 'email';
    const bouncedOpt = document.querySelector('#ceAudienceSelect option[value="email_bounced"]');
    if (bouncedOpt) bouncedOpt.style.display = isEmail ? 'none' : '';
    const badge = document.getElementById('ceBadge');
    badge.textContent = isEmail ? '📧 Email' : '📱 WhatsApp';
    badge.className = 'ce-channel-badge ' + (isEmail ? 'email' : '');
    
    document.getElementById('ceChatPane').className = 'ce-chat-pane ' + (isEmail ? 'email-mode' : '');
    document.getElementById('ceEmailSubjectField').style.display = isEmail ? 'block' : 'none';
    document.getElementById('ceEmailSubjectHeader').style.display = isEmail ? 'block' : 'none';
    document.getElementById('ceSecuritySection').style.display = isEmail ? 'none' : 'flex';
    document.getElementById('ceCheckmarks').style.display = isEmail ? 'none' : 'inline';

    // Restablecer casillas de adjuntos (PDF activo por defecto)
    const pdfChk = document.getElementById('ceAttachPdf');
    if (pdfChk) pdfChk.checked = true;
    const imgChk = document.getElementById('ceAttachImg');
    if (imgChk) imgChk.checked = false;
    const fileChk = document.getElementById('ceAttachFile');
    if (fileChk) fileChk.checked = false;

    const customWrap = document.getElementById('ceCustomFileWrap');
    if (customWrap) customWrap.style.display = 'none';

    document.getElementById('ceCampName').value = config.defaultName || (isEmail ? 'Campaña de Email ' : 'Difusión WhatsApp ') + new Date().toLocaleDateString('es-VE');

    const tplSel = document.getElementById('ceTemplateSelect');
    const availableTpls = (config.templates || []).filter(t => !t.channel || t.channel === config.channel || t.channel === 'both');
    tplSel.innerHTML = availableTpls.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    if (config.preTplId) {
      tplSel.value = config.preTplId;
      setEditorMode('template');
    } else {
      // Por defecto abrir en Modo IA (Recomendado)
      setEditorMode('ai');
    }

    if (availableTpls.length > 0 && config.preTplId) {
      onTemplateChange();
    } else {
      const sName = config.seller?.name || 'Asesor JJ Paper';
      const sPhone = config.seller?.phone || '0412-4676073';
      document.getElementById('ceMessageInput').value = isEmail 
        ? `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEsperamos que todo marche excelente en sus operaciones. Le saluda atentamente *${sName}*, del equipo comercial de *JJ Paper C.A.* en Caracas.\n\nPoniendo a su disposición condiciones preferenciales de suministro mayorista directo con entrega garantizada:\n\n*📦 PROPUESTA DE ABASTECIMIENTO MAYORISTA:*\n• *Resmas de papel Bond Carta y Oficio* (75g y 80g HP/Report/Chamex).\n• *Consumibles de línea de caja*: rollos térmicos para POS y cajas registradoras (80x70 y 57x40mm).\n• *Carpetas de fibra, sobres y archivadores* para resguardo documental de oficina.\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.\n\n👉 Puede revisar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le elaboremos una cotización formal adaptada a sus necesidades?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sPhone}\nCaracas, Venezuela`
        : `{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋, le saluda *${sName}* de *JJ Paper C.A.*\n\nPensando en el abastecimiento continuo de su negocio, ponemos a su disposición disponibilidad inmediata al mayor en:\n\n*📦 INSUMOS DE ALTA ROTACIÓN:*\n• *Rollos térmicos para puntos de venta (POS)*: 80x70 y 57x40mm garantizados.\n• *Resmas de papel Bond Carta y Oficio* de máxima blancura.\n• *Cintas de embalaje industrial* y papelería escolar y de oficina.\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista en PDF* con más de 900 artículos disponibles.\n\n👉 Puede consultar nuestro catálogo digital aquí:\n{{link}}\n\n¿Desea que le verifiquemos disponibilidad o le preparemos una cotización formal?`;
    }

    if (isEmail) {
      document.getElementById('ceSubjectInput').value = '📋 Propuesta de Suministro Mayorista y Lista de Precios Oficial — JJ Paper C.A.';
    }

    // Poblar selector de sectores B2B con los sectores reales presentes en la cartera
    const sectorSel = document.getElementById('ceSectorSelect');
    if (sectorSel) {
      const sectorsSet = new Set();
      (config.contacts || []).forEach(c => {
        if (c.sector && c.sector.trim() && c.sector.trim() !== 'Otro') sectorsSet.add(c.sector.trim());
      });
      const sortedSectors = Array.from(sectorsSet).sort();
      if (sortedSectors.length > 0) {
        sectorSel.innerHTML = sortedSectors.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
      } else {
        sectorSel.innerHTML = '<option value="">Todos los sectores</option>';
      }
    }

    if (config.preAudience) {
      const audSel = document.getElementById('ceAudienceSelect');
      if (audSel) audSel.value = config.preAudience;
    }

    await onAudienceChange();
    updatePreview();
    activeOverlay.classList.add('active');
  }

  function onTemplateChange() {
    const tplId = document.getElementById('ceTemplateSelect').value;
    const tpl = (currentConfig?.templates || []).find(t => t.id === tplId);
    if (!tpl) return;

    document.getElementById('ceMessageInput').value = tpl.body || '';
    if (tpl.subject && document.getElementById('ceSubjectInput')) {
      document.getElementById('ceSubjectInput').value = tpl.subject;
    }

    const typeSel = document.getElementById('ceTypeSelect');
    if (tpl.kind === 'producto' || tpl.id.includes('prod')) {
      typeSel.value = 'producto';
      onTypeChange();
      return;
    } else if (tpl.kind === 'combo' || tpl.id.includes('combo')) {
      typeSel.value = 'combo';
      onTypeChange();
      return;
    } else if (tpl.kind === 'reactivacion' || tpl.id.includes('react')) {
      typeSel.value = 'reactivacion';
      document.getElementById('ceAudienceSelect').value = 'inactivos';
      onAudienceChange();
    } else {
      typeSel.value = 'general';
      selectedProductOrCombo = null;
      document.getElementById('ceSelectedCardWrap').style.display = 'none';
      document.getElementById('ceSelectedCardWrap').innerHTML = '';
    }

    updatePreview();
  }

  function openCatalogPicker(mode = 'product') {
    const typeSel = document.getElementById('ceTypeSelect');
    if (mode === 'combo') {
      if (typeSel) typeSel.value = 'combo';
      window.ProductPicker.open({
        mode: 'combo',
        combos: currentConfig.combos || [],
        onSelect: (combo) => {
          selectedProductOrCombo = combo;
          selectedProductsList = [combo];
          renderSelectedCard();
          applyComboTemplate();
        }
      });
    } else if (mode === 'multi') {
      if (typeSel) typeSel.value = 'multi_oferta';
      window.ProductPicker.open({
        mode: 'multi',
        products: currentConfig.products || [],
        selectedList: selectedProductsList,
        onSelect: (list) => {
          selectedProductsList = Array.isArray(list) ? list : [list];
          selectedProductOrCombo = selectedProductsList[0] || null;
          renderSelectedCard();
          applyMultiOfertaTemplate();
        }
      });
    } else {
      if (typeSel) typeSel.value = 'producto';
      window.ProductPicker.open({
        mode: 'product',
        products: currentConfig.products || [],
        onSelect: (prod) => {
          selectedProductOrCombo = prod;
          selectedProductsList = [prod];
          renderSelectedCard();
          applyProductTemplate();
        }
      });
    }
  }

  function onTypeChange() {
    const type = document.getElementById('ceTypeSelect').value;
    const cardWrap = document.getElementById('ceSelectedCardWrap');

    if (type === 'producto') {
      openCatalogPicker('product');
    } else if (type === 'multi_oferta') {
      openCatalogPicker('multi');
    } else if (type === 'combo') {
      openCatalogPicker('combo');
    } else {
      selectedProductOrCombo = null;
      selectedProductsList = [];
      cardWrap.style.display = 'none';
      cardWrap.innerHTML = '';
    }
    updatePreview();
  }

  function renderSelectedCard() {
    const cardWrap = document.getElementById('ceSelectedCardWrap');
    const type = document.getElementById('ceTypeSelect')?.value;

    if (type === 'multi_oferta' && selectedProductsList.length > 0) {
      cardWrap.style.display = 'block';
      const itemsHtml = selectedProductsList.map((p, idx) => {
        const pUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_b || p.price_usd || 0)).toFixed(2);
        return `
          <div style="display:inline-flex; align-items:center; gap:6px; background:#fff7ed; border:1px solid #fed7aa; padding:4px 8px; border-radius:6px; font-size:11px; margin:2px;">
            <strong style="color:#c2410c;">#${idx + 1}</strong>
            <span style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</span>
            <span style="display:inline-flex; align-items:center; gap:2px; font-weight:700; color:#15803d;">
              $
              <input type="number" step="0.01" min="0" value="${pUsd}"
                     title="Modificar precio de oferta ($)"
                     onchange="CampaignEditor.updateMultiProductPrice(${idx}, this.value)"
                     style="width:58px; padding:2px 4px; font-size:11px; font-weight:700; border:1px solid #10b981; border-radius:4px; color:#065f46; text-align:center; background:#fff;">
            </span>
            <button type="button" style="border:none; background:transparent; color:#9a3412; cursor:pointer; font-weight:700;" onclick="CampaignEditor.removeMultiProduct(${idx})">✕</button>
          </div>
        `;
      }).join('');

      cardWrap.innerHTML = `
        <div style="background:#fff; border:1px solid #fed7aa; border-radius:8px; padding:8px 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:12px; font-weight:700; color:#c2410c;">🔥 ${selectedProductsList.length} Ofertas Seleccionadas (Puedes ajustar el precio de oferta directamente en cada caja)</span>
            <button type="button" class="ce-var-btn" style="font-size:11px; padding:3px 8px;" onclick="CampaignEditor.openCatalogPicker('multi')">Buscar Más</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; max-height:140px; overflow-y:auto;">
            ${itemsHtml}
          </div>
        </div>
      `;
      return;
    }

    if (!selectedProductOrCombo) {
      cardWrap.style.display = 'none';
      return;
    }

    const singlePrice = Number(selectedProductOrCombo.final_price_usd || selectedProductOrCombo.price_b || selectedProductOrCombo.price_usd || 0).toFixed(2);
    cardWrap.style.display = 'block';
    cardWrap.innerHTML = `
      <div class="ce-selected-card">
        <img src="${selectedProductOrCombo.image_url}" alt="${selectedProductOrCombo.name}">
        <div class="ce-selected-info">
          <div class="ce-selected-name">${selectedProductOrCombo.name}</div>
          <div class="ce-selected-price" style="display:flex; align-items:center; gap:6px; margin-top:3px;">
            <span style="font-size:11px; color:#64748b; font-weight:600;">Precio Oferta ($):</span>
            <input type="number" step="0.01" min="0" value="${singlePrice}"
                   title="Modificar precio de oferta"
                   onchange="CampaignEditor.updateSingleProductPrice(this.value)"
                   style="width:75px; padding:3px 6px; font-size:12px; font-weight:700; border:1.5px solid #10b981; border-radius:4px; color:#065f46; background:#fff;">
            ${selectedProductOrCombo.discount_pct > 0 ? `<span style="color:#e11d48; font-size:11px; font-weight:700;">(-${selectedProductOrCombo.discount_pct}%)</span>` : ''}
          </div>
        </div>
        <button type="button" class="ce-var-btn" onclick="CampaignEditor.onTypeChange()">Cambiar</button>
      </div>
    `;
  }

  function updateMultiProductPrice(idx, newPrice) {
    const val = parseFloat(newPrice);
    if (isNaN(val) || val < 0) return;
    const it = selectedProductsList[idx];
    if (it) {
      const base = Number(it.price_b || it.price_usd || val);
      const disc = (base > 0 && val < base) ? Math.max(0, Math.min(99, Math.round(((base - val) / base) * 100))) : 0;
      it.final_price_usd = val;
      it.discount_pct = disc;
      applyMultiOfertaTemplate();
      updatePreview();
    }
  }

  function updateSingleProductPrice(newPrice) {
    const val = parseFloat(newPrice);
    if (isNaN(val) || val < 0 || !selectedProductOrCombo) return;
    const base = Number(selectedProductOrCombo.price_b || selectedProductOrCombo.price_usd || val);
    const disc = (base > 0 && val < base) ? Math.max(0, Math.min(99, Math.round(((base - val) / base) * 100))) : 0;
    selectedProductOrCombo.final_price_usd = val;
    selectedProductOrCombo.discount_pct = disc;
    renderSelectedCard();
    applyProductTemplate();
    updatePreview();
  }

  function removeMultiProduct(idx) {
    if (typeof idx === 'number' && idx >= 0 && idx < selectedProductsList.length) {
      selectedProductsList.splice(idx, 1);
    } else {
      selectedProductsList = selectedProductsList.filter(x => x.id !== idx);
    }
    selectedProductOrCombo = selectedProductsList[0] || null;
    if (selectedProductsList.length === 0) {
      const typeSel = document.getElementById('ceTypeSelect');
      if (typeSel) typeSel.value = 'general';
    }
    renderSelectedCard();
    applyMultiOfertaTemplate();
  }

  function applyMultiOfertaTemplate() {
    if (!selectedProductsList || !selectedProductsList.length) return;
    const isEmail = currentConfig?.channel === 'email';
    const rate = (typeof getRate === 'function') ? getRate() : (window.APP?.EXCHANGE_RATE || 40);

    const itemsLines = selectedProductsList.map((p, idx) => {
      const pUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_b || p.price_usd || 0));
      const pBs = pUsd > 0 ? (pUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
      const unitStr = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
      return `• *${p.name}*${unitStr}: *$${pUsd.toFixed(2)} USD* | Bs. ${pBs}`;
    }).join('\n');

    let msg = '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda atentamente {{vendedor}} de *JJ Paper C.A.*, su aliado de abastecimiento mayorista directo en Caracas.\n\nPara apoyar la operatividad de su empresa y optimizar costos de procura, ponemos a su disposición disponibilidad inmediata con precios preferenciales de importador en:\n\n*📦 LISTADO DE SUMINISTROS EN PROMOCIÓN:*\n_(Precios unitarios promocionales — no es combo cerrado, puede solicitar los artículos y cantidades que requiera)_\n──────────────────────────\n${itemsLines}\n──────────────────────────\n\n💡 *¿Busca algún producto o marca que no vea en esta lista?*\n¡Pídanoslo con total confianza! Nuestro equipo mayorista se lo ubica, cotiza y despacha de inmediato.\n\n*VENTAJAS DIRECTAS DE TRABAJAR CON JJ PAPER:*\n• 🏭 *Importador Directo:* Precios directos de distribuidor en Caracas (sin intermediarios).\n• 🧾 *Facturación Legal:* Facturación formal fiscal a Tasa Oficial BCV.\n• 🚚 *Despacho Inmediato 24h:* Logística y delivery prioritario a su sede.\n• 📄 *Lista Oficial en PDF:* Le adjuntamos nuestro catálogo con más de 900 productos disponibles.\n\n👉 Catálogo digital en línea: {{link}}\n\n¿Desea que le reservemos inventario de estos productos o le preparemos una cotización formal?\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      if (document.getElementById('ceSubjectInput')) {
        document.getElementById('ceSubjectInput').value = `🔥 Ofertas Mayoristas Especiales — JJ Paper C.A.`;
      }
    } else {
      msg = `*🔥 OPORTUNIDAD MAYORISTA EXCLUSIVA · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe saluda *{{vendedor}}* de *JJ Paper C.A.*, su importador y distribuidor mayorista directo en Caracas.\n\nHoy queremos presentarle nuestro lote seleccionado de *ofertas especiales* con inventario físico para entrega inmediata esta semana:\n\n*📦 LISTADO DE PRODUCTOS EN PROMOCIÓN ESPECIAL:*\n_(Precios unitarios promocionales — no es combo cerrado, solicite los artículos que requiera)_\n──────────────────────────\n${itemsLines}\n──────────────────────────\n\n💡 *¿Busca algún producto o marca que no vea en esta lista?*\n¡Pídanoslo con total confianza! Nuestro equipo mayorista se lo ubica, cotiza y despacha de inmediato.\n\n*💎 VENTAJAS OPERATIVAS CON JJ PAPER:*\n• 🏭 *Importador y Distribuidor Directo* en Caracas (sin intermediarios)\n• 🧾 *Facturación formal fiscal* al cambio oficial BCV\n• 🚚 *Despacho prioritario 24h* en Caracas directamente a su empresa o colegio\n• 📄 *Catálogo Completo en PDF:* Le adjuntamos lista oficial con +900 artículos disponibles\n\n👉 Ver catálogo digital completo y hacer pedido directo: {{link}}\n\n💬 ¿Le reservamos unidades de alguno de estos productos para su próximo despacho?\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial JJ Paper C.A.`;
    }
    if (document.getElementById('ceMessageInput')) {
      document.getElementById('ceMessageInput').value = msg;
    }
    onAttachChange();
    updatePreview();
  }

  /* ---------- ARMADOR INTELIGENTE DE OFERTAS CON IA O ARCHIVO ---------- */
  function openAiOfferBuilderModal() {
    let modal = document.getElementById('jjAiOfferModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'jjAiOfferModal';
      modal.className = 'modal-overlay op';
      modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:99999;background:rgba(15,23,42,0.7);backdrop-filter:blur(4px);';
      document.body.appendChild(modal);
    } else {
      modal.style.display = 'flex';
      modal.classList.add('op');
    }

    modal.innerHTML = `
      <div class="modal-box" style="max-width:620px;width:92%;background:#ffffff;color:#0f172a;border-radius:16px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,0.3);border:1px solid #e2e8f0;" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
          <h3 style="margin:0;font-size:17px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:6px">
            🤖 Armador Inteligente de Ofertas con IA & Archivo
          </h3>
          <button type="button" class="btn-g sm" onclick="CampaignEditor.closeAiOfferModal()" style="font-size:16px;line-height:1;border:none;background:transparent;cursor:pointer;">✕</button>
        </div>

        <p style="font-size:12.5px;color:#64748b;margin:0 0 10px 0;line-height:1.4">
          Pega abajo una lista de productos en oferta (de WhatsApp, correo, notas de almacén) o sube un archivo (<strong>.txt, .csv</strong>). La IA detectará los productos, buscará en el catálogo de JJ Paper y armará el lote de ofertas automáticamente:
        </p>

        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
          <input type="file" id="aiOfferFileInput" accept=".txt,.csv,.json,.tsv" style="display:none" onchange="CampaignEditor.handleAiOfferFileUpload(event)">
          <button type="button" class="ce-var-btn" style="background:#f8fafc;border-color:#cbd5e1;font-weight:600;font-size:12px;padding:6px 12px;cursor:pointer;" onclick="document.getElementById('aiOfferFileInput').click()">
            📁 Cargar Archivo (.txt, .csv)
          </button>
          <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
            <label style="font-size:11.5px;color:#475569;font-weight:600;">Descuento por defecto:</label>
            <input type="number" id="ceAiOfferDefaultDiscount" value="10" min="0" max="80" style="width:55px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;text-align:center;">
            <span style="font-size:12px;color:#64748b;">%</span>
          </div>
        </div>

        <textarea id="ceAiOfferRawInput" class="fi" rows="7" placeholder="Ejemplo:
🔥 OFERTAS DE ESTA SEMANA:
- 10 Resmas de papel fotocopia carta Report 75g con 10% de descuento
- Lapiz dibujo artesco HB caja x12
- Cinta de embalar transparente 48x100
- 5 Cuadernos 1 linea 100h
- Goma en barra artesco 8gr
- Creyones triangulares artesco x48" style="width:100%;font-size:13px;resize:vertical;font-family:inherit;margin-bottom:12px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;box-sizing:border-box;"></textarea>

        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
          <button type="button" class="btn-g" onclick="CampaignEditor.closeAiOfferModal()" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;">Cancelar</button>
          <button type="button" id="btnProcessAiOffers" class="btn-p" onclick="CampaignEditor.processAiOffersRequest()" style="padding:8px 18px;font-size:13px;font-weight:800;background:#15803d;color:#fff;border:none;border-radius:8px;cursor:pointer;">
            Analizar con IA y Armar Oferta 🚀
          </button>
        </div>
      </div>
    `;
    setTimeout(() => document.getElementById('ceAiOfferRawInput')?.focus(), 60);
  }

  function closeAiOfferModal() {
    const modal = document.getElementById('jjAiOfferModal');
    if (modal) {
      modal.classList.remove('op');
      modal.style.display = 'none';
    }
  }

  function handleAiOfferFileUpload(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      const ta = document.getElementById('ceAiOfferRawInput');
      if (ta && content) {
        ta.value = content;
        if (typeof showToast === 'function') {
          showToast(`Archivo "${file.name}" cargado (${file.size} bytes) 📄`);
        }
      }
    };
    reader.readAsText(file);
  }

  async function processAiOffersRequest() {
    const rawText = (document.getElementById('ceAiOfferRawInput')?.value || '').trim();
    if (!rawText) {
      if (typeof showToast === 'function') showToast('Por favor escribe, pega o carga una lista de productos.', 'warn');
      else alert('Por favor escribe, pega o carga una lista de productos.');
      return;
    }

    const defaultDisc = parseFloat(document.getElementById('ceAiOfferDefaultDiscount')?.value) || 0;
    const btn = document.getElementById('btnProcessAiOffers');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analizando con IA y Catálogo... 🧠';
    }

    try {
      let itemsToMatch = [];

      // 1. Cargar cliente Gemini AI y consultar
      await ensureGeminiClient();
      const ai = window.GeminiClient;

      if (ai && ai.callGemini) {
        const prompt = `Actúa como clasificador y normalizador de catálogo para JJ Paper C.A. (distribuidora mayorista en Caracas).
El usuario te entrega una lista o texto con artículos de oficina y papelería para una campaña de promociones.
Muchos nombres contienen errores de tipeo, jerga comercial o marcas abreviadas:
- "injoy" o "ink joy" -> "InkJoy / Paper Mate"
- "tol" -> "Estol"
- "giromaica" o "sinfonia giro mayka" -> "Archivador Sinfonia Giro Printa / Mayka"
- "sinfonia" -> "Sinfonía / Giro"
- "cisvi" o "kiss be" o "kiss" -> "Crisvi / Shark punta fina"
- "fimax" o "ofimax" -> "Ofimax"
- "poligrafo" -> "bolígrafo"
- "manita" -> "manila"
- "archicomodo" o "archicomodos" -> "archicomodos plasticos"

INSTRUCCIÓN VITAL:
Si una línea contiene varios colores o presentaciones entre paréntesis o separados por comas (por ejemplo: "Bolígrafos Ink Joy *12 (Azul, Negro) - $2,70" o "Bolígrafos Levo *12 (Azul, Rojo, Negro) - $1,81"), DEBES DESGLOSARLA en un ítem separado para CADA color con su respectivo precio y color:
- Ítem 1: query: "boligrafo inkjoy azul x12", color: "azul", offer_price_usd: 2.70
- Ítem 2: query: "boligrafo inkjoy negro x12", color: "negro", offer_price_usd: 2.70

Los precios pueden venir con coma (ej: $2,70 -> 2.70, $54,50 -> 54.50). Conviértelos siempre a números con punto decimal.
Separa el color (azul, negro, rojo), tamaño (carta, oficio), presentación/cantidad (x12, x25, x100, 10 unidades) y marca si se mencionan.

DEVUELVE ÚNICAMENTE UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA (SIN TEXTO ANTES NI DESPUÉS):
{
  "items": [
    {
      "query": "boligrafo inkjoy azul",
      "qty": 1,
      "discount_pct": null,
      "offer_price_usd": 2.70,
      "color": "azul",
      "size": null,
      "brand": "inkjoy"
    }
  ]
}

TEXTO DE ENTRADA:
"""
${rawText}
"""`;

        try {
          const res = await ai.callGemini({ prompt, temperature: 0.1 });
          const cleaned = res.replace(/```json/gi, '').replace(/```/g, '').trim();
          let parsed = null;
          try {
            parsed = JSON.parse(cleaned);
          } catch (e) {
            const m = cleaned.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
          }
          if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            itemsToMatch = parsed.items;
          }
        } catch (aiErr) {
          console.warn('[AI Offer Builder] Fallo en Gemini AI, usando fallback heurístico:', aiErr);
        }
      }

      // 2. Fallback heurístico local si no se obtuvieron ítems de la IA
      if (!itemsToMatch || itemsToMatch.length === 0) {
        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const discMatch = line.match(/(?:-|desc(?:uento)?\s*:?\s*)?(\d{1,2})\s*%/i);
          const itemDisc = discMatch ? parseFloat(discMatch[1]) : null;

          const priceMatch = line.match(/(?:\$|usd\s*|precio\s*:?\s*\$?)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
          const itemPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

          const parenM = line.match(/\(([^)]+)\)/);
          const cleanBase = line.replace(/(?:\$|usd\s*|precio\s*:?\s*\$?)\s*[0-9]+(?:[.,][0-9]{1,2})?/gi, '').replace(/[-–—]/g, '').trim();

          if (parenM) {
            const inside = parenM[1].toLowerCase();
            const possibleColors = ['azul', 'negro', 'rojo', 'verde', 'amarillo'];
            const foundCols = possibleColors.filter(c => inside.includes(c));
            if (foundCols.length > 1) {
              const withoutParen = cleanBase.replace(/\([^)]+\)/, '').trim();
              for (const col of foundCols) {
                itemsToMatch.push({
                  query: withoutParen + ' ' + col,
                  qty: 1,
                  discount_pct: itemDisc,
                  offer_price_usd: itemPrice,
                  forcedColor: col,
                  color: col
                });
              }
              continue;
            }
          }

          if (cleanBase.length >= 3) {
            itemsToMatch.push({
              query: cleanBase,
              qty: 1,
              discount_pct: itemDisc,
              offer_price_usd: itemPrice,
              forcedColor: null
            });
          }
        }
      }

      // 3. Obtener catálogo completo (+1200 productos garantizados sin límite de 1000)
      let allCatalog = currentConfig?.products || [];
      if ((!allCatalog || allCatalog.length < 1200) && typeof DataService !== 'undefined' && DataService.getProducts) {
        try {
          const dsProds = await DataService.getProducts();
          if (dsProds && dsProds.length >= 1200) allCatalog = dsProds;
        } catch (_) {}
      }
      if ((!allCatalog || allCatalog.length < 1200) && typeof sb !== 'undefined') {
        try {
          let paged = [];
          let from = 0;
          const step = 999;
          while (true) {
            const { data, error } = await sb.from('jjp_catalog_flat').select('*').range(from, from + step);
            if (error || !data || data.length === 0) break;
            paged.push(...data);
            if (data.length <= step) break;
            from += step + 1;
          }
          if (paged.length > 0) allCatalog = paged;
        } catch (_) {}
      }
      if (allCatalog && allCatalog.length > 0 && currentConfig) {
        currentConfig.products = allCatalog;
      }

      // Diccionario de sinónimos fonéticos y comerciales
      const SYNONYMS = {
        'ink joy': 'inkjoy',
        'injoy': 'inkjoy',
        'paper mate': 'inkjoy paper km',
        'tol': 'estol',
        'cisvi': 'crisvi',
        'crisvi': 'crisvi',
        'kiss be': 'shark',
        'fimax': 'ofimax',
        'ofimax': 'ofimax',
        'poligrafo': 'boligrafo',
        'manita': 'manila',
        'archicomodo': 'archicomodos',
        'archicomodos plasticos': 'archicomodos plasticos',
        'mayka': 'mayka',
        'giro mayka': 'giro mayka',
        'sinfonia giro mayka': 'archivador sinfonia giro',
        'sinfonia': 'sinfonia giro'
      };

      function normalizeSearchStr(s) {
        let str = String(s || '').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ').trim();
        for (const [k, v] of Object.entries(SYNONYMS)) {
          const reg = new RegExp('\\b' + k + '\\b', 'gi');
          str = str.replace(reg, v);
        }
        str = str.replace(/\b(az)\b/gi, 'azul').replace(/\b(ne)\b/gi, 'negro').replace(/\b(ro)\b/gi, 'rojo');
        return str;
      }

      // 4. Aplanar candidatos del catálogo (variantes y productos base)
      const candidates = [];
      for (const p of (allCatalog || [])) {
        const pName = p.name || p.jjp_products?.name || '';
        const pDesc = p.description || p.jjp_products?.description || '';
        const pUnit = p.unit || p.jjp_products?.unit || 'unid';
        const pBrand = p.brand || p.jjp_brands?.name || '';
        const pImg = p.image_url || p.jjp_products?.image_url || 'assets/img/no-img.svg';
        const vars = p.jjp_product_variants || p.variants || [];

        if (!vars || vars.length === 0) {
          const price = Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : 0));
          candidates.push({
            id: p.id,
            variant_id: null,
            name: pName,
            brand: pBrand,
            sku: p.sku || '',
            price_usd: price,
            image_url: pImg,
            description: pDesc,
            unit: pUnit,
            raw: p,
            searchTarget: normalizeSearchStr(`${pName} ${pBrand} ${p.sku || ''} ${pDesc} ${pUnit}`)
          });
        } else {
          for (const v of vars) {
            const vName = v.variant_name && v.variant_name !== 'Estándar' ? v.variant_name : '';
            const fullTitle = vName ? `${pName} (${vName})` : pName;
            const price = Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : (p.price_b || p.price_usd || 0)));
            const vSku = v.sku || p.sku || '';
            const vImg = v.image_url || pImg;
            candidates.push({
              id: p.id,
              variant_id: v.id,
              name: fullTitle,
              brand: pBrand || v.jjp_brands?.name || '',
              sku: vSku,
              price_usd: price,
              image_url: vImg,
              description: pDesc,
              unit: pUnit,
              raw: p,
              searchTarget: normalizeSearchStr(`${pName} ${vName} ${pBrand} ${vSku} ${pDesc} ${pUnit}`)
            });
          }
        }
      }

      function scoreCandidate(queryNorm, cand, forcedCol) {
        const qWords = queryNorm.split(/\s+/).filter(w => w.length > 1 || /\d/.test(w));
        const target = cand.searchTarget;
        let score = 0;

        for (const w of qWords) {
          if (target.includes(w)) {
            score += (w.length >= 4 ? 6 : 3);
          }
        }
        if (target.includes(queryNorm)) score += 20;

        // Modificadores de COLOR
        const colors = ['azul', 'negro', 'rojo', 'verde', 'amarillo'];
        if (forcedCol) {
          if (target.includes(forcedCol)) score += 50;
          else {
            const otherCols = colors.filter(c => c !== forcedCol);
            if (otherCols.some(oc => target.includes(oc))) score -= 50;
          }
        } else {
          for (const col of colors) {
            const qHasCol = qWords.includes(col);
            const candHasCol = target.includes(col);
            if (qHasCol && candHasCol) score += 35;
            else if (qHasCol && !candHasCol) {
              const otherCols = colors.filter(c => c !== col);
              if (otherCols.some(oc => target.includes(oc))) score -= 35;
            }
          }
        }

        // Modificadores de TAMAÑO (carta vs oficio)
        const sizes = ['carta', 'oficio'];
        for (const sz of sizes) {
          const qHasSz = qWords.includes(sz);
          const candHasSz = target.includes(sz);
          if (qHasSz && candHasSz) score += 25;
          else if (qHasSz && !candHasSz) {
            const otherSz = sizes.filter(s => s !== sz);
            if (otherSz.some(os => target.includes(os))) score -= 30;
          }
        }

        // Números (25, 100, 12, 10, 300, 2)
        ['25', '100', '12', '10', '300', '2'].forEach(num => {
          if (qWords.includes(num) && target.includes(num)) score += 10;
        });

        // Marcas prioritarias
        const brands = ['printon', 'hp', 'artesco', 'kores', 'levo', 'inkjoy', 'marfil', 'estol', 'caribe', 'shark', 'reprograf', 'lider', 'sinfonia', 'ofimax', 'crisvi', 'prismacolor', 'mayka'];
        for (const b of brands) {
          if (qWords.includes(b) && target.includes(b)) {
            score += 40;
          }
        }

        // Categoría Papel Fotocopia / Resma
        const isPaperQ = qWords.includes('papel') && (qWords.includes('carta') || qWords.includes('oficio') || qWords.includes('resma') || qWords.includes('fotocopia'));
        const isPaperCand = target.includes('fotocopia') || target.includes('resma') || target.includes('pacc') || target.includes('pafo') || target.includes('reprograf') || target.includes('printon');
        if (isPaperQ && isPaperCand) {
          score += 50;
          if (qWords.includes('hp') && (target.includes('hp') || target.includes('pacc'))) score += 40;
          if (qWords.includes('printon') && target.includes('printon')) score += 40;
        } else if (isPaperQ && (target.includes('boligrafo') || target.includes('cartulina') || target.includes('carbon') || target.includes('higuinico') || target.includes('funda'))) {
          score -= 80;
        }

        // Barrera Marcador vs Bolígrafo
        if (qWords.includes('marcador') && (target.includes('boligrafo') || target.includes('bolsn') || target.includes('b100'))) {
          score -= 60;
        }
        if ((qWords.includes('boligrafo') || qWords.includes('boligrafos')) && target.includes('marcador')) {
          score -= 60;
        }

        // Categoría Bolígrafo
        const isPenQ = qWords.includes('boligrafo') || qWords.includes('boligrafos');
        const isPenCand = target.includes('boligrafo') || target.includes('bolsn') || target.includes('b100') || target.includes('semi-gel') || target.includes('inkjoy');
        if (isPenQ && isPenCand) {
          score += 30;
          if (qWords.includes('inkjoy') && (target.includes('inkjoy') || target.includes('paper km') || target.includes('pm'))) score += 50;
          if (qWords.includes('levo') && (target.includes('levo') || target.includes('l-ink'))) score += 50;
          if (qWords.includes('marfil') && target.includes('marfil')) score += 50;
          if (qWords.includes('ofimax') && target.includes('ofimax')) score += 50;
          if (qWords.includes('estol') && target.includes('estol')) score += 50;
        } else if (isPenQ && !isPenCand) score -= 60;

        // Categoría Carpeta
        const isFolderQ = qWords.includes('carpeta') || qWords.includes('carpetas');
        const isFolderCand = target.includes('carpeta') || target.includes('carpetas');
        if (isFolderQ && isFolderCand) {
          score += 30;
          if (qWords.includes('fibra') && target.includes('fibra')) score += 40;
          if (qWords.includes('manila') && target.includes('manila')) score += 40;
        } else if (isFolderQ && !isFolderCand) score -= 50;

        // Categoría Archicomodos
        if (qWords.includes('archicomodo') || qWords.includes('archicomodos')) {
          if (target.includes('archicomodo') || target.includes('archicomodos')) score += 70;
          if (target.includes('plastico') || target.includes('plasticos')) score += 20;
          if (target.includes('archivador')) score -= 60;
        }

        // Categoría Archivador
        const isArchQ = (qWords.includes('archivador') || qWords.includes('archivadores')) && !qWords.includes('archicomodo');
        const isArchCand = (target.includes('archivador') || target.includes('archivadores')) && !target.includes('archicomodo');
        if (isArchQ && isArchCand) {
          score += 30;
          if (qWords.includes('sinfonia') && target.includes('sinfonia')) score += 40;
          if (qWords.includes('giro') && target.includes('giro')) score += 30;
          if (qWords.includes('mayka') && (target.includes('mayka') || target.includes('sinfonia'))) score += 30;
        } else if (isArchQ && !isArchCand) score -= 50;

        // Categoría Lápiz
        const isPencilQ = qWords.includes('lapiz') || qWords.includes('grafito');
        const isPencilCand = (target.includes('lapiz') || target.includes('grafito') || target.includes('turquoise')) && !target.includes('corrector');
        if (isPencilQ && isPencilCand) {
          score += 30;
          if (qWords.includes('prismacolor') && (target.includes('prismacolor') || target.includes('turquoise'))) score += 50;
          if (qWords.includes('artesco') && target.includes('artesco')) score += 50;
          if ((qWords.includes('hb') || qWords.includes('grafito')) && (target.includes('bicolor') || target.includes('cheq'))) {
            score -= 60;
          }
        } else if (isPencilQ && !isPencilCand) score -= 50;

        // Categoría Libro Contabilidad
        const isBookQ = qWords.includes('libro') || qWords.includes('libros') || qWords.includes('contabilidad');
        const isBookCand = target.includes('libro') || target.includes('libros') || target.includes('contab');
        if (isBookQ && isBookCand) {
          score += 40;
          if (qWords.includes('300') && target.includes('300')) score += 30;
          if (qWords.includes('2') || qWords.includes('dos')) {
            if (target.includes('2 col') || target.includes('2col') || target.includes('2')) score += 40;
            if (target.includes('3 col') || target.includes('4 col')) score -= 40;
          }
        }

        // Penalizaciones por marcas ausentes
        if (qWords.includes('levo') && !target.includes('levo') && !target.includes('l-ink')) score -= 60;
        if (qWords.includes('ofimax') && !target.includes('ofimax')) score -= 60;
        if (qWords.includes('marfil') && !target.includes('marfil')) score -= 60;

        return score;
      }

      const matchedOffers = [];
      const usedKeys = new Set(selectedProductsList.map(p => p.variant_id ? `${p.id}_${p.variant_id}` : p.id));

      for (const item of itemsToMatch) {
        const normQ = normalizeSearchStr(item.query);
        if (!normQ) continue;

        let bestCand = null;
        let bestScore = 0;
        const forcedColor = item.forcedColor || item.color || null;

        for (const cand of candidates) {
          const candKey = cand.variant_id ? `${cand.id}_${cand.variant_id}` : cand.id;
          if (usedKeys.has(candKey)) continue;

          const sc = scoreCandidate(normQ, cand, forcedColor);
          if (sc > bestScore) {
            bestScore = sc;
            bestCand = cand;
          }
        }

        if (bestCand && bestScore >= 12) {
          const candKey = bestCand.variant_id ? `${bestCand.id}_${bestCand.variant_id}` : bestCand.id;
          usedKeys.add(candKey);

          let finalPrice = bestCand.price_usd;
          let disc = (item.discount_pct != null && !isNaN(item.discount_pct)) ? Number(item.discount_pct) : defaultDisc;

          if (item.offer_price_usd != null && !isNaN(item.offer_price_usd) && Number(item.offer_price_usd) > 0) {
            finalPrice = Number(item.offer_price_usd);
            if (bestCand.price_usd > 0) {
              disc = Math.max(0, Math.round(((bestCand.price_usd - finalPrice) / bestCand.price_usd) * 100));
            }
          } else if (disc > 0) {
            finalPrice = Math.max(0, bestCand.price_usd * (1 - (disc / 100)));
          }

          matchedOffers.push({
            id: bestCand.id,
            variant_id: bestCand.variant_id || null,
            product_id: bestCand.id,
            name: bestCand.name,
            brand: bestCand.brand,
            price_usd: bestCand.price_usd,
            final_price_usd: finalPrice,
            discount_pct: disc,
            image_url: bestCand.image_url,
            description: bestCand.description,
            sku: bestCand.sku,
            unit: bestCand.unit,
            raw: bestCand.raw,
            type: 'product'
          });
        }
      }

      if (matchedOffers.length === 0) {
        if (typeof showToast === 'function') {
          showToast('No se encontraron coincidencias en el catálogo. Revisa los nombres.', 'warn');
        } else {
          alert('No se encontraron coincidencias en el catálogo.');
        }
        return;
      }

      selectedProductsList = [...selectedProductsList, ...matchedOffers];
      selectedProductOrCombo = selectedProductsList[0] || null;

      const typeSel = document.getElementById('ceTypeSelect');
      if (typeSel) typeSel.value = 'multi_oferta';

      renderSelectedCard();
      applyMultiOfertaTemplate();
      closeAiOfferModal();

      if (typeof showToast === 'function') {
        showToast(`🎉 ¡Lote de ofertas preparado! Se incorporaron ${matchedOffers.length} productos a la campaña. ✨`);
      }
    } catch (err) {
      console.error('Error armando ofertas con IA:', err);
      if (typeof showToast === 'function') showToast('Error procesando ofertas: ' + err.message, 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Analizar con IA y Armar Oferta 🚀';
      }
    }
  }

  function applyProductTemplate() {
    if (!selectedProductOrCombo) return;
    const p = selectedProductOrCombo;
    const isEmail = currentConfig?.channel === 'email';
    const priceUsd = Number(p.final_price_usd || p.price_b || p.price_usd || 0).toFixed(2);
    const unitStr = p.unit ? ` (${escapeHTML(p.unit)})` : '';

    let msg = '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda {{vendedor}} de *JJ Paper C.A.*, su importador y distribuidor mayorista en Caracas.\n\nQueremos presentarle una propuesta directa de abastecimiento mayorista con disponibilidad inmediata en:\n\n*📦 ${p.name}${unitStr}*\n${p.description ? '📝 ' + p.description + '\n' : ''}*💲 Precio de Lista Mayorista: $${priceUsd} USD*${p.discount_pct > 0 ? ' _(Descuento comercial del ' + p.discount_pct + '% aplicado)_' : ' _(Condiciones preferenciales y ahorro por volumen / bulto cerrado)_'}\n\n*VENTAJAS DIRECTAS CON JJ PAPER:*\n• 🏭 Precios directos de importador en Caracas sin intermediarios.\n• 🚚 Delivery express gratuito en Caracas a su sede.\n• 🧾 Facturación fiscal formal a Tasa Oficial BCV.\n• 🔍 ¿Busca alguna medida o insumo especial fuera de lista? Nuestro equipo de procura se lo ubica de inmediato.\n\n👉 Puede revisar la ficha técnica y confirmar su requerimiento aquí:\n{{link}}\n\n¿Gusta que le reservemos disponibilidad o le preparemos una cotización por volumen para su empresa?\n\nAtentamente,\n{{vendedor}}\nDirección Comercial | JJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `📦 Propuesta Mayorista: ${p.name} — JJ Paper C.A.`;
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Como importadores y distribuidores mayoristas directos en Caracas, hoy queremos compartirle disponibilidad inmediata y precio preferencial en:\n\n*📦 ${p.name}${unitStr}*\n${p.description ? p.description + '\n' : ''}*💲 Precio lista mayorista: $${priceUsd} USD*\n_(Condiciones preferenciales y escala de descuento por volumen / bulto cerrado)_\n\n• 🏭 *Importador directo en Caracas* (inventario físico sin intermediarios)\n• 🚚 *Delivery a su sede* y factura fiscal formal a tasa oficial BCV\n• 🔍 *Procura especial:* si requiere algún formato o insumo que no esté en lista, se lo conseguimos.\n\n👉 Ficha completa y pedido en línea: {{link}}\n\n¿Le reservamos unidades o le preparamos una cotización formal para su empresa?`;
    }
    document.getElementById('ceMessageInput').value = msg;
    const imgChk1 = document.getElementById('ceAttachImg');
    if (imgChk1) imgChk1.checked = true;
    onAttachChange();
    updatePreview();
  }

  function applyComboTemplate() {
    if (!selectedProductOrCombo) return;
    const c = selectedProductOrCombo;
    const isEmail = currentConfig?.channel === 'email';
    const priceUsd = Number(c.final_price_usd || c.price_b || c.price_usd || 0).toFixed(2);

    let msg = '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda {{vendedor}} de *JJ Paper C.A.*, su aliado de abastecimiento mayorista directo en Caracas.\n\nDiseñamos este combo de alta rotación para optimizar el presupuesto y flujo operativo de su empresa:\n\n*🎁 COMBO OPERATIVO: ${c.name}*\n${c.description ? '📝 Incluye: ' + c.description + '\n' : ''}*💲 Inversión mayorista preferencial: $${priceUsd} USD*\n_(Ahorro integrado por lote frente a compras individuales)_\n\n*VENTAJAS CLAVE:*\n• 🏭 Precios directos de distribuidor en Caracas.\n• 🚚 Entrega garantizada en su sede en 24h.\n• 🧾 Facturación fiscal en bolívares a Tasa Oficial BCV.\n• 🔍 ¿Requiere ajustar cantidades o sumar insumos? Lo adaptamos a su medida.\n\n👉 Ver detalle del combo y gestionar pedido: {{link}}\n\n¿Desea que le confirmemos despacho de este lote para su sede esta semana?\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `🎁 Combo Mayorista Especial: ${c.name} — JJ Paper C.A.`;
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarle 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Armamos este combo especial pensado para optimizar la reposición de su empresa con precio directo de importador:\n\n*🎁 COMBO OPERATIVO: ${c.name}*\n${c.description ? '📝 ' + c.description + '\n' : ''}*💲 Inversión del combo: $${priceUsd} USD*\n_(Ahorro directo frente a compras al detal)_\n\n• 🏭 *Importador directo en Caracas*\n• 🚚 *Despacho garantizado en 24h*\n• 🧾 *Facturación formal a Tasa Oficial BCV*\n\n👉 Ver detalles o confirmar pedido directo: {{link}}\n\n¿Le reservamos este combo antes de agotar existencia del lote?`;
    }
    document.getElementById('ceMessageInput').value = msg;
    const imgChk2 = document.getElementById('ceAttachImg');
    if (imgChk2) imgChk2.checked = true;
    onAttachChange();
    updatePreview();
  }

  /* ---------------- AUDIENCIA Y FILTRO DE CONTACTOS ---------------- */
  async function onAudienceChange() {
    if (!cooldownLoading) cooldownLoading = reloadCooldown().finally(() => { cooldownLoading = null; });
    await cooldownLoading;
    const aud = document.getElementById('ceAudienceSelect')?.value || 'todos';
    const tagWrap = document.getElementById('ceTagWrap');
    if (tagWrap) tagWrap.style.display = aud === 'etiqueta' ? 'block' : 'none';
    const sectorWrap = document.getElementById('ceSectorWrap');
    if (sectorWrap) sectorWrap.style.display = aud === 'sector' ? 'block' : 'none';
    const sectorVal = document.getElementById('ceSectorSelect')?.value;

    const contacts = currentConfig?.contacts || [];
    const isEmail = currentConfig?.channel === 'email';
    const tagVal = document.getElementById('ceTagInput')?.value?.toLowerCase().trim();
    const ex = cooldownExcluded;

    const hitCooldown = (c) =>
      ex.customer.has(c.id) ||
      (isEmail ? ex.email.has(String(c.email || '').toLowerCase().trim()) : ex.phone.has(normPhoneKey(c.phone)));

    const isQuoted = (c) => {
      if (c.id && recentQuotesMap.has(c.id)) return true;
      if (c.email && recentQuotesMap.has(String(c.email).toLowerCase().trim())) return true;
      if (c.phone && recentQuotesMap.has(normPhoneKey(c.phone))) return true;
      return false;
    };

    const isReplied = (c) => {
      if (c.status === 'respondio_email' || c.status === 'respondio_wa') return true;
      if (c.id && recentRepliesMap.has(c.id)) return true;
      if (c.email && recentRepliesMap.has(String(c.email).toLowerCase().trim())) return true;
      if (c.phone && recentRepliesMap.has(normPhoneKey(c.phone))) return true;
      return false;
    };

    let excludedCount = 0;
    let nonMobileCount = 0;
    let bouncedCount = 0;

    selectedAudienceList = contacts.filter(c => {
      if (!isEmail && (!c.phone || !isMobileNum(c.phone))) {
        const best = getBestMobilePhone(c);
        if (best) c.phone = best;
      }
      if (isEmail && !c.email) return false;
      if (!isEmail && !c.phone) return false;
      if (isEmail && c.email_opt_out) return false;
      
      // Filtro anti-rebotes
      if (isEmail && (c.email_status === 'bounced_hard' || c.email_status === 'bounced_soft')) {
        bouncedCount++;
        return false;
      }

      if (!isEmail && (c.opt_out || c.wa_opt_out || knownNoWaPhones.has(normPhoneKey(c.phone)))) {
        nonMobileCount++;
        return false;
      }

      // Validar móvil WhatsApp
      if (!isEmail) {
        let isMob = false;
        if (typeof parsePhoneInfo === 'function') {
          const pInfo = parsePhoneInfo(c.phone);
          isMob = pInfo.isValid && pInfo.isMobile && !pInfo.isLandline;
        } else {
          isMob = isMobileNum(c.phone);
        }
        if (!isMob) {
          nonMobileCount++;
          return false;
        }
      }

      // Si el usuario aplicó una selección manual con checkboxes, priorizarla absolutamente
      if (manualSelectedIds && manualSelectedIds.size > 0) {
        return manualSelectedIds.has(c.id);
      }

      const applyCooldown = document.getElementById('ceApplyCooldown') ? document.getElementById('ceApplyCooldown').checked : true;
      if (applyCooldown && hitCooldown(c)) {
        excludedCount++;
        return false;
      }

      const excludeQuoted = document.getElementById('ceExcludeQuoted') ? document.getElementById('ceExcludeQuoted').checked : false;
      if (excludeQuoted && isQuoted(c)) {
        excludedCount++;
        return false;
      }

      if (aud === 'con_cotizacion') return isQuoted(c);
      if (aud === 'respondieron') return isReplied(c);
      if (aud === 'email_bounced') {
        const hasBounced = c.email_status === 'bounced' || c.email_status === 'bounced_hard' || c.email_status === 'bounced_soft';
        const noEmail = !c.email || !String(c.email).trim();
        return (hasBounced || noEmail);
      }
      if (aud === 'prospectos_b2b') return Boolean(c.is_prospect_b2b);
      if (aud === 'solo_clientes') return !c.is_prospect_b2b;
      if (aud === 'inactivos') return (c.total_orders > 0 && c.days_since_last > 30);
      if (aud === 'prospectos') return (!c.total_orders || c.total_orders === 0) && !c.is_prospect_b2b;
      if (aud === 'sector' && sectorVal) {
        return c.sector === sectorVal || (Array.isArray(c.tags) && c.tags.includes(sectorVal.toLowerCase().replace(/\s+/g, '_')));
      }
      if (aud === 'etiqueta' && tagVal) {
        const zoneMatch = c.zone && String(c.zone).toLowerCase().includes(tagVal);
        const tagMatch = Array.isArray(c.tags)
          ? c.tags.some(t => String(t).toLowerCase().includes(tagVal))
          : (c.tags && String(c.tags).toLowerCase().includes(tagVal));
        return zoneMatch || tagMatch;
      }
      return true;
    });

    // Ajustar índice de preview si se desborda
    if (activePreviewIdx >= selectedAudienceList.length) {
      activePreviewIdx = Math.max(0, selectedAudienceList.length - 1);
    }

    const b2bCount = selectedAudienceList.filter(c => c.is_prospect_b2b).length;
    const clCount = selectedAudienceList.length - b2bCount;
    let b2bTxt = '';
    if (b2bCount > 0 && clCount > 0) {
      b2bTxt = ` <span style="font-size:11px;color:#065f46">(${b2bCount} Prospectos B2B · ${clCount} Clientes)</span>`;
    } else if (b2bCount > 0) {
      b2bTxt = ` <span style="font-size:11px;color:#065f46">(${b2bCount} Prospectos B2B)</span>`;
    }

    let detailsTxt = '';
    if (!isEmail && nonMobileCount > 0) {
      detailsTxt += ` <span style="color:#64748b;font-size:11px">(${nonMobileCount} omitidos: fijos CANTV o sin WhatsApp)</span>`;
    }
    if (excludedCount > 0) {
      detailsTxt += ` · <span style="color:#b45309;font-size:11px">${excludedCount} omitidos (cooldown / cotización reciente)</span>`;
    }
    if (isEmail && bouncedCount > 0) {
      detailsTxt += ` <span style="color:#ef4444;font-size:11px">(${bouncedCount} omitidos por rebote duro)</span>`;
    }

    const countLabel = isEmail ? `${selectedAudienceList.length} correos` : `${selectedAudienceList.length} móviles WhatsApp`;
    document.getElementById('ceFooterSummary').innerHTML = `Destinatarios válidos: <strong>${countLabel}</strong>${b2bTxt}${detailsTxt}`;
    document.getElementById('ceLaunchBtn').disabled = selectedAudienceList.length === 0;

    // Actualizar badges
    const badgeEl = document.getElementById('ceSelectedProspectsBadge');
    if (badgeEl) badgeEl.textContent = selectedAudienceList.length;
    const analyzeCountEl = document.getElementById('ceAnalyzeCountSpan');
    if (analyzeCountEl) analyzeCountEl.textContent = selectedAudienceList.length;

    const cooldownBadge = document.getElementById('ceCooldownBadge');
    if (cooldownBadge) {
      if (excludedCount > 0) {
        cooldownBadge.textContent = `${excludedCount} omitidos`;
        cooldownBadge.style.display = 'inline-block';
      } else {
        cooldownBadge.style.display = 'none';
      }
    }

    updateAnalyzedCountBadge();
    updatePreview();
  }

  function updateAnalyzedCountBadge() {
    const analyzedCount = selectedAudienceList.filter(c => c._custom_message).length;
    const badge = document.getElementById('ceAnalyzedCountBadge');
    if (badge) badge.textContent = `${analyzedCount}/${selectedAudienceList.length}`;
  }

  function onAttachChange() {
    const wrap = document.getElementById('ceCustomFileWrap');
    if (wrap) {
      wrap.style.display = document.getElementById('ceAttachFile')?.checked ? 'block' : 'none';
    }
    updatePreview();
  }

  function currentAttachOpts() {
    const opts = [];
    if (document.getElementById('ceAttachPdf')?.checked) opts.push('pdf_lista_precios');
    if (document.getElementById('ceAttachImg')?.checked) opts.push('prod_image');
    if (document.getElementById('ceAttachFile')?.checked) opts.push('custom_file');
    return opts;
  }

  function onCustomFileChange(input) {
    updatePreview();
  }

  /* ---------------- MODAL DE SELECCIÓN MANUAL DE PROSPECTOS ---------------- */
  function openProspectPicker() {
    let picker = document.getElementById('campProspectPickerOverlay');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'campProspectPickerOverlay';
      picker.className = 'ce-picker-overlay';
      picker.innerHTML = `
        <div class="ce-picker-dialog">
          <div class="ce-picker-header">
            <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px">
              <span>👥 Seleccionar Prospectos para la Campaña</span>
            </div>
            <button class="ce-close-btn" onclick="CampaignEditor.closeProspectPicker()" title="Cerrar">✕</button>
          </div>
          <div class="ce-picker-body">
            <div class="ce-picker-toolbar">
              <input type="text" id="cePickerSearchInput" class="ce-input" style="flex:1;min-width:200px" placeholder="🔍 Buscar por nombre, RIF, ciudad, notas..." oninput="CampaignEditor.filterProspectPicker(this.value)">
              <button type="button" class="ce-card-action-btn primary" onclick="CampaignEditor.toggleAllProspects(true)">✓ Seleccionar Todos</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.toggleAllProspects(false)">✗ Desmarcar Todos</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:600;color:#64748b">Filtros rápidos:</span>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('todos')">🌐 Todos</button>
              <button type="button" class="ce-card-action-btn" style="color:#065f46;background:#ecfdf5;font-weight:700" onclick="CampaignEditor.setPickerQuickFilter('b2b')">🎯 Prospectos B2B</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('clientes')">👥 Solo Clientes</button>
              <button type="button" class="ce-card-action-btn" style="color:#0369a1;background:#f0f9ff;font-weight:700" onclick="CampaignEditor.setPickerQuickFilter('con_cotizacion')">📑 Con Cotización (&lt;30d)</button>
              <button type="button" class="ce-card-action-btn" style="color:#15803d;background:#f0fdf4;font-weight:700" onclick="CampaignEditor.setPickerQuickFilter('respondieron')">💬 Respondieron</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('con_compras')">Con Compras</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('nuevos')">Nuevos</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('inactivos')">Inactivos (&gt;30d)</button>
            </div>
            <div class="ce-picker-list" id="cePickerList"></div>
          </div>
          <div class="ce-picker-footer">
            <div id="cePickerStats" style="font-size:12px;font-weight:600;color:#475569">0 seleccionados</div>
            <div style="display:flex;gap:8px">
              <button class="ce-btn-cancel" onclick="CampaignEditor.closeProspectPicker()">Cancelar</button>
              <button class="ce-btn-launch" onclick="CampaignEditor.applyProspectSelection()">✓ Confirmar Selección</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(picker);
    }

    // Inicializar borrador con los IDs actualmente seleccionados
    pickerDraftIds = new Set(selectedAudienceList.map(c => c.id));
    pickerSearchQuery = '';
    pickerQuickFilter = 'todos';
    const searchInp = document.getElementById('cePickerSearchInput');
    if (searchInp) searchInp.value = '';

    renderProspectPickerList();
    picker.style.display = 'flex';
  }

  function closeProspectPicker() {
    const picker = document.getElementById('campProspectPickerOverlay');
    if (picker) picker.style.display = 'none';
  }

  function filterProspectPicker(q = '') {
    pickerSearchQuery = String(q || '').toLowerCase().trim();
    renderProspectPickerList();
  }

  function setPickerQuickFilter(filter = 'todos') {
    pickerQuickFilter = filter;
    renderProspectPickerList();
  }

  function renderProspectPickerList() {
    const listWrap = document.getElementById('cePickerList');
    if (!listWrap) return;

    const contacts = currentConfig?.contacts || [];
    const isEmail = currentConfig?.channel === 'email';

    const filtered = contacts.filter(c => {
      if (!isEmail && (!c.phone || !isMobileNum(c.phone))) {
        const best = getBestMobilePhone(c);
        if (best) c.phone = best;
      }
      if (isEmail && !c.email) return false;
      if (!isEmail && !c.phone) return false;

      // Filtros rápidos
      if (pickerQuickFilter === 'b2b' && !c.is_prospect_b2b) return false;
      if (pickerQuickFilter === 'clientes' && c.is_prospect_b2b) return false;
      if (pickerQuickFilter === 'con_cotizacion') {
        const hasQuote = (c.id && recentQuotesMap.has(c.id)) || (c.email && recentQuotesMap.has(String(c.email).toLowerCase().trim())) || (c.phone && recentQuotesMap.has(normPhoneKey(c.phone)));
        if (!hasQuote) return false;
      }
      if (pickerQuickFilter === 'respondieron') {
        const isReplied = (c.status === 'respondio_email' || c.status === 'respondio_wa') || (c.id && recentRepliesMap.has(c.id)) || (c.email && recentRepliesMap.has(String(c.email).toLowerCase().trim())) || (c.phone && recentRepliesMap.has(normPhoneKey(c.phone)));
        if (!isReplied) return false;
      }
      if (pickerQuickFilter === 'con_compras' && (!c.total_orders || c.total_orders === 0)) return false;
      if (pickerQuickFilter === 'nuevos' && (c.total_orders && c.total_orders > 0)) return false;
      if (pickerQuickFilter === 'inactivos' && (!c.total_orders || c.days_since_last <= 30)) return false;

      // Búsqueda
      if (pickerSearchQuery) {
        const text = `${c.name || ''} ${c.company_name || ''} ${c.contact_name || ''} ${c.contact_role || ''} ${c.sector || ''} ${c.rif || ''} ${c.city || ''} ${c.address || ''} ${c.notes || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
        if (!text.includes(pickerSearchQuery)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      listWrap.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;font-size:13px">Ningún contacto coincide con la búsqueda.</div>';
      updatePickerStats(0, filtered.length);
      return;
    }

    listWrap.innerHTML = filtered.map(c => {
      const isChecked = pickerDraftIds.has(c.id);
      const isB2B = Boolean(c.is_prospect_b2b);
      const isAnalyzed = Boolean(c._custom_message || c.custom_wa_body || c.custom_email_body || (c.ai_analysis && c.ai_analysis.dolor_operativo));

      const b2bBadge = isB2B
        ? `<span style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px">🎯 Prospecto B2B · ${escapeHTML(c.sector || 'Rubro')}</span>`
        : `<span style="background:#f1f5f9;color:#475569;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;margin-left:6px">👥 Cliente Cartera</span>`;

      const recentQuote = (c.id && recentQuotesMap.get(c.id)) || (c.email && recentQuotesMap.get(String(c.email).toLowerCase().trim())) || (c.phone && recentQuotesMap.get(normPhoneKey(c.phone)));
      const quoteBadge = recentQuote
        ? `<span style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px" title="Cotización reciente #${recentQuote.quote_number || recentQuote.id.slice(0,6)} ($${Number(recentQuote.estimated_total_usd || 0).toFixed(0)})">📑 Cot #${recentQuote.quote_number || recentQuote.id.slice(0,6)} ($${Number(recentQuote.estimated_total_usd || 0).toFixed(0)})</span>`
        : '';

      const recentReply = (c.id && recentRepliesMap.get(c.id)) || (c.email && recentRepliesMap.get(String(c.email).toLowerCase().trim())) || (c.phone && recentRepliesMap.get(normPhoneKey(c.phone)));
      const isRepliedStatus = c.status === 'respondio_email' || c.status === 'respondio_wa';
      const replyBadge = (recentReply || isRepliedStatus)
        ? `<span style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px" title="${escapeHTML(recentReply?.snippet || 'Respuesta reciente recibida')}">💬 Respondió</span>`
        : '';

      const isCooling = cooldownExcluded.customer.has(c.id) ||
        (isEmail ? cooldownExcluded.email.has(String(c.email || '').toLowerCase().trim()) : cooldownExcluded.phone.has(normPhoneKey(c.phone)));
      const cooldownDetail = isCooling ? (cooldownExcluded.details.get(c.id) || (isEmail ? cooldownExcluded.details.get(String(c.email || '').toLowerCase().trim()) : cooldownExcluded.details.get(normPhoneKey(c.phone)))) : null;
      const cooldownBadge = isCooling
        ? `<span style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px" title="Envío reciente ${cooldownDetail?.at ? new Date(cooldownDetail.at).toLocaleString() : ''}">⏳ Contactado (<${cooldownHours}h)</span>`
        : '';

      const aiBadge = isAnalyzed
        ? `<span style="background:#f3e8ff;color:#6b21a8;font-size:10.5px;padding:2px 6px;border-radius:4px;font-weight:700;display:inline-block;margin-top:2px">🧠 Analizado con IA ✓</span>`
        : '';

      const ordersInfo = (c.total_orders && c.total_orders > 0)
        ? `<span style="color:#15803d;font-weight:600">${c.total_orders} pedidos ($${Number(c.total_usd || 0).toFixed(0)})</span>`
        : (isB2B ? '<span style="color:#059669;font-weight:600">Lead Corporativo</span>' : '<span style="color:#64748b">Nuevo cliente</span>');

      const contactDetail = (c.contact_name || c.contact_role)
        ? `<div style="font-size:11.5px;color:#1e293b;font-weight:600;margin-top:2px">👤 ${escapeHTML(c.contact_name || 'Sin contacto')} ${c.contact_role ? `<span style="color:#64748b;font-weight:400">(${escapeHTML(c.contact_role)})</span>` : ''}</div>`
        : '';

      return `
        <div class="ce-picker-item ${isChecked ? 'selected' : ''}" onclick="CampaignEditor.toggleProspect('${c.id}')">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); CampaignEditor.toggleProspect('${c.id}')">
          <div style="flex:1; min-width:0">
            <div style="font-size:13px; font-weight:700; color:#1e293b; display:flex; align-items:center; flex-wrap:wrap; gap:4px">
              <span>${escapeHTML(c.name || 'Sin Nombre')}</span>
              ${b2bBadge}
              ${quoteBadge}
              ${replyBadge}
              ${cooldownBadge}
            </div>
            ${contactDetail}
            <div style="font-size:11px; color:#64748b; margin-top:2px">
              ${c.rif ? `RIF: ${escapeHTML(c.rif)} · ` : ''}
              ${c.city ? `📍 ${escapeHTML(c.city)} · ` : ''}
              ${isEmail ? (c.email || 'Sin correo') : (c.phone || 'Sin teléfono')}
            </div>
            ${c.notes ? `<div style="font-size:10.5px; color:#475569; font-style:italic; margin-top:2px">📝 ${escapeHTML(c.notes)}</div>` : ''}
            ${aiBadge}
          </div>
          <div style="text-align:right; font-size:11px">
            ${ordersInfo}
          </div>
        </div>
      `;
    }).join('');

    updatePickerStats(pickerDraftIds.size, contacts.length);
  }

  function toggleProspect(id) {
    if (pickerDraftIds.has(id)) pickerDraftIds.delete(id);
    else pickerDraftIds.add(id);
    renderProspectPickerList();
  }

  function toggleAllProspects(checked = true) {
    const contacts = currentConfig?.contacts || [];
    if (checked) {
      contacts.forEach(c => {
        if (currentConfig?.channel === 'email' ? c.email : c.phone) {
          pickerDraftIds.add(c.id);
        }
      });
    } else {
      pickerDraftIds.clear();
    }
    renderProspectPickerList();
  }

  function updatePickerStats(selectedCount, totalCount) {
    const el = document.getElementById('cePickerStats');
    if (el) el.textContent = `${selectedCount} prospectos seleccionados (de ${totalCount})`;
  }

  function applyProspectSelection() {
    manualSelectedIds = new Set(pickerDraftIds);
    closeProspectPicker();
    onAudienceChange();
  }

  /* ---------------- MÉTODOS DE INTELIGENCIA ARTIFICIAL ---------------- */
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
      script.onerror = () => reject(new Error('No se pudo cargar el archivo gemini-client.js. Verifica la conexión.'));
      document.head.appendChild(script);
    });
  }

  function closeAiToneModal() {
    const modal = document.getElementById('campAiToneModal');
    if (modal) {
      modal.classList.remove('op');
      modal.style.display = 'none';
    }
  }

  function openAiToneModal() {
    let modal = document.getElementById('campAiToneModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'campAiToneModal';
      modal.className = 'ce-picker-overlay';
      modal.innerHTML = `
        <div class="ce-picker-dialog" style="max-width:500px; height:auto">
          <div class="ce-picker-header">
            <h3>🤖 Actitud y Enfoque de la IA</h3>
            <button type="button" class="ce-btn-close" id="btnCloseAiToneTop">✕</button>
          </div>
          <div style="padding:20px; font-size:14px; color:#334155;">
            <div id="ceAiToneNotice" style="display:none; margin-bottom:14px; padding:10px 14px; border-radius:8px; font-size:12.5px; line-height:1.45;"></div>
            <p style="margin-top:0; margin-bottom:15px;">¿Qué tipo de mensaje debe redactar la IA para estos prospectos?</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px; border:1px solid #e2e8f0; border-radius:8px;">
                <input type="radio" name="ai_tone" value="presentacion" checked style="margin-top:3px">
                <div>
                  <strong>🚀 Presentación Comercial (Primer contacto)</strong><br>
                  <span style="font-size:12px; color:#64748b">Presenta a JJ Paper desde cero y enfoca el catálogo en las necesidades de su rubro.</span>
                </div>
              </label>
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px; border:1px solid #e2e8f0; border-radius:8px;">
                <input type="radio" name="ai_tone" value="seguimiento" style="margin-top:3px">
                <div>
                  <strong>👀 Seguimiento (Warm up)</strong><br>
                  <span style="font-size:12px; color:#64748b">Retoma el contacto de forma cordial preguntando cómo le ha ido con su inventario.</span>
                </div>
              </label>
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px; border:1px solid #e2e8f0; border-radius:8px;">
                <input type="radio" name="ai_tone" value="recordatorio" style="margin-top:3px">
                <div>
                  <strong>⏰ Recordatorio de Compra</strong><br>
                  <span style="font-size:12px; color:#64748b">Directo al punto: recuerda que estamos listos para despachar su próximo pedido.</span>
                </div>
              </label>
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px; border:1px solid #e2e8f0; border-radius:8px;">
                <input type="radio" name="ai_tone" value="oferta" style="margin-top:3px">
                <div>
                  <strong>🔥 Oferta Relámpago</strong><br>
                  <span style="font-size:12px; color:#64748b">Crea urgencia sobre una promoción o producto específico con alta disponibilidad.</span>
                </div>
              </label>
            </div>
            <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
              <button type="button" class="ce-btn btn-sec" id="btnCancelAiTone">Cancelar</button>
              <button type="button" class="ce-btn btn-pri" id="btnConfirmAiTone">Empezar Análisis ⚡</button>
            </div>
          </div>
        </div>
      `;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAiToneModal();
      });
      document.body.appendChild(modal);

      document.getElementById('btnCloseAiToneTop').onclick = closeAiToneModal;
      document.getElementById('btnCancelAiTone').onclick = closeAiToneModal;

      document.getElementById('btnConfirmAiTone').onclick = () => {
        const toneEl = document.querySelector('input[name="ai_tone"]:checked');
        const tone = toneEl ? toneEl.value : 'presentacion';
        closeAiToneModal();
        startAiAnalysisBatch(tone);
      };
    }

    const totalSelected = selectedAudienceList.length;
    const contactedCount = selectedAudienceList.filter(c => 
      c.contacted || 
      c.last_contact_at || 
      (c.status && String(c.status).startsWith('contactado')) || 
      Number(c.total_orders) > 0
    ).length;

    let defaultTone = 'presentacion';
    let noticeHtml = '';

    if (selectedProductOrCombo) {
      defaultTone = 'oferta';
      noticeHtml = `💡 <strong>Producto seleccionado:</strong> La IA redactará una oferta comercial directa de <em>"${escapeHTML(selectedProductOrCombo.name || selectedProductOrCombo.title)}"</em> destacando disponibilidad inmediata en 24h y cotización oficial en Bs (Tasa BCV).`;
    } else if (contactedCount > 0) {
      defaultTone = 'seguimiento';
      noticeHtml = `👀 <strong>Contactos previos detectados:</strong> ${contactedCount} de ${totalSelected} destinatarios ya recibieron un mensaje anterior. La IA redactará automáticamente un <em>Seguimiento cordial</em> de reposición sin repetir la presentación inicial.`;
    }

    const noticeEl = document.getElementById('ceAiToneNotice');
    if (noticeEl) {
      if (noticeHtml) {
        noticeEl.innerHTML = noticeHtml;
        noticeEl.style.display = 'block';
        noticeEl.style.background = defaultTone === 'oferta' ? '#fef3c7' : '#e0f2fe';
        noticeEl.style.border = defaultTone === 'oferta' ? '1px solid #fde68a' : '1px solid #bae6fd';
        noticeEl.style.color = defaultTone === 'oferta' ? '#92400e' : '#0369a1';
      } else {
        noticeEl.style.display = 'none';
      }
    }

    const targetRadio = document.querySelector(`input[name="ai_tone"][value="${defaultTone}"]`);
    if (targetRadio) targetRadio.checked = true;

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('op'));
  }

  async function startAiAnalysisBatch(selectedTone = 'presentacion') {
    if (isAnalyzingBatch) return;
    if (!selectedAudienceList.length) {
      alert('Por favor selecciona primero los prospectos o clientes a los que dirigirás la campaña.');
      return;
    }

    const btn = document.getElementById('ceStartAiAnalysisBtn');
    const origBtnTxt = btn ? btn.innerHTML : '';
    const progressWrap = document.getElementById('ceAiProgressWrap');
    const progressBar = document.getElementById('ceAiProgressBar');
    const progressLabel = document.getElementById('ceAiProgressLabel');
    const statusTxt = document.getElementById('ceAiFlowStatusTxt');

    isAnalyzingBatch = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Analizando...';
    }
    if (progressWrap) progressWrap.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressLabel) progressLabel.textContent = `Analizando 0 de ${selectedAudienceList.length}...`;
    if (statusTxt) statusTxt.textContent = 'La IA está examinando el rubro y necesidades operativas de cada prospecto...';

    try {
      await ensureGeminiClient();
      if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');

      const isPdf = document.getElementById('ceAttachPdf')?.checked !== false;
      const channel = currentConfig?.channel || 'whatsapp';
      const sName = currentConfig?.seller?.name || '';
      const sPhone = currentConfig?.seller?.phone || '';
      const targetSector = document.getElementById('ceTargetSector')?.value || 'auto';
      const commercialTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
      const valueHook = document.getElementById('ceValueHook')?.value || 'importador_directo';

      await window.GeminiClient.analyzeCustomersBatch({
        customers: selectedAudienceList,
        channel,
        sellerName: sName,
        sellerPhone: sPhone,
        promoProductOrCombo: selectedProductOrCombo,
        products: selectedProductsList,
        officialPdfIncluded: isPdf,
        attitude: selectedTone,
        targetSector,
        commercialTone,
        valueHook,
        forceRefresh: true,
        onProgress: async ({ current, total, customer, result }) => {
          const pct = Math.round((current / total) * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          const custName = customer.name || customer.company_name || '';
          if (progressLabel) progressLabel.textContent = `Analizando ${current} de ${total}: ${custName}... (${pct}%)`;
          customer._custom_message = result.body;
          customer._custom_subject = result.subject;
          customer._detected_need = result.need;
          customer._detected_sector = result.sector;

          // Sincronizar con base de datos jjp_prospects si es un prospecto B2B
          if (customer.id && typeof sb !== 'undefined') {
            const raw = result.raw_analysis || {};
            const isEmail = (channel === 'email');
            const isAlreadyContacted = Boolean(
              customer.contacted ||
              customer.last_contact_at ||
              (customer.status && String(customer.status).startsWith('contactado'))
            );
            const updatePayload = {
              status: isAlreadyContacted ? customer.status : ((customer.status === 'nuevo' || !customer.status) ? 'analizado_ia' : customer.status),
              ai_analysis: {
                sector_deducido: result.sector || customer.sector,
                dolor_operativo: result.need,
                insumos_core: raw.insumos_core || [],
                insumo_cross_sell: raw.insumo_cross_sell || '',
                angulo_seleccionado: raw.angulo_seleccionado || ''
              },
              suggested_subject: result.subject,
              custom_email_body: raw.email_body || (isEmail ? result.body : customer.custom_email_body),
              custom_wa_body: raw.wa_body || (!isEmail ? result.body : customer.custom_wa_body),
              updated_at: new Date().toISOString()
            };

            // Sincronizar memoria del objeto
            customer.ai_analysis = updatePayload.ai_analysis;
            customer.suggested_subject = updatePayload.suggested_subject;
            customer.custom_email_body = updatePayload.custom_email_body;
            customer.custom_wa_body = updatePayload.custom_wa_body;
            customer.status = updatePayload.status;

            // Guardar en jjp_prospects en segundo plano sin bloquear el avance
            sb.from('jjp_prospects').update(updatePayload).eq('id', customer.id)
              .then(() => {})
              .catch(err => console.warn('Aviso guardando en jjp_prospects:', err));
          }

          updateAnalyzedCountBadge();
        }
      });

      if (progressBar) progressBar.style.width = '100%';
      if (progressLabel) progressLabel.textContent = `✅ ¡Análisis completado para los ${selectedAudienceList.length} prospectos!`;
      if (statusTxt) statusTxt.textContent = '¡Listo! Cada prospecto tiene su propuesta comercial personalizada y variaciones anti-spam.';

      activePreviewIdx = 0;
      updatePreview();
      renderProspectCards();

      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = 'none';
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `⚡ Re-analizar con IA (${selectedAudienceList.length})`;
        }
      }, 3500);

    } catch (err) {
      console.error('Error en análisis batch:', err);
      alert('Aviso durante el análisis con IA: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origBtnTxt;
      }
      if (progressWrap) progressWrap.style.display = 'none';
    } finally {
      isAnalyzingBatch = false;
    }
  }

  function stepPreviewCustomer(delta = 1) {
    if (!selectedAudienceList.length) return;
    activePreviewIdx = (activePreviewIdx + delta + selectedAudienceList.length) % selectedAudienceList.length;
    updatePreview();
  }

  function selectPreviewCustomer(idx) {
    if (idx >= 0 && idx < selectedAudienceList.length) {
      activePreviewIdx = idx;
      switchRightTab('simulator');
    }
  }

  async function regenerateActiveCustomer() {
    const cust = selectedAudienceList[activePreviewIdx];
    if (!cust) return;

    const noteEl = document.getElementById('ceCustomerActionNote');
    if (noteEl) noteEl.textContent = `⏳ Regenerando propuesta para ${cust.name}...`;

    try {
      await ensureGeminiClient();
      const isPdf = document.getElementById('ceAttachPdf')?.checked !== false;
      const channel = currentConfig?.channel || 'whatsapp';
      const isEmail = (channel === 'email');

      const targetSector = document.getElementById('ceTargetSector')?.value || 'auto';
      const commercialTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
      const valueHook = document.getElementById('ceValueHook')?.value || 'importador_directo';

      const res = await window.GeminiClient.analyzeCustomerAndDraftMessage({
        customer: cust,
        channel,
        sellerName: currentConfig?.seller?.name || '',
        sellerPhone: currentConfig?.seller?.phone || '',
        promoProductOrCombo: selectedProductOrCombo,
        products: selectedProductsList,
        officialPdfIncluded: isPdf,
        targetSector,
        commercialTone,
        valueHook,
        forceRefresh: true
      });

      cust._custom_message = res.body;
      cust._custom_subject = res.subject;
      cust._detected_need = res.need;
      cust._detected_sector = res.sector;

      // Sincronizar con base de datos jjp_prospects
      if (cust.is_prospect_b2b && cust.id && typeof sb !== 'undefined') {
        const raw = res.raw_analysis || {};
        const updatePayload = {
          status: cust.status === 'nuevo' ? 'analizado_ia' : cust.status,
          ai_analysis: {
            sector_deducido: res.sector || cust.sector,
            dolor_operativo: res.need,
            insumos_core: raw.insumos_core || [],
            insumo_cross_sell: raw.insumo_cross_sell || '',
            angulo_seleccionado: raw.angulo_seleccionado || ''
          },
          suggested_subject: res.subject,
          custom_email_body: raw.email_body || (isEmail ? res.body : cust.custom_email_body),
          custom_wa_body: raw.wa_body || (!isEmail ? res.body : cust.custom_wa_body),
          updated_at: new Date().toISOString()
        };
        sb.from('jjp_prospects').update(updatePayload).eq('id', cust.id)
          .then(() => {})
          .catch(err => console.warn('Aviso sincronizando regeneración en jjp_prospects:', err));
      }

      if (noteEl) noteEl.textContent = `✅ Propuesta regenerada exitosamente.`;
      updatePreview();
      renderProspectCards();
    } catch (err) {
      alert('Error regenerando propuesta: ' + err.message);
      if (noteEl) noteEl.textContent = `💡 Mensaje personalizado único para este cliente.`;
    }
  }

  function editActiveCustomerMessage() {
    const cust = selectedAudienceList[activePreviewIdx];
    if (!cust) return;
    openCustomerEditModal(activePreviewIdx);
  }

  function openCustomerEditModal(idx) {
    editingCustomerIdx = idx;
    const cust = selectedAudienceList[idx];
    if (!cust) return;

    let modal = document.getElementById('campEditCustomerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'campEditCustomerModal';
      modal.className = 'ce-picker-overlay';
      modal.innerHTML = `
        <div class="ce-picker-dialog" style="max-width:650px; height:auto; max-height:85vh">
          <div class="ce-picker-header">
            <div style="font-weight:700;font-size:13.5px" id="ceEditModalTitle">✏️ Editar Mensaje Personalizado</div>
            <button class="ce-close-btn" onclick="CampaignEditor.closeCustomerEditModal()" title="Cerrar">✕</button>
          </div>
          <div class="ce-picker-body" style="padding:16px">
            <div id="ceEditSubjectGroup" style="display:none;margin-bottom:8px">
              <label class="ce-label">Asunto del Correo:</label>
              <input type="text" id="ceEditSubjectInput" class="ce-input" placeholder="Asunto personalizado...">
            </div>
            <div class="ce-field-group">
              <label class="ce-label">Cuerpo del Mensaje (con *negritas*, viñetas y Spintax):</label>
              <textarea id="ceEditBodyTextarea" class="ce-textarea" style="min-height:180px;font-size:13px"></textarea>
            </div>
          </div>
          <div class="ce-picker-footer">
            <button class="ce-btn-cancel" onclick="CampaignEditor.closeCustomerEditModal()">Cancelar</button>
            <button class="ce-btn-launch" onclick="CampaignEditor.saveCustomerEdit()">✓ Guardar Mensaje</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const isEmail = currentConfig?.channel === 'email';
    document.getElementById('ceEditModalTitle').textContent = `✏️ Editar Mensaje para ${cust.name}`;
    document.getElementById('ceEditSubjectGroup').style.display = isEmail ? 'block' : 'none';
    if (isEmail) {
      document.getElementById('ceEditSubjectInput').value = cust._custom_subject || document.getElementById('ceSubjectInput')?.value || '';
    }
    document.getElementById('ceEditBodyTextarea').value = cust._custom_message || document.getElementById('ceMessageInput')?.value || '';

    modal.style.display = 'flex';
  }

  function closeCustomerEditModal() {
    const modal = document.getElementById('campEditCustomerModal');
    if (modal) modal.style.display = 'none';
  }

  function saveCustomerEdit() {
    if (editingCustomerIdx < 0 || editingCustomerIdx >= selectedAudienceList.length) return;
    const cust = selectedAudienceList[editingCustomerIdx];
    const isEmail = currentConfig?.channel === 'email';

    cust._custom_message = document.getElementById('ceEditBodyTextarea')?.value.trim();
    if (isEmail) {
      cust._custom_subject = document.getElementById('ceEditSubjectInput')?.value.trim();
    }

    // Persistir edición manual en base de datos si es prospecto B2B
    if (cust.is_prospect_b2b && cust.id && typeof sb !== 'undefined') {
      const updateData = { updated_at: new Date().toISOString() };
      if (isEmail) {
        updateData.custom_email_body = cust._custom_message;
        if (cust._custom_subject) updateData.suggested_subject = cust._custom_subject;
      } else {
        updateData.custom_wa_body = cust._custom_message;
      }
      sb.from('jjp_prospects').update(updateData).eq('id', cust.id)
        .then(() => {})
        .catch(err => console.warn('Aviso guardando edición en jjp_prospects:', err));
    }

    closeCustomerEditModal();
    updatePreview();
    renderProspectCards();
  }

  function renderProspectCards() {
    const wrap = document.getElementById('ceCardsContainer');
    if (!wrap) return;

    if (!selectedAudienceList.length) {
      wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">No hay prospectos seleccionados en la audiencia.</div>';
      return;
    }

    wrap.innerHTML = selectedAudienceList.map((c, idx) => {
      const isCurrent = (idx === activePreviewIdx);
      const needBadge = c._detected_need
        ? `<span class="ce-need-badge">🎯 ${escapeHTML(c._detected_sector || c.sector || 'Sector')} | ${escapeHTML(c._detected_need)}</span>`
        : `<span style="font-size:10.5px;color:#b45309;background:#fef3c7;padding:2px 6px;border-radius:4px;font-weight:600">⏳ Pendiente de análisis IA</span>`;

      const msgPreview = c._custom_message
        ? escapeHTML(c._custom_message)
        : '<em style="color:#94a3b8">Haz clic en "Analizar y Redactar con IA" para generar la propuesta única de este cliente.</em>';

      return `
        <div class="ce-customer-ai-card ${isCurrent ? 'active-preview' : ''}">
          <div class="ce-customer-ai-header">
            <div>
              <div class="ce-customer-ai-title">
                ${isCurrent ? '👉 ' : ''}${escapeHTML(c.name || 'Cliente')}
                ${c.is_prospect_b2b ? `<span style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-size:10px;padding:2px 5px;border-radius:4px;font-weight:700;margin-left:6px">🎯 B2B</span>` : ''}
              </div>
              <div class="ce-customer-ai-meta">
                ${c.is_prospect_b2b ? (c.contact_role ? `👤 ${escapeHTML(c.contact_role)} · ` : '') : ''}
                ${c.city ? `📍 ${escapeHTML(c.city)} · ` : ''}
                ${c.total_orders > 0 ? `<span style="color:#15803d;font-weight:600">${c.total_orders} pedidos</span>` : (c.is_prospect_b2b ? '<span style="color:#059669;font-weight:600">Lead Corporativo</span>' : 'Nuevo cliente')}
              </div>
            </div>
            <div>${needBadge}</div>
          </div>
          <div class="ce-customer-ai-preview">${msgPreview}</div>
          <div class="ce-customer-ai-actions">
            <button type="button" class="ce-card-action-btn primary" onclick="CampaignEditor.selectPreviewCustomer(${idx})">👁️ Ver en Simulador</button>
            <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.openCustomerEditModal(${idx})">✏️ Editar</button>
            <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.selectPreviewCustomer(${idx}); CampaignEditor.regenerateActiveCustomer()">🔄 Regenerar IA</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ---------------- SIMULADOR INTERACTIVO Y PREVIEW ---------------- */
  function updatePreview() {
    const isEmail = currentConfig?.channel === 'email';
    const currentCust = selectedAudienceList[activePreviewIdx];

    // Stepper label
    const stepperLabel = document.getElementById('ceStepperLabel');
    if (stepperLabel) {
      stepperLabel.textContent = selectedAudienceList.length > 0
        ? `Destinatario ${activePreviewIdx + 1} de ${selectedAudienceList.length}`
        : '0 destinatarios';
    }

    // Nombre y subtítulo del cliente activo
    const nameEl = document.getElementById('cePreviewClientName');
    const subEl = document.getElementById('cePreviewClientSub');
    const badgeWrap = document.getElementById('cePreviewNeedBadgeWrap');

    if (currentCust) {
      if (nameEl) nameEl.textContent = currentCust.name || 'Cliente JJ Paper';
      if (subEl) {
        if (currentCust.is_prospect_b2b) {
          subEl.innerHTML = `<span style="color:#065f46;font-weight:700">🎯 Prospecto B2B (${escapeHTML(currentCust.sector || 'General')})</span>${currentCust.contact_role ? ' · ' + escapeHTML(currentCust.contact_role) : ''} · 📍 ${escapeHTML(currentCust.city || 'Caracas')}`;
        } else {
          subEl.textContent = `${currentCust.city ? '📍 ' + currentCust.city + ' · ' : ''}${currentCust.total_orders > 0 ? currentCust.total_orders + ' pedidos registrados' : 'Cliente nuevo'}`;
        }
      }
      if (badgeWrap) {
        badgeWrap.innerHTML = currentCust._detected_need
          ? `<span class="ce-need-badge" style="font-size:10px">🎯 ${escapeHTML(currentCust._detected_sector || currentCust.sector || 'Rubro')}</span>`
          : '';
      }
    } else {
      if (nameEl) nameEl.textContent = 'Librería El Saber, C.A.';
      if (subEl) subEl.textContent = 'Vista previa interactiva en tiempo real';
      if (badgeWrap) badgeWrap.innerHTML = '';
    }

    const publicBase = location.origin + location.pathname
      .replace(/\/(admin|vendedor)\/.*$/, '').replace(/\/[^/]*$/, '');
    const prodId = selectedProductOrCombo?.raw?.jjp_products?.id || selectedProductOrCombo?.product_id;
    const prodSku = selectedProductOrCombo?.sku || selectedProductOrCombo?.raw?.sku;
    const isCombo = selectedProductOrCombo?.type === 'combo';
    const link = selectedProductOrCombo
      ? (isCombo
          ? `${publicBase}/catalogo.html`
          : (prodSku ? `${publicBase}/catalogo.html?producto=${encodeURIComponent(prodSku)}` : (prodId ? `${publicBase}/catalogo.html?producto=${encodeURIComponent(prodId)}` : `${publicBase}/catalogo.html?q=${encodeURIComponent(selectedProductOrCombo.name || '')}`)))
      : (sellerRefLink ? (sellerRefLink() || `${publicBase}/catalogo.html`) : `${publicBase}/catalogo.html`);

    let rawText = '';
    let subjectText = '';

    if (editorMode === 'ai') {
      if (currentCust?._custom_message) {
        rawText = currentCust._custom_message;
        subjectText = currentCust._custom_subject || 'Propuesta Comercial — JJ Paper C.A.';
      } else {
        rawText = document.getElementById('ceMessageInput')?.value || '';
        subjectText = document.getElementById('ceSubjectInput')?.value || 'Sin asunto';
        
        if (badgeWrap) {
          badgeWrap.innerHTML = '<span style="background-color: #fff3cd; color: #856404; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; border: 1px solid #ffeeba;">⚠️ Sin análisis IA — se enviará la plantilla base</span>';
        }
      }
    } else {
      rawText = document.getElementById('ceMessageInput')?.value || '';
      subjectText = document.getElementById('ceSubjectInput')?.value || 'Sin asunto';
    }

    const sample = {
      nombre: currentCust?.name || 'Librería El Saber',
      empresa: currentCust?.name || 'Librería El Saber, C.A.',
      vendedor: currentConfig?.seller?.name || 'Asesor JJ Paper',
      producto: selectedProductOrCombo?.name || 'Cuaderno Universitario 100h',
      precio: `$${Number(selectedProductOrCombo?.final_price_usd || selectedProductOrCombo?.price_usd || 2.45).toFixed(2)} USD`,
      descuento: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '15%',
      descripcion: selectedProductOrCombo?.description || 'Papelería y suministros de alta calidad con despacho directo.',
      link
    };

    // Resolver variables dobles primero
    let rendered = rawText.replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
      (_, k) => sample[k.trim().toLowerCase()] ?? '');

    // Resolver Spintax
    rendered = rendered.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, choices) => {
      const parts = choices.split('|');
      return parts[0].trim();
    });

    // Adjuntos
    const attachOpts = currentAttachOpts();
    const attachPreviewEl = document.getElementById('ceBubbleAttachment');
    const previewItems = [];

    if (generatedFlyerFile) {
      try {
        const flyerBlobUrl = URL.createObjectURL(generatedFlyerFile);
        previewItems.push(`<div style="position:relative"><img src="${flyerBlobUrl}" alt="Flyer con IA" style="max-height:180px;width:100%;object-fit:cover;border-radius:8px;margin-bottom:6px;border:1px solid #e2e8f0;box-shadow:0 4px 10px rgba(0,0,0,0.06)"><span style="position:absolute;top:6px;right:6px;background:#16604A;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700">🎨 Flyer IA</span></div>`);
      } catch (e) {}
    } else if (attachOpts.includes('prod_image') && selectedProductOrCombo?.image_url) {
      previewItems.push(`<img src="${selectedProductOrCombo.image_url}" alt="Preview" style="max-height:160px;width:100%;object-fit:cover;border-radius:8px;margin-bottom:6px">`);
    }

    if (attachOpts.includes('pdf_lista_precios')) {
      previewItems.push(`<div class="ce-bubble-doc-card">📄 Lista_de_Precios_Mayorista_JJ_Paper.pdf (PDF Oficial +900 arts)</div>`);
    }

    if (attachOpts.includes('custom_file') && !generatedFlyerFile) {
      const file = document.getElementById('ceCustomFileInput')?.files?.[0];
      if (file) {
        previewItems.push(`<div class="ce-bubble-doc-card">📎 ${escapeHTML(file.name)} (${(file.size / 1024).toFixed(1)} KB)</div>`);
      }
    }

    attachPreviewEl.style.display = previewItems.length ? 'block' : 'none';
    attachPreviewEl.innerHTML = previewItems.join('');

    if (isEmail) {
      document.getElementById('ceEmailSubjectHeader').textContent = `Asunto: ${subjectText}`;
    }

    let formatted = escapeHTML(rendered);
    formatted = formatted.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/_(.+?)_/g, '<em>$1</em>');
    formatted = formatted.replace(/~(.+?)~/g, '<del>$1</del>');
    formatted = formatted.replace(/\n/g, '<br>');

    document.getElementById('ceBubbleText').innerHTML = formatted;
    document.getElementById('ceBubbleTime').textContent = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  function insertVar(varName) {
    const textarea = document.getElementById('ceMessageInput');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const tag = `{{${varName}}}`;
    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    updatePreview();
  }

  function insertSpintax() {
    const textarea = document.getElementById('ceMessageInput');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const spin = `{Hola|Buen día|Saludos|Qué tal}`;
    textarea.value = text.substring(0, start) + spin + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + spin.length;
    updatePreview();
  }

  async function aiDraftTemplate() {
    const hasSpecificProducts = (selectedProductsList && selectedProductsList.length > 0) || Boolean(selectedProductOrCombo);
    let obj = '';
    if (selectedProductsList && selectedProductsList.length > 0) {
      obj = `Lote especial de promociones mayoristas (${selectedProductsList.length} artículos destacados con precios de importador)`;
    } else if (selectedProductOrCombo) {
      obj = `Disponibilidad y suministro mayorista de ${selectedProductOrCombo.name}`;
    } else {
      // Solo pedir propuesta personalizada si no se seleccionaron productos específicos
      const defPrompt = 'Actualización de condiciones mayoristas y reposición de inventario';
      obj = prompt('✨ ¿Qué propuesta comercial deseas presentar?\n(Ej: Suministro corporativo de resmas y papel, Reposición para el año escolar, Rollos térmicos para cajas)', defPrompt);
      if (!obj || !obj.trim()) return;
    }

    const btn = document.getElementById('ceAiDraftBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Redactando con IA...';
    }

    try {
      await ensureGeminiClient();
      const targetSector = document.getElementById('ceTargetSector')?.value || 'auto';
      const commercialTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
      const valueHook = document.getElementById('ceValueHook')?.value || 'importador_directo';

      const result = await window.GeminiClient.draftCampaignMessage({
        objective: obj.trim(),
        product: selectedProductOrCombo,
        products: selectedProductsList,
        discount: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '',
        audience: document.getElementById('ceAudienceSelect')?.value || 'todos',
        channel: currentConfig?.channel || 'whatsapp',
        sellerName: currentConfig?.seller?.name || '',
        targetSector,
        tone: commercialTone,
        valueHook
      });

      if (isEmail && result.subject && document.getElementById('ceSubjectInput')) {
        document.getElementById('ceSubjectInput').value = result.subject;
      }
      if (result.body) {
        document.getElementById('ceMessageInput').value = result.body;
      }

      updatePreview();
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🪄 Redactado ✓';
        setTimeout(() => { btn.textContent = origText; }, 2500);
      }
    } catch (err) {
      alert('Error redactando con IA: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  async function aiSectorPitch() {
    const isEmail = currentConfig?.channel === 'email';
    const sector = prompt('Ingresa el sector o rubro para el abordaje B2B:\n(Ej: Supermercados, Retail y Farmacias, Banca, Clínicas y Salud, Logística, Colegios)', 'Supermercados');
    if (!sector) return;

    const btn = document.getElementById('ceAiSectorBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analizando sector con IA… ⏳';
    }

    try {
      await ensureGeminiClient();
      const result = await window.GeminiClient.analyzeAndDraftProspectB2B({
        companyName: '{{empresa}}',
        sector: sector,
        contactName: '{{nombre}}',
        sellerName: currentConfig?.seller?.name || 'Keyder José Salazar',
        sellerPhone: currentConfig?.seller?.phone || '0412-4676073'
      });

      if (isEmail) {
        if (result.subject && document.getElementById('ceSubjectInput')) {
          document.getElementById('ceSubjectInput').value = result.subject;
        }
        if (result.email_body) {
          document.getElementById('ceMessageInput').value = result.email_body;
        }
      } else {
        if (result.wa_body) {
          document.getElementById('ceMessageInput').value = result.wa_body;
        }
      }

      updatePreview();
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🎯 Abordaje Aplicado ✓';
        setTimeout(() => { btn.textContent = origText; }, 2500);
      }
    } catch (err) {
      alert('Error generando propuesta por sector: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  async function aiAntiSpamSpintax() {
    const textarea = document.getElementById('ceMessageInput');
    const text = (textarea?.value || '').trim();
    if (!text) {
      alert('Por favor escribe o selecciona primero un texto de mensaje para variarlo.');
      return;
    }

    const btn = document.getElementById('ceAiSpintaxBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Generando Spintax...';
    }

    try {
      await ensureGeminiClient();
      const spintax = await window.GeminiClient.generateCampaignSpintax(text, currentConfig?.channel || 'whatsapp');
      textarea.value = spintax;
      updatePreview();

      if (btn) {
        btn.disabled = false;
        btn.textContent = '🛡️ Spintax Aplicado ✓';
        setTimeout(() => { btn.textContent = origText; }, 2500);
      }
    } catch (err) {
      alert('Error generando Spintax: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  async function aiDesignFlyer() {
    const hasMultiple = Array.isArray(selectedProductsList) && selectedProductsList.length > 0;
    if (!selectedProductOrCombo && !hasMultiple) {
      alert('Por favor selecciona primero un producto, combo o lista de productos en el panel izquierdo.');
      openCatalogPicker('product');
      return;
    }

    const btn = document.getElementById('ceAiFlyerBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Diseñando Flyer...';
    }

    try {
      await ensureGeminiClient();
      const p = selectedProductOrCombo;
      const prods = (selectedProductsList && selectedProductsList.length > 0)
        ? selectedProductsList
        : (p?.products ? p.products : (p ? [p] : []));

      // Si es un solo producto y no tiene foto, intentar buscar foto comercial real
      if (prods.length === 1 && !prods[0]._studio_photo_url && !prods[0].image_url) {
        if (btn) btn.textContent = '🔍 Buscando Foto Comercial Real...';
        try {
          const realPhoto = await window.GeminiClient.searchRealProductPhoto(prods[0].name);
          if (realPhoto) prods[0]._studio_photo_url = realPhoto;
        } catch (photoSearchErr) {
          console.warn('Búsqueda web de foto comercial no disponible:', photoSearchErr);
        }
      }

      if (btn) btn.textContent = '🎨 Renderizando Flyer con Fotos Reales...';
      const isMulti = prods.length > 1;
      const cvs = await window.GeminiClient.renderMarketingFlyer({
        product: p,
        products: prods,
        customPriceUsd: p?.final_price_usd || p?.price_usd,
        sellerName: currentConfig?.seller?.name || '',
        sellerPhone: currentConfig?.seller?.phone || '',
        customNote: isMulti ? '🔥 Suministros mayoristas garantizados con entrega en 24h' : '🔥 Promoción exclusiva al mayor',
        theme: 'white',
        headline: isMulti ? '🔥 COMBO / LOTE MAYORISTA DESTACADO' : '🔥 OFERTA AL MAYOR'
      });

      cvs.toBlob(async (blob) => {
        if (!blob) throw new Error('No se pudo generar el archivo de imagen.');
        const baseName = (p?.name || (prods[0]?.name ? `Lote_${prods[0].name}` : 'Oferta_Mayorista')).replace(/[^\w.-]/g, '_');
        const fileName = `Flyer_${baseName}.png`;
        generatedFlyerFile = new File([blob], fileName, { type: 'image/png' });

        const chk = document.getElementById('ceAttachFile');
        if (chk) chk.checked = true;

        updatePreview();
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🎨 Flyer Listo ✓';
          setTimeout(() => { btn.textContent = origText; }, 2500);
        }
      }, 'image/png');

    } catch (err) {
      alert('Error generando flyer: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  /* ---------------- DESPACHO Y LANZAMIENTO ---------------- */
  function buildMinimalFallback(c, channel, sellerName, inclPdf) {
    const sName = sellerName || 'Asesor JJ Paper';
    const shown = (c ? (c.company_name || c.name) : null) || 'Estimado Cliente';
    const isContacted = Boolean(
      c && (
        c.contacted ||
        c.last_contact_at ||
        c.contactado_email ||
        c.contactado_wa ||
        (c.status && String(c.status).startsWith('contactado')) ||
        Number(c.total_orders) > 0
      )
    );
    const pdf = inclPdf !== false
      ? '\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.'
      : '';

    let base = '';
    if (isContacted) {
      base = `{Hola|Buen día|Un gusto saludarle de nuevo} ${shown} 👋, un cordial saludo.\n\n{Le saluda atentamente|Le escribe nuevamente} *${sName}* de *JJ Paper C.A.* En seguimiento a nuestra comunicación previa, queríamos consultarles brevemente cómo se encuentran de stock e insumos para sus sedes esta semana.\n\nSomos distribuidores mayoristas de papelería corporativa, consumibles de oficina, insumos de caja y productos de limpieza. Además, *si requiere algún insumo especial que no visualice en nuestra lista de precios, nosotros se lo conseguimos y gestionamos directamente* para garantizar el abastecimiento continuo de su negocio.\n\n*📦 DISPONIBILIDAD INMEDIATA EN:*\n• *Rollos térmicos para puntos de venta* (POS y cajas registradoras).\n• *Resmas de papel Bond Carta y Oficio* y cuadernos de alta rotación.\n• *Cintas de embalaje industrial*, consumibles de oficina y artículos de limpieza institucional.${pdf}\n\n👉 Puede consultar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Tienen algún requerimiento o cotización abierta esta semana en la que podamos apoyarles?|¿Gusta que le reservemos inventario para su despacho de esta semana?|Quedo a su disposición para coordinar lo que necesite.}`;
    } else {
      base = `{Hola|Buen día|Un gusto saludarle} ${shown} 👋, un cordial saludo.\n\n{Le escribe|Le saluda} *${sName}* de *JJ Paper C.A.*, su distribuidor mayorista en Caracas de papelería corporativa, consumibles de oficina, insumos de caja/facturación y productos de limpieza. Además, *si requiere cualquier otro producto que no esté en la lista de precios, nosotros se lo conseguimos directamente* para apoyar la operatividad de su empresa.\n\n*📦 DISPONIBILIDAD INMEDIATA EN:*\n• *Rollos térmicos para puntos de venta* (POS y cajas registradoras).\n• *Resmas de papel Bond Carta y Oficio* y cuadernos de alta rotación.\n• *Cintas de embalaje industrial*, consumibles de oficina y artículos de limpieza institucional.${pdf}\n\n👉 Puede consultar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal para su empresa?|Quedo a su disposición para apoyarle en lo que necesite.}`;
    }

    if (channel === 'email') {
      return `${base}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nCaracas, Venezuela`;
    }
    return `${base}\n\nAtentamente,\n*${sName}* | Teléfono/WhatsApp: ${(typeof window !== 'undefined' && window.CURRENT_PROFILE?.phone) || '0412-4676073'}\nJJ Paper C.A.`;
  }

  async function launch() {
    const name = document.getElementById('ceCampName').value.trim();
    const attachOpts = currentAttachOpts();
    const attachOpt = attachOpts.length ? attachOpts.join(',') : 'none';
    const speed = document.getElementById('ceSpeedSelect')?.value || 'human';
    const isEmail = currentConfig?.channel === 'email';
    let subject = isEmail ? document.getElementById('ceSubjectInput')?.value.trim() : null;
    let body = document.getElementById('ceMessageInput')?.value.trim();

    if (!name) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!selectedAudienceList.length) { alert('No hay destinatarios seleccionados.'); return; }

    // Si estamos en Modo IA y hay prospectos sin analizar
    if (editorMode === 'ai') {
      const missingAnalysis = selectedAudienceList.filter(c => !c._custom_message);
      if (missingAnalysis.length > 0) {
        const doAnalyze = confirm(`Hay ${missingAnalysis.length} prospectos sin propuesta redactada por IA.\n\n¿Deseas analizarlos ahora para que cada cliente reciba su mensaje 100% personalizado y diferente?\n(Si cancelas, se despachará de inmediato con el mensaje actual o plantilla comercial).`);
        if (doAnalyze) {
          openAiToneModal();
          return;
        } else {
          console.log(`[CampaignEditor] Despachando ${missingAnalysis.length} prospectos con mensaje base para envío inmediato.`);
        }
      }
      if (!body || body.includes('Le saludamos cordialmente de JJ Paper...') || body === '{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}') {
        body = buildMinimalFallback(null, currentConfig.channel || 'whatsapp', currentConfig.seller?.name, document.getElementById('ceAttachPdf')?.checked !== false);
      }
      if (isEmail && !subject) subject = '📋 Propuesta Comercial y Lista de Precios Oficial — JJ Paper C.A.';

      // Asegurar que cada contacto de la lista tenga su mensaje y asunto listos sin dejar ninguno vacío
      const isPdfActive = document.getElementById('ceAttachPdf')?.checked !== false;
      selectedAudienceList.forEach(c => {
        const isContacted = Boolean(
          c && (c.contacted || c.last_contact_at || c.contactado_email || c.contactado_wa || (c.status && String(c.status).startsWith('contactado')) || Number(c.total_orders) > 0)
        );
        if (!c._custom_message) {
          c._custom_message = buildMinimalFallback(c, currentConfig?.channel || 'whatsapp', currentConfig?.seller?.name, isPdfActive);
        }
        if (isEmail && !c._custom_subject) {
          c._custom_subject = isContacted
            ? `🤝 Seguimiento Operativo y Reposición para ${c.name || 'su empresa'} — JJ Paper C.A.`
            : (subject || '📋 Propuesta Comercial y Lista de Precios Oficial — JJ Paper C.A.');
        }
      });
    } else {
      if (!body) { alert('El mensaje no puede estar vacío.'); return; }
      if (isEmail && !subject) { alert('El asunto del correo es obligatorio.'); return; }
    }

    const scheduledVal = document.getElementById('ceScheduledAt')?.value;
    let scheduled_at = null;
    if (scheduledVal) {
      const dt = new Date(scheduledVal);
      if (isNaN(dt.getTime())) {
        alert('Fecha u hora programada inválida.');
        return;
      }
      if (dt.getTime() < Date.now() - 60000) {
        alert('La fecha y hora de programación debe ser futura.');
        return;
      }
      scheduled_at = dt.toISOString();
    }

    const delays = {
      human: { min: 45, max: 90 },
      safe: { min: 25, max: 55 },
      ultra_safe: { min: 60, max: 120 },
      fast: { min: 15, max: 30 }
    }[speed] || { min: 45, max: 90 };

    const batchSize = parseInt(document.getElementById('ceBatchSizeSelect')?.value, 10) || 0;
    const batchPauseM = parseInt(document.getElementById('ceBatchPauseSelect')?.value, 10) || 5;

    const fileToUpload = generatedFlyerFile || document.getElementById('ceCustomFileInput')?.files?.[0] || null;
    let finalAttachOpt = attachOpt;
    if (generatedFlyerFile && !finalAttachOpt.includes('custom_file')) {
      finalAttachOpt = finalAttachOpt === 'none' ? 'custom_file' : `${finalAttachOpt},custom_file`;
    }

    const launchConfig = {
      channel: currentConfig.channel || 'whatsapp',
      name,
      body,
      subject,
      audience: selectedAudienceList,
      attachOpt: finalAttachOpt,
      selectedProductOrCombo,
      customFile: fileToUpload,
      generatedFlyerFile,
      delays,
      batchSize,
      batchPauseM,
      scheduled_at,
      isAiMode: (editorMode === 'ai')
    };

    if (typeof currentConfig.onLaunch === 'function') {
      const btn = document.getElementById('ceLaunchBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Encolando campaña...';
      }
      try {
        await currentConfig.onLaunch({
          ...launchConfig,
          updateStatus: (msg) => { if (btn) btn.textContent = msg; }
        });
        close();
      } catch (err) {
        alert('Error al lanzar: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 Lanzar Campaña';
        }
      }
    }

  }

  function close() {
    if (activeOverlay) activeOverlay.classList.remove('active');
  }

  return {
    open,
    close,
    setEditorMode,
    switchRightTab,
    openProspectPicker,
    closeProspectPicker,
    filterProspectPicker,
    setPickerQuickFilter,
    toggleProspect,
    toggleAllProspects,
    applyProspectSelection,
    openAiToneModal,
    closeAiToneModal,
    startAiAnalysisBatch,
    stepPreviewCustomer,
    selectPreviewCustomer,
    regenerateActiveCustomer,
    editActiveCustomerMessage,
    openCustomerEditModal,
    closeCustomerEditModal,
    saveCustomerEdit,
    renderProspectCards,
    openCatalogPicker,
    removeMultiProduct,
    updateMultiProductPrice,
    updateSingleProductPrice,
    applyMultiOfertaTemplate,
    openAiOfferBuilderModal,
    closeAiOfferModal,
    handleAiOfferFileUpload,
    processAiOffersRequest,
    onTypeChange,
    onTemplateChange,
    onAudienceChange,
    onAttachChange,
    onCustomFileChange,
    insertVar,
    insertSpintax,
    updatePreview,
    launch,
    aiDraftTemplate,
    aiSectorPitch,
    aiAntiSpamSpintax,
    aiDesignFlyer
  };
})();
