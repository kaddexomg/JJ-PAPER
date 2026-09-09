/**
 * JJ Paper — Editor Chat-Like de Campañas (WhatsApp y Email)
 * assets/js/vendedor/campaign-editor.js
 */

window.CampaignEditor = (() => {
  let activeOverlay = null;
  let currentConfig = null;
  let selectedAudienceList = [];
  let selectedProductOrCombo = null;
  let generatedFlyerFile = null;
  let cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set() };
  let cooldownHours = 0;
  let cooldownLoading = null;

  function normPhoneKey(p) {
    return String(p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-11);
  }

  // Descarga la lista de contactos a los que YA se les envió por campaña en las
  // últimas N horas (email o WhatsApp) para NO repetirles mientras dure el
  // cooldown. Página en rangos de 1.000 (PostgREST).
  async function reloadCooldown() {
    cooldownExcluded = { customer: new Set(), email: new Set(), phone: new Set() };
    cooldownHours = 0;
    const isEmail = currentConfig?.channel === 'email';
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
            <div class="ce-section">
              <div class="ce-section-title">
                <span>📝 Plantilla Base</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTemplateSelect" onchange="CampaignEditor.onTemplateChange()"></select>
              </div>
            </div>

            <div class="ce-section">
              <div class="ce-section-title">
                <span>🎯 Tipo de Campaña y Catálogo</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTypeSelect" onchange="CampaignEditor.onTypeChange()">
                  <option value="general">📣 Campaña General / Toda Cartera</option>
                  <option value="producto">📦 Promoción de un Producto Destacado</option>
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

            <div class="ce-section">
              <div class="ce-section-title">
                <span>📇 Audiencia y Destinatarios</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceAudienceSelect" onchange="CampaignEditor.onAudienceChange()">
                  <option value="todos">Toda mi cartera de clientes</option>
                  <option value="inactivos">😴 Inactivos (sin compras >30d)</option>
                  <option value="prospectos">🆕 Prospectos (sin compras)</option>
                  <option value="etiqueta">🏷️ Por etiqueta / zona...</option>
                </select>
              </div>
              <div class="ce-field-group" id="ceTagWrap" style="display:none;">
                <input type="text" class="ce-input" id="ceTagInput" placeholder="Ej: 004, mayoristas..." oninput="CampaignEditor.onAudienceChange()">
              </div>
            </div>

            <div class="ce-section">
              <div class="ce-section-title">
                <span>📎 Adjuntos de Campaña</span>
              </div>
              <div class="ce-field-group">
                <div id="ceAttachCheckboxes" style="margin-top:2px;">
                  <label style="display:flex;align-items:center;font-size:12.5px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachImg" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>🖼️ Ficha / Foto del Producto o Flyer</span>
                  </label>
                  <label style="display:flex;align-items:center;font-size:12.5px;color:#334155;padding:3px 0;cursor:pointer">
                    <input type="checkbox" id="ceAttachPdf" onchange="CampaignEditor.onAttachChange()" style="margin-right:7px">
                    <span>📄 Adjuntar Lista de Precios PDF Oficial</span>
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
              <div style="font-size:11px;color:#6b7280;margin-top:4px;line-height:1.3">
                💡 Incluye variación <code>{Hola|Buenos días|Saludos}</code> para que cada cliente reciba un texto único y no se detecte como spam.
              </div>
            </div>

            <div class="ce-section" id="ceScheduleSection">
              <div class="ce-section-title">
                <span>📅 Programar Envío (Opcional)</span>
              </div>
              <div class="ce-field-group">
                <label style="font-size:11px;color:#475569;font-weight:600;display:block;margin-bottom:2px">Fecha y hora de inicio:</label>
                <input type="datetime-local" class="ce-input" id="ceScheduledAt" style="font-size:12px">
                <div style="font-size:10.5px;color:#64748b;margin-top:3px;line-height:1.3">
                  ⏰ Déjalo vacío para iniciar de inmediato. Si eliges fecha y hora futura, el servidor despachará automáticamente al llegar ese momento.
                </div>
              </div>
            </div>
          </div>

          <!-- Chat Simulator Pane (Right) -->
          <div class="ce-chat-pane" id="ceChatPane">
            <div class="ce-chat-header">
              <div class="ce-chat-avatar">👤</div>
              <div class="ce-chat-meta">
                <div class="ce-chat-client-name" id="cePreviewClientName">Librería El Saber, C.A.</div>
                <div class="ce-chat-client-sub" id="cePreviewClientSub">Vista previa interactiva en tiempo real</div>
              </div>
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

            <!-- Composer Area -->
            <div class="ce-composer-area">
              <div class="ce-ai-toolbar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                <button type="button" id="ceAiDraftBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);color:#166534;border-color:#86efac;font-weight:700" onclick="CampaignEditor.aiDraftTemplate()" title="Redactar o personalizar plantilla con IA">🪄 Redactar con IA</button>
                <button type="button" id="ceAiSpintaxBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%);color:#991b1b;border-color:#fecaca;font-weight:700" onclick="CampaignEditor.aiAntiSpamSpintax()" title="Generar Spintax anti-baneo automático">🛡️ Variar Anti-Spam IA</button>
                <button type="button" id="ceAiFlyerBtn" class="ce-var-btn" style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);color:#1e40af;border-color:#bfdbfe;font-weight:700" onclick="CampaignEditor.aiDesignFlyer()" title="Diseñar Flyer gráfico del producto con IA">🎨 Diseñar Flyer con IA</button>
              </div>

              <div class="ce-variables-toolbar">
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('nombre')">👤 {{nombre}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('empresa')">🏢 {{empresa}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('vendedor')">💼 {{vendedor}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('producto')">📦 {{producto}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('precio')">💲 {{precio}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('descuento')">🏷️ {{descuento}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('descripcion')">📝 {{descripcion}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('link')">🔗 {{link}}</button>
                <button type="button" class="ce-var-btn" style="background:#fef3c7;color:#92400e;border-color:#fcd34d" onclick="CampaignEditor.insertSpintax()" title="Variar saludos para evitar bloqueos">🎲 Spintax</button>
              </div>

              <div id="ceEmailSubjectField" style="display:none; margin-bottom:4px;">
                <input type="text" id="ceSubjectInput" class="ce-input" placeholder="Asunto del correo electrónico..." oninput="CampaignEditor.updatePreview()">
              </div>

              <textarea class="ce-textarea" id="ceMessageInput" placeholder="Escribe el mensaje de la campaña..." oninput="CampaignEditor.updatePreview()"></textarea>
            </div>
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

  async function open(config = {}) {
    initModal();
    currentConfig = config;
    selectedProductOrCombo = null;
    generatedFlyerFile = null;
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

    ['ceAttachPdf', 'ceAttachImg', 'ceAttachFile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    const customWrap = document.getElementById('ceCustomFileWrap');
    if (customWrap) customWrap.style.display = 'none';

    document.getElementById('ceCampName').value = config.defaultName || (isEmail ? 'Campaña de Email ' : 'Difusión WhatsApp ') + new Date().toLocaleDateString('es-VE');

    const tplSel = document.getElementById('ceTemplateSelect');
    const availableTpls = (config.templates || []).filter(t => !t.channel || t.channel === config.channel || t.channel === 'both');
    tplSel.innerHTML = availableTpls.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    if (config.preTplId) {
      tplSel.value = config.preTplId;
    }

    if (availableTpls.length > 0) {
      onTemplateChange();
    } else {
      document.getElementById('ceMessageInput').value = isEmail 
        ? '{Hola|Estimado(a)|Saludos cordiales} {{nombre}},\n\nLe saludamos cordialmente de JJ Paper...\n\nAtentamente,\n{{vendedor}}'
        : '{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}';
    }

    if (isEmail) {
      document.getElementById('ceSubjectInput').value = 'Ofertas y Novedades Especiales — JJ Paper';
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
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEsperamos que se encuentre excelente. Le presentamos una oportunidad destacada de nuestro catálogo:\n\n📦 *${p.name}*\n${p.description ? '📝 ' + p.description + '\n' : ''}💲 Precio especial: *$${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' (Incluye ' + p.discount_pct + '% de descuento exclusivo)' : ''}\n\n👉 Puede consultar disponibilidad y gestionar su pedido en línea aquí:\n{{link}}\n\nSi requiere cotización formal con factura fiscal o despacho inmediato, quedamos a su entera disposición.\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `📦 Oferta Especial en ${p.name} — JJ Paper`;
    } else {
      msg = `{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nLe escribimos para presentarle una excelente oferta en:\n📦 *${p.name}*\n${p.description ? p.description + '\n' : ''}💲 Precio de oportunidad: *$${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' 🔥 *(' + p.discount_pct + '% OFF)*' : ''}\n\n👉 Ver catálogo o pedir aquí: {{link}}\n¿Le reservamos inventario de este producto para su despacho?`;
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
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nDesde JJ Paper queremos compartirle nuestro combo especial diseñado para su negocio:\n\n🎁 *${c.name}*\n${c.description ? '📝 Incluye: ' + c.description + '\n' : ''}💲 Precio del combo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Vea todos los detalles y confirme su orden aquí:\n{{link}}\n\n¡Contamos con despacho inmediato y asesoría personalizada!\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `🎁 Combo en Promoción: ${c.name} — JJ Paper`;
    } else {
      msg = `{¡Hola|Saludos cordiales|Buen día} {{nombre}}! 🌟 Le saluda {{vendedor}} de JJ Paper.\n\n🎁 *SUPER COMBO DE TEMPORADA*\n*${c.name}*\n${c.description ? '📝 ' + c.description + '\n' : ''}💲 Por tan solo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Vea los detalles y haga su pedido en: {{link}}\n¡Promoción por tiempo limitado hasta agotar stock! ¿Desea apartarlo hoy?`;
    }
    document.getElementById('ceMessageInput').value = msg;
    const imgChk2 = document.getElementById('ceAttachImg');
    if (imgChk2) imgChk2.checked = true;
    onAttachChange();
    updatePreview();
  }

  async function onAudienceChange() {
    if (!cooldownLoading) cooldownLoading = reloadCooldown().finally(() => { cooldownLoading = null; });
    await cooldownLoading;
    const aud = document.getElementById('ceAudienceSelect').value;
    const tagWrap = document.getElementById('ceTagWrap');
    tagWrap.style.display = aud === 'etiqueta' ? 'block' : 'none';

    const contacts = currentConfig?.contacts || [];
    const isEmail = currentConfig?.channel === 'email';
    const tagVal = document.getElementById('ceTagInput')?.value?.toLowerCase().trim();
    const ex = cooldownExcluded;

    const hitCooldown = (c) =>
      ex.customer.has(c.id) ||
      (isEmail ? ex.email.has(String(c.email || '').toLowerCase().trim()) : ex.phone.has(normPhoneKey(c.phone)));

    let excludedCount = 0;
    selectedAudienceList = contacts.filter(c => {
      if (isEmail && !c.email) return false;
      if (!isEmail && !c.phone) return false;
      if (isEmail && c.email_opt_out) return false;
      if (!isEmail && (c.opt_out || c.wa_opt_out)) return false;

      if (hitCooldown(c)) { excludedCount++; return false; }

      if (aud === 'inactivos') return (c.total_orders > 0 && c.days_since_last > 30);
      if (aud === 'prospectos') return (!c.total_orders || c.total_orders === 0);
      if (aud === 'etiqueta' && tagVal) {
        const zoneMatch = c.zone && String(c.zone).toLowerCase().includes(tagVal);
        const tagMatch = Array.isArray(c.tags)
          ? c.tags.some(t => String(t).toLowerCase().includes(tagVal))
          : (c.tags && String(c.tags).toLowerCase().includes(tagVal));
        return zoneMatch || tagMatch;
      }
      return true;
    });

    const cooldownTxt = cooldownHours > 0
      ? ` · ${excludedCount} omitido${excludedCount !== 1 ? 's' : ''} por envío reciente (<${cooldownHours}h)`
      : '';
    document.getElementById('ceFooterSummary').innerHTML = `Destinatarios válidos: <strong>${selectedAudienceList.length} contactos</strong><span style="color:#b45309;font-size:11px">${cooldownTxt}</span>`;
    document.getElementById('ceLaunchBtn').disabled = selectedAudienceList.length === 0;
  }

  function onAttachChange() {
    const wrap = document.getElementById('ceCustomFileWrap');
    if (wrap) {
      wrap.style.display = document.getElementById('ceAttachFile')?.checked ? 'block' : 'none';
    }
    updatePreview();
  }

  // Soporta selección múltiple de adjuntos (PDF + foto/flyer + archivo propio) tanto para WhatsApp como para Email
  function currentAttachOpts() {
    const opts = [];
    if (document.getElementById('ceAttachImg')?.checked) opts.push('prod_image');
    if (document.getElementById('ceAttachPdf')?.checked) opts.push('pdf_lista_precios');
    if (document.getElementById('ceAttachFile')?.checked) opts.push('custom_file');
    return opts;
  }

  function onCustomFileChange(input) {
    updatePreview();
  }

  function insertVar(varName) {
    const textarea = document.getElementById('ceMessageInput');
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
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const spin = `{Hola|Buen día|Saludos|Qué tal}`;
    textarea.value = text.substring(0, start) + spin + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + spin.length;
    updatePreview();
  }

  function updatePreview() {
    const text = document.getElementById('ceMessageInput').value;
    const isEmail = currentConfig?.channel === 'email';
    
    // El link de venta debe apuntar SIEMPRE al dominio real en uso (jj-paper.pages.dev),
    // nunca a un dominio viejo de Netlify. Para un producto se usa la FICHA directa
    // (producto.html?id=<id del producto> — igual que la función fichaLink de ficha-producto.js);
    // para un combo/oferta se enlaza la sección de promociones.
    const publicBase = location.origin + location.pathname
      .replace(/\/(admin|vendedor)\/.*$/, '').replace(/\/[^/]*$/, '');
    const prodId = selectedProductOrCombo?.raw?.jjp_products?.id || selectedProductOrCombo?.product_id;
    const isCombo = selectedProductOrCombo?.type === 'combo';
    const link = selectedProductOrCombo
      ? (isCombo
          ? `${publicBase}/promociones.html`
          : (prodId ? `${publicBase}/producto.html?id=${prodId}` : `${publicBase}/catalogo.html?q=${encodeURIComponent(selectedProductOrCombo.name || '')}`))
      : (sellerRefLink ? (sellerRefLink() || `${publicBase}/catalogo.html`) : `${publicBase}/catalogo.html`);

    const sample = {
      nombre: 'Librería El Saber',
      empresa: 'Librería El Saber, C.A.',
      vendedor: currentConfig?.seller?.name || 'Asesor JJ Paper',
      producto: selectedProductOrCombo?.name || 'Cuaderno Universitario 100h',
      precio: `$${Number(selectedProductOrCombo?.final_price_usd || selectedProductOrCombo?.price_usd || 2.45).toFixed(2)} USD`,
      descuento: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '15%',
      descripcion: selectedProductOrCombo?.description || 'Papelería y suministros de alta calidad con despacho directo.',
      link
    };

    // Renderizar variables dobles PRIMERO ({{clave}} → valor), luego Spintax {A|B|C}.
    // Antes se resolvía Spintax antes y con una regex de llave simple que destruía la
    // llave interna de {{variable}} (la dejaba como {variable}), por eso las variables
    // se veían rotas en el preview y no coincidían con lo que se envía.
    let rendered = text.replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
      (_, k) => sample[k.trim().toLowerCase()] ?? '');
    rendered = rendered.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, choices) => {
      const parts = choices.split('|');
      return parts[0].trim();
    });

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
      previewItems.push(`<div class="ce-bubble-doc-card">📄 Lista_de_Precios_JJ_Paper.pdf (PDF Oficial)</div>`);
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
      const subj = document.getElementById('ceSubjectInput').value || 'Sin asunto';
      document.getElementById('ceEmailSubjectHeader').textContent = `Asunto: ${subj}`;
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

  async function aiDraftTemplate() {
    const isEmail = currentConfig?.channel === 'email';
    const defPrompt = selectedProductOrCombo 
      ? `Disponibilidad y suministro mayorista de ${selectedProductOrCombo.name}`
      : 'Actualización de condiciones mayoristas y reposición de inventario';

    const obj = prompt('✨ ¿Qué requerimiento o propuesta comercial deseas presentar?\n(Ej: Suministro corporativo de resmas y papel, Reposición para el año escolar, Oferta mayorista con despacho inmediato en Caracas)', defPrompt);
    if (!obj || !obj.trim()) return;

    const btn = document.getElementById('ceAiDraftBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Redactando con IA...';

    try {
      await ensureGeminiClient();
      if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');
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
      btn.disabled = false;
      btn.textContent = '🪄 Redactado ✓';
      setTimeout(() => { btn.textContent = origText; }, 2500);
    } catch (err) {
      alert('Error redactando con IA: ' + err.message);
      btn.disabled = false;
      btn.textContent = origText;
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
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Generando Spintax...';

    try {
      await ensureGeminiClient();
      if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');
      const spintax = await window.GeminiClient.generateCampaignSpintax(text, currentConfig?.channel || 'whatsapp');
      textarea.value = spintax;
      updatePreview();

      btn.disabled = false;
      btn.textContent = '🛡️ Spintax Aplicado ✓';
      setTimeout(() => { btn.textContent = origText; }, 2500);
    } catch (err) {
      alert('Error generando Spintax: ' + err.message);
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  async function aiDesignFlyer() {
    if (!selectedProductOrCombo) {
      alert('Por favor selecciona primero un producto o combo en el panel izquierdo.');
      openCatalogPicker('product');
      return;
    }

    const btn = document.getElementById('ceAiFlyerBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Diseñando Flyer...';

    try {
      await ensureGeminiClient();
      if (!window.GeminiClient) throw new Error('Módulo GeminiClient no disponible.');
      const p = selectedProductOrCombo;

      // Si el producto no tiene foto previa, generar primero la fotografía fotorrealista de estudio
      if (!p._studio_photo_url && !p.image_url) {
        btn.textContent = '📸 Generando Foto Estudio IA...';
        try {
          const photoRes = await window.GeminiClient.generateProductStudioPhoto({ product: p, theme: 'white' });
          if (photoRes?.imageUrl) {
            p._studio_photo_url = photoRes.imageUrl;
          }
        } catch (photoErr) {
          console.warn('Foto de estudio no pudo completarse antes del flyer:', photoErr);
        }
      }

      btn.textContent = '🎨 Renderizando Flyer...';
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
        btn.disabled = false;
        btn.textContent = '🎨 Flyer Listo ✓';
        setTimeout(() => { btn.textContent = origText; }, 2500);
      }, 'image/png');

    } catch (err) {
      alert('Error generando flyer: ' + err.message);
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  async function launch() {
    const name = document.getElementById('ceCampName').value.trim();
    const body = document.getElementById('ceMessageInput').value.trim();
    const attachOpts = currentAttachOpts();
    const attachOpt = attachOpts.length ? attachOpts.join(',') : 'none';
    const speed = document.getElementById('ceSpeedSelect')?.value || 'human';
    const isEmail = currentConfig?.channel === 'email';
    const subject = isEmail ? document.getElementById('ceSubjectInput').value.trim() : null;

    if (!name) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!body) { alert('El mensaje no puede estar vacío.'); return; }
    if (isEmail && !subject) { alert('El asunto del correo es obligatorio.'); return; }
    await onAudienceChange();
    if (!selectedAudienceList.length) { alert('No hay destinatarios seleccionados.'); return; }

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
      scheduled_at
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

  return { open, close, openCatalogPicker, onTypeChange, onTemplateChange, onAudienceChange, onAttachChange, onCustomFileChange, insertVar, insertSpintax, updatePreview, launch, aiDraftTemplate, aiAntiSpamSpintax, aiDesignFlyer };
})();

