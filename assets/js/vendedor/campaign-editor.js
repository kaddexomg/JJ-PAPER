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
                <span>📎 Adjunto de Campaña</span>
              </div>
              <div class="ce-field-group">
                <select class="ce-select" id="ceAttachSelect" onchange="CampaignEditor.onAttachChange()">
                  <option value="none">❌ Sin adjunto (Solo mensaje)</option>
                  <option value="prod_image">🖼️ Ficha / Foto del Producto o Combo</option>
                  <option value="pdf_lista_precios">📄 Adjuntar Lista de Precios PDF</option>
                  <option value="custom_file">📁 Subir Archivo Propio (PDF/Imagen)</option>
                </select>
              </div>
              <div id="ceCustomFileWrap" style="display:none; margin-top:4px;">
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
        ? '{Hola|Estimado(a)|Saludos cordiales} {{nombre}},\n\nLe saludamos cordialmente de JJ Paper...\n\nAtentamente,\n{{vendedor}}'
        : '{Hola|Saludos|Buen día} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones hoy.\n👉 Catálogo: {{link}}';
    }

    if (isEmail) {
      document.getElementById('ceSubjectInput').value = 'Ofertas y Novedades Especiales — JJ Paper';
    }

    onAudienceChange();
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
      msg = `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nDesde JJ Paper queremos compartirle nuestro combo especial diseñado para su negocio:\n\n🎁 *${c.name}*\n${c.description ? '📝 Incluye: ' + c.description + '\n' : ''}💲 Precio del combo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Vea todos los detalles y confirme su orden aquí:\n{{link}}\n\n¡Contamos con despacho inmediato y asesoría personalizada!\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`;
      document.getElementById('ceSubjectInput').value = `🎁 Combo en Promoción: ${c.name} — JJ Paper`;
    } else {
      msg = `{¡Hola|Saludos cordiales|Buen día} {{nombre}}! 🌟 Le saluda {{vendedor}} de JJ Paper.\n\n🎁 *SUPER COMBO DE TEMPORADA*\n*${c.name}*\n${c.description ? '📝 ' + c.description + '\n' : ''}💲 Por tan solo: *$${Number(c.final_price_usd).toFixed(2)} USD*\n\n👉 Vea los detalles y haga su pedido en: {{link}}\n¡Promoción por tiempo limitado hasta agotar stock! ¿Desea apartarlo hoy?`;
    }
    document.getElementById('ceMessageInput').value = msg;
    document.getElementById('ceAttachSelect').value = 'prod_image';
    onAttachChange();
    updatePreview();
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

    const attachOpt = document.getElementById('ceAttachSelect').value;
    const attachPreviewEl = document.getElementById('ceBubbleAttachment');
    
    if (attachOpt === 'prod_image' && selectedProductOrCombo?.image_url) {
      attachPreviewEl.style.display = 'block';
      attachPreviewEl.innerHTML = `<img src="${selectedProductOrCombo.image_url}" alt="Preview" style="max-height:160px;width:100%;object-fit:cover;border-radius:8px;margin-bottom:6px">`;
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
    const speed = document.getElementById('ceSpeedSelect')?.value || 'human';
    const isEmail = currentConfig?.channel === 'email';
    const subject = isEmail ? document.getElementById('ceSubjectInput').value.trim() : null;

    if (!name) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!body) { alert('El mensaje no puede estar vacío.'); return; }
    if (isEmail && !subject) { alert('El asunto del correo es obligatorio.'); return; }
    if (!selectedAudienceList.length) { alert('No hay destinatarios seleccionados.'); return; }

    const delays = {
      human: { min: 45, max: 90 },
      safe: { min: 25, max: 55 },
      ultra_safe: { min: 60, max: 120 },
      fast: { min: 15, max: 30 }
    }[speed] || { min: 45, max: 90 };

    const batchSize = parseInt(document.getElementById('ceBatchSizeSelect')?.value, 10) || 0;
    const batchPauseM = parseInt(document.getElementById('ceBatchPauseSelect')?.value, 10) || 5;

    const launchConfig = {
      channel: currentConfig.channel || 'whatsapp',
      name,
      body,
      subject,
      audience: selectedAudienceList,
      attachOpt,
      selectedProductOrCombo,
      customFile: document.getElementById('ceCustomFileInput')?.files?.[0] || null,
      delays,
      batchSize,
      batchPauseM
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

  return { open, close, openCatalogPicker, onTypeChange, onTemplateChange, onAudienceChange, onAttachChange, onCustomFileChange, insertVar, insertSpintax, updatePreview, launch };
})();

