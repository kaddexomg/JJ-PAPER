/**
 * JJ Paper — Editor Chat-Like de Campañas (WhatsApp y Email)
 * assets/js/vendedor/campaign-editor.js
 */

window.CampaignEditor = (() => {
  let activeOverlay = null;
  let currentConfig = null;
  let selectedAudienceList = [];
  let selectedProductOrCombo = null;

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
                <span>🎯 Tipo y Enfoque</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTypeSelect" onchange="CampaignEditor.onTypeChange()">
                  <option value="general">📣 General / Toda Cartera</option>
                  <option value="producto">📦 Promoción de un Producto</option>
                  <option value="combo">🎁 Promoción de un Combo / Oferta</option>
                  <option value="reactivacion">😴 Reactivación de Clientes Inactivos</option>
                </select>
              </div>
              <div id="ceSelectedCardWrap" style="display:none; margin-top:4px;"></div>
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
                <span>📝 Plantilla Base</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceTemplateSelect" onchange="CampaignEditor.onTemplateChange()"></select>
              </div>
            </div>

            <div class="ce-section">
              <div class="ce-section-title">
                <span>📎 Adjunto de Campaña</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceAttachSelect" onchange="CampaignEditor.onAttachChange()">
                  <option value="none">❌ Sin adjunto (Solo mensaje)</option>
                  <option value="pdf_lista_precios">📄 Adjuntar Lista de Precios PDF</option>
                  <option value="prod_image">🖼️ Foto del Producto / Combo</option>
                  <option value="custom_file">📁 Subir Archivo Propio (PDF/Imagen)</option>
                </select>
              </div>
              <div id="ceCustomFileWrap" style="display:none; margin-top:4px;">
                <input type="file" id="ceCustomFileInput" class="ce-input" accept=".pdf,image/*" onchange="CampaignEditor.onCustomFileChange(this)">
              </div>
            </div>

            <div class="ce-section" id="ceSecuritySection">
              <div class="ce-section-title">
                <span>🛡️ Velocidad y Anti-Bloqueo</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceSpeedSelect">
                  <option value="safe" selected>🐢 Seguro (15 - 35 seg)</option>
                  <option value="ultra_safe">🛡️ Ultra Seguro (30 - 60 seg)</option>
                  <option value="fast">⚡ Rápido (8 - 18 seg)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Chat Simulator Pane (Right) -->
          <div class="ce-chat-pane" id="ceChatPane">
            <div class="ce-chat-header">
              <div class="ce-chat-avatar">👤</div>
              <div class="ce-chat-meta">
                <div class="ce-chat-client-name" id="cePreviewClientName">Librería El Saber, C.A.</div>
                <div class="ce-chat-client-sub" id="cePreviewClientSub">Vista previa en tiempo real</div>
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
              <div class="ce-variables-toolbar">
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('nombre')">👤 {{nombre}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('empresa')">🏢 {{empresa}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('vendedor')">💼 {{vendedor}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('producto')">📦 {{producto}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('precio')">💲 {{precio}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('descuento')">🏷️ {{descuento}}</button>
                <button type="button" class="ce-var-btn" onclick="CampaignEditor.insertVar('link')">🔗 {{link}}</button>
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

  function open(config = {}) {
    initModal();
    currentConfig = config;
    selectedProductOrCombo = null;

    const isEmail = config.channel === 'email';
    const badge = document.getElementById('ceBadge');
    badge.textContent = isEmail ? '📧 Email' : '📱 WhatsApp';
    badge.className = 'ce-channel-badge ' + (isEmail ? 'email' : '');
    
    document.getElementById('ceChatPane').className = 'ce-chat-pane ' + (isEmail ? 'email-mode' : '');
    document.getElementById('ceEmailSubjectField').style.display = isEmail ? 'block' : 'none';
    document.getElementById('ceEmailSubjectHeader').style.display = isEmail ? 'block' : 'none';
    document.getElementById('ceSecuritySection').style.display = isEmail ? 'none' : 'flex';
    document.getElementById('ceCheckmarks').style.display = isEmail ? 'none' : 'inline';

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
        ? 'Estimado/a {{nombre}},\n\nLe saludamos cordialmente de JJ Paper...\n\nAtentamente,\n{{vendedor}}'
        : 'Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}';
    }

    if (isEmail) {
      document.getElementById('ceSubjectInput').value = 'Ofertas y Novedades Especiales — JJ Paper';
    }

    onAudienceChange();
    updatePreview();
    activeOverlay.classList.add('active');
  }

  function onTypeChange() {
    const type = document.getElementById('ceTypeSelect').value;
    const cardWrap = document.getElementById('ceSelectedCardWrap');

    if (type === 'producto') {
      window.ProductPicker.open({
        mode: 'product',
        products: currentConfig.products || [],
        onSelect: (prod) => {
          selectedProductOrCombo = prod;
          renderSelectedCard();
          applyProductTemplate();
        }
      });
    } else if (type === 'combo') {
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
      msg = `Estimado/a {{nombre}},\n\nLe presentamos una oferta destacada en nuestro catálogo:\n\n📦 *${p.name}*\n${p.description ? p.description + '\n' : ''}💲 Precio especial: *$${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' (Aplica ' + p.discount_pct + '% de descuento)' : ''}\n\nPuede consultar nuestro catálogo online aquí: {{link}}\n\nQuedamos a su entera disposición,\n{{vendedor}} — JJ Paper`;
      document.getElementById('ceSubjectInput').value = `📦 Oferta Especial: ${p.name} — JJ Paper`;
    } else {
      msg = `Hola {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos en promoción destacada:\n📦 *${p.name}*\n${p.description ? p.description + '\n' : ''}💲 Precio especial: *$${Number(p.final_price_usd).toFixed(2)} USD*${p.discount_pct > 0 ? ' 🔥 *(' + p.discount_pct + '% OFF)*' : ''}\n\n👉 Ver catálogo completo: {{link}}\n¿Le apartamos algunas unidades?`;
    }
    document.getElementById('ceMessageInput').value = msg;
    document.getElementById('ceAttachSelect').value = 'prod_image';
    onAttachChange();
    updatePreview();
  }

  function applyComboTemplate() {
    if (!selectedProductOrCombo) return;
    const c = selectedProductOrCombo;
    const isEmail = currentConfig?.channel === 'email';

    let msg = '';
    if (isEmail) {
      msg = `Estimado/a {{nombre}},\n\nLe presentamos nuestro combo especial:\n\n🎁 *${c.name}*\n${c.description ? c.description + '\n' : ''}💲 Precio del combo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\nCatálogo: {{link}}\n\nAtentamente,\n{{vendedor}} — JJ Paper`;
      document.getElementById('ceSubjectInput').value = `🎁 Combo en Promoción: ${c.name} — JJ Paper`;
    } else {
      msg = `¡Hola {{nombre}}! 👋 Le saluda {{vendedor}} de JJ Paper.\n\n🎁 *SUPER COMBO DISPONIBLE*\n*${c.name}*\n${c.description ? c.description + '\n' : ''}💲 Por tan solo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Ver catálogo: {{link}}\n¡Promoción válida hasta agotar stock!`;
    }
    document.getElementById('ceMessageInput').value = msg;
    document.getElementById('ceAttachSelect').value = 'prod_image';
    onAttachChange();
    updatePreview();
  }

  function onTemplateChange() {
    const tplId = document.getElementById('ceTemplateSelect').value;
    const tpl = (currentConfig?.templates || []).find(t => t.id === tplId);
    if (tpl) {
      document.getElementById('ceMessageInput').value = tpl.body || '';
      updatePreview();
    }
  }

  function onAudienceChange() {
    const aud = document.getElementById('ceAudienceSelect').value;
    const tagWrap = document.getElementById('ceTagWrap');
    tagWrap.style.display = aud === 'etiqueta' ? 'block' : 'none';

    const contacts = currentConfig?.contacts || [];
    const isEmail = currentConfig?.channel === 'email';
    const tagVal = document.getElementById('ceTagInput')?.value?.toLowerCase().trim();

    selectedAudienceList = contacts.filter(c => {
      if (isEmail && !c.email) return false;
      if (!isEmail && !c.phone) return false;
      if (c.opt_out || c.email_opt_out) return false;

      if (aud === 'inactivos') return (c.total_orders > 0 && c.days_since_last > 30);
      if (aud === 'prospectos') return (!c.total_orders || c.total_orders === 0);
      if (aud === 'etiqueta' && tagVal) {
        return (c.zone && c.zone.toLowerCase().includes(tagVal)) || 
               (c.tags && c.tags.toLowerCase().includes(tagVal));
      }
      return true;
    });

    document.getElementById('ceFooterSummary').innerHTML = `Destinatarios válidos: <strong>${selectedAudienceList.length} contactos</strong>`;
    document.getElementById('ceLaunchBtn').disabled = selectedAudienceList.length === 0;
  }

  function onAttachChange() {
    const opt = document.getElementById('ceAttachSelect').value;
    document.getElementById('ceCustomFileWrap').style.display = opt === 'custom_file' ? 'block' : 'none';
    updatePreview();
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

  function updatePreview() {
    const text = document.getElementById('ceMessageInput').value;
    const isEmail = currentConfig?.channel === 'email';
    
    const sample = {
      nombre: 'Librería El Saber',
      empresa: 'Librería El Saber, C.A.',
      vendedor: currentConfig?.seller?.name || 'Asesor JJ Paper',
      producto: selectedProductOrCombo?.name || 'Cuaderno Universitario 100h',
      precio: `$${Number(selectedProductOrCombo?.final_price_usd || 2.45).toFixed(2)}`,
      descuento: selectedProductOrCombo?.discount_pct ? `${selectedProductOrCombo.discount_pct}%` : '15%',
      link: 'https://jjpaper-store.netlify.app/catalogo.html'
    };

    let rendered = text;
    for (const [k, v] of Object.entries(sample)) {
      rendered = rendered.replaceAll(`{{${k}}}`, v);
    }

    const attachOpt = document.getElementById('ceAttachSelect').value;
    const attachPreviewEl = document.getElementById('ceBubbleAttachment');
    
    if (attachOpt === 'prod_image' && selectedProductOrCombo?.image_url) {
      attachPreviewEl.style.display = 'block';
      attachPreviewEl.innerHTML = `<img src="${selectedProductOrCombo.image_url}" alt="Preview">`;
    } else if (attachOpt === 'pdf_lista_precios') {
      attachPreviewEl.style.display = 'block';
      attachPreviewEl.innerHTML = `<div class="ce-bubble-doc-card">📄 Lista_de_Precios_JJ_Paper.pdf (PDF Oficial)</div>`;
    } else if (attachOpt === 'custom_file') {
      const file = document.getElementById('ceCustomFileInput')?.files?.[0];
      if (file) {
        attachPreviewEl.style.display = 'block';
        attachPreviewEl.innerHTML = `<div class="ce-bubble-doc-card">📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>`;
      } else {
        attachPreviewEl.style.display = 'none';
      }
    } else {
      attachPreviewEl.style.display = 'none';
    }

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

  async function launch() {
    const name = document.getElementById('ceCampName').value.trim();
    const body = document.getElementById('ceMessageInput').value.trim();
    const attachOpt = document.getElementById('ceAttachSelect').value;
    const speed = document.getElementById('ceSpeedSelect')?.value || 'safe';
    const isEmail = currentConfig?.channel === 'email';
    const subject = isEmail ? document.getElementById('ceSubjectInput').value.trim() : null;

    if (!name) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!body) { alert('El mensaje no puede estar vacío.'); return; }
    if (isEmail && !subject) { alert('El asunto del correo es obligatorio.'); return; }
    if (!selectedAudienceList.length) { alert('No hay destinatarios seleccionados.'); return; }

    const delays = {
      safe: { min: 15, max: 35 },
      ultra_safe: { min: 30, max: 60 },
      fast: { min: 8, max: 18 }
    }[speed] || { min: 15, max: 35 };

    const launchConfig = {
      channel: currentConfig.channel || 'whatsapp',
      name,
      body,
      subject,
      audience: selectedAudienceList,
      attachOpt,
      selectedProductOrCombo,
      customFile: document.getElementById('ceCustomFileInput')?.files?.[0] || null,
      delays
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

  return { open, close, onTypeChange, onTemplateChange, onAudienceChange, onAttachChange, onCustomFileChange, insertVar, updatePreview, launch };
})();
