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
  let generatedFlyerFile = null;
  let cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set() };
  let knownNoWaPhones = new Set();
  let cooldownHours = 0;
  let cooldownLoading = null;

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
    return String(p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-11);
  }

  // Descarga contactos con envíos recientes para respetar cooldown anti-spam
  async function reloadCooldown() {
    cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set() };
    knownNoWaPhones = new Set();
    cooldownHours = 0;
    const isEmail = currentConfig?.channel === 'email';

    if (!isEmail) {
      try {
        const { data: noWa } = await sb.from('jjp_wa_campaign_targets')
          .select('phone')
          .eq('status', 'skipped')
          .ilike('error', '%sin WhatsApp%')
          .limit(2000);
        for (const row of noWa || []) {
          if (row.phone) knownNoWaPhones.add(normPhoneKey(row.phone));
        }
      } catch (e) {}
    }

    const key = isEmail ? 'email_camp_cooldown_h' : 'wa_camp_cooldown_h';
    const hours = parseInt(APP?.SETTINGS?.[key] || 48, 10);
    if (!hours || hours <= 0) return;
    const ownerId = currentConfig?.seller?.id;
    if (!ownerId) return;
    const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
    const table = isEmail ? 'jjp_email_campaign_targets' : 'jjp_wa_campaign_targets';
    const valueField = isEmail ? 'to_addr' : 'phone';
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table)
        .select(`customer_id, ${valueField}, sent_at`)
        .eq('owner_id', ownerId)
        .eq('status', 'sent')
        .gte('sent_at', cutoff)
        .order('sent_at', { ascending: false })
        .range(from, from + 999);
      if (error) break;
      for (const r of data || []) {
        if (r.customer_id) cooldownExcluded.customer.add(r.customer_id);
        if (isEmail) {
          if (r.to_addr) cooldownExcluded.email.add(String(r.to_addr).toLowerCase().trim());
        } else if (r.phone) {
          cooldownExcluded.phone.add(normPhoneKey(r.phone));
        }
      }
      if (!data || data.length < 1000) break;
    }
    cooldownHours = hours;
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
                  <option value="combo">🎁 Promoción de un Combo / Oferta Especial</option>
                  <option value="reactivacion">😴 Reactivación de Clientes Inactivos</option>
                </select>
              </div>
              
              <div id="cePickerTriggerWrap" style="margin-top:6px; display:flex; gap:6px;">
                <button type="button" class="ce-var-btn" style="flex:1; background:#f0fdf4; color:#166534; border-color:#86efac; font-weight:600; padding:6px 10px;" onclick="CampaignEditor.openCatalogPicker('product')">
                  📦 Elegir Producto del Catálogo
                </button>
                <button type="button" class="ce-var-btn" style="flex:1; background:#fdf2f8; color:#9d174d; border-color:#fbcfe8; font-weight:600; padding:6px 10px;" onclick="CampaignEditor.openCatalogPicker('combo')">
                  🎁 Elegir Combo / Promoción
                </button>
              </div>

              <div id="ceSelectedCardWrap" style="display:none; margin-top:8px;"></div>
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
                  <option value="inactivos">😴 Inactivos (sin compras >30d)</option>
                  <option value="prospectos">🆕 Clientes sin compras</option>
                  <option value="sector">🏢 Filtrar por Sector B2B...</option>
                  <option value="etiqueta">🏷️ Por etiqueta / zona...</option>
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
                  <span>👥 Seleccionar Prospectos</span>
                  <span class="ce-badge-pill" id="ceSelectedProspectsBadge">0</span>
                </button>
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
                  <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('descuento')">🏷️ {{descuento}}</button>
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

    // Normalizar números móviles en contactos
    if (Array.isArray(config.contacts)) {
      config.contacts.forEach(c => {
        if (!c.phone || (config.channel !== 'email' && !isMobileNum(c.phone))) {
          const best = getBestMobilePhone(c);
          if (best) c.phone = best;
        }
      });
    }

    // Auto-cargar catálogo (productos, combos y plantillas) si no fueron provistos
    if ((!config.products || config.products.length === 0) && typeof sb !== 'undefined') {
      try {
        const { data: prods } = await sb.from('jjp_product_variants')
          .select('id,sku,price_usd,variant_name,jjp_products(id,name,description,image_url),jjp_brands(name)')
          .eq('active', true)
          .order('price_usd', { ascending: false })
          .limit(300);
        config.products = prods || [];
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
        const { data: tpls } = await sb.from('jjp_campaign_templates')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false });
        config.templates = tpls || [];
      } catch (e) {
        console.warn('Aviso cargando plantillas en CampaignEditor:', e);
      }
    }

    if (document.getElementById('ceScheduledAt')) {
      document.getElementById('ceScheduledAt').value = '';
    }

    const isEmail = config.channel === 'email';
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
          renderSelectedCard();
          applyComboTemplate();
        }
      });
    } else {
      if (typeSel) typeSel.value = 'producto';
      window.ProductPicker.open({
        mode: 'product',
        products: currentConfig.products || [],
        onSelect: (prod) => {
          selectedProductOrCombo = prod;
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
    } else if (type === 'combo') {
      openCatalogPicker('combo');
    } else {
      selectedProductOrCombo = null;
      cardWrap.style.display = 'none';
      cardWrap.innerHTML = '';
    }
    updatePreview();
  }

  function renderSelectedCard() {
    const cardWrap = document.getElementById('ceSelectedCardWrap');
    if (!selectedProductOrCombo) {
      cardWrap.style.display = 'none';
      return;
    }

    cardWrap.style.display = 'block';
    cardWrap.innerHTML = `
      <div class="ce-selected-card">
        <img src="${selectedProductOrCombo.image_url}" alt="${selectedProductOrCombo.name}">
        <div class="ce-selected-info">
          <div class="ce-selected-name">${selectedProductOrCombo.name}</div>
          <div class="ce-selected-price">
            $${Number(selectedProductOrCombo.final_price_usd || selectedProductOrCombo.price_usd).toFixed(2)}
            ${selectedProductOrCombo.discount_pct > 0 ? `<span style="color:#e11d48; font-size:11px;">(-${selectedProductOrCombo.discount_pct}%)</span>` : ''}
          </div>
        </div>
        <button type="button" class="ce-var-btn" onclick="CampaignEditor.onTypeChange()">Cambiar</button>
      </div>
    `;
  }

  function applyProductTemplate() {
    if (!selectedProductOrCombo) return;
    const p = selectedProductOrCombo;
    const isEmail = currentConfig?.channel === 'email';

    let msg = '';
    if (isEmail) {
      msg = `{Estimado(a)|Hola|Apreciado(a)} {{nombre}},\n\nEspero se encuentre muy bien. Le escribe {{vendedor}} del equipo comercial de JJ Paper.\n\nQueremos presentarle una alternativa destacada para abastecer su inventario con entrega garantizada:\n\n*📦 ${p.name}*\n${p.description ? '📝 ' + p.description + '\n' : ''}*💲 Precio especial: $${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' (Descuento del ' + p.discount_pct + '% aplicado)' : ''}\n\n👉 Puede revisar la ficha técnica y gestionar su pedido en línea en el siguiente enlace:\n{{link}}\n\nQuedo atento si desea una cotización formal o reservar cantidades para despacho.\n\nUn cordial saludo,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `📦 Oferta Especial en ${p.name} — JJ Paper`;
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, espero estés muy bien 👋\n\nTe escribe {{vendedor}} de JJ Paper. Quería pasarte esta opción de alta rotación para tu negocio:\n\n*📦 ${p.name}*\n${p.description ? p.description + '\n' : ''}*💲 Precio especial: $${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' _(' + p.discount_pct + '% de descuento)_' : ''}\n\n👉 Puedes chequear detalles o hacer tu pedido aquí:\n{{link}}\n\n¿Te aparto unas unidades para tu próximo despacho?`;
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

    let msg = '';
    if (isEmail) {
      msg = `{Estimado(a)|Hola|Apreciado(a)} {{nombre}},\n\nEspero se encuentre muy bien. Le escribe {{vendedor}} de JJ Paper.\n\nPreparamos este combo especial pensado para surtir el inventario de su negocio al mejor costo:\n\n*🎁 COMBO: ${c.name}*\n${c.description ? '📝 Incluye: ' + c.description + '\n' : ''}*💲 Precio del combo: $${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Puede ver el detalle completo y confirmar su pedido aquí:\n{{link}}\n\n¡Contamos con despacho inmediato y asesoría personalizada!\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `🎁 Combo en Promoción: ${c.name} — JJ Paper`;
    } else {
      msg = `{Hola|Qué tal|Buen día} {{nombre}}, un gusto saludarte 👋\n\nTe escribe {{vendedor}} de JJ Paper. Armamos este combo especial pensado para surtir tu negocio:\n\n*🎁 COMBO: ${c.name}*\n${c.description ? '📝 ' + c.description + '\n' : ''}*💲 Precio del combo: $${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Ver detalles o pedir directamente aquí:\n{{link}}\n\n¿Te apartamos este combo antes de agotar existencia?`;
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

    let excludedCount = 0;
    let nonMobileCount = 0;

    selectedAudienceList = contacts.filter(c => {
      if (!isEmail && (!c.phone || !isMobileNum(c.phone))) {
        const best = getBestMobilePhone(c);
        if (best) c.phone = best;
      }
      if (isEmail && !c.email) return false;
      if (!isEmail && !c.phone) return false;
      if (isEmail && c.email_opt_out) return false;
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

      if (hitCooldown(c)) { excludedCount++; return false; }

      // Si el usuario aplicó una selección manual con checkboxes, priorizarla
      if (manualSelectedIds && manualSelectedIds.size > 0) {
        return manualSelectedIds.has(c.id);
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
    if (cooldownHours > 0 && excludedCount > 0) {
      detailsTxt += ` · <span style="color:#b45309;font-size:11px">${excludedCount} omitidos por envío reciente (<${cooldownHours}h)</span>`;
    }

    const countLabel = isEmail ? `${selectedAudienceList.length} correos` : `${selectedAudienceList.length} móviles WhatsApp`;
    document.getElementById('ceFooterSummary').innerHTML = `Destinatarios válidos: <strong>${countLabel}</strong>${b2bTxt}${detailsTxt}`;
    document.getElementById('ceLaunchBtn').disabled = selectedAudienceList.length === 0;

    // Actualizar badges
    const badgeEl = document.getElementById('ceSelectedProspectsBadge');
    if (badgeEl) badgeEl.textContent = selectedAudienceList.length;
    const analyzeCountEl = document.getElementById('ceAnalyzeCountSpan');
    if (analyzeCountEl) analyzeCountEl.textContent = selectedAudienceList.length;

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
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('con_compras')">Con Compras</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('nuevos')">Nuevos</button>
              <button type="button" class="ce-card-action-btn" onclick="CampaignEditor.setPickerQuickFilter('inactivos')">Inactivos (>30d)</button>
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
            <div style="font-size:13px; font-weight:700; color:#1e293b; display:flex; align-items:center; flex-wrap:wrap">
              <span>${escapeHTML(c.name || 'Sin Nombre')}</span>
              ${b2bBadge}
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
            <button type="button" class="ce-btn-close" onclick="document.getElementById('campAiToneModal').classList.remove('op')">✕</button>
          </div>
          <div style="padding:20px; font-size:14px; color:#334155;">
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
              <button type="button" class="ce-btn btn-sec" onclick="document.getElementById('campAiToneModal').classList.remove('op')">Cancelar</button>
              <button type="button" class="ce-btn btn-pri" id="btnConfirmAiTone">Empezar Análisis ⚡</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('btnConfirmAiTone').addEventListener('click', () => {
        const tone = document.querySelector('input[name="ai_tone"]:checked').value;
        modal.classList.remove('op');
        startAiAnalysisBatch(tone);
      });
    }

    document.querySelector('input[name="ai_tone"][value="presentacion"]').checked = true;
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

      await window.GeminiClient.analyzeCustomersBatch({
        customers: selectedAudienceList,
        channel,
        sellerName: sName,
        sellerPhone: sPhone,
        promoProductOrCombo: selectedProductOrCombo,
        officialPdfIncluded: isPdf,
        attitude: selectedTone,
        onProgress: ({ current, total, customer, result }) => {
          const pct = Math.round((current / total) * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressLabel) progressLabel.textContent = `Analizando ${current} de ${total}: ${customer.name || ''}... (${pct}%)`;
          customer._custom_message = result.body;
          customer._custom_subject = result.subject;
          customer._detected_need = result.need;
          customer._detected_sector = result.sector;

          // Sincronizar con base de datos jjp_prospects si es un prospecto B2B
          if (customer.is_prospect_b2b && customer.id && typeof sb !== 'undefined') {
            const raw = result.raw_analysis || {};
            const isEmail = (channel === 'email');
            const updatePayload = {
              status: customer.status === 'nuevo' ? 'analizado_ia' : customer.status,
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

      const res = await window.GeminiClient.analyzeCustomerAndDraftMessage({
        customer: cust,
        channel,
        sellerName: currentConfig?.seller?.name || '',
        sellerPhone: currentConfig?.seller?.phone || '',
        promoProductOrCombo: selectedProductOrCombo,
        officialPdfIncluded: isPdf,
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
    const isCombo = selectedProductOrCombo?.type === 'combo';
    const link = selectedProductOrCombo
      ? (isCombo
          ? `${publicBase}/promociones.html`
          : (prodId ? `${publicBase}/producto.html?id=${prodId}` : `${publicBase}/catalogo.html?q=${encodeURIComponent(selectedProductOrCombo.name || '')}`))
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
    const isEmail = currentConfig?.channel === 'email';
    const defPrompt = selectedProductOrCombo 
      ? `Disponibilidad y suministro mayorista de ${selectedProductOrCombo.name}`
      : 'Actualización de condiciones mayoristas y reposición de inventario';

    const obj = prompt('✨ ¿Qué propuesta comercial deseas presentar?\n(Ej: Suministro corporativo de resmas y papel, Reposición para el año escolar, Rollos térmicos para cajas)', defPrompt);
    if (!obj || !obj.trim()) return;

    const btn = document.getElementById('ceAiDraftBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Redactando con IA...';
    }

    try {
      await ensureGeminiClient();
      const result = await window.GeminiClient.draftCampaignMessage({
        objective: obj.trim(),
        product: selectedProductOrCombo,
        discount: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '',
        audience: document.getElementById('ceAudienceSelect')?.value || 'todos',
        channel: currentConfig?.channel || 'whatsapp',
        sellerName: currentConfig?.seller?.name || ''
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
    if (!selectedProductOrCombo) {
      alert('Por favor selecciona primero un producto o combo en el panel izquierdo.');
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

      if (!p._studio_photo_url && !p.image_url) {
        if (btn) btn.textContent = '🔍 Buscando Foto Comercial Real...';
        try {
          const realPhoto = await window.GeminiClient.searchRealProductPhoto(p.name);
          if (realPhoto) p._studio_photo_url = realPhoto;
        } catch (photoSearchErr) {
          console.warn('Búsqueda web de foto comercial no disponible:', photoSearchErr);
        }

        if (!p._studio_photo_url) {
          if (btn) btn.textContent = '📸 Generando Foto Estudio IA...';
          try {
            const photoRes = await window.GeminiClient.generateProductStudioPhoto({ product: p, theme: 'white' });
            if (photoRes?.imageUrl) p._studio_photo_url = photoRes.imageUrl;
          } catch (photoErr) {
            console.warn('Foto de estudio no pudo completarse:', photoErr);
          }
        }
      }

      if (btn) btn.textContent = '🎨 Renderizando Flyer...';
      const cvs = await window.GeminiClient.renderProductCard({
        product: p,
        customPriceUsd: p.final_price_usd || p.price_usd,
        sellerName: currentConfig?.seller?.name || '',
        sellerPhone: currentConfig?.seller?.phone || '',
        customNote: '🔥 ¡Promoción exclusiva por tiempo limitado!',
        theme: 'white',
        headline: '🔥 OFERTA AL MAYOR'
      });

      cvs.toBlob(async (blob) => {
        if (!blob) throw new Error('No se pudo generar el archivo de imagen.');
        const fileName = `Flyer_${(p.name || 'producto').replace(/[^\w.-]/g, '_')}.png`;
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
    const shown = (c ? c.name : null) || 'Estimado Cliente';
    const pdf = inclPdf !== false
      ? '\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.'
      : '';
    const base = `{Hola|Buen día|Un gusto saludarle} ${shown} 👋, un cordial saludo.\n\n{Le escribe|Le saluda} *${sName}* de *JJ Paper C.A.*, su distribuidor mayorista de papelería, insumos de caja y consumibles en Caracas. Somos el aliado para el abastecimiento continuo de su negocio.\n\n*📦 TENEMOS DISPONIBILIDAD INMEDIATA EN:*\n• *Rollos térmicos para puntos de venta* (POS y cajas registradoras).\n• *Resmas de papel Bond Carta y Oficio* y cuadernos de alta rotación.\n• *Cintas de embalaje* y consumibles de papelería escolar y de oficina.${pdf}\n\n👉 Puede consultar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal?|Quedo a su disposición para apoyarle en lo que necesite.}`;
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
        const doAnalyze = confirm(`Hay ${missingAnalysis.length} prospectos sin propuesta redactada por IA.\n\n¿Deseas analizarlos ahora para que cada cliente reciba su mensaje 100% personalizado y diferente?`);
        if (doAnalyze) {
          openAiToneModal();
          return;
        } else {
          await ensureGeminiClient();
          const isPdf = document.getElementById('ceAttachPdf')?.checked !== false;
          await Promise.all(missingAnalysis.map(async c => {
            try {
              const res = await window.GeminiClient.analyzeCustomerAndDraftMessage({
                customer: c,
                channel: currentConfig.channel || 'whatsapp',
                sellerName: currentConfig.seller?.name || '',
                sellerPhone: currentConfig.seller?.phone || '',
                promoProductOrCombo: selectedProductOrCombo,
                officialPdfIncluded: isPdf
              });
              c._custom_message = res.body;
              c._custom_subject = res.subject;
              c._detected_need = res.need;
              c._detected_sector = res.sector;
            } catch (e) {
              console.warn('Fallback heurístico falló para', c.name, e);
              const isPdfCited = document.getElementById('ceAttachPdf')?.checked !== false;
              c._custom_message = c._custom_message || buildMinimalFallback(c, currentConfig?.channel || 'whatsapp', currentConfig?.seller?.name, isPdfCited);
            }
          }));
        }
      }
      if (!body || body.includes('Le saludamos cordialmente de JJ Paper...') || body === '{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}') {
        body = buildMinimalFallback(null, currentConfig.channel || 'whatsapp', currentConfig.seller?.name, document.getElementById('ceAttachPdf')?.checked !== false);
      }
      if (isEmail && !subject) subject = '📋 Propuesta Comercial y Lista de Precios Oficial — JJ Paper C.A.';

      // Asegurar que cada contacto de la lista tenga su mensaje y asunto listos sin dejar ninguno vacío
      const isPdfActive = document.getElementById('ceAttachPdf')?.checked !== false;
      selectedAudienceList.forEach(c => {
        if (!c._custom_message) {
          c._custom_message = buildMinimalFallback(c, currentConfig?.channel || 'whatsapp', currentConfig?.seller?.name, isPdfActive);
        }
        if (isEmail && !c._custom_subject) {
          c._custom_subject = subject;
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
      btn.disabled = true;
      btn.textContent = 'Encolando campaña...';
      try {
        await currentConfig.onLaunch(launchConfig);
        close();
      } catch (err) {
        alert('Error al lanzar: ' + err.message);
        btn.disabled = false;
        btn.textContent = '🚀 Lanzar Campaña';
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
