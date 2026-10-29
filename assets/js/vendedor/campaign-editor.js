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

  
  function resolveContactEmail(c) {
    if (!c) return null;
    const textToScan = `${c.email || ''} ${c.notes || ''}`;
    const found = textToScan.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const unique = [...new Set(found.map(x => x.trim().toLowerCase()))];
    if (!unique.length) return null;
    c.all_emails = unique;

    const isBouncedStatus = (c.email_status === 'bounced' || c.email_status === 'bounced_hard' || c.email_status === 'bounced_soft');
    if (!isBouncedStatus) {
      c.email = unique[0];
      return unique[0];
    }

    // Probar si tiene correos secundarios que no hayan rebotado
    const bReason = String(c.bounce_reason || '').toLowerCase();
    for (let i = 0; i < unique.length; i++) {
      const em = unique[i];
      if (i === 0 && isBouncedStatus) continue;
      if (bReason.includes(em)) continue;
      c.email = em;
      c._is_fallback_email = true;
      return em;
    }
    return null;
  }

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
            // EXCLUSIÓN ESTRICTA: Solo entran en cooldown destinatarios a quienes REALMENTE se les envió el mensaje
            const isSent = (r.status === 'sent' || r.status === 'enviado' || Boolean(r.sent_at));
            if (!isSent) continue;

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
            <span class="ce-channel-badge" id="ceBadge">📧 Email</span>
            <input type="text" class="ce-name-input" id="ceCampName" placeholder="Nombre de la campaña..." value="Propuesta Comercial Mayorista">
          </div>
          <button class="ce-close-btn" onclick="CampaignEditor.close()" title="Cerrar">✕</button>
        </div>

        <!-- Body -->
        <div class="ce-body">
          <!-- Config Panel (Left) -->
          <div class="ce-config-pane" style="padding:0; overflow-y:auto;">
            <!-- Barra Superior de Pestañas Izquierdas -->
            <div class="ce-tab-nav">
              <button type="button" class="ce-tab-btn active" id="ceTabBtn_audiencia" onclick="CampaignEditor.switchLeftTab('audiencia')">
                👥 Audiencia &amp; Modo
              </button>
              <button type="button" class="ce-tab-btn" id="ceTabBtn_insumos" onclick="CampaignEditor.switchLeftTab('insumos')">
                📦 Insumos &amp; Ofertas
              </button>
              <button type="button" class="ce-tab-btn" id="ceTabBtn_redactor" onclick="CampaignEditor.switchLeftTab('redactor')">
                ✨ Estrategia &amp; IA
              </button>
            </div>

            <select class="ce-select" id="ceTemplateSelect" style="display:none;"></select>

            <!-- PESTAÑA 1: Audiencia & Modo Comercial -->
            <div class="ce-tab-panel active" id="ceTabPanel_audiencia">
              <!-- PASO 1: Destinatarios & Audiencia -->
              <div class="ce-step-card">
                <div class="ce-step-header">
                  <span class="ce-step-number">1</span>
                  <div>
                    <div class="ce-step-title">Destinatarios &amp; Audiencia</div>
                    <div class="ce-step-subtitle">Selecciona la lista o segmento a contactar</div>
                  </div>
                </div>
                <div class="ce-field-group">
                  <select class="ce-select" id="ceAudienceSelect" onchange="CampaignEditor.onAudienceChange()">
                    <option value="todos">🌐 Toda la Cartera (Clientes + Prospectos B2B)</option>
                    <option value="prospectos_b2b" selected>🎯 Solo Cartera de Prospectos B2B (Leads Corporativos)</option>
                    <option value="con_cotizacion">📑 Clientes con Cotización Reciente (Hacer Seguimiento)</option>
                    <option value="solo_clientes">🏢 Solo Cartera Clientes Formales (jjp_customers)</option>
                    <option value="gmail_starred">⭐ Destacados en Gmail (Clientes Prioritarios)</option>
                    <option value="respondieron">💬 Contactos que han Respondido</option>
                    <option value="inactivos">😴 Inactivos (sin compras &gt;30d)</option>
                    <option value="sector">🏢 Filtrar por Sector B2B...</option>
                    <option value="etiqueta">🔖 Por etiqueta / zona...</option>
                  </select>
                </div>
                <div class="ce-field-group" id="ceSectorWrap" style="display:none; margin-top:4px;">
                  <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:2px">Sector B2B:</label>
                  <select class="ce-select" id="ceSectorSelect" onchange="CampaignEditor.onAudienceChange()"></select>
                </div>
                <div class="ce-field-group" id="ceTagWrap" style="display:none;">
                  <input type="text" class="ce-input" id="ceTagInput" placeholder="Ej: 004, mayoristas..." oninput="CampaignEditor.onAudienceChange()">
                </div>

                <div style="margin-top:6px; display:flex; gap:6px;">
                  <button type="button" class="ce-var-btn" style="flex:1; background:#f8fafc; border-color:#cbd5e1; font-weight:700; padding:7px 10px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="CampaignEditor.openProspectPicker()">
                    <span>👥 Ver / Modificar Contactos</span>
                    <span class="ce-badge-pill" id="ceSelectedProspectsBadge">0</span>
                  </button>
                </div>

                <!-- Filtro Anti-Fatiga y Cooldown -->
                <div style="margin-top:8px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:#1e293b;cursor:pointer;font-weight:700;">
                      <input type="checkbox" id="ceApplyCooldown" onchange="CampaignEditor.onAudienceChange()" checked>
                      <span>🛡️ Filtro Anti-Fatiga (Cooldown)</span>
                    </label>
                    <span class="ce-badge-pill" id="ceCooldownBadge" style="background:#fee2e2;color:#991b1b;display:none;font-size:10px;">0 omitidos</span>
                  </div>
                  <select class="ce-select" id="ceCooldownHours" onchange="CampaignEditor.onCooldownHoursChange()" style="font-size:11.5px; padding:3px 6px; background:#fff;">
                    <option value="24">⏱️ Omitir contactados en 24h (1 día)</option>
                    <option value="72" selected>⏱️ Omitir contactados en 72h (3 días — Recomendado)</option>
                    <option value="168">⏱️ Omitir contactados en 7 días (1 semana)</option>
                    <option value="360">⏱️ Omitir contactados en 15 días</option>
                    <option value="720">⏱️ Omitir contactados en 30 días</option>
                  </select>
                </div>
              </div>

              <!-- PASO 2: Modo Comercial -->
              <div class="ce-step-card">
                <div class="ce-step-header">
                  <span class="ce-step-number">2</span>
                  <div>
                    <div class="ce-step-title">Enfoque de Contacto</div>
                    <div class="ce-step-subtitle">Define el objetivo y relación comercial</div>
                  </div>
                </div>
                <div class="ce-mode-selector-5">
                  <button type="button" class="ce-mode-btn active" id="ceModeBtn_presentacion_b2b" data-mode="presentacion_b2b" onclick="CampaignEditor.setCampaignMode('presentacion_b2b')">
                    <span class="ce-mode-icon">🏢</span>
                    <span class="ce-mode-title">Presentación B2B</span>
                    <span class="ce-mode-desc">1er contacto formal</span>
                  </button>
                  <button type="button" class="ce-mode-btn" id="ceModeBtn_seguimiento_prospecto" data-mode="seguimiento_prospecto" onclick="CampaignEditor.setCampaignMode('seguimiento_prospecto')">
                    <span class="ce-mode-icon">🤝</span>
                    <span class="ce-mode-title">Seguimiento</span>
                    <span class="ce-mode-desc">A cotización previa</span>
                  </button>
                  <button type="button" class="ce-mode-btn" id="ceModeBtn_reposicion_cliente" data-mode="reposicion_cliente" onclick="CampaignEditor.setCampaignMode('reposicion_cliente')">
                    <span class="ce-mode-icon">🔄</span>
                    <span class="ce-mode-title">Reposición Stock</span>
                    <span class="ce-mode-desc">Clientes habituales</span>
                  </button>
                  <button type="button" class="ce-mode-btn" id="ceModeBtn_oferta_multiproducto" data-mode="oferta_multiproducto" onclick="CampaignEditor.setCampaignMode('oferta_multiproducto')">
                    <span class="ce-mode-icon">🔥</span>
                    <span class="ce-mode-title">Multi-Oferta</span>
                    <span class="ce-mode-desc">Combo / lote ahorro</span>
                  </button>
                  <button type="button" class="ce-mode-btn" id="ceModeBtn_oferta_unipromocion" data-mode="oferta_unipromocion" onclick="CampaignEditor.setCampaignMode('oferta_unipromocion')">
                    <span class="ce-mode-icon">⭐</span>
                    <span class="ce-mode-title">1 Producto</span>
                    <span class="ce-mode-desc">Producto estrella</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- PESTAÑA 2: Insumos & Ofertas del Catálogo -->
            <div class="ce-tab-panel" id="ceTabPanel_insumos">
              <div class="ce-step-card">
                <div class="ce-step-header">
                  <span class="ce-step-number">📦</span>
                  <div>
                    <div class="ce-step-title">Selección de Productos u Ofertas</div>
                    <div class="ce-step-subtitle">Catálogo Mayorista (+2.000 artículos en stock)</div>
                  </div>
                </div>

                <div id="ceProductSelectorContext" style="display:block;margin-bottom:8px;">
                  <button type="button" id="ceCatalogPickerBtn" class="ce-var-btn" style="width:100%;background:#f0fdf4;color:#166534;border-color:#86efac;font-weight:700;padding:10px 12px;font-size:12.5px;" onclick="CampaignEditor.openCatalogPickerForActiveMode()">
                    📦 Explorar Catálogo y Agregar Productos en Oferta ↗
                  </button>
                </div>

                <!-- Tarjetas de Productos Seleccionados con precio editable -->
                <div id="ceSelectedCardWrap" style="display:none; margin-bottom:8px;"></div>

                <div id="ceAutoSectorNotice" style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:11.5px;color:#166534;line-height:1.45;">
                  💡 <strong>Propuestas Inteligentes &amp; Variedad Real:</strong><br>
                  • Si agregas productos arriba, la propuesta incluirá esos insumos específicos con su precio promocional.<br>
                  • Si dejas este catálogo general libre, el sistema seleccionará automáticamente los insumos prioritarios según el sector real de cada cliente (salud, educación, logística, comercio o corporativo, sin imponer un producto fijo).
                </div>
              </div>
            </div>

            <!-- PESTAÑA 3: Estrategia, Tono & Redactor IA -->
            <div class="ce-tab-panel" id="ceTabPanel_redactor">
              <div class="ce-step-card">
                <div class="ce-step-header">
                  <span class="ce-step-number">✨</span>
                  <div>
                    <div class="ce-step-title">Estrategia, Personalidad &amp; IA</div>
                    <div class="ce-step-subtitle">Calibra el tono, perfil y llamada a la acción</div>
                  </div>
                </div>

                <!-- Perfil del Cliente -->
                <div class="ce-field-group" style="margin-bottom:8px;">
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:3px">👤 Perfil y Relación con el Cliente:</label>
                  <select class="ce-select" id="ceClientProfileType" style="font-size:12px;" onchange="CampaignEditor.onToneOrNotesChange()">
                    <option value="auto" selected>🤖 Auto-detectar (Según compras en MixNet / Prospecto)</option>
                    <option value="prospecto_frio">❄️ Prospecto B2B Nuevo (1er Abordaje Comercial)</option>
                    <option value="activo_fidelizado">🤝 Cliente Activo Frecuente (Reposición de Confianza)</option>
                    <option value="inactivo_recuperacion">🔄 Cliente Inactivo (Recuperar Cuenta MixNet)</option>
                    <option value="gran_cuenta">🏛️ Gran Cuenta / Corporativa (Cotización Proforma)</option>
                    <option value="revendedor">📦 Papelería, Librería o Quincalla (Margen Reventa Mayorista)</option>
                  </select>
                </div>

                <!-- Selector de Tono Comercial -->
                <div class="ce-field-group" style="margin-bottom:8px;">
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:3px">🎭 Tono Comercial &amp; Estilo:</label>
                  <select class="ce-select" id="ceCommercialTone" style="font-size:12px;" onchange="CampaignEditor.onToneOrNotesChange()">
                    <option value="seguimiento_destacados">⭐ Seguimiento a Destacados &amp; Clientes Habituales (Reposición y Novedades)</option>
                    <option value="socio_estrategico" selected>🤝 Socio Estratégico y Consultivo (Recomendado)</option>
                    <option value="oportunidad_mayorista">🔥 Oportunidad Mayorista (Precios de Escala &amp; Volumen)</option>
                    <option value="cercano_consultivo">⚡ Consultivo Cercano &amp; Ágil</option>
                    <option value="institucional_formal">🏢 Institucional Formal (Gerencia de Compras &amp; SENIAT)</option>
                    <option value="directo_ejecutivo">💼 Resumen Ejecutivo Directo (Sin Rodeos)</option>
                  </select>
                </div>

                <!-- Finalidad / Llamada a la Acción (CTA) -->
                <div class="ce-field-group" style="margin-bottom:8px;">
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:3px">🎯 Finalidad / Llamada a la Acción (CTA):</label>
                  <select class="ce-select" id="ceCtaGoal" style="font-size:12px;" onchange="CampaignEditor.onToneOrNotesChange()">
                    <option value="quote" selected>📋 Cotización Rápida (Indíquenos qué insumos evalúa para presupuestar)</option>
                    <option value="reposicion_novedades">⭐ Reposición &amp; Novedades (Pase de lista actualizada a la mano)</option>
                    <option value="inventory">📦 Reposición Preventiva (¿Qué insumos están por agotar esta quincena?)</option>
                    <option value="catalog">🌐 Catálogo Digital (Invite a explorar +2.000 artículos en línea)</option>
                    <option value="procura">🔍 Procura Especial (Cualquier formato o medida atípica se la ubicamos)</option>
                  </select>
                </div>

                <!-- Textarea de Instrucciones Libres a la IA -->
                <div style="margin-bottom:10px;">
                  <label style="font-size:11px;font-weight:700;color:#1e293b;display:block;margin-bottom:3px">💡 Instrucción Específica para la IA:</label>
                  <textarea class="ce-textarea" id="ceCustomNotesInput" placeholder="Ej: Enfócate en resmas bond, marcadores acrílicos y embalaje industrial. Resalta entrega gratis hoy en Caracas a Tasa Oficial BCV..." style="min-height:56px;font-size:12px;padding:8px 10px;resize:vertical;" oninput="CampaignEditor.onToneOrNotesChange()"></textarea>
                </div>

                <!-- Botones de Acción IA -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
                  <button type="button" class="ce-regen-btn" id="ceStartAiAnalysisBtn" style="flex:1;" onclick="CampaignEditor.startAiDraftForCampaign()">
                    ⚡ Redactar Propuestas con IA (<span id="ceAnalyzeCountSpan">0</span>)
                  </button>
                  <button type="button" class="ce-var-btn" style="background:#fef2f2;color:#991b1b;border-color:#fecaca;font-weight:700" onclick="CampaignEditor.aiAntiSpamSpintax()" title="Convertir a Spintax anti-bloqueo">
                    🛡️ Spintax
                  </button>
                  <button type="button" class="ce-var-btn" style="background:#eff6ff;color:#1e40af;border-color:#bfdbfe;font-weight:700" onclick="CampaignEditor.openCatalogPickerForActiveMode()" title="Adjuntar Foto Real de Catálogo">
                    📸 Foto Catálogo
                  </button>
                </div>

                <!-- Barra de Progreso IA -->
                <div class="ce-progress-bar-wrap" id="ceAiProgressWrap" style="display:none;margin-bottom:10px;">
                  <div class="ce-progress-bar" id="ceAiProgressBar" style="width:0%"></div>
                  <div class="ce-progress-label" id="ceAiProgressLabel">Iniciando análisis...</div>
                </div>

                <!-- Acordeón / Desplegable: Modificar Redacción Manual & Variables -->
                <details style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;margin-top:6px;">
                  <summary style="font-size:12px;font-weight:700;color:#334155;cursor:pointer;">
                    ✏️ Ver / Editar Texto Base Manual &amp; Variables Dinámicas
                  </summary>
                  <div style="margin-top:8px;">
                    <div id="ceEmailSubjectField" style="margin-bottom:6px;">
                      <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:2px">Asunto Base del Correo:</label>
                      <input type="text" id="ceSubjectInput" class="ce-input" placeholder="Asunto del correo electrónico..." oninput="CampaignEditor.onSubjectInputChange()">
                    </div>

                    <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:2px">Cuerpo Base del Mensaje:</label>
                    <textarea class="ce-textarea" id="ceMessageInput" placeholder="Escribe el mensaje de la campaña..." style="min-height:90px;" oninput="CampaignEditor.onMessageInputChange()"></textarea>

                    <div style="margin-top:6px;">
                      <label style="font-size:10.5px;color:#64748b;display:block;margin-bottom:3px">Variables dinámicas:</label>
                      <div class="ce-variables-grid">
                        <button type="button" class="ce-var-chip" onclick="CampaignEditor.insertVar('nombre')">👤 {{nombre}}</button>
                        <button type="button" class="ce-var-chip" onclick="CampaignEditor.insertVar('empresa')">🏢 {{empresa}}</button>
                        <button type="button" class="ce-var-chip" onclick="CampaignEditor.insertVar('vendedor')">💼 {{vendedor}}</button>
                        <button type="button" class="ce-var-chip" onclick="CampaignEditor.insertVar('link')">🔗 {{link}}</button>
                        <button type="button" class="ce-var-chip" onclick="CampaignEditor.insertSpintax()">🎲 Spintax</button>
                      </div>
                    </div>
                  </div>
                </details>

                <!-- Adjuntos & Seguridad -->
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;">
                  <label style="font-size:11.5px;font-weight:700;color:#1e293b;display:block;margin-bottom:4px">📎 Documentos Adjuntos:</label>
                  <label style="display:flex;align-items:center;font-size:12px;color:#1e293b;padding:3px 0;cursor:pointer;font-weight:600">
                    <input type="checkbox" id="ceAttachPdf" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>📖 Adjuntar Catálogo Oficial JJ Paper (PDF con QR)</span>
                  </label>
                  <label style="display:flex;align-items:center;font-size:12px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachImg" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>🖼️ Ficha / Foto del Producto o Flyer</span>
                  </label>
                  <label style="display:flex;align-items:center;font-size:12px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachFile" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>📁 Subir Archivo Propio (PDF / Imagen)</span>
                  </label>
                  <div id="ceCustomFileWrap" style="display:none; margin-top:6px;">
                    <input type="file" id="ceCustomFileInput" class="ce-input" accept=".pdf,image/*" onchange="CampaignEditor.onCustomFileChange(this)">
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Panel Derecho: Simulador en Vivo 100% Espacioso (EL HÉROE) -->
          <div class="ce-chat-pane" id="ceChatPane">
            <!-- Barra Superior del Simulador (Stepper y Regeneración) -->
            <div class="ce-sim-topbar" id="ceSimTopbar">
              <div class="ce-sim-stepper-box">
                <button type="button" class="ce-stepper-btn" onclick="CampaignEditor.stepPreviewCustomer(-1)">◀ Anterior</button>
                <span id="ceStepperLabel" style="font-size:12px;font-weight:700;color:#334155;">Destinatario 1 de 1</span>
                <button type="button" class="ce-stepper-btn" onclick="CampaignEditor.stepPreviewCustomer(1)">Siguiente ▶</button>
              </div>

              <div class="ce-sim-client-pill" id="ceSimClientPill">
                <span id="cePreviewClientName">Cliente JJ Paper</span>
                <span id="cePreviewNeedBadgeWrap"></span>
              </div>

              <div class="ce-sim-actions">
                <button type="button" class="ce-regen-btn" id="ceRegenCustomerBtn" onclick="CampaignEditor.regenerateActiveCustomer()" title="Regenerar propuesta comercial única con IA para este cliente">
                  🔄 Regenerar con IA
                </button>
              </div>
            </div>

            <!-- Viewport del Simulador (Email vs WhatsApp) -->
            <div class="ce-email-simulator-viewport" id="ceSimViewport">
              <!-- En Email Mode se inyecta la maqueta de correo formal -->
              <div class="ce-email-simulator-frame" id="ceEmailSimulatorFrame" style="display:flex;">
                <!-- Chrome del Correo (De, Para, Asunto) -->
                <div class="ce-email-chrome" id="ceEmailChrome">
                  <div class="ce-email-chrome-row">
                    <span><strong>De:</strong> <span id="ceSimFromEmail">Keyder Salazar &lt;ventas@jjpaper.com&gt;</span></span>
                    <span id="ceSimTimeEmail" style="color:#64748b;font-size:11px;">Hoy</span>
                  </div>
                  <div class="ce-email-chrome-row">
                    <span><strong>Para:</strong> <span id="ceSimToEmail">cliente@empresa.com</span></span>
                  </div>
                  <div class="ce-email-chrome-subject" id="ceSimSubjectText">
                    📄 Propuesta de Suministro Operativo Mayorista — JJ Paper C.A.
                  </div>
                </div>

                <!-- Barra Superior Corporativa en Degradé Institucional -->
                <div style="height:5px;background:linear-gradient(90deg, #16604A 0%, #208b6b 50%, #A7D7A0 100%);"></div>

                <!-- Cabecera Blanca y Limpia con Logo en Alta Definición y RIF -->
                <div class="ce-email-corp-banner" id="ceEmailCorpBanner">
                  <div class="ce-email-corp-banner-inner">
                    <img src="https://jjpaper.pages.dev/assets/img/logo.svg" alt="JJ Paper" class="ce-email-corp-logo" onerror="this.style.display='none'">
                    <div>
                      <div class="ce-email-corp-title">JJ PAPER <span style="font-size:14px;font-weight:700;color:#16604A;">C.A.</span></div>
                      <div class="ce-email-corp-sub">RIF: <strong style="color:#0f172a;">J-29537545-0</strong> · Importador &amp; Distribuidor Mayorista Directo</div>
                      <div style="margin-top:5px;">
                        <span style="display:inline-block;padding:2px 8px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:11px;color:#16604A;font-weight:600;">
                          📍 Caracas, Venezuela · Despacho Corporativo en 24h
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Adjuntos en el simulador (si aplica) -->
                <div id="ceSimAttachmentWrap" style="display:none;padding:12px 28px 0 28px;"></div>

                <!-- Cuerpo del Correo -->
                <div class="ce-email-body-content" id="ceSimBodyContent"></div>

                <!-- Footer Legal Institucional -->
                <div class="ce-email-footer-legal" id="ceEmailFooterLegal">
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                      <strong>JJ PAPER C.A.</strong> · RIF: J-29537545-0 · Facturación fiscal SENIAT a Tasa Oficial BCV.<br>
                      📞 +58 412 2830185 / 0212 7531777 · 📍 Caracas, Venezuela · Despacho y Distribución Mayorista Directa
                    </div>
                    <div style="font-size:11px;color:#94a3b8;">
                      Comunicación Comercial B2B Oficial
                    </div>
                  </div>
                </div>
              </div>

              <!-- En WhatsApp Mode se muestra la burbuja de WhatsApp -->
              <div class="ce-bubble-container" id="ceWaSimulatorWrap" style="display:none;">
                <div class="ce-bubble" id="ceBubble">
                  <div id="ceBubbleAttachment" class="ce-bubble-attachment-preview" style="display:none;"></div>
                  <div class="ce-bubble-text" id="ceBubbleText"></div>
                  <div class="ce-bubble-footer">
                    <span id="ceBubbleTime">10:45 AM</span>
                    <span class="ce-checkmarks" id="ceCheckmarks">✓✓</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Vista 2: Lista de Tarjetas de Prospectos Analizados (Oculta por defecto) -->
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
    const aiBar = document.getElementById('ceAiFlowBar');
    const rightSubtabs = document.getElementById('ceRightSubtabs');
    const simStepper = document.getElementById('ceSimStepper');
    const activeActions = document.getElementById('ceActiveCustomerActions');
    const composerArea = document.getElementById('ceComposerArea');

    if (aiBar) aiBar.style.display = 'flex';
    if (rightSubtabs) rightSubtabs.style.display = 'flex';
    if (simStepper) simStepper.style.display = 'flex';
    if (activeActions) activeActions.style.display = 'flex';
    if (composerArea) composerArea.style.display = 'block';
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

  function switchLeftTab(tab = 'audiencia') {
    const tabs = ['audiencia', 'insumos', 'redactor'];
    tabs.forEach(t => {
      const btn = document.getElementById(`ceTabBtn_${t}`);
      const panel = document.getElementById(`ceTabPanel_${t}`);
      if (btn) btn.classList.toggle('active', t === tab);
      if (panel) panel.classList.toggle('active', t === tab);
    });
  }

  /* ---------------- INTELIGENCIA DE PROPUESTAS COMERCIALES ÚNICAS ---------------- */
  function generateCustomerTailoredProposal(cust) {
    if (!cust) return { subject: 'Propuesta Comercial — JJ Paper C.A.', message: '', sector: 'Comercial', need: 'Suministro mayorista' };
    
    const isEmail = currentConfig?.channel === 'email';
    const sName = currentConfig?.seller?.name || 'Keyder José Salazar';
    const sPhone = currentConfig?.seller?.phone || '0412-4676073 / 0212-7531777';
    const rate = (typeof getRate === 'function') ? getRate() : (window.APP?.EXCHANGE_RATE || 0);

    const compName = cust.company_name || cust.name || 'su empresa';
    const contactPerson = cust.contact_name || '';
    const contactRole = cust.contact_role || '';
    const city = cust.city || 'Caracas';
    const low = `${compName} ${cust.sector || ''} ${cust.notes || ''} ${cust.tags || ''} ${cust.order_history_summary || ''}`.toLowerCase();

    // 1. Detección de Perfil
    const profileSel = document.getElementById('ceClientProfileType')?.value || 'auto';
    let profile = profileSel;
    if (profile === 'auto') {
      if (Number(cust.total_orders) > 0) {
        profile = 'activo_fidelizado';
      } else if (cust.is_prospect_b2b) {
        profile = 'prospecto_frio';
      } else {
        profile = 'prospecto_frio';
      }
    }

    // 2. Detección de Rubro y Selección de Insumos Reales (+2.000 artículos en catálogo)
    let sector = 'Oficinas y Corporativo';
    let need = 'Abastecimiento continuo de resmas, archivo contable SENIAT y consumibles de escritorio';
    let items = [];

    const hasCustomProds = (selectedProductsList && selectedProductsList.length > 0) || Boolean(selectedProductOrCombo);
    if (hasCustomProds) {
      const pList = (selectedProductsList && selectedProductsList.length > 0)
        ? selectedProductsList
        : (selectedProductOrCombo?.products || [selectedProductOrCombo]);
      
      sector = cust.sector || 'Lote Mayorista Seleccionado';
      need = 'Suministro mayorista directo con precios de importador y entrega inmediata';
      items = pList.map(p => {
        const pUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const pBs = (rate > 0 && pUsd > 0)
          ? ` (Bs. ${(pUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a Tasa Oficial BCV)`
          : ' (Cotización formal a Tasa Oficial BCV)';
        const pUnit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
        return `• *${p.name || 'Artículo'}*${pUnit} ➔ *$${pUsd.toFixed(2)} USD*${pBs}`;
      });
    } else if (/farmacia|droguer[ií]a|farma/i.test(low)) {
      sector = 'Farmacias y Salud Retail';
      need = 'Cero quiebres en rollos para puntos de venta fiscales, resmas de facturación y embalaje de bultos';
      items = [
        `• *Rollos térmicos certificados libres de polvillo* (80×70mm y 57×40mm) ➔ Alta nitidez para cajas y POS.`,
        `• *Sobres manila y resmas de papel Bond* ➔ Archivo de récipes, reportes diarios y facturación.`,
        `• *Cintas de embalaje transparente y marrón (48mm × 100m)* ➔ Sellado seguro y entrega de despachos.`
      ];
    } else if (/cl[ií]nica|salud|m[eé]dico|dental|laboratorio|hospital|consultorio|sanatorio|odontol/i.test(low)) {
      sector = 'Clínicas, Salud y Laboratorios';
      need = 'Historias médicas protegidas, sobres de estudios diagnósticos y papelería de admisión';
      items = [
        `• *Sobres para estudios y radiografías (14×17 y Oficio)* ➔ Entrega profesional de resultados y placas.`,
        `• *Carpetas de historias médicas con divisiones y ganchos* ➔ Resguardo normativo clínico a largo plazo.`,
        `• *Resmas de papel Bond Carta y Oficio (75g/80g)* ➔ Informes médicos, récipes y órdenes de admisión sin atascos.`
      ];
    } else if (/colegio|escuela|instituto|liceo|educaci[oó]n|educativo|universidad|acad[eé]mico|docente|plantel/i.test(low)) {
      sector = 'Instituciones Educativas';
      need = 'Dotación institucional de papel para evaluaciones continuas y material docente de aula';
      items = [
        `• *Resmas de papel Bond Carta y Oficio (75g y 80g)* ➔ Precios mayoristas por bulto cerrado para exámenes y guías.`,
        `• *Marcadores de pizarra acrílica recargables y borradores* ➔ Insumos docentes de alta duración y pigmentación.`,
        `• *Carpetas de expedientes estudiantiles, cartulinas y cuadernos* ➔ Dotación y archivo académico continuo.`
      ];
    } else if (/transporte|log[ií]stica|env[ií]os|cargo|almac[eé]n|ferreter[ií]a|repuestos|distribuidora|aduana|embalaje/i.test(low)) {
      sector = 'Logística, Almacenes y Envíos';
      need = 'Embalaje industrial de alta resistencia y rotulación indeleble en traslados y despacho';
      items = [
        `• *Cintas de embalaje de alto micraje (48mm × 100m/200m marrón y transparente)* ➔ Adhesivo extra-fuerte para bultos pesados.`,
        `• *Marcadores industriales permanentes (Servicio 80 / Sharpie)* ➔ Rotulación indeleble resistente al agua y roce.`,
        `• *Dispensadores tipo pistola, exactos metálicos y tirros* ➔ Agilidad y seguridad en cerrado de paletas y cajas.`
      ];
    } else if (/librer[ií]a|papeler[ií]a|bazar|quincalla|variedades|copias|comercio|detal/i.test(low)) {
      sector = 'Librerías y Papelerías (Reventa Mayorista)';
      need = 'Margen de ganancia directo de importador y marcas líderes de alta rotación de mostrador';
      items = [
        `• *Resmas de papel Bond Carta y Oficio por bulto cerrado* ➔ Costo mayorista de importador para maximizar margen.`,
        `• *Cuadernos engrapados, cosidos y espiral* ➔ Surtido escolar y corporativo de rápida salida en vitrina.`,
        `• *Línea escolar y oficina (bolígrafos por caja, carpetas, pegas, tijeras)* ➔ Precios de distribuidor directo.`
      ];
    } else if (/supermercado|abasto|bodeg[oó]n|charcuter[ií]a|panader[ií]a|automercado|minimarket|viveres|alimentos|restaurante|caf[eé]/i.test(low)) {
      sector = 'Supermercados, Alimentos y Retail';
      need = 'Continuidad en líneas de cajas registradoras, resguardo de billetes y empaque';
      items = [
        `• *Rollos térmicos certificados para cajas registradoras (80×70mm y 80×80mm)* ➔ Papel térmico puro sin pelusa.`,
        `• *Marcadores detectores de billetes falsos Kores* ➔ Protección inmediata en cobros de caja.`,
        `• *Cintas de embalaje industrial y resmas de facturación interna* ➔ Cierre firme de bultos y administración.`
      ];
    } else if (/banco|seguros|financier|consultor|asesor|legal|abogad|contab|inmobiliari/i.test(low)) {
      sector = 'Banca, Seguros y Servicios Financieros';
      need = 'Resguardo documental normativo SENIAT/SUDEBAN y papel de alta presentación';
      items = [
        `• *Archivadores de palanca de 3" con cantoneras metálicas* ➔ Organización reglamentaria y resguardo a 10 años.`,
        `• *Resmas de papel Bond Carta y Oficio (80g)* ➔ Máxima blancura y pulcritud para contratos e informes ejecutivos.`,
        `• *Carpetas de fibra marrón con ganchos y bolígrafos ejecutivos* ➔ Suministro continuo para oficinas y firmas.`
      ];
    } else if (/construc|ingenier|arquitect|metal|industri|f[aá]brica|planta|manufactur/i.test(low)) {
      sector = 'Industria, Manufactura y Construcción';
      need = 'Suministros de empaque pesado, rotulación de planta y papelería de control técnico';
      items = [
        `• *Cintas de embalaje industrial reforzadas (48mm × 100m/200m)* ➔ Adhesión duradera sobre bultos de carga pesada.`,
        `• *Marcadores industriales permanentes y pintura sólida* ➔ Rotulación técnica resistente a polvo y humedad.`,
        `• *Resmas de papel Bond para planos, especificaciones e informes* ➔ Abastecimiento continuo de oficina y planta.`
      ];
    } else {
      sector = 'Oficinas Corporativas y Empresas B2B';
      need = 'Abastecimiento continuo de resmas, archivo contable SENIAT y consumibles de escritorio';
      items = [
        `• *Resmas de papel Bond Carta y Oficio (75g/80g)* ➔ Máxima blancura para impresión continua de contratos e informes.`,
        `• *Archivadores de palanca de 3 pulgadas y carpetas de archivo* ➔ Resguardo normativo y organización contable SENIAT.`,
        `• *Consumibles de escritorio (bolígrafos por caja, grapas 26/6, notas adhesivas)* ➔ Dotación completa para su personal.`
      ];
    }

    let historyMention = '';
    if (cust.order_history_summary) {
      historyMention = `Revisando sus compras anteriores en JJ Paper (con registro de ${cust.order_history_summary}), hoy disponemos de inventario físico para su reposición inmediata.`;
    }

    // 3. Tono Comercial y CTA
    const tone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
    const cta = document.getElementById('ceCtaGoal')?.value || 'quote';
    const customUserNotes = (document.getElementById('ceCustomNotesInput')?.value || '').trim();

    // Sanitización B2B: si contact_name contiene basura de scraping (ej. 'Correo directo de Compras...'), se descarta
    const cleanPerson = (typeof window.sanitizeB2BContactName === 'function')
      ? window.sanitizeB2BContactName(contactPerson, compName)
      : null;
    const greetFormal = cleanPerson ? `Estimado(a) ${cleanPerson} (${compName}):` : `Estimado equipo de ${compName}:`;
    const greetWa = cleanPerson ? `Hola ${cleanPerson} 👋 (${compName}),` : `Estimado equipo de ${compName} 👋,`;
    const greeting = isEmail ? greetFormal : greetWa;

    let subject = '';
    if (profile === 'activo_fidelizado') {
      subject = `🔄 Reposición de Insumos y Disponibilidad Inmediata para ${compName} — JJ Paper`;
    } else if (profile === 'inactivo_recuperacion') {
      subject = `👋 ¡Un gusto saludarles de nuevo! Nuevas Condiciones Mayoristas para ${compName} — JJ Paper`;
    } else if (tone === 'oportunidad_mayorista') {
      subject = `🔥 Precios Mayoristas y Lote Disponible para ${compName} — JJ Paper C.A.`;
    } else if (tone === 'institucional_formal') {
      subject = `📋 Propuesta Formal de Abastecimiento Operativo para ${compName} | JJ Paper C.A.`;
    } else {
      subject = `📦 Suministro Mayorista Directo y Catálogo para ${compName} — JJ Paper`;
    }

    let ctaLine = '¿Le preparamos una cotización comparativa para su requerimiento de esta semana?';
    if (cta === 'inventory') {
      ctaLine = '¿Qué insumos están por agotar en sus oficinas para reservarles disponibilidad hoy mismo?';
    } else if (cta === 'catalog') {
      ctaLine = 'Le invitamos a consultar nuestro catálogo interactivo en línea con más de 2.000 artículos disponibles.';
    } else if (cta === 'procura') {
      ctaLine = '¿Busca algún formato, medida o artículo especial que no consiga? Se lo ubicamos y cotizamos de inmediato.';
    }

    let notesExtra = customUserNotes ? `\n\n📌 *CONDICIÓN ESPECIAL:* ${customUserNotes}` : '';
    const rateBcvStr = rate > 0 ? ` (${rate.toFixed(2)} Bs/USD)` : '';
    const rateBsStr = rate > 0 ? ` (${rate.toFixed(2)} Bs)` : '';

    let message = '';
    if (profile === 'activo_fidelizado') {
      message = `${greeting}\n\nAgradecemos su constante confianza en nuestras soluciones de papelería y suministros. ${historyMention || 'Queríamos consultar cómo se encuentra su inventario operativo para esta quincena y apoyarles antes de que se agoten insumos clave en sus sedes:'}\n\n*📦 INSUMOS DESTACADOS PARA SU SECTOR (${sector.toUpperCase()}):*\n${items.join('\n')}\n\n*💎 VENTAJAS DE OPERAR CON JJ PAPER:*\n• 🏭 *Importador y Distribuidor Directo:* Precios de primera mano sin intermediarios.\n• 🧾 *Facturación Fiscal SENIAT:* En bolívares calculados a Tasa Oficial BCV${rateBcvStr}.\n• 🚚 *Despacho Prioritario 24h:* Entrega gratuita directa en sus sedes en ${city}.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.${notesExtra}\n\n👉 Revise nuestro Catálogo Digital Oficial (+2.000 artículos en stock): {{link}}\n\n${ctaLine}\n\nAtentamente,\n*${sName}*\nDirección Comercial | JJ Paper C.A.\n📞 ${sPhone} · Caracas, Venezuela`;
    } else if (profile === 'inactivo_recuperacion') {
      message = `${greeting}\n\nLe escribe ${sName} de *JJ Paper C.A.* Pasamos por aquí para retomar contacto con ${compName} y compartirle que hemos renovado nuestro catálogo con más de 2.000 productos de papelería, archivo corporativo y embalaje a precios mayoristas de importador directo.\n\n*📦 DISPONIBILIDAD INMEDIATA PARA SU SECTOR (${sector.toUpperCase()}):*\n${items.join('\n')}\n\n*🛡️ CONDICIONES ESPECIALES DE REACTIVACIÓN:*\n• 🏭 Precios directos de distribuidor calculados a **Tasa Oficial BCV**${rateBsStr}.\n• 🧾 Facturación fiscal legal SENIAT y cotizaciones formales en minutos.\n• 🚚 Despacho exprés sin costo en ${city} directamente en su puerta.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.${notesExtra}\n\n👉 Catálogo interactivo completo sin login: {{link}}\n\n${ctaLine}\n\nUn cordial saludo,\n*${sName}*\nAsesor Comercial | JJ Paper C.A.\n📞 ${sPhone}`;
    } else if (tone === 'institucional_formal') {
      message = `Estimada Gerencia de Compras y Administración en ${compName}:\nPresente.-\n\nPor medio de la presente, *JJ Paper C.A.* (RIF J-29537545-0), empresa importadora y distribuidora mayorista en Caracas, somete a su consideración nuestra propuesta formal de abastecimiento corporativo para sus operaciones en ${city}:\n\n*LÍNEAS DE SUMINISTRO DISPONIBLES (${sector.toUpperCase()}):*\n${items.join('\n')}\n\nGARANTÍAS INSTITUCIONALES:\n- Facturación fiscal conforme a normativas del SENIAT a Tasa Oficial BCV${rateBcvStr}.\n- Servicio de entrega directa sin cargo en el Área Metropolitana de Caracas en 24h.\n- Suministro continuo y resguardo de archivo reglamentario a 10 años.\n- 🔍 ¿Requiere un insumo, medida o maquinaria fuera de catálogo? Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.${notesExtra}\n\nCatálogo digital corporativo: {{link}}\n\n${ctaLine}\n\nAtentamente,\n*${sName}*\nEjecutivo de Cuentas Corporativas | JJ Paper C.A.\nTeléfono: ${sPhone} · Caracas, Venezuela`;
    } else if (tone === 'oportunidad_mayorista') {
      message = `${greeting}\n\nHoy habilitamos en nuestro centro de distribución de Caracas condiciones preferenciales por volumen y escala cerrada adaptadas a ${compName}:\n\n*🔥 LOTE MAYORISTA DISPONIBLE (${sector.toUpperCase()}):*\n${items.join('\n')}\n\n*🚀 BENEFICIOS DE COMPRA MAYORISTA:*\n• 🏭 Precios de primera mano de importador a **Tasa Oficial BCV**${rateBsStr}.\n• 🧾 Facturación formal SENIAT (RIF J-29537545-0).\n• 🚚 Delivery corporativo gratis y prioritario en ${city}.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.${notesExtra}\n\n👉 Catálogo digital completo: {{link}}\n\n${ctaLine}\n\nAtentamente,\n*${sName}* | Dirección Comercial JJ Paper C.A.\n📞 ${sPhone}`;
    } else {
      message = `${greeting}\n\nConociendo las exigencias operativas del sector ${sector} en ${city}, nos ponemos a la orden como su aliado mayorista directo para optimizar sus costos en insumos esenciales y papelería diaria:\n\n*📦 SUMINISTROS ESENCIALES PARA SU OPERACIÓN:*\n${items.join('\n')}\n\n*💎 RESPALDO OPERATIVO JJ PAPER:*\n• 🏭 *Importador y Distribuidor Directo:* Cero intermediarios y disponibilidad en almacén.\n• 🧾 *Facturación Legal SENIAT:* En bolívares calculada a Tasa Oficial BCV${rateBsStr}.\n• 🚚 *Despacho en 24h:* Entrega gratuita directa en su empresa.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.${notesExtra}\n\n👉 Revise nuestro Catálogo Digital Oficial (sin claves ni registros): {{link}}\n\n${ctaLine}\n\nAtentamente,\n*${sName}*\nAsesor Comercial | JJ Paper C.A.\n📞 ${sPhone} · Caracas, Venezuela`;
    }

    return { subject, message, sector, need };
  }

  function populateAudienceUniqueProposals(force = false) {
    if (!selectedAudienceList || !selectedAudienceList.length) return;
    selectedAudienceList.forEach(c => {
      if (force || !c._is_manual_edit || !c._custom_message) {
        const prop = generateCustomerTailoredProposal(c);
        c._custom_message = prop.message;
        c._custom_subject = prop.subject;
        c._detected_sector = prop.sector;
        c._detected_need = prop.need;
      }
    });
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
    config.combos = [];
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
    if (badge) {
      badge.textContent = isEmail ? '📧 Email' : '📱 WhatsApp';
      badge.className = 'ce-channel-badge ' + (isEmail ? 'email' : '');
    }
    
    const chatPane = document.getElementById('ceChatPane');
    if (chatPane) chatPane.className = 'ce-chat-pane ' + (isEmail ? 'email-mode' : '');
    const emailSubjField = document.getElementById('ceEmailSubjectField');
    if (emailSubjField) emailSubjField.style.display = isEmail ? 'block' : 'none';
    const emailSubjHdr = document.getElementById('ceEmailSubjectHeader');
    if (emailSubjHdr) emailSubjHdr.style.display = isEmail ? 'block' : 'none';
    const secEl = document.getElementById('ceSecuritySection');
    if (secEl) secEl.style.display = isEmail ? 'none' : 'block';
    const chkMarks = document.getElementById('ceCheckmarks');
    if (chkMarks) chkMarks.style.display = isEmail ? 'none' : 'inline';
    const bTime = document.getElementById('ceBubbleTime');
    if (bTime) bTime.style.display = isEmail ? 'none' : 'inline';

    // Restablecer casillas de adjuntos (PDF activo por defecto)
    // Restablecer casillas de adjuntos (por defecto limpio, sin PDF obsoleto)
    const pdfChk = document.getElementById('ceAttachPdf');
    if (pdfChk) pdfChk.checked = false;
    const imgChk = document.getElementById('ceAttachImg');
    if (imgChk) imgChk.checked = Boolean(selectedProductOrCombo?.image_url);
    const fileChk = document.getElementById('ceAttachFile');
    if (fileChk) fileChk.checked = false;

    const customWrap = document.getElementById('ceCustomFileWrap');
    if (customWrap) customWrap.style.display = 'none';

    const campNameInput = document.getElementById('ceCampName');
    if (campNameInput) {
      campNameInput.value = config.defaultName || (isEmail ? 'Campaña de Email ' : 'Difusión WhatsApp ') + new Date().toLocaleDateString('es-VE');
    }

    const availableTpls = (config.templates || []).filter(t => !t.channel || t.channel === config.channel || t.channel === 'both');
    const tplSel = document.getElementById('ceTemplateSelect');
    if (tplSel) {
      tplSel.innerHTML = availableTpls.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    
    setEditorMode('ai');
    setCampaignMode(config.preMode || 'presentacion_b2b');

    if (availableTpls.length > 0 && config.preTplId) {
      onTemplateChange();
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
    const type = document.getElementById('ceTypeSelect')?.value;
    if (!type) return;
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

  function onSectorStrategyChange() {
    const sec = document.getElementById('ceTargetSector')?.value || 'auto';
    const tone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
    const hook = document.getElementById('ceValueHook')?.value || 'importador_directo';

    const toneNames = {
      socio_estrategico: '💼 Socio Estratégico',
      oportunidad_mayorista: '🔥 Oferta Mayorista',
      cercano_consultivo: '🤝 Cercano y Consultivo',
      institucional_formal: '🏢 Institucional Formal',
      fidelizado_reactivacion: '💎 Cliente VIP / Fidelizado'
    };

    const statusEl = document.getElementById('ceStrategyStatus');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = `✨ <strong>Estrategia Activa:</strong> ${toneNames[tone] || tone} · Sector: ${sec.toUpperCase()}`;
    }

    const aud = document.getElementById('ceAudienceSelect')?.value;
    if (aud === 'sector' && sec !== 'auto') {
      const secSel = document.getElementById('ceSectorSelect');
      if (secSel && secSel.value !== sec) {
        secSel.value = sec;
        onAudienceChange();
      }
    }
  }

  async function onCooldownHoursChange() {
    const hoursSelectVal = document.getElementById('ceCooldownHours')?.value;
    const hours = hoursSelectVal !== undefined ? parseInt(hoursSelectVal, 10) : 72;
    cooldownHours = hours;
    currentLoadedCooldownHours = null;
    await reloadCooldown(true);
    await onAudienceChange();
  }

  function renderSelectedCard() {
    const cardWrap = document.getElementById('ceSelectedCardWrap');
    if (!cardWrap) return;
    const type = document.getElementById('ceTypeSelect')?.value;

    if ((activeCampaignMode === 'oferta_multiproducto' || type === 'multi_oferta') && selectedProductsList.length > 0) {
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

  
  let activeCampaignMode = 'presentacion_b2b';

  function setCampaignMode(mode) {
    if (!mode) mode = 'presentacion_b2b';
    activeCampaignMode = mode;

    const modeBtns = ['presentacion_b2b', 'seguimiento_prospecto', 'reposicion_cliente', 'oferta_multiproducto', 'oferta_unipromocion'];
    modeBtns.forEach(m => {
      const btn = document.getElementById('ceModeBtn_' + m);
      if (btn) {
        if (m === mode) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });

    // Limpiar mensajes personalizados anteriores para que toda la audiencia adopte el nuevo modo seleccionado
    selectedAudienceList.forEach(c => {
      delete c._custom_message;
      delete c._custom_subject;
      delete c._is_manual_edit;
    });

    // Mantener la audiencia seleccionada por el usuario en el Paso 1 (NO pisarla)
    const audSel = document.getElementById('ceAudienceSelect');
    if (audSel && (!selectedAudienceList || selectedAudienceList.length === 0)) {
      if (mode === 'presentacion_b2b') {
        audSel.value = 'prospectos_b2b';
      } else if (mode === 'seguimiento_prospecto') {
        audSel.value = 'con_cotizacion';
      } else if (mode === 'reposicion_cliente') {
        audSel.value = 'solo_clientes';
      } else {
        audSel.value = 'todos';
      }
      onAudienceChange();
    }

    const prodSec = document.getElementById('ceProductSelectorContext');
    const pickerBtn = document.getElementById('ceCatalogPickerBtn');
    const cardWrap = document.getElementById('ceSelectedCardWrap');
    const autoNotice = document.getElementById('ceAutoSectorNotice');

    // El selector de catálogo y tarjetas de ofertas están SIEMPRE disponibles
    if (prodSec) prodSec.style.display = 'block';
    const hasProds = (selectedProductsList && selectedProductsList.length > 0) || Boolean(selectedProductOrCombo);
    if (cardWrap) cardWrap.style.display = hasProds ? 'block' : 'none';
    if (autoNotice) autoNotice.style.display = hasProds ? 'none' : 'block';

    if (mode === 'oferta_multiproducto') {
      if (pickerBtn) pickerBtn.innerHTML = '📦 Seleccionar Productos u Ofertas del Catálogo';
      if (selectedProductsList && selectedProductsList.length) {
        applyMultiOfertaTemplate();
      } else {
        openCatalogPickerForActiveMode();
      }
    } else if (mode === 'oferta_unipromocion') {
      if (pickerBtn) pickerBtn.innerHTML = '⭐ Seleccionar Producto Estrella del Catálogo';
      if (selectedProductOrCombo) {
        applyProductTemplate();
      } else {
        openCatalogPickerForActiveMode();
      }
    } else {
      if (pickerBtn) pickerBtn.innerHTML = '📦 Agregar Productos u Ofertas Específicas (Opcional)';
      if (selectedProductsList && selectedProductsList.length) {
        applyMultiOfertaTemplate();
      } else if (selectedProductOrCombo) {
        applyProductTemplate();
      } else {
        populateAudienceUniqueProposals(true);
        updatePreview();
      }
    }
  }

  function openCatalogPickerForActiveMode() {
    if (activeCampaignMode === 'oferta_multiproducto') {
      openCatalogPicker('multi');
    } else {
      openCatalogPicker('product');
    }
  }

  function startAiDraftForCampaign() {
    if (!selectedAudienceList || !selectedAudienceList.length) {
      alert('Por favor selecciona primero los destinatarios en el Paso 1 antes de redactar con IA.');
      return;
    }
    startAiAnalysisBatch();
  }

  function onMessageInputChange() {
    const val = document.getElementById('ceMessageInput')?.value || '';
    const currentCust = selectedAudienceList[activePreviewIdx];
    if (currentCust) {
      currentCust._custom_message = val;
      currentCust._is_manual_edit = true;
    }
    updatePreview();
  }

  function onSubjectInputChange() {
    const val = document.getElementById('ceSubjectInput')?.value || '';
    const currentCust = selectedAudienceList[activePreviewIdx];
    if (currentCust) {
      currentCust._custom_subject = val;
      currentCust._is_manual_edit = true;
    }
    updatePreview();
  }

  function onToneOrNotesChange() {
    populateAudienceUniqueProposals(true);
    updatePreview();
  }

  function applyBaseModeTemplate(mode = activeCampaignMode) {
    const isEmail = currentConfig?.channel === 'email';
    const commercialTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
    const customNotes = (document.getElementById('ceCustomNotesInput')?.value || '').trim();
    let msg = '';
    let subj = '';

    const notesExtra = customNotes ? `\n\n📌 *CONDICIÓN ESPECIAL:* ${customNotes}` : '';

    if (mode === 'presentacion_b2b') {
      if (commercialTone === 'oportunidad_mayorista') {
        subj = 'Condiciones Mayoristas y Suministro Directo — JJ Paper C.A.';
        if (isEmail) {
          msg = `{Estimado(a)|Hola} {{nombre}},\n\nLe saluda atentamente {{vendedor}} de *JJ Paper C.A.* en Caracas.\n\nPonemos a su disposición nuestro inventario físico con **precios de importador directo y escalas de descuento por volumen** en papelería, suministros de embalaje y consumibles operativos para {{empresa}}.\n\n*📦 LÍNEAS DE ALTA ROTACIÓN AL MAYOR:*\n• 📄 *Papelería & Resmas:* Precios por caja y bulto cerrado en formato Carta y Oficio.\n• 🧹 *Artículos de Limpieza Industrial:* Desinfectantes, bolsas reforzadas y químicos.\n• 🔍 *Procura a Medida:* Conseguimos cualquier renglón especial con el mejor costo del mercado.\n\n*💎 VENTAJAS DE COMPRA MAYORISTA:*\n• 🏭 Precios directos sin intermediarios a **Tasa Oficial BCV**.\n• 🧾 Facturación fiscal formal legal SENIAT (RIF J-29537545-0).\n• 🚚 Despacho prioritario 24h a su sede en Caracas.${notesExtra}\n\n👉 *Catálogo digital completo en línea (sin clave ni login):*\n{{link}}\n\n💡 *Prueba de precios:* Indíquenos 2 o 3 renglones de alto consumo en {{empresa}} y le enviamos cotización inmediata con el mejor precio garantizado.\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.* · RIF J-29537545-0`;
        } else {
          msg = `*🔥 CONDICIONES MAYORISTAS DIRECTAS · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe saluda *{{vendedor}}* de *JJ Paper C.A.* en Caracas.\n\nLe escribimos para ofrecerle **precios directos de importador y condiciones por volumen** en papelería y consumibles operativos para {{empresa}}.\n\n*📦 DISPONIBILIDAD INMEDIATA AL MAYOR:*\n• 📄 *Resmas y Papelería:* Descuentos por caja y bulto cerrado.\n• 🧹 *Limpieza Corporativa:* Insumos de alto rendimiento y aseo.\n• 🔍 *Procura Especial:* Conseguimos cualquier marca o insumo al mejor precio.\n\n*💎 CONDICIONES COMERCIALES:*\n• 🏭 Precios directos a **Tasa Oficial BCV**.\n• 🧾 Facturación fiscal SENIAT.\n• 🚚 Entrega en 24h en Caracas.${notesExtra}\n\n👉 *Catálogo Digital Mayorista:* {{link}}\n\n💡 *Hagamos una prueba:* Indíquenos 2 o 3 artículos de alto consumo y le enviamos cotización formal al instante con el mejor precio garantizado.\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial\n*JJ Paper C.A.* · RIF J-29537545-0`;
        }
      } else if (commercialTone === 'institucional_formal') {
        subj = 'Propuesta Institucional de Suministro Operativo — JJ Paper C.A.';
        if (isEmail) {
          msg = `Estimada Gerencia de Compras y Administración en {{empresa}}:\nPresente.-\n\nPor medio de la presente, {{vendedor}} en representación de *JJ Paper C.A.* (RIF J-29537545-0), empresa distribuidora e importadora mayorista en Caracas, somete a su consideración nuestra propuesta de abastecimiento integral.\n\n*📦 LÍNEAS DE SUMINISTRO DISPONIBLES:*\n• 📄 *Papelería Institucional:* Resmas de papel Bond (Carta/Oficio), carpetas, sobres de archivo y consumibles de oficina.\n• 🧹 *Insumos de Mantenimiento e Higiene:* Artículos de limpieza industrial y aseo corporativo.\n• 🎯 *Procura Especializada:* Gestión de cotización y despacho de cualquier marca o insumo específico requerido por su institución.\n\n*GARANTÍAS Y RESPALDO OPERATIVO:*\n• Facturación fiscal legal SENIAT a **Tasa Oficial BCV**.\n• Despacho prioritario en 24 horas hábiles a sus sedes en Caracas.\n• Emisión de cotizaciones proforma inmediatas para órdenes de compra y licitaciones.${notesExtra}\n\n👉 *Catálogo corporativo digital (acceso libre):*\n{{link}}\n\nQuedamos a su disposición para remitir cotización formal sobre los requerimientos actuales de su empresa.\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.* · RIF J-29537545-0`;
        } else {
          msg = `*🏢 PROPUESTA INSTITUCIONAL DE SUMINISTRO · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nEstimada Gerencia de {{empresa}},\n\nLe saluda cordialmente *{{vendedor}}*, asesor corporativo de *JJ Paper C.A.* (RIF J-29537545-0) en Caracas.\n\nPresentamos formalmente nuestra empresa como proveedor mayorista directo para sus sedes:\n\n*📦 LÍNEAS DE ABASTECIMIENTO:*\n• 📄 *Papelería & Archivo:* Resmas Carta/Oficio, carpetas, bolígrafos y consumibles.\n• 🧹 *Limpieza y Mantenimiento:* Insumos de higiene y químicos corporativos.\n• 🎯 *Sourcing:* Conseguimos cualquier insumo operativo al mejor costo.\n\n*GARANTÍAS CORPORATIVAS:*\n• Facturación fiscal formal a **Tasa BCV**.\n• Despacho directo en 24h en Caracas.${notesExtra}\n\n👉 *Catálogo Institucional en línea:* {{link}}\n\nQuedamos atentos para prepararle una cotización proforma ajustada a sus requerimientos.\n\nAtentamente,\n*{{vendedor}}* | JJ Paper C.A. · RIF J-29537545-0`;
        }
      } else if (commercialTone === 'directo_ejecutivo') {
        subj = 'Disponibilidad Mayorista Inmediata en Caracas — JJ Paper C.A.';
        if (isEmail) {
          msg = `Buen día {{nombre}},\n\nLe saluda {{vendedor}} de *JJ Paper C.A.* en Caracas.\n\nComparto directo al grano nuestra disponibilidad mayorista para despacho inmediato en su sede:\n\n• 📄 *Papelería Corporativa:* Resmas Bond Carta/Oficio por bulto a Tasa Oficial BCV.\n• 📁 *Archivo y Oficina:* Archivadores de palanca, carpetas manila/fibra y consumibles de escritorio.\n• 🧹 *Consumibles Operativos:* Rollos térmicos POS, cintas de embalaje y limpieza corporativa.${notesExtra}\n\n*BENEFICIOS INMEDIATOS:*\n✅ Facturación fiscal SENIAT (RIF J-29537545-0)\n✅ Delivery corporativo gratis en Caracas en 24h\n✅ Procura especial: cualquier insumo adicional se lo ubicamos al mejor precio\n\nCatálogo completo: {{link}}\n\n¿Le emitimos cotización formal hoy sobre los insumos que requiera?\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.*`;
        } else {
          msg = `{Buen día|Hola} {{nombre}} 👋 · *Resumen Mayorista JJ Paper*\n\nLe saluda *{{vendedor}}*. Comparto directo al grano nuestro stock para despacho inmediato en Caracas:\n\n• 📄 Resmas Carta/Oficio por bulto\n• 📁 Archivadores de palanca, carpetas y suministros de oficina\n• 📦 Cintas de embalaje y consumibles${notesExtra}\n\n✅ *Factura fiscal SENIAT + Tasa BCV*\n✅ *Delivery prioritario gratis en Caracas*\n🔗 *Catálogo:* {{link}}\n\n⚡ *¿Le cotizo formalmente alguno de estos ítems hoy?*\n— *{{vendedor}}* | JJ Paper C.A.`;
        }
      } else if (commercialTone === 'cercano_consultivo') {
        subj = 'Apoyo en Suministros y Papelería para su Empresa — JJ Paper C.A.';
        if (isEmail) {
          msg = `{Hola|Apreciado(a)} {{nombre}},\n\n¡Un gran gusto saludarle! Le escribe atentamente {{vendedor}} de *JJ Paper C.A.* en Caracas.\n\nNos comunicamos para ponernos a su orden como su aliado de procura y compras corporativas. Atendemos a empresas y oficinas con precios directos de distribuidor y atención personalizada.\n\n*📦 EN QUÉ PODEMOS APOYARLES:*\n• Papelería, resmas, carpetas y archivadores de lomo ancho.\n• Artículos de oficina, bolígrafos por caja y cintas de embalaje.\n• Insumos de limpieza e higiene corporativa.\n• **Procura a la medida:** si busca algún producto o marca que no vea en catálogo, con gusto se lo ubicamos.\n\n*💎 NUESTRAS CONDICIONES:*\n• Precios a **Tasa Oficial BCV** con factura legal SENIAT.\n• Delivery directo en 24h a su sede en Caracas.${notesExtra}\n\n👉 *Catálogo en línea:* {{link}}\n\n¿Qué insumos están requiriendo reponer en {{empresa}} para pasarle cotización hoy mismo?\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.*`;
        } else {
          msg = `{Hola|Qué tal} {{nombre}} 👋, ¡un gran saludo!\n\nPor aquí le escribe *{{vendedor}}* de *JJ Paper C.A.* en Caracas.\n\nQuería saludarle y ponerme a su completa orden para lo que necesiten en papelería, archivo e insumos operativos en {{empresa}}.\n\n• 🏭 Precios directos a **Tasa Oficial BCV**\n• 🧾 Facturación formal fiscal SENIAT\n• 🚚 Delivery gratis en Caracas\n• 🔍 Si buscas algo que no veas en catálogo, ¡te lo conseguimos!${notesExtra}\n\n👉 Ver catálogo digital: {{link}}\n\n¿Qué insumos están necesitando reponer esta quincena para apoyarle?\n\nAtentamente,\n*{{vendedor}}* | JJ Paper C.A.`;
        }
      } else {
        // Tono socio_estrategico por defecto
        subj = 'Presentación Comercial: Abastecimiento y Distribución Mayorista — JJ Paper C.A.';
        if (isEmail) {
          msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda atentamente {{vendedor}} de *JJ Paper C.A.* en Caracas.\n\nNos dirigimos a usted para presentar nuestra empresa como su **aliado estratégico de abastecimiento directo**. Distribuimos artículos de oficina, papelería y productos de consumo para empresas, comercios y colegios con precios directos de distribuidor.\n\n*📦 NUESTRAS LÍNEAS DE DISTRIBUCIÓN:*\n• 📄 *Papelería y Artículos de Oficina:* Resmas, carpetas, sobres, bolígrafos, archivadores y consumibles.\n• 🧹 *Artículos de Limpieza y Mantenimiento:* Desinfectantes, toallas, bolsas industriales y químicos de aseo.\n• 🎯 *Procura Especializada:* Cualquier producto o marca que su empresa requiera, **nosotros se lo conseguimos con el mejor precio del mercado**.\n\n*💎 VENTAJAS OPERATIVAS CON JJ PAPER:*\n• 🏭 Precios directos al mayor en USD ($) y Bolívares a **Tasa Oficial BCV**.\n• 🧾 Facturación fiscal legal SENIAT.\n• 🚚 Despacho prioritario en 24h directamente a su sede en Caracas.${notesExtra}\n\n👉 *Catálogo digital completo en línea (sin registro ni login):*\n{{link}}\n\n💡 *Hagamos una prueba:* Indíquenos 2 o 3 productos de alta necesidad y demanda en su empresa, y con gusto le responderemos de inmediato con una cotización a su medida y el mejor precio del mercado.\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.* · RIF J-29537545-0`;
        } else {
          msg = `*🏢 JJ PAPER C.A. · DISTRIBUIDOR MAYORISTA DIRECTO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe saluda *{{vendedor}}*, asesor comercial de *JJ Paper C.A.* en Caracas.\n\nNos comunicamos para presentar nuestra empresa como su **aliado de abastecimiento directo**. Atendemos a empresas, oficinas y comercios con precios de importador y atención personalizada.\n\n*📦 LÍNEAS DE SUMINISTRO DISPONIBLES:*\n• 📄 *Papelería:* Resmas de papel, carpetas, sobres, bolígrafos y archivo.\n• 🧹 *Limpieza y Mantenimiento:* Toallas, bolsas, desinfectantes e higiene.\n• 🎯 *Procura a Medida:* Cualquier artículo que necesite, **nosotros se lo ubicamos al mejor precio**.\n\n*💎 BENEFICIOS DIRECTOS:*\n• 🏭 Precios al mayor en USD ($) y Bs a **Tasa Oficial BCV**.\n• 🧾 Facturación fiscal legal SENIAT.\n• 🚚 Despacho prioritario en 24h en Caracas.${notesExtra}\n\n👉 *Revise nuestro Catálogo Digital (sin login):*\n{{link}}\n\n💡 *Hagamos una prueba:* Indíquenos 2 o 3 artículos de alta demanda en su empresa y le preparamos una cotización a su medida con el mejor precio garantizado.\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial\n*JJ Paper C.A.* · RIF J-29537545-0`;
        }
      }
    } else if (mode === 'seguimiento_prospecto') {
      subj = 'Seguimiento de Cotización y Disponibilidad de Despacho — JJ Paper C.A.';
      if (isEmail) {
        msg = `{Estimado(a)|Hola} {{nombre}},\n\nEspero se encuentre excelente. Le saluda nuevamente {{vendedor}} de *JJ Paper C.A.*\n\nNos comunicamos para darle seguimiento a la cotización y suministros conversados anteriormente. Queremos confirmar si tuvieron oportunidad de evaluarla o si requieren algún ajuste en cantidades, marcas o productos adicionales.\n\n*🚚 LOGÍSTICA LISTA PARA DESPACHO:*\n• Contamos con **inventario físico garantizado** para entrega hoy mismo en su sede.\n• Facturación legal y cotización oficial a **Tasa BCV**.\n• Podemos incorporar cualquier otro artículo de papelería, limpieza o consumibles en la misma entrega.${notesExtra}\n\n👉 *Catálogo en línea siempre disponible:* {{link}}\n\n¿Desea que le reservemos la mercancía o coordinemos la orden de compra para esta semana?\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.* · RIF J-29537545-0`;
      } else {
        msg = `*🤝 SEGUIMIENTO COMERCIAL · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarle de nuevo 👋\n\nLe escribe *{{vendedor}}* de *JJ Paper C.A.* en Caracas.\n\nNos comunicamos para darle seguimiento a la cotización y suministros conversados previamente. Queremos validar si requieren algún ajuste en cantidades, marcas o artículos complementarios.\n\n*🚚 DESPACHO INMEDIATO:*\n• Mercancía disponible en almacén para entrega hoy mismo.\n• Facturación formal fiscal a **Tasa Oficial BCV**.\n• Si requiere insumos de limpieza o papelería adicional, se los sumamos a la misma entrega.${notesExtra}\n\n👉 *Ver catálogo digital:* {{link}}\n\n¿Gusta que le reservemos el pedido o le actualicemos la cotización?\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial\n*JJ Paper C.A.* · RIF J-29537545-0`;
      }
    } else if (mode === 'reposicion_cliente') {
      subj = 'Recordatorio de Reposición de Inventario y Stock — JJ Paper C.A.';
      if (isEmail) {
        msg = `{Estimado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda atentamente {{vendedor}} de *JJ Paper C.A.* Agradecemos su constante confianza como cliente de nuestra casa.\n\nLe escribimos preventivamente para consultar cómo se encuentra su inventario de suministros para este mes y evitar que se quede sin artículos esenciales en su empresa:\n\n*📋 LÍNEAS LISTAS PARA REPOSICIÓN:*\n• Resmas de papel carta/oficio, carpetas, sobres y archivo.\n• Bolígrafos, marcadores, cintas de embalaje y artículos de escritorio.\n• Insumos de limpieza, higiene y consumibles operativos.\n\n*⚡ CONDICIONES PREFERENCIALES:*\n• Facturación inmediata a **Tasa Oficial BCV**.\n• Despacho directo y prioritario a su sede.${notesExtra}\n\n👉 *Consulte catálogo actualizado:* {{link}}\n\n¿Le preparamos su pedido habitual o desea cotizar una reposición con algún producto nuevo?\n\nAtentamente,\n{{vendedor}}\n*JJ Paper C.A.* · RIF J-29537545-0`;
      } else {
        msg = `*🔄 REPOSICIÓN DE STOCK · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarle 👋\n\nLe escribe *{{vendedor}}* de *JJ Paper C.A.* Gracias por su preferencia constante con nosotros.\n\nLe escribimos de forma preventiva para verificar cómo está su inventario de insumos para este mes y apoyarle antes de que se agoten en su empresa:\n\n*📋 LISTOS PARA REPOSICIÓN:*\n• Papel fotocopia, carpetas, sobres y consumibles de oficina.\n• Bolígrafos, cintas de embalaje y artículos de escritorio.\n• Línea de limpieza e higiene corporativa.\n\n*⚡ BENEFICIO CLIENTE ACTIVO:*\n• Atención y despacho prioritario en Caracas.\n• Precios oficiales a **Tasa BCV**.${notesExtra}\n\n👉 *Catálogo digital en línea:* {{link}}\n\n¿Le confirmamos su despacho habitual o requiere cotizar algún artículo nuevo?\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial\n*JJ Paper C.A.* · RIF J-29537545-0`;
      }
    }

    if (subj && document.getElementById('ceSubjectInput')) {
      document.getElementById('ceSubjectInput').value = subj;
    }
    if (msg && document.getElementById('ceMessageInput')) {
      document.getElementById('ceMessageInput').value = msg;
    }

    selectedAudienceList.forEach(c => {
      c._custom_message = msg;
      if (subj) c._custom_subject = subj;
    });

    updatePreview();
  }

  function applyMultiOfertaTemplate() {
    if (!selectedProductsList || !selectedProductsList.length) return;
    const isEmail = currentConfig?.channel === 'email';
    const rate = (typeof getRate === 'function') ? getRate() : (window.APP?.EXCHANGE_RATE || 0);

    const itemsLines = selectedProductsList.map((p, idx) => {
      const pUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_b || p.price_usd || 0));
      const pBsStr = (pUsd > 0 && rate > 0)
        ? ` | Bs. ${(pUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Tasa BCV)`
        : ' | Cotización formal a Tasa BCV';
      const unitStr = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
      return pUsd > 0
        ? `• *${p.name}*${unitStr}: *$${pUsd.toFixed(2)} USD*${pBsStr}`
        : `• *${p.name}*${unitStr}: *Cotización comparativa a Tasa Oficial BCV*`;
    }).join('\n');

    let msg = '';
    const subj = isEmail ? `🔥 Ofertas Mayoristas Especiales — JJ Paper C.A.` : '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda atentamente {{vendedor}} de *JJ Paper C.A.*, su aliado de abastecimiento mayorista directo en Caracas.\n\nPara apoyar la operatividad de su empresa y optimizar costos de procura, ponemos a su disposición disponibilidad inmediata con precios preferenciales de importador en:\n\n*📦 LISTADO DE SUMINISTROS EN PROMOCIÓN:*\n_(Precios unitarios promocionales — no es combo cerrado, puede solicitar los artículos y cantidades que requiera)_\n──────────────────────────\n${itemsLines}\n──────────────────────────\n\n🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n*VENTAJAS DIRECTAS DE TRABAJAR CON JJ PAPER:*\n• 🏭 *Importador Directo:* Precios directos de distribuidor en Caracas (sin intermediarios).\n• 🧾 *Facturación Legal:* Facturación formal fiscal a Tasa Oficial BCV.\n• 🚚 *Despacho Inmediato 24h:* Logística y delivery prioritario a su sede.\n• 📄 *Lista Oficial en PDF:* Le adjuntamos nuestro catálogo oficial con más de 2.400 artículos disponibles.\n\n👉 Catálogo digital en línea: {{link}}\n\n¿Desea que le reservemos inventario de estos productos o le preparemos una cotización formal?\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      if (document.getElementById('ceSubjectInput')) {
        document.getElementById('ceSubjectInput').value = subj;
      }
    } else {
      msg = `*🔥 OPORTUNIDAD MAYORISTA EXCLUSIVA · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe saluda *{{vendedor}}* de *JJ Paper C.A.*, su importador y distribuidor mayorista directo en Caracas.\n\nHoy queremos presentarle nuestro lote seleccionado de *ofertas especiales* con inventario físico para entrega inmediata esta semana:\n\n*📦 LISTADO DE PRODUCTOS EN PROMOCIÓN ESPECIAL:*\n_(Precios unitarios promocionales — no es combo cerrado, solicite los artículos que requiera)_\n──────────────────────────\n${itemsLines}\n──────────────────────────\n\n🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n*💎 VENTAJAS OPERATIVAS CON JJ PAPER:*\n• 🏭 *Importador y Distribuidor Directo* en Caracas (sin intermediarios)\n• 🧾 *Facturación formal fiscal* al cambio oficial BCV\n• 🚚 *Despacho prioritario 24h* en Caracas directamente a su empresa o colegio\n• 📄 *Catálogo Completo en PDF:* Le adjuntamos nuestro catálogo oficial en PDF con más de 2.400 artículos disponibles\n\n👉 Ver catálogo digital completo y hacer pedido directo: {{link}}\n\n💬 ¿Le reservamos unidades de alguno de estos productos para su próximo despacho?\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial JJ Paper C.A.`;
    }
    if (document.getElementById('ceMessageInput')) {
      document.getElementById('ceMessageInput').value = msg;
    }
    selectedAudienceList.forEach(c => {
      c._custom_message = msg;
      if (subj) c._custom_subject = subj;
    });
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
    const subj = isEmail ? `📦 Propuesta Mayorista: ${p.name} — JJ Paper C.A.` : '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda {{vendedor}} de *JJ Paper C.A.*, su importador y distribuidor mayorista en Caracas.\n\nQueremos presentarle una propuesta directa de abastecimiento mayorista con disponibilidad inmediata en:\n\n*📦 ${p.name}${unitStr}*\n${p.description ? '📝 ' + p.description + '\n' : ''}*💲 Precio de Lista Mayorista: $${priceUsd} USD*${p.discount_pct > 0 ? ' _(Descuento comercial del ' + p.discount_pct + '% aplicado)_' : ' _(Condiciones preferenciales y ahorro por volumen / bulto cerrado)_'}\n\n*VENTAJAS DIRECTAS CON JJ PAPER:*\n• 🏭 Precios directos de importador en Caracas sin intermediarios.\n• 🚚 Delivery express gratuito en Caracas a su sede.\n• 🧾 Facturación fiscal formal a Tasa Oficial BCV.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n👉 Puede revisar la ficha técnica y confirmar su requerimiento aquí:\n{{link}}\n\n¿Gusta que le reservemos disponibilidad o le preparemos una cotización por volumen para su empresa?\n\nAtentamente,\n{{vendedor}}\nDirección Comercial | JJ Paper C.A.`;
      if (document.getElementById('ceSubjectInput')) {
        document.getElementById('ceSubjectInput').value = subj;
      }
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Como importadores y distribuidores mayoristas directos en Caracas, hoy queremos compartirle disponibilidad inmediata y precio preferencial en:\n\n*📦 ${p.name}${unitStr}*\n${p.description ? p.description + '\n' : ''}*💲 Precio lista mayorista: $${priceUsd} USD*\n_(Condiciones preferenciales y escala de descuento por volumen / bulto cerrado)_\n\n• 🏭 *Importador directo en Caracas* (inventario físico sin intermediarios)\n• 🚚 *Delivery a su sede* y factura fiscal formal a tasa oficial BCV\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n👉 Ficha completa y pedido en línea: {{link}}\n\n¿Le reservamos unidades o le preparamos una cotización formal para su empresa?`;
    }
    if (document.getElementById('ceMessageInput')) {
      document.getElementById('ceMessageInput').value = msg;
    }
    selectedAudienceList.forEach(c => {
      c._custom_message = msg;
      if (subj) c._custom_subject = subj;
    });
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
    const subj = isEmail ? `🎁 Combo Mayorista Especial: ${c.name} — JJ Paper C.A.` : '';
    if (isEmail) {
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEspero se encuentre muy bien. Le saluda {{vendedor}} de *JJ Paper C.A.*, su aliado de abastecimiento mayorista directo en Caracas.\n\nDiseñamos este combo de alta rotación para optimizar el presupuesto y flujo operativo de su empresa:\n\n*🎁 COMBO OPERATIVO: ${c.name}*\n${c.description ? '📝 Incluye: ' + c.description + '\n' : ''}*💲 Inversión mayorista preferencial: $${priceUsd} USD*\n_(Ahorro integrado por lote frente a compras individuales)_\n\n*VENTAJAS CLAVE:*\n• 🏭 Precios directos de distribuidor en Caracas.\n• 🚚 Entrega garantizada en su sede en 24h.\n• 🧾 Facturación fiscal en bolívares a Tasa Oficial BCV.\n• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n👉 Ver detalle del combo y gestionar pedido: {{link}}\n\n¿Desea que le confirmemos despacho de este lote para su sede esta semana?\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      if (document.getElementById('ceSubjectInput')) {
        document.getElementById('ceSubjectInput').value = subj;
      }
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarle 👋\n\nLe escribe {{vendedor}} de *JJ Paper C.A.* Armamos este combo especial pensado para optimizar la reposición de su empresa con precio directo de importador:\n\n*🎁 COMBO OPERATIVO: ${c.name}*\n${c.description ? '📝 ' + c.description + '\n' : ''}*💲 Inversión del combo: $${priceUsd} USD*\n_(Ahorro directo frente a compras al detal)_\n\n• 🏭 *Importador directo en Caracas*\n• 🚚 *Despacho garantizado en 24h*\n• 🧾 *Facturación formal a Tasa Oficial BCV*
• 🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n👉 Ver detalles o confirmar pedido directo: {{link}}\n\n¿Le reservamos este combo antes de agotar existencia del lote?`;
    }
    if (document.getElementById('ceMessageInput')) {
      document.getElementById('ceMessageInput').value = msg;
    }
    selectedAudienceList.forEach(c => {
      c._custom_message = msg;
      if (subj) c._custom_subject = subj;
    });
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
      // 1. Validaciones técnicas estrictas de canal (Email)
      if (isEmail) {
        if (!c.email) return false;
        const cleanEm = String(c.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEm)) return false;
        if (c.email_opt_out) return false;
        
        // Filtro anti-rebotes riguroso (bounced, bounced_hard, bounced_soft)
        const isBounced = c.email_status === 'bounced' || c.email_status === 'bounced_hard' || c.email_status === 'bounced_soft';
        if (isBounced) {
          bouncedCount++;
          return false;
        }
      }

      // 2. Validaciones técnicas estrictas de canal (WhatsApp)
      if (!isEmail) {
        if (!c.phone || !isMobileNum(c.phone)) {
          const best = getBestMobilePhone(c);
          if (best) c.phone = best;
        }
        if (!c.phone) return false;
        if (c.opt_out || c.wa_opt_out || knownNoWaPhones.has(normPhoneKey(c.phone))) {
          nonMobileCount++;
          return false;
        }

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

      // Si el usuario aplicó una selección manual con checkboxes, priorizarla (ya pasó filtros técnicos)
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
      if (aud === 'gmail_starred') {
        return Boolean(
          c.is_gmail_starred ||
          (Array.isArray(c.tags) && (c.tags.includes('destacado_gmail') || c.tags.includes('vip') || c.tags.includes('cliente_activo'))) ||
          c.source === 'gmail_destacado' ||
          c.status === 'destacado' ||
          c.ai_analysis?.destacado_gmail ||
          (typeof c.notes === 'string' && (c.notes.includes('Destacado en Gmail') || c.notes.includes('Compras activas verificadas')))
        );
      }
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

    populateAudienceUniqueProposals(false);
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
              <button type="button" class="ce-card-action-btn" style="color:#b45309;background:#fef3c7;font-weight:700" onclick="CampaignEditor.setPickerQuickFilter('destacados_gmail')">⭐ Destacados Gmail</button>
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
      if (pickerQuickFilter === 'destacados_gmail') {
        const isStarred = Boolean(
          c.is_gmail_starred ||
          (Array.isArray(c.tags) && c.tags.includes('destacado_gmail')) ||
          c.source === 'gmail_destacado' ||
          c.status === 'destacado' ||
          c.ai_analysis?.destacado_gmail ||
          (typeof c.notes === 'string' && c.notes.includes('Destacado en Gmail'))
        );
        if (!isStarred) return false;
      }
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

      const isStarredContact = Boolean(
        c.is_gmail_starred ||
        (Array.isArray(c.tags) && c.tags.includes('destacado_gmail')) ||
        c.source === 'gmail_destacado' ||
        c.status === 'destacado' ||
        c.ai_analysis?.destacado_gmail ||
        (typeof c.notes === 'string' && c.notes.includes('Destacado en Gmail'))
      );
      const starredBadge = isStarredContact
        ? `<span style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px" title="Contacto destacado con estrella en Gmail">⭐ Destacado Gmail</span>`
        : '';
      const starredNote = isStarredContact && (c.suggested_subject || (typeof c.notes === 'string' && c.notes.includes('Destacado en Gmail')))
        ? `<div style="font-size:11px;color:#b45309;font-weight:600;margin-top:2px">⭐ Seguimiento: ${escapeHTML(c.suggested_subject || c.notes.split('\n')[0].replace('⭐ Destacado en Gmail:', '').trim())}</div>`
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
              ${starredBadge}
              ${quoteBadge}
              ${replyBadge}
              ${cooldownBadge}
            </div>
            ${contactDetail}
            ${starredNote}
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
        <div class="ce-picker-dialog">
          <div class="ce-picker-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:20px;">🤖</span>
              <div>
                <h3 style="margin:0; font-size:16px; font-weight:700;">Actitud, Enfoque y Control de la IA</h3>
                <span style="font-size:11.5px; color:#64748b;">Configura cómo la IA redactará y personalizará la propuesta para cada cuenta</span>
              </div>
            </div>
            <button type="button" class="ce-btn-close" id="btnCloseAiToneTop">✕</button>
          </div>
          <div class="ce-picker-body">
            <div id="ceAiToneNotice" style="display:none; margin-bottom:14px; padding:10px 14px; border-radius:8px; font-size:12.5px; line-height:1.45;"></div>
            
            <div style="margin-bottom:16px;">
              <label style="display:block; font-weight:700; font-size:13px; color:#1e293b; margin-bottom:6px;">1. Enfoque / Actitud de la Comunicación</label>
              <div style="display:flex; flex-direction:column; gap:8px;">
                <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px;">
                  <input type="radio" name="ai_tone" value="presentacion" checked style="margin-top:3px">
                  <div>
                    <strong>🚀 Presentación Comercial (Primer contacto)</strong><br>
                    <span style="font-size:12px; color:#64748b">Presenta a JJ Paper desde cero y enfoca el catálogo en las necesidades de su rubro.</span>
                  </div>
                </label>
                <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px;">
                  <input type="radio" name="ai_tone" value="seguimiento" style="margin-top:3px">
                  <div>
                    <strong>👀 Seguimiento (Warm up)</strong><br>
                    <span style="font-size:12px; color:#64748b">Retoma el contacto de forma cordial preguntando cómo le ha ido con su inventario.</span>
                  </div>
                </label>
                <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px;">
                  <input type="radio" name="ai_tone" value="recordatorio" style="margin-top:3px">
                  <div>
                    <strong>⏰ Recordatorio de Compra</strong><br>
                    <span style="font-size:12px; color:#64748b">Directo al punto: recuerda que estamos listos para despachar su próximo pedido.</span>
                  </div>
                </label>
                <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px;">
                  <input type="radio" name="ai_tone" value="oferta" style="margin-top:3px">
                  <div>
                    <strong>🔥 Oferta Relámpago / Oportunidad Mayorista</strong><br>
                    <span style="font-size:12px; color:#64748b">Crea urgencia comercial, destaca precios de importador directo y ahorro por volumen.</span>
                  </div>
                </label>
                <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px;">
                  <input type="radio" name="ai_tone" value="fidelizado" style="margin-top:3px">
                  <div>
                    <strong>💎 Cliente VIP / Fidelizado (Reactivación de la Casa)</strong><br>
                    <span style="font-size:12px; color:#64748b">Trato preferencial exclusivo: agradece la preferencia, destaca precios oficiales BCV y entrega prioritaria.</span>
                  </div>
                </label>
              </div>
            </div>

            <div style="margin-bottom:16px;">
              <label style="display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:13px; color:#1e293b; margin-bottom:6px;">
                <span>2. Instrucciones Específicas / Petición del Asesor <span style="font-weight:normal; font-size:11px; color:#64748b;">(Opcional pero prioritario)</span></span>
              </label>
              <textarea id="ceAiCustomInstructionsBatch" rows="2" placeholder="Ej: Menciona despacho gratis hoy, ofrece crédito a 7 días, o haz énfasis en que somos distribuidores directos de resmas..." style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:12.5px; border:1px solid #cbd5e1; border-radius:8px; resize:vertical; line-height:1.4; font-family:inherit;"></textarea>
              <span style="display:block; font-size:11px; color:#64748b; margin-top:3px;">La IA obedecerá estas indicaciones de forma estricta al generar cada mensaje.</span>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:8px;">
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">📏 Longitud</label>
                <select id="ceAiMsgLengthBatch" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="balanced" selected>Equilibrado (B2B)</option>
                  <option value="short">Ultra-Conciso (3-5 lín)</option>
                  <option value="detailed">Detallado y Formal</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">💰 Manejo Precios</label>
                <select id="ceAiPriceModeBatch" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="with_prices" selected>Con Precios ($ / Bs)</option>
                  <option value="no_prices">Solo Disponibilidad</option>
                  <option value="bulk_only">Enfocar por Bulto</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">🎯 Llamado Acción</label>
                <select id="ceAiCtaGoalBatch" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="quote" selected>Pedir Cotización</option>
                  <option value="inventory">Reponer Inventario</option>
                  <option value="catalog">Solicitar Catálogo</option>
                  <option value="meeting">Coordinar Asesoría</option>
                </select>
              </div>
            </div>
          </div>
          <div class="ce-picker-footer">
            <div style="font-size:12px; color:#64748b;">
              <span id="ceAiBatchCountHint"></span>
            </div>
            <div style="display:flex; gap:10px;">
              <button type="button" class="ce-btn btn-sec" id="btnCancelAiTone">Cancelar</button>
              <button type="button" class="ce-btn btn-pri" id="btnConfirmAiTone" style="background:#16604A; border-color:#16604A;">Empezar Análisis ⚡</button>
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
        const customInstructions = (document.getElementById('ceCustomNotesInput')?.value || document.getElementById('ceAiCustomInstructionsBatch')?.value || '').trim();
        const msgLength = document.getElementById('ceAiMsgLengthBatch')?.value || 'balanced';
        const priceMode = document.getElementById('ceAiPriceModeBatch')?.value || 'with_prices';
        const ctaGoal = document.getElementById('ceAiCtaGoalBatch')?.value || 'quote';
        closeAiToneModal();
        startAiAnalysisBatch({
          selectedTone: tone,
          customInstructions,
          msgLength,
          priceMode,
          ctaGoal
        });
      };
    }

    const totalSelected = selectedAudienceList.length;
    const contactedCount = selectedAudienceList.filter(c => 
      c.contacted || 
      c.last_contact_at || 
      (c.status && String(c.status).startsWith('contactado')) || 
      Number(c.total_orders) > 0
    ).length;

    const hintEl = document.getElementById('ceAiBatchCountHint');
    if (hintEl) {
      hintEl.textContent = `🎯 ${totalSelected} destinatario${totalSelected === 1 ? '' : 's'} seleccionado${totalSelected === 1 ? '' : 's'}`;
    }

    const commTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
    const targetSec = document.getElementById('ceTargetSector')?.value || 'auto';

    let defaultTone = 'presentacion';
    if (commTone === 'fidelizado_reactivacion') defaultTone = 'fidelizado';
    else if (commTone === 'oportunidad_mayorista') defaultTone = 'oferta';
    else if (commTone === 'cercano_consultivo') defaultTone = 'seguimiento';
    else if (selectedProductOrCombo) defaultTone = 'oferta';
    else if (contactedCount > 0) defaultTone = 'seguimiento';

    const toneNames = {
      socio_estrategico: '💼 Socio Estratégico',
      oportunidad_mayorista: '🔥 Oferta Mayorista',
      cercano_consultivo: '🤝 Cercano y Consultivo',
      institucional_formal: '🏢 Institucional Formal',
      fidelizado_reactivacion: '💎 Cliente VIP / Fidelizado'
    };

    let stratPill = `<div style="margin-bottom:8px; font-weight:700; color:#0369a1; background:#f0f9ff; padding:4px 8px; border-radius:6px; font-size:12px;">🎯 Estrategia Activa: <u>${toneNames[commTone] || commTone}</u> · Sector: <u>${targetSec.toUpperCase()}</u></div>`;
    let noticeHtml = '';

    if (selectedProductOrCombo) {
      noticeHtml = `${stratPill}💡 <strong>Producto seleccionado:</strong> La IA redactará una oferta comercial directa de <em>"${escapeHTML(selectedProductOrCombo.name || selectedProductOrCombo.title)}"</em> con el tono <strong>${toneNames[commTone] || commTone}</strong>, destacando disponibilidad en 24h y cotización en Bs (Tasa BCV).`;
    } else if (contactedCount > 0) {
      noticeHtml = `${stratPill}👀 <strong>Contactos previos detectados:</strong> ${contactedCount} de ${totalSelected} destinatarios ya recibieron un mensaje anterior. La IA redactará un <em>Seguimiento cordial</em> sin repetir la presentación inicial.`;
    } else {
      noticeHtml = `${stratPill}🚀 <strong>Nuevos destinatarios:</strong> La IA analizará la actividad de cada cuenta y adaptará el mensaje con el tono <strong>${toneNames[commTone] || commTone}</strong>.`;
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

  async function startAiAnalysisBatch(opts = {}) {
    if (isAnalyzingBatch) return;
    if (!selectedAudienceList.length) {
      alert('Por favor selecciona primero los prospectos o clientes a los que dirigirás la campaña.');
      return;
    }

    const options = (typeof opts === 'string') ? { selectedTone: opts } : (opts || {});
    const selectedTone = options.selectedTone || (
      activeCampaignMode === 'presentacion_b2b' ? 'presentacion' :
      activeCampaignMode === 'seguimiento_prospecto' ? 'seguimiento' :
      activeCampaignMode === 'reposicion_cliente' ? 'fidelizado' :
      activeCampaignMode === 'oferta_multiproducto' ? 'oferta' :
      activeCampaignMode === 'oferta_unipromocion' ? 'oferta' : 'presentacion'
    );
    const commercialTone = options.commercialTone || document.getElementById('ceCommercialTone')?.value || (
      selectedTone === 'fidelizado' ? 'fidelizado_reactivacion' :
      selectedTone === 'oferta' ? 'oportunidad_mayorista' :
      selectedTone === 'seguimiento' ? 'cercano_consultivo' : 'socio_estrategico'
    );
    const valueHook = options.valueHook || document.getElementById('ceValueHook')?.value || 'importador_directo';
    const targetSector = options.targetSector || document.getElementById('ceTargetSector')?.value || 'auto';
    const customInstructions = options.customInstructions || document.getElementById('ceAiCustomInstructionsBatch')?.value || document.getElementById('ceCustomNotesInput')?.value || '';
    const msgLength = options.msgLength || document.getElementById('ceAiMsgLengthBatch')?.value || 'balanced';
    const priceMode = options.priceMode || document.getElementById('ceAiPriceModeBatch')?.value || 'with_prices';
    const ctaGoal = options.ctaGoal || document.getElementById('ceAiCtaGoalBatch')?.value || (
      activeCampaignMode === 'reposicion_cliente' ? 'inventory' : 'quote'
    );
    const profileType = options.profileType || document.getElementById('ceClientProfileType')?.value || 'auto';

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
      const baseMessageText = (document.getElementById('ceMessageInput')?.value || '').trim();
      const baseSubjectText = (document.getElementById('ceSubjectInput')?.value || '').trim();

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
        customInstructions,
        msgLength,
        priceMode,
        ctaGoal,
        profileType,
        forceRefresh: true,
        baseMessageText,
        baseSubjectText,
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
      syncComposerWithCurrentCustomer();
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

  function syncComposerWithCurrentCustomer() {
    const currentCust = selectedAudienceList[activePreviewIdx];
    if (!currentCust) return;
    const msgInput = document.getElementById('ceMessageInput');
    const subjInput = document.getElementById('ceSubjectInput');
    if (currentCust._custom_message && msgInput) {
      msgInput.value = currentCust._custom_message;
    }
    if (currentCust._custom_subject && subjInput) {
      subjInput.value = currentCust._custom_subject;
    }
  }

  function stepPreviewCustomer(delta = 1) {
    if (!selectedAudienceList.length) return;
    activePreviewIdx = (activePreviewIdx + delta + selectedAudienceList.length) % selectedAudienceList.length;
    syncComposerWithCurrentCustomer();
    updatePreview();
  }

  function selectPreviewCustomer(idx) {
    if (idx >= 0 && idx < selectedAudienceList.length) {
      activePreviewIdx = idx;
      syncComposerWithCurrentCustomer();
      switchRightTab('simulator');
      updatePreview();
    }
  }

  async function regenerateActiveCustomer() {
    const cust = selectedAudienceList[activePreviewIdx];
    if (!cust) return;

    const btn = document.getElementById('ceRegenCustomerBtn');
    const origTxt = btn ? btn.textContent : '🔄 Regenerar con IA';
    if (btn) {
      btn.textContent = '⏳ Analizando con IA...';
      btn.disabled = true;
    }

    try {
      await ensureGeminiClient();
      const isPdf = document.getElementById('ceAttachPdf')?.checked !== false;
      const channel = currentConfig?.channel || 'whatsapp';
      const isEmail = (channel === 'email');

      const targetSector = document.getElementById('ceTargetSector')?.value || 'auto';
      const commercialTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
      const valueHook = document.getElementById('ceValueHook')?.value || 'importador_directo';
      const profileType = document.getElementById('ceClientProfileType')?.value || 'auto';
      const ctaGoal = document.getElementById('ceCtaGoal')?.value || 'quote';
      const customInstructions = (document.getElementById('ceCustomNotesInput')?.value || '').trim();
      const msgLength = 'balanced';
      const priceMode = 'with_prices';

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
        profileType,
        customInstructions,
        msgLength,
        priceMode,
        ctaGoal,
        orderHistory: cust.order_history_summary || '',
        forceRefresh: true
      });

      cust._custom_message = res.body;
      cust._custom_subject = res.subject;
      cust._detected_need = res.need;
      cust._detected_sector = res.sector;
      cust._is_manual_edit = false;

      // Sincronizar con base de datos jjp_prospects si aplica
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

      syncComposerWithCurrentCustomer();
      updatePreview();

      if (btn) {
        btn.textContent = '✅ Propuesta Lista ✓';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = origTxt; }, 2200);
      }
    } catch (err) {
      console.warn('Error en regeneración individual con IA:', err);
      // Fallback a propuesta heurística diferenciada
      const prop = generateCustomerTailoredProposal(cust);
      cust._custom_message = prop.message;
      cust._custom_subject = prop.subject;
      cust._detected_sector = prop.sector;
      cust._detected_need = prop.need;
      cust._is_manual_edit = false;
      syncComposerWithCurrentCustomer();
      updatePreview();

      if (btn) {
        btn.textContent = '✅ Propuesta Adaptada ✓';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = origTxt; }, 2200);
      }
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

  
  function formatBodyToCorporateHtml(text) {
    if (!text) return '';
    const lines = String(text).split(/\r?\n/);
    const blocks = [];
    let currentParagraph = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentParagraph.length) {
          blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
          currentParagraph = [];
        }
        continue;
      }

      // Viñeta / Bloque de Solución o Insumo
      if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('▪')) {
        if (currentParagraph.length) {
          blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
          currentParagraph = [];
        }
        let content = trimmed.replace(/^[•\-*▪]\s*/, '');
        content = content.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
        content = content.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
        blocks.push(
          '<div style="margin:8px 0 10px;padding:12px 16px;background-color:#f8fafc;border:1px solid #e2e8f0;border-left:3.5px solid #16604A;border-radius:8px;font-size:14.5px;color:#1e293b;line-height:1.65;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
            '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>' +
              '<td width="20" valign="top" style="color:#16604A;font-weight:bold;font-size:15px;padding-right:8px;line-height:1.4;">✔</td>' +
              '<td valign="top" style="font-size:14px;color:#1e293b;line-height:1.65;">' + content + '</td>' +
            '</tr></table>' +
          '</div>'
        );
        continue;
      }

      // Título de sección destacado
      if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length < 80) {
        if (currentParagraph.length) {
          blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
          currentParagraph = [];
        }
        const title = trimmed.slice(1, -1);
        blocks.push('<div style="font-size:12.5px;font-weight:700;color:#16604A;margin:24px 0 10px;text-transform:uppercase;letter-spacing:0.8px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + title + '</div>');
        continue;
      }

      let formatted = trimmed
        .replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
      currentParagraph.push(formatted);
    }

    if (currentParagraph.length) {
      blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
    }

    return blocks.join('');
  }

  function renderCorporateEmailHtml({ subject = '', body = '', sellerName = '', sellerPhone = '', sellerCode = '', imgUrl = '' } = {}) {
    const bodyHtml = formatBodyToCorporateHtml(body);
    const sName = sellerName || currentConfig?.seller?.name || 'Keyder Salazar';
    const sPhone = sellerPhone || currentConfig?.seller?.phone || '0412-4676073 / 0212-7531777';
    const sCode = sellerCode || currentConfig?.seller?.mixnet_code || currentConfig?.seller?.ref_code || currentConfig?.seller?.code || '005';
    const catalogUrl = 'https://jjpaper.pages.dev/catalogo.html?ref=' + encodeURIComponent(sCode);

    // Iniciales del asesor para el monograma ejecutivo
    const nameParts = sName.trim().split(/\s+/);
    const initials = (nameParts.length > 1
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0])
      : nameParts[0].slice(0, 2)).toUpperCase();

    // Limpiar teléfono para WhatsApp directo
    const cleanPhoneDigits = (sPhone.split('/')[0] || sPhone).replace(/\D/g, '');
    const waNumber = cleanPhoneDigits.startsWith('0') ? '58' + cleanPhoneDigits.slice(1) : (cleanPhoneDigits.startsWith('58') ? cleanPhoneDigits : '58' + cleanPhoneDigits);

    return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHTML(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @keyframes jjp-pulse {
      0% { box-shadow: 0 4px 14px rgba(22, 96, 74, 0.25); }
      50% { box-shadow: 0 6px 22px rgba(22, 96, 74, 0.50); }
      100% { box-shadow: 0 4px 14px rgba(22, 96, 74, 0.25); }
    }
    .jjp-btn-cta {
      display: inline-block !important;
      background: linear-gradient(135deg, #16604A 0%, #1e7a5e 100%) !important;
      color: #ffffff !important;
      padding: 14px 34px !important;
      font-size: 15px !important;
      font-weight: 700 !important;
      text-decoration: none !important;
      border-radius: 8px !important;
      letter-spacing: 0.3px !important;
      box-shadow: 0 4px 14px rgba(22, 96, 74, 0.3) !important;
      transition: all 0.25s ease-in-out !important;
      animation: jjp-pulse 3s infinite ease-in-out !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    }
    .jjp-btn-cta:hover {
      background: linear-gradient(135deg, #0f4b39 0%, #16604A 100%) !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 8px 24px rgba(22, 96, 74, 0.5) !important;
    }
    .jjp-btn-wa:hover {
      text-decoration: underline !important;
      color: #0f4b39 !important;
    }
    @media only screen and (max-width: 620px) {
      .jjp-container { width: 100% !important; }
      .jjp-card-body { padding: 22px 18px !important; }
      .jjp-header-cell { padding: 20px 18px !important; }
      .jjp-footer-cell { padding: 20px 18px !important; }
      .jjp-btn-cta { width: 100% !important; padding: 14px 20px !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.75;-webkit-font-smoothing:antialiased;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;padding:32px 12px;">
    <tr>
      <td align="center">
        <!-- Tarjeta Ejecutiva Principal (680px) -->
        <table role="presentation" class="jjp-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.05),0 8px 10px -6px rgba(0,0,0,0.01);text-align:left;">
          <!-- Barra Superior Corporativa en Degradé Institucional -->
          <tr>
            <td style="height:5px;background:linear-gradient(90deg, #16604A 0%, #208b6b 50%, #A7D7A0 100%);background-color:#16604A;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Cabecera Institucional con Logo en Alta Definición y RIF Oficial -->
          <tr>
            <td class="jjp-header-cell" style="background-color:#ffffff;padding:26px 32px 22px 32px;border-bottom:2px solid #16604A;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="60" valign="middle" style="padding-right:16px;">
                    <a href="https://jjpaper.pages.dev" target="_blank" style="text-decoration:none;display:inline-block;">
                      <img src="https://jjpaper.pages.dev/assets/img/logo.svg" alt="JJ Paper C.A." width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;">
                    </a>
                  </td>
                  <td valign="middle" align="left">
                    <div style="font-size:21px;font-weight:800;color:#0f172a;letter-spacing:0.5px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      JJ PAPER <span style="font-size:14px;font-weight:700;color:#16604A;">C.A.</span>
                    </div>
                    <div style="font-size:12.5px;color:#64748b;margin-top:4px;font-weight:500;line-height:1.4;">
                      RIF: <strong style="color:#0f172a;">J-29537545-0</strong> · Importador &amp; Distribuidor Mayorista Directo
                    </div>
                    <div style="margin-top:5px;">
                      <span style="display:inline-block;padding:2px 8px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:11px;color:#16604A;font-weight:600;">
                        📍 Caracas, Venezuela · Despacho Corporativo en 24h
                      </span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Asunto Formal / Cintillo de Comunicación B2B -->
          ${subject ? `
          <tr>
            <td style="background-color:#f8fafc;padding:12px 32px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#334155;">
              <span style="color:#16604A;margin-right:6px;">📋</span> Ref: ${escapeHTML(subject)}
            </td>
          </tr>` : ''}

          <!-- Flyer o Imagen Adjunta (si aplica) -->
          ${imgUrl ? `
          <tr>
            <td style="padding:24px 32px 0 32px;text-align:center;">
              <img src="${imgUrl}" alt="Catálogo Comercial" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.05);display:block;margin:0 auto;">
            </td>
          </tr>` : ''}

          <!-- Cuerpo del Mensaje -->
          <tr>
            <td class="jjp-card-body" style="padding:28px 32px 20px 32px;font-size:15px;color:#1e293b;line-height:1.75;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Cuadro Institucional de Respaldo & Garantía Operativa JJ Paper -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #16604A;border-radius:8px;padding:18px 20px;">
                <tr>
                  <td>
                    <div style="font-size:12.5px;font-weight:700;color:#16604A;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">
                      🛡️ Respaldo &amp; Garantía Operativa JJ Paper C.A.
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:13.5px;color:#334155;line-height:1.65;">
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Facturación Fiscal Formal SENIAT:</strong> Emitida legalmente en bolívares calculada a Tasa Oficial BCV del día.
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Despacho Directo en 24 Horas:</strong> Flota propia con entrega ágil y puntual en su sede (Caracas y La Guaira).
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Servicio de Procura Especial:</strong> ¿Requiere un insumo, medida o maquinaria fuera de catálogo? Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Cuadro de Cotización Web Directa desde el Catálogo -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;border:1.5px solid #16604A;border-radius:10px;padding:16px 20px;box-shadow:0 4px 12px rgba(22,96,74,0.08);">
                <tr>
                  <td>
                    <div style="font-size:14px;font-weight:700;color:#16604A;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      🛒 Cotización Web Directa desde Nuestro Catálogo
                    </div>
                    <div style="font-size:13.5px;color:#334155;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      En nuestro catálogo en línea puede armar su lista de requerimientos (como un carrito de compras) y enviarla directamente a su asesor asignado (<strong>${escapeHTML(sName)}</strong>). Con un simple clic procesamos su cotización formal con mejores costos por volumen liquidada a <strong>Tasa Oficial BCV</strong>.
                    </div>
                    <div style="margin-top:8px;font-size:12px;color:#64748b;font-style:italic;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      💡 Nota: Los precios mostrados en el catálogo son referenciales. Se pueden mejorar y aplicar descuentos adicionales por volumen corporativo al procesar su solicitud.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botón de Acción Principal (CTA con Redirección y Animación) -->
          <tr>
            <td style="padding:0 32px 28px 32px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" style="border-radius:8px;background-color:#16604A;">
                    <a href="${catalogUrl}" target="_blank" class="jjp-btn-cta" style="display:inline-block;padding:14px 34px;background-color:#16604A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;letter-spacing:0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-shadow:0 4px 14px rgba(22,96,74,0.3);text-align:center;">
                      🌐 Armar Cotización en Catálogo ↗
                    </a>
                  </td>
                </tr>
              </table>
              <div style="margin-top:14px;font-size:12.5px;color:#64748b;line-height:1.5;">
                💬 ¿Desea atención directa o cotización formal inmediata? 
                <a href="https://wa.me/${waNumber}?text=${encodeURIComponent('Hola, me comunico con JJ Paper para solicitar una cotización formal.')}" target="_blank" class="jjp-btn-wa" style="color:#16604A;font-weight:700;text-decoration:underline;">Escríbanos a WhatsApp (${escapeHTML(sPhone.split('/')[0].trim())})</a>
              </div>
            </td>
          </tr>

          <!-- Firma Corporativa y Pie Institucional B2B -->
          <tr>
            <td class="jjp-footer-cell" style="background-color:#f8fafc;padding:24px 32px;border-top:1px solid #e2e8f0;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="48" valign="top" style="padding-right:14px;">
                    <div style="width:44px;height:44px;border-radius:50%;background-color:#16604A;color:#ffffff;font-weight:800;font-size:16px;text-align:center;line-height:44px;letter-spacing:0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      ${initials}
                    </div>
                  </td>
                  <td valign="top" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.2;">
                      ${escapeHTML(sName)}
                    </div>
                    <div style="font-size:13px;color:#64748b;margin-top:2px;">
                      Dirección Comercial &amp; Cuentas Corporativas · <strong>JJ Paper C.A.</strong>
                    </div>
                    <div style="font-size:13px;color:#16604A;font-weight:600;margin-top:6px;">
                      📱 WhatsApp / Celular: <a href="https://wa.me/${waNumber}" target="_blank" style="color:#16604A;text-decoration:none;font-weight:600;">${escapeHTML(sPhone)}</a>
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:3px;">
                      🏢 Central Corporativa: +58 412 2830185 / 0212 7531777 · <strong>RIF: J-29537545-0</strong>
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px;">
                      📍 Caracas, Venezuela · Despacho y Distribución Mayorista Directa
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:14px;border-top:1px solid #e2e8f0;margin-top:12px;font-size:11.5px;color:#475569;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    🛒 <strong>Cotice directamente desde nuestro catálogo digital:</strong> Ingrese a <a href="${catalogUrl}" target="_blank" style="color:#16604A;font-weight:700;text-decoration:underline;">jjpaper.pages.dev/catalogo.html?ref=${encodeURIComponent(sCode)}</a> para armar su requerimiento y despacharlo a su asesor comercial asignado. Precios mejorables por volumen.
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:10px;font-size:11px;color:#94a3b8;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    Este mensaje institucional B2B ha sido remitido por JJ Paper C.A. exclusivamente para presentar oportunidades de suministro corporativo directo. Si no desea recibir más comunicaciones, responda con la palabra 'Baja' y su dirección será excluida de inmediato.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
          ? `${publicBase}/catalogo`
          : (prodId ? `${publicBase}/producto?id=${encodeURIComponent(prodId)}` : (prodSku ? `${publicBase}/producto?sku=${encodeURIComponent(prodSku)}` : `${publicBase}/catalogo`)))
      : ((typeof sellerRefLink === 'function') ? (sellerRefLink() || `${publicBase}/catalogo`) : `${publicBase}/catalogo`);

    // Priorizar el mensaje del cliente activo si existe, o el del input
    let rawText = currentCust?._custom_message || document.getElementById('ceMessageInput')?.value || '';
    let subjectText = currentCust?._custom_subject || document.getElementById('ceSubjectInput')?.value || 'Propuesta Comercial — JJ Paper C.A.';

    const sample = {
      nombre: currentCust?.contact_name || currentCust?.name || 'Cliente B2B',
      empresa: currentCust?.name || currentCust?.company_name || 'Su Empresa',
      vendedor: currentConfig?.seller?.name || 'Keyder José Salazar',
      producto: selectedProductOrCombo?.name || 'Papelería y Suministros',
      precio: `${Number(selectedProductOrCombo?.final_price_usd || selectedProductOrCombo?.price_usd || 2.45).toFixed(2)} USD`,
      descuento: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '15%',
      descripcion: selectedProductOrCombo?.description || 'Papelería y suministros de alta rotación con despacho directo.',
      link
    };

    // Resolver variables
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
      previewItems.push(`<div class="ce-bubble-doc-card">📖 Catalogo_y_Lista_de_Precios_JJ_Paper.pdf (Catálogo Oficial con QR)</div>`);
    }

    if (attachOpts.includes('custom_file') && !generatedFlyerFile) {
      const file = document.getElementById('ceCustomFileInput')?.files?.[0];
      if (file) {
        previewItems.push(`<div class="ce-bubble-doc-card">📎 ${escapeHTML(file.name)} (${(file.size / 1024).toFixed(1)} KB)</div>`);
      }
    }

    attachPreviewEl.style.display = previewItems.length ? 'block' : 'none';
    attachPreviewEl.innerHTML = previewItems.join('');

    const emailFrame = document.getElementById('ceEmailSimulatorFrame');
    const waWrap = document.getElementById('ceWaSimulatorWrap');

    if (isEmail) {
      if (emailFrame) emailFrame.style.display = 'flex';
      if (waWrap) waWrap.style.display = 'none';

      const fromEl = document.getElementById('ceSimFromEmail');
      if (fromEl) fromEl.innerHTML = `${escapeHTML(currentConfig?.seller?.name || 'Keyder José Salazar')} &lt;ventas@jjpaper.com&gt;`;

      const toEl = document.getElementById('ceSimToEmail');
      if (toEl) toEl.innerHTML = `${escapeHTML(currentCust?.name || 'Cliente')} &lt;${escapeHTML(currentCust?.email || 'cliente@empresa.com')}&gt;`;

      const subjEl = document.getElementById('ceSimSubjectText');
      if (subjEl) subjEl.innerHTML = `📄 ${escapeHTML(subjectText)}`;

      // Formatear cuerpo del correo en bloques limpios, espaciados y con tarjetas de insumos
      const lines = String(rendered).split(/\r?\n/);
      const blocks = [];
      let currentParagraph = [];

      for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (currentParagraph.length) {
            blocks.push('<p style="margin:0 0 16px 0;line-height:1.7;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
            currentParagraph = [];
          }
          continue;
        }

        // Viñeta / Tarjeta de insumo
        if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('▪')) {
          if (currentParagraph.length) {
            blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
            currentParagraph = [];
          }
          let content = trimmed.replace(/^[•\-*▪]\s*/, '');
          content = escapeHTML(content);
          content = content.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
          content = content.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
          blocks.push(
            '<div class="ce-email-item-card">' +
              '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>' +
                '<td width="20" valign="top" style="color:#16604A;font-weight:bold;font-size:15px;padding-right:8px;line-height:1.4;">✔</td>' +
                '<td valign="top" style="font-size:14px;color:#1e293b;line-height:1.65;">' + content + '</td>' +
              '</tr></table>' +
            '</div>'
          );
          continue;
        }

        // Título de sección destacado
        if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length < 80) {
          if (currentParagraph.length) {
            blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
            currentParagraph = [];
          }
          const title = trimmed.slice(1, -1);
          blocks.push('<div class="ce-email-section-title">' + escapeHTML(title) + '</div>');
          continue;
        }

        let fLine = escapeHTML(trimmed)
          .replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>')
          .replace(/_([^_]+)_/g, '<em>$1</em>')
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
        currentParagraph.push(fLine);
      }

      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
      }

      // Cuadro Institucional de Respaldo JJ Paper en el Simulador
      blocks.push(`
        <div class="ce-email-guarantee-card">
          <div class="ce-email-guarantee-title">🛡️ Respaldo &amp; Garantía Operativa JJ Paper C.A.</div>
          <div class="ce-email-guarantee-item">
            <span class="ce-email-check">✔</span> <strong>Facturación Fiscal Formal SENIAT:</strong> Emitida legalmente en bolívares calculada a Tasa Oficial BCV del día.
          </div>
          <div class="ce-email-guarantee-item">
            <span class="ce-email-check">✔</span> <strong>Despacho Directo en 24 Horas:</strong> Flota propia con entrega ágil y puntual en su sede (Caracas y La Guaira).
          </div>
          <div class="ce-email-guarantee-item">
            <span class="ce-email-check">✔</span> <strong>Servicio de Procura Especial:</strong> ¿Requiere un insumo, medida o maquinaria fuera de catálogo? Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.
          </div>
        </div>
      `);

      // Botón Destacado al Catálogo Digital (+2.400 artículos) con Animación
      const sellerDisplayName = currentConfig?.seller?.name || 'Keyder José Salazar';
      const sellerDisplayPhone = currentConfig?.seller?.phone || '0412-4676073 / 0212-7531777';
      const cleanPhoneDigits = (sellerDisplayPhone.split('/')[0] || sellerDisplayPhone).replace(/\D/g, '');
      const waNumber = cleanPhoneDigits.startsWith('0') ? '58' + cleanPhoneDigits.slice(1) : (cleanPhoneDigits.startsWith('58') ? cleanPhoneDigits : '58' + cleanPhoneDigits);

      blocks.push(`
        <div class="ce-email-catalog-btn-wrap">
          <a href="https://jjpaper.pages.dev/catalogo" target="_blank" class="ce-email-catalog-btn">
            🌐 Ver Catálogo Digital Completo (+2.400 Productos) ↗
          </a>
          <div class="ce-email-wa-action" style="margin-top:12px;font-size:12.5px;color:#64748b;">
            💬 ¿Desea atención directa o cotización formal inmediata? 
            <a href="https://wa.me/${waNumber}?text=${encodeURIComponent('Hola, me comunico con JJ Paper para solicitar una cotización formal.')}" target="_blank" style="color:#16604A;font-weight:700;text-decoration:underline;">Escríbanos a WhatsApp (${escapeHTML(sellerDisplayPhone.split('/')[0].trim())})</a>
          </div>
        </div>
      `);

      // Firma Institucional con Monograma y Datos Oficiales
      const nameParts = sellerDisplayName.trim().split(/\s+/);
      const initials = (nameParts.length > 1
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0])
        : nameParts[0].slice(0, 2)).toUpperCase();

      blocks.push(`
        <div class="ce-email-signature-card">
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div class="ce-email-monogram">
              ${initials}
            </div>
            <div>
              <div style="font-size:15.5px;font-weight:700;color:#0f172a;line-height:1.2;">${escapeHTML(sellerDisplayName)}</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px;">Dirección Comercial &amp; Cuentas Corporativas · <strong>JJ Paper C.A.</strong></div>
              <div style="font-size:13px;color:#16604A;font-weight:600;margin-top:6px;">
                📱 WhatsApp / Celular: <a href="https://wa.me/${waNumber}" target="_blank" style="color:#16604A;text-decoration:none;font-weight:600;">${escapeHTML(sellerDisplayPhone)}</a>
              </div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">🏢 Central Corporativa: +58 412 2830185 / 0212 7531777 · <strong>RIF: J-29537545-0</strong></div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">📍 Caracas, Venezuela · Despacho y Distribución Mayorista Directa</div>
            </div>
          </div>
        </div>
      `);

      const simBodyEl = document.getElementById('ceSimBodyContent');
      if (simBodyEl) simBodyEl.innerHTML = blocks.join('');

    } else {
      // Modo WhatsApp
      if (emailFrame) emailFrame.style.display = 'none';
      if (waWrap) waWrap.style.display = 'block';

      let formatted = escapeHTML(rendered);
      formatted = formatted.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
      formatted = formatted.replace(/_(.+?)_/g, '<em>$1</em>');
      formatted = formatted.replace(/~(.+?)~/g, '<del>$1</del>');
      formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#00a884;font-weight:700;text-decoration:underline;">$1</a>');

      const bubbleEl = document.getElementById('ceBubbleText');
      if (bubbleEl) bubbleEl.innerHTML = formatted;
      const timeEl = document.getElementById('ceBubbleTime');
      if (timeEl) {
        timeEl.style.display = 'inline';
        timeEl.textContent = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
      }
      const chkEl = document.getElementById('ceCheckmarks');
      if (chkEl) chkEl.style.display = 'inline';
    }

    // Sincronizar campos de edición manual en Tab 3
    const msgInput = document.getElementById('ceMessageInput');
    if (msgInput && document.activeElement !== msgInput) {
      msgInput.value = rawText;
    }
    const subjInput = document.getElementById('ceSubjectInput');
    if (subjInput && document.activeElement !== subjInput) {
      subjInput.value = subjectText;
    }
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

  function insertCatalogLink(type = 'web') {
    const textarea = document.getElementById('ceMessageInput');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    let snippet = '';
    if (type === 'qr') {
      snippet = `\n\n📲 *Catálogo Interactivo con Códigos QR (para ver o imprimir):*\nhttps://jjpaper.pages.dev/catalogo_impreso\n`;
    } else {
      snippet = `\n\n👉 *Catálogo Digital Completo y Fichas Técnicas (Acceso libre sin registro):*\nhttps://jjpaper.pages.dev/catalogo\n`;
    }
    textarea.value = text.substring(0, start) + snippet + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    updatePreview();
  }

  function closeAiDraftModal() {
    const modal = document.getElementById('campAiDraftModal');
    if (modal) {
      modal.classList.remove('op');
      modal.style.display = 'none';
    }
  }

  function openAiDraftModal() {
    let modal = document.getElementById('campAiDraftModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'campAiDraftModal';
      modal.className = 'ce-picker-overlay';
      modal.innerHTML = `
        <div class="ce-picker-dialog">
          <div class="ce-picker-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:20px;">🪄</span>
              <div>
                <h3 style="margin:0; font-size:16px; font-weight:700;">Redactar Propuesta Comercial con IA</h3>
                <span style="font-size:11.5px; color:#64748b;">Control total de redacción, argumentos comerciales y personalización</span>
              </div>
            </div>
            <button type="button" class="ce-btn-close" id="btnCloseAiDraftTop">✕</button>
          </div>
          <div class="ce-picker-body">
            <!-- Info contextual -->
            <div id="ceAiDraftContextBox" style="margin-bottom:14px; padding:10px 12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; font-size:12.5px; color:#0369a1;"></div>

            <!-- 1. Objetivo / Propuesta Base -->
            <div style="margin-bottom:14px;">
              <label style="display:block; font-weight:700; font-size:13px; color:#1e293b; margin-bottom:5px;">1. Objetivo o Propuesta Comercial a Presentar</label>
              <input type="text" id="ceAiDraftObjective" style="width:100%; box-sizing:border-box; padding:8px 12px; font-size:13px; border:1px solid #cbd5e1; border-radius:8px;" placeholder="Ej: Actualización de precios de resmas, reposición para oficina, oferta escolar...">
            </div>

            <!-- 2. Instrucciones Personalizadas (Control Total) -->
            <div style="margin-bottom:14px;">
              <label style="display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:13px; color:#1e293b; margin-bottom:5px;">
                <span>2. Instrucciones Específicas / Petición del Asesor <span style="font-weight:normal; font-size:11px; color:#64748b;">(Opcional pero prioritario)</span></span>
              </label>
              <textarea id="ceAiDraftCustomInstructions" rows="3" placeholder="Ej: Haz énfasis en entrega en 24h a toda Caracas, resalta que emitimos factura fiscal y tasa BCV, o menciona que tenemos bultos cerrados a precio especial..." style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:12.5px; border:1px solid #cbd5e1; border-radius:8px; resize:vertical; line-height:1.4; font-family:inherit;"></textarea>
              <span style="display:block; font-size:11px; color:#64748b; margin-top:3px;">La IA obedecerá fielmente tus directivas sin añadir rellenos innecesarios.</span>
            </div>

            <!-- 3. Parámetros Estratégicos -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">💼 Tono Comercial</label>
                <select id="ceAiDraftTone" style="width:100%; box-sizing:border-box; padding:7px 10px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="socio_estrategico">💼 Socio Estratégico (Profesional B2B)</option>
                  <option value="oportunidad_mayorista">🔥 Oferta Mayorista (Oportunidad y ahorro)</option>
                  <option value="cercano_consultivo">🤝 Cercano y Consultivo (Asesor amigo)</option>
                  <option value="institucional_formal">🏢 Institucional Formal (Corporativo)</option>
                  <option value="fidelizado_reactivacion">💎 Cliente VIP / Fidelizado</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">🎯 Sector Objetivo</label>
                <select id="ceAiDraftSector" style="width:100%; box-sizing:border-box; padding:7px 10px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="auto">🌐 Detectar / Adaptar Automático</option>
                  <option value="oficinas">🏢 Oficinas y Empresas</option>
                  <option value="colegios">🏫 Colegios e Institutos</option>
                  <option value="papelerias">📚 Papelerías, Librerías y Quincallas (Reventa)</option>
                  <option value="clinicas">🏥 Clínicas y Salud</option>
                  <option value="restaurantes">🍽️ Restaurantes y Alimentos</option>
                  <option value="retail">🛒 Supermercados y Retail</option>
                </select>
              </div>
            </div>

            <!-- 4. Ajustes Finos de Estructura -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:8px;">
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">📏 Longitud</label>
                <select id="ceAiDraftLength" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="balanced" selected>Equilibrado (B2B)</option>
                  <option value="short">Ultra-Conciso (3-5 lín)</option>
                  <option value="detailed">Detallado y Formal</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">💰 Precios</label>
                <select id="ceAiDraftPriceMode" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="with_prices" selected>Con Precios ($ y Bs BCV)</option>
                  <option value="no_prices">Solo Disponibilidad (Sin precios)</option>
                  <option value="bulk_only">Enfocar Precios por Bulto</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">🎯 Llamado Acción</label>
                <select id="ceAiDraftCta" style="width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
                  <option value="quote" selected>Pedir Cotización</option>
                  <option value="inventory">Reponer Inventario</option>
                  <option value="catalog">Solicitar Catálogo</option>
                  <option value="meeting">Coordinar Asesoría</option>
                </select>
              </div>
            </div>
          </div>
          <div class="ce-picker-footer">
            <div style="font-size:11.5px; color:#64748b;">
              <span>Se insertará automáticamente en el editor con soporte Spintax</span>
            </div>
            <div style="display:flex; gap:10px;">
              <button type="button" class="ce-btn btn-sec" id="btnCancelAiDraft">Cancelar</button>
              <button type="button" class="ce-btn btn-pri" id="btnConfirmAiDraft" style="background:#16604A; border-color:#16604A;">Redactar Mensaje 🪄</button>
            </div>
          </div>
        </div>
      `;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAiDraftModal();
      });
      document.body.appendChild(modal);

      document.getElementById('btnCloseAiDraftTop').onclick = closeAiDraftModal;
      document.getElementById('btnCancelAiDraft').onclick = closeAiDraftModal;

      document.getElementById('btnConfirmAiDraft').onclick = () => {
        const objective = document.getElementById('ceAiDraftObjective')?.value?.trim() || '';
        const customInstructions = document.getElementById('ceAiDraftCustomInstructions')?.value?.trim() || '';
        const tone = document.getElementById('ceAiDraftTone')?.value || 'socio_estrategico';
        const targetSector = document.getElementById('ceAiDraftSector')?.value || 'auto';
        const msgLength = document.getElementById('ceAiDraftLength')?.value || 'balanced';
        const priceMode = document.getElementById('ceAiDraftPriceMode')?.value || 'with_prices';
        const ctaGoal = document.getElementById('ceAiDraftCta')?.value || 'quote';

        // Sincronizar selectores principales de la pantalla si el usuario los cambió en el modal
        const mainTone = document.getElementById('ceCommercialTone');
        if (mainTone && tone) mainTone.value = tone;
        const mainSec = document.getElementById('ceTargetSector');
        if (mainSec && targetSector) mainSec.value = targetSector;
        onSectorStrategyChange();

        closeAiDraftModal();
        executeAiDraftTemplate({
          objective,
          customInstructions,
          tone,
          targetSector,
          msgLength,
          priceMode,
          ctaGoal
        });
      };
    }

    // Context box y valores por defecto
    const contextBox = document.getElementById('ceAiDraftContextBox');
    const objInput = document.getElementById('ceAiDraftObjective');
    const toneSelect = document.getElementById('ceAiDraftTone');
    const secSelect = document.getElementById('ceAiDraftSector');

    const activeTone = document.getElementById('ceCommercialTone')?.value || 'socio_estrategico';
    const activeSec = document.getElementById('ceTargetSector')?.value || 'auto';
    if (toneSelect) toneSelect.value = activeTone;
    if (secSelect) secSelect.value = activeSec;

    let defaultObj = '';
    let contextHtml = '';
    if (selectedProductsList && selectedProductsList.length > 0) {
      defaultObj = `Lote especial de promociones mayoristas (${selectedProductsList.length} artículos destacados con precios de importador)`;
      contextHtml = `📦 <strong>${selectedProductsList.length} artículos seleccionados</strong> en el editor. La IA incluirá sus especificaciones y precios actualizados.`;
    } else if (selectedProductOrCombo) {
      defaultObj = `Disponibilidad y suministro mayorista de ${selectedProductOrCombo.name || selectedProductOrCombo.title}`;
      contextHtml = `💡 <strong>Producto seleccionado:</strong> <em>"${escapeHTML(selectedProductOrCombo.name || selectedProductOrCombo.title)}"</em>. La IA lo destacará como protagonista comercial.`;
    } else {
      defaultObj = 'Actualización de condiciones mayoristas y reposición de inventario';
      contextHtml = `🚀 <strong>Catálogo General JJ Paper:</strong> La IA redactará una propuesta corporativa destacando nuestro rol como importador directo y despacho en 24h.`;
    }

    if (objInput) objInput.value = defaultObj;
    if (contextBox) contextBox.innerHTML = contextHtml;

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('op'));
  }

  function aiDraftTemplate() {
    openAiDraftModal();
  }

  async function executeAiDraftTemplate(params = {}) {
    const isEmail = currentConfig?.channel === 'email';
    const btn = document.getElementById('ceAiDraftBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Redactando con IA...';
    }

    try {
      await ensureGeminiClient();
      if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');

      const valueHook = document.getElementById('ceValueHook')?.value || 'importador_directo';
      const userInstruction = document.getElementById('ceCustomNotesInput')?.value?.trim() || '';
      const combinedInstructions = [params.customInstructions, userInstruction].filter(Boolean).join('. ');

      let autoObjective = params.objective || '';
      if (!autoObjective) {
        if (activeCampaignMode === 'presentacion_b2b') {
          autoObjective = 'Presentación institucional de JJ Paper a nueva empresa B2B con catálogo y propuesta de cotización de prueba';
        } else if (activeCampaignMode === 'seguimiento_prospecto') {
          autoObjective = 'Seguimiento a cotización previa y confirmación de despacho inmediato sin repetir presentación';
        } else if (activeCampaignMode === 'reposicion_cliente') {
          autoObjective = 'Recordatorio preventivo de reposición de papelería, oficina y limpieza para cliente activo';
        } else if (activeCampaignMode === 'oferta_multiproducto') {
          autoObjective = 'Oferta multi-producto de lote ahorro con precios preferenciales en USD y Bolívares a tasa BCV';
        } else if (activeCampaignMode === 'oferta_unipromocion') {
          autoObjective = 'Promoción de producto estrella con disponibilidad física garantizada y escala por bulto';
        } else {
          autoObjective = 'Propuesta comercial de abastecimiento mayorista';
        }
      }

      const result = await window.GeminiClient.draftCampaignMessage({
        objective: autoObjective.trim(),
        customInstructions: combinedInstructions,
        product: selectedProductOrCombo,
        products: selectedProductsList,
        discount: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '',
        audience: document.getElementById('ceAudienceSelect')?.value || 'todos',
        channel: currentConfig?.channel || 'whatsapp',
        sellerName: currentConfig?.seller?.name || '',
        targetSector: params.targetSector || 'auto',
        tone: params.tone || 'socio_estrategico',
        valueHook,
        msgLength: params.msgLength || 'balanced',
        priceMode: params.priceMode || 'with_prices',
        ctaGoal: params.ctaGoal || 'quote',
        includeSourcing: true
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
    const shown = (c ? (c.contact_name || c.company_name || c.name) : null) || 'Estimado Cliente';
    const custCompany = (c ? (c.company_name || c.name) : null) || 'su empresa';
    const sPhone = (typeof window !== 'undefined' && window.CURRENT_PROFILE?.phone) || '0412-4676073';

    // 1. Si el asesor escribió o cargó una plantilla en el editor, ADAPTAR ESA MISMA PROPUESTA:
    const currentInput = (document.getElementById('ceMessageInput')?.value || '').trim();
    if (currentInput && currentInput.length > 10 && !currentInput.includes('Le saludamos cordialmente de JJ Paper...')) {
      let custom = currentInput;
      // Reemplazar variables dinámicas {{...}} PRIMERO
      custom = custom
        .replace(/\{\{nombre\}\}/gi, shown)
        .replace(/\{\{contacto\}\}/gi, shown)
        .replace(/\{\{empresa\}\}/gi, custCompany)
        .replace(/\{\{vendedor\}\}/gi, sName)
        .replace(/\{\{telefono\}\}/gi, sPhone)
        .replace(/\{\{link\}\}/gi, 'https://jjpaper.pages.dev/catalogo');

      // Resolver Spintax {A|B|C} para humanizar cada envío
      custom = custom.replace(/\{([^{}]+)\}/g, (_, choices) => {
        const arr = choices.split('|');
        return arr[Math.floor(Math.random() * arr.length)];
      });
      return custom;
    }

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
      ? '\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 2.400 artículos disponibles para despacho inmediato.'
      : '';

    function getSectorProposalLines(contact) {
      if (!contact) {
        return [
          '• *Resmas de papel Bond Carta y Oficio* (75g y 80g de máxima blancura).',
          '• *Archivadores de palanca, carpetas y suministros de oficina y escritorio*.',
          '• *Cintas de embalaje industrial*, bolígrafos por caja y artículos de archivo.'
        ];
      }
      const raw = `${contact.company_name || ''} ${contact.name || ''} ${contact.sector || ''} ${contact.notes || ''} ${contact.tags || ''}`.toLowerCase();

      if (/cl[ií]nica|salud|m[eé]dico|dental|laboratorio|hospital|consultorio|sanatorio|odontol|farmacia|droguer/i.test(raw)) {
        return [
          '• *Sobres para radiografía y estudios (14×17 y Oficio)* — Entrega profesional de resultados y placas.',
          '• *Carpetas de historias médicas con divisiones y gancho* — Cumplimiento reglamentario y resguardo clínico.',
          '• *Resmas de papel Bond y rollos térmicos certificados libres de polvillo* — Cero atascos en informes y admisión.'
        ];
      }
      if (/colegio|escuela|instituto|liceo|educaci[oó]n|educativo|universidad|acad[eé]mico|docente|plantel/i.test(raw)) {
        return [
          '• *Resmas de papel Bond Carta y Oficio (75g y 80g)* — Blancura y rendimiento para guías y evaluaciones masivas.',
          '• *Marcadores de pizarra acrílica recargables y borradores* — Alta pigmentación para el equipo docente.',
          '• *Carpetas de expedientes estudiantiles, cuadernos y archivo escolar* — Precios mayoristas por volumen.'
        ];
      }
      if (/transporte|log[ií]stica|env[ií]os|cargo|almac[eé]n|ferreter[ií]a|repuestos|distribuidora|aduana|embalaje/i.test(raw)) {
        return [
          '• *Cintas de embalaje industrial marrón y transparente (48mm × 100m/200m)* — Adhesivo de alto agarre sobre cartón corrugado.',
          '• *Marcadores industriales permanentes (Servicio 80 / Sharpie)* — Tinta indeleble para rotulación de bultos.',
          '• *Dispensadores tipo pistola, exactos de trabajo pesado y tirros* — Agilidad en despacho y paletizado.'
        ];
      }
      if (/librer[ií]a|papeler[ií]a|bazar|quincalla|variedades|copias|comercio|detal/i.test(raw)) {
        return [
          '• *Resmas de papel Bond Carta y Oficio por bulto cerrado* — Precio mayorista de importador para maximizar su margen.',
          '• *Línea escolar y oficina de alta rotación* — Cuadernos, bolígrafos por caja, pegas y marcadores.',
          '• *Surtido continuo y reposición rápida en su mostrador* — Despacho directo a su local en Caracas.'
        ];
      }
      if (/supermercado|abasto|bodeg[oó]n|charcuter[ií]a|panader[ií]a|automercado|minimarket|viveres|alimentos|restaurante/i.test(raw)) {
        return [
          '• *Rollos térmicos fiscales y para puntos de venta (80×70mm y 57×40mm)* — Nitidez pura y cero atascos en caja.',
          '• *Marcadores detectores de billetes falsos Kores* — Protección y resguardo inmediato en cobros.',
          '• *Cintas de embalaje industrial y resmas para facturación y control interno* — Entrega inmediata en su sede.'
        ];
      }
      if (/banco|seguros|financier|consultor|asesor|legal|abogad|contab/i.test(raw)) {
        return [
          '• *Archivadores de palanca de 3" con cantoneras metálicas* — Organización reglamentaria y resguardo SENIAT a 10 años.',
          '• *Resmas de papel Bond Carta y Oficio (80g)* — Máxima blancura y pulcritud para contratos e informes ejecutivos.',
          '• *Carpetas de fibra marrón con ganchos y bolígrafos ejecutivos* — Suministro continuo para oficinas.'
        ];
      }
      // Corporativo general / empresas
      return [
        '• *Resmas de papel Bond Carta y Oficio (75g/80g)* — Gramaje y blancura ideal para impresión de contratos e informes.',
        '• *Archivadores de palanca y carpetas de archivo* — Resguardo reglamentario y organización contable SENIAT.',
        '• *Consumibles de escritorio* — Bolígrafos por caja, grapas 26/6, notas adhesivas y suministros diarios.'
      ];
    }

    const sectorLines = getSectorProposalLines(c);

    let base = '';
    if (isContacted) {
      base = `{Hola|Buen día|Un gusto saludarle de nuevo} ${shown} 👋, un cordial saludo.\n\n{Le saluda atentamente|Le escribe nuevamente} *${sName}* de *JJ Paper C.A.* En seguimiento a nuestra comunicación previa, queríamos consultarles brevemente cómo se encuentran de stock e insumos para sus sedes esta semana.\n\nSomos importadores y distribuidores directos de papelería corporativa, útiles de oficina, consumibles de caja y embalaje con facturación a Tasa Oficial BCV.\n\n🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n*📦 DISPONIBILIDAD INMEDIATA EN:*\n${sectorLines.join('\n')}${pdf}\n\n👉 Puede consultar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Tienen algún requerimiento o cotización abierta esta semana en la que podamos apoyarles?|¿Gusta que le reservemos inventario para su despacho de esta semana?|Quedo a su disposición para coordinar lo que necesite.}`;
    } else {
      base = `{Hola|Buen día|Un gusto saludarle} ${shown} 👋, un cordial saludo.\n\n{Le escribe|Le saluda} *${sName}* de *JJ Paper C.A.*, su distribuidor mayorista directo en Caracas de papelería corporativa, consumibles de oficina, insumos de caja/facturación y suministros operativos.\n\n🔍 *¿Requiere un insumo, medida o maquinaria fuera de catálogo?* Nuestro equipo de Procura Especial se lo ubica directamente con entrega inmediata a Tasa Oficial BCV.\n\n*📦 DISPONIBILIDAD INMEDIATA EN:*\n${sectorLines.join('\n')}${pdf}\n\n👉 Puede consultar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal para su empresa?|Quedo a su disposición para apoyarle en lo que necesite.}`;
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
      // Si hay prospectos sin análisis individual, asegurar que todos tengan el mensaje base de la campaña
      selectedAudienceList.forEach(c => {
        if (!c._custom_message) c._custom_message = body;
        if (isEmail && !c._custom_subject) c._custom_subject = subject;
      });
      if (!body || body.includes('Le saludamos cordialmente de JJ Paper...') || body === '{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}') {
        body = buildMinimalFallback(null, currentConfig.channel || 'whatsapp', currentConfig.seller?.name, document.getElementById('ceAttachPdf')?.checked !== false);
      }
      if (isEmail && !subject) subject = '📋 Propuesta de Suministro y Optimización Operativa — JJ Paper C.A.';

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
            : (subject || '📋 Propuesta de Suministro y Optimización Operativa — JJ Paper C.A.');
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
    switchLeftTab,
    generateCustomerTailoredProposal,
    populateAudienceUniqueProposals,
    setCampaignMode,
    onToneOrNotesChange,
    onMessageInputChange,
    onSubjectInputChange,
    openCatalogPickerForActiveMode,
    startAiDraftForCampaign,
    applyBaseModeTemplate,
    renderCorporateEmailHtml,
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
    onSectorStrategyChange,
    onCooldownHoursChange,
    onTemplateChange,
    onAudienceChange,
    onAttachChange,
    onCustomFileChange,
    insertVar,
    insertSpintax,
    insertCatalogLink,
    updatePreview,
    launch,
    aiDraftTemplate,
    openAiDraftModal,
    closeAiDraftModal,
    executeAiDraftTemplate,
    aiSectorPitch,
    aiAntiSpamSpintax,
    aiDesignFlyer
  };
})();
