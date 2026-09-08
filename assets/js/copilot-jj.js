/* ==========================================================================
   JJ Paper — Copiloto Flotante Inteligente & Creador de Flyers
   - Asistente comercial flotante para Admin y Vendedores
   - Consultas en vivo de productos, precios en USD y Bs (tasa BCV) y stock
   - Creador de Flyers visuales de producto con descarga, copiado o envío directo a WhatsApp
   - Herramienta anti-spam integrada
   ========================================================================== */

(function () {
  if (typeof window === 'undefined' || document.getElementById('jjp-copilot-root')) return;

  // Asegurar que GeminiClient esté cargado; si no, cargarlo dinámicamente
  function ensureGeminiClient(cb) {
    if (window.GeminiClient) return cb();
    const script = document.createElement('script');
    script.src = (location.pathname.includes('/admin/') || location.pathname.includes('/vendedor/'))
      ? '../assets/js/gemini-client.js?v=' + Date.now()
      : 'assets/js/gemini-client.js?v=' + Date.now();
    script.onload = () => cb();
    script.onerror = () => console.error('No se pudo cargar gemini-client.js');
    document.head.appendChild(script);
  }

  /* ---------------- Estilos Scoped del Copiloto ---------------- */
  function injectCopilotStyles() {
    if (document.getElementById('jjp-copilot-css')) return;
    const style = document.createElement('style');
    style.id = 'jjp-copilot-css';
    style.textContent = `
      #jjp-copilot-fab {
        position: fixed; right: 22px; bottom: 22px; z-index: 9998;
        display: flex; align-items: center; gap: 8px;
        background: linear-gradient(135deg, #16604A 0%, #0d3d2f 100%);
        color: #fff; padding: 10px 16px; border-radius: 999px;
        box-shadow: 0 4px 18px rgba(22, 96, 74, 0.45);
        cursor: pointer; border: 1.5px solid rgba(255,255,255,0.25);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13.5px; font-weight: 700; user-select: none;
      }
      #jjp-copilot-fab:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 6px 24px rgba(22, 96, 74, 0.6);
      }
      #jjp-copilot-fab .cpi-pulse {
        width: 10px; height: 10px; border-radius: 50%; background: #99CC33;
        box-shadow: 0 0 8px #99CC33; animation: cpiPulse 2s infinite;
      }
      @keyframes cpiPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
      }

      #jjp-copilot-window {
        position: fixed; right: 22px; bottom: 82px; z-index: 9999;
        width: 390px; max-width: calc(100vw - 32px); height: 580px; max-height: calc(100vh - 110px);
        background: #ffffff; border-radius: 18px;
        box-shadow: 0 16px 45px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.06);
        border: 1px solid rgba(22, 96, 74, 0.15);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      #jjp-copilot-window.cpi-hidden {
        opacity: 0; pointer-events: none; transform: translateY(16px) scale(0.96);
      }

      .cpi-head {
        background: linear-gradient(135deg, #16604A 0%, #0c382b 100%);
        color: #fff; padding: 14px 16px 10px; display: flex; align-items: center; justify-content: space-between;
      }
      .cpi-head-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14.5px; }
      .cpi-head-actions { display: flex; gap: 6px; }
      .cpi-head-btn {
        background: rgba(255,255,255,0.15); border: 0; color: #fff;
        width: 26px; height: 26px; border-radius: 6px; cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 14px;
      }
      .cpi-head-btn:hover { background: rgba(255,255,255,0.3); }

      .cpi-tabs {
        display: flex; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
      }
      .cpi-tab {
        flex: 1; padding: 8px 4px; text-align: center; font-size: 12.5px; font-weight: 600;
        color: #64748b; background: transparent; border: 0; cursor: pointer; transition: all 0.2s;
      }
      .cpi-tab.active {
        color: #16604A; background: #fff; border-bottom: 2px solid #16604A;
      }

      .cpi-body {
        flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; background: #fafbfc;
      }

      /* Tab 1: Chat */
      .cpi-chat-msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-bottom: 8px; }
      .cpi-msg {
        max-width: 85%; padding: 10px 13px; border-radius: 12px; font-size: 13px; line-height: 1.45;
      }
      .cpi-msg.ai {
        align-self: flex-start; background: #ffffff; border: 1px solid #e2e8f0; color: #1e293b;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .cpi-msg.user {
        align-self: flex-end; background: #16604A; color: #ffffff;
      }
      .cpi-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .cpi-chip {
        background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 999px;
        padding: 5px 10px; font-size: 11.5px; font-weight: 600; color: #334155;
        cursor: pointer; transition: all 0.15s;
      }
      .cpi-chip:hover { background: #e2e8f0; color: #0f172a; }

      .cpi-chat-input-bar {
        display: flex; gap: 6px; padding: 10px 12px; background: #fff; border-top: 1px solid #e2e8f0;
      }
      .cpi-chat-input {
        flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px;
        font-size: 13px; outline: none;
      }
      .cpi-chat-input:focus { border-color: #16604A; }
      .cpi-chat-send {
        background: #16604A; color: #fff; border: 0; border-radius: 8px;
        padding: 0 14px; font-weight: 600; cursor: pointer;
      }

      /* Tab 2: Flyer Generator */
      .cpi-flyer-panel { display: flex; flex-direction: column; gap: 10px; }
      .cpi-input-lbl { font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 2px; }
      .cpi-search-box { position: relative; }
      .cpi-results-dropdown {
        position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1px solid #cbd5e1;
        border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); max-height: 180px; overflow-y: auto;
        z-index: 10;
      }
      .cpi-res-item {
        padding: 8px 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 12.5px;
      }
      .cpi-res-item:hover { background: #f8fafc; }
      .cpi-canvas-preview {
        width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 12px; border: 1px solid #e2e8f0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.06); margin-top: 6px;
      }

      /* Tab 3: Anti-Spam */
      .cpi-var-box {
        background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px;
        margin-top: 8px; font-size: 12.5px; line-height: 1.45;
      }
      .cpi-var-title { font-weight: 700; color: #16604A; margin-bottom: 4px; display: flex; justify-content: space-between; }
      .cpi-var-copy-btn {
        background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px;
        padding: 2px 8px; font-size: 11px; cursor: pointer;
      }
      .cpi-var-copy-btn:hover { background: #e2e8f0; }

      @media (max-width: 600px) {
        #jjp-copilot-window { right: 8px; bottom: 74px; width: calc(100vw - 16px); height: calc(100vh - 90px); }
        #jjp-copilot-fab { right: 14px; bottom: 14px; padding: 8px 14px; font-size: 12.5px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ---------------- Construcción del HTML ---------------- */
  let _activeTab = 'chat';
  let _chatHistory = [];
  let _selectedFlyerProduct = null;

  function createCopilotDOM() {
    injectCopilotStyles();

    const root = document.createElement('div');
    root.id = 'jjp-copilot-root';
    root.innerHTML = `
      <div id="jjp-copilot-fab" title="Abrir Copiloto IA de JJ Paper">
        <span class="cpi-pulse"></span>
        <span>🤖 Copiloto JJ</span>
      </div>

      <div id="jjp-copilot-window" class="cpi-hidden">
        <div class="cpi-head">
          <div class="cpi-head-title">
            <span>🤖 Copiloto JJ · Asistente IA</span>
          </div>
          <div class="cpi-head-actions">
            <button class="cpi-head-btn" id="cpiCloseBtn" title="Cerrar">✕</button>
          </div>
        </div>

        <div class="cpi-tabs">
          <button class="cpi-tab active" data-tab="chat">💬 Chat Asesor</button>
          <button class="cpi-tab" data-tab="flyer">🎨 Crear Flyer</button>
          <button class="cpi-tab" data-tab="antispam">🛡️ Anti-Spam</button>
        </div>

        <!-- Tab 1: Chat -->
        <div class="cpi-body" id="cpiTabChat">
          <div class="cpi-chips">
            <span class="cpi-chip" onclick="cpiQuickAsk('¿A cómo está la tasa BCV hoy?')">💵 Tasa BCV hoy</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('¿Cuánto cuesta la resma de papel bond carta?')">📄 Resma papel</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('¿Cuáles son las opciones de despacho?')">🚚 Despachos</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('¿Cómo creo una cotización nueva?')">📝 Cotizar</span>
          </div>
          <div class="cpi-chat-msgs" id="cpiChatMsgs">
            <div class="cpi-msg ai">
              ¡Hola! Soy tu Copiloto Inteligente de JJ Paper. Puedo responderte dudas sobre productos, precios en $ y Bs a tasa BCV, y ayudarte a vender más rápido. ¿Qué necesitas consultar?
            </div>
          </div>
          <div class="cpi-chat-input-bar">
            <input type="text" class="cpi-chat-input" id="cpiChatInput" placeholder="Pregunta algo sobre productos o precios…">
            <button class="cpi-chat-send" id="cpiChatSendBtn">➤</button>
          </div>
        </div>

        <!-- Tab 2: Flyer Generator -->
        <div class="cpi-body" id="cpiTabFlyer" style="display:none">
          <div class="cpi-flyer-panel">
            <div class="cpi-search-box">
              <label class="cpi-input-lbl">Selecciona un producto del catálogo:</label>
              <input type="text" class="cpi-chat-input" id="cpiFlyerSearch" placeholder="Buscar por nombre o código…" autocomplete="off" style="width:100%">
              <div class="cpi-results-dropdown" id="cpiFlyerResults" style="display:none"></div>
            </div>

            <div id="cpiFlyerForm" style="display:none">
              <div style="display:flex;gap:8px">
                <div style="flex:1">
                  <label class="cpi-input-lbl">Precio USD ($):</label>
                  <input type="number" step="0.01" class="cpi-chat-input" id="cpiFlyerPrice" style="width:100%">
                </div>
                <div style="flex:1">
                  <label class="cpi-input-lbl">Nota / Contacto:</label>
                  <input type="text" class="cpi-chat-input" id="cpiFlyerNote" placeholder="Ej: Entrega inmediata" style="width:100%">
                </div>
              </div>
              <button class="cpi-chat-send" id="cpiRenderFlyerBtn" style="width:100%;margin-top:8px;padding:8px">🖼️ Generar / Actualizar Flyer</button>

              <canvas id="cpiCanvas" class="cpi-canvas-preview" width="800" height="800"></canvas>

              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                <button class="cpi-chip" id="cpiCopyImgBtn" style="flex:1;text-align:center;padding:7px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd">📋 Copiar Imagen</button>
                <button class="cpi-chip" id="cpiDownloadImgBtn" style="flex:1;text-align:center;padding:7px;background:#f0fdf4;color:#15803d;border-color:#bbf7d0">⬇️ Descargar PNG</button>
                <button class="cpi-chip" id="cpiSendWaBtn" style="flex:100%;text-align:center;padding:8px;background:#16604A;color:#fff;display:none">💬 Enviar a este Chat de WhatsApp</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 3: Anti-Spam -->
        <div class="cpi-body" id="cpiTabAntiSpam" style="display:none">
          <label class="cpi-input-lbl">Texto base del mensaje que enviarás:</label>
          <textarea class="cpi-chat-input" id="cpiAntiSpamInput" rows="3" placeholder="Ej: Hola, tenemos oferta especial en resmas de papel bond carta entrega hoy..." style="width:100%;resize:vertical"></textarea>
          <button class="cpi-chat-send" id="cpiGenAntiSpamBtn" style="width:100%;margin-top:8px;padding:8px">🛡️ Generar 3 Variaciones Anti-Baneo</button>
          
          <div id="cpiAntiSpamResults" style="margin-top:10px"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    // Eventos UI
    const fab = document.getElementById('jjp-copilot-fab');
    const win = document.getElementById('jjp-copilot-window');
    const closeBtn = document.getElementById('cpiCloseBtn');

    fab.addEventListener('click', () => {
      win.classList.toggle('cpi-hidden');
      if (!win.classList.contains('cpi-hidden') && _activeTab === 'chat') {
        document.getElementById('cpiChatInput')?.focus();
      }
    });

    closeBtn.addEventListener('click', () => {
      win.classList.add('cpi-hidden');
    });

    // Pestañas
    const tabs = root.querySelectorAll('.cpi-tab');
    tabs.forEach(t => {
      t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        _activeTab = t.getAttribute('data-tab');

        document.getElementById('cpiTabChat').style.display = _activeTab === 'chat' ? 'flex' : 'none';
        document.getElementById('cpiTabFlyer').style.display = _activeTab === 'flyer' ? 'flex' : 'none';
        document.getElementById('cpiTabAntiSpam').style.display = _activeTab === 'antispam' ? 'flex' : 'none';

        if (_activeTab === 'flyer') initFlyerTab();
      });
    });

    // Chat events
    document.getElementById('cpiChatSendBtn')?.addEventListener('click', handleChatSend);
    document.getElementById('cpiChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleChatSend();
    });

    // Anti-spam events
    document.getElementById('cpiGenAntiSpamBtn')?.addEventListener('click', handleGenAntiSpam);
  }

  /* ---------------- Tab 1: Chat Handling ---------------- */
  window.cpiQuickAsk = function (question) {
    const input = document.getElementById('cpiChatInput');
    if (input) {
      input.value = question;
      handleChatSend();
    }
  };

  async function handleChatSend() {
    const input = document.getElementById('cpiChatInput');
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';

    const msgsBox = document.getElementById('cpiChatMsgs');
    
    // Bubble usuario
    const userBubble = document.createElement('div');
    userBubble.className = 'cpi-msg user';
    userBubble.textContent = text;
    msgsBox.appendChild(userBubble);
    msgsBox.scrollTop = msgsBox.scrollHeight;

    // Bubble cargando IA
    const aiBubble = document.createElement('div');
    aiBubble.className = 'cpi-msg ai';
    aiBubble.innerHTML = '<em>Consultando catálogo y analizando…</em>';
    msgsBox.appendChild(aiBubble);
    msgsBox.scrollTop = msgsBox.scrollHeight;

    _chatHistory.push({ sender: 'Usuario', text });

    ensureGeminiClient(async () => {
      try {
        const profile = window.CURRENT_PROFILE || window.WA_ME || {};
        const reply = await window.GeminiClient.askCopilot({
          message: text,
          chatHistory: _chatHistory,
          userRole: profile.role || 'vendedor',
          userName: profile.full_name || profile.name || ''
        });

        aiBubble.textContent = reply;
        _chatHistory.push({ sender: 'Copiloto', text: reply });
      } catch (err) {
        aiBubble.innerHTML = `<span style="color:#b91c1c">⚠️ Error al consultar IA: ${err.message}</span>`;
      }
      msgsBox.scrollTop = msgsBox.scrollHeight;
    });
  }

  /* ---------------- Tab 2: Flyer Generator ---------------- */
  let _flyerDebounce = null;
  function initFlyerTab() {
    const searchInput = document.getElementById('cpiFlyerSearch');
    const resBox = document.getElementById('cpiFlyerResults');
    const sendWaBtn = document.getElementById('cpiSendWaBtn');

    // Verificar si estamos en la página de WhatsApp con un chat activo
    if (window.waActive && typeof window.waSendGeneratedImage === 'function') {
      sendWaBtn.style.display = 'block';
    } else {
      sendWaBtn.style.display = 'none';
    }

    searchInput.oninput = () => {
      clearTimeout(_flyerDebounce);
      _flyerDebounce = setTimeout(async () => {
        const q = searchInput.value.trim();
        if (q.length < 2) { resBox.style.display = 'none'; return; }
        
        ensureGeminiClient(async () => {
          const prods = await window.GeminiClient.searchProductsLive(q, 6);
          if (!prods || prods.length === 0) {
            resBox.innerHTML = '<div class="cpi-res-item" style="color:#64748b">No se encontraron productos</div>';
            resBox.style.display = 'block';
            return;
          }

          resBox.innerHTML = prods.map(p => `
            <div class="cpi-res-item" data-id="${p.id}">
              <strong>${p.name}</strong> ${p.sku ? `(${p.sku})` : ''}<br>
              <span style="color:#16604A;font-weight:600">$${p.price_usd.toFixed(2)} USD</span> · Bs ${p.price_bs.toFixed(2)}
            </div>
          `).join('');
          resBox.style.display = 'block';

          resBox.querySelectorAll('.cpi-res-item').forEach((el, idx) => {
            el.onclick = () => {
              _selectedFlyerProduct = prods[idx];
              resBox.style.display = 'none';
              searchInput.value = _selectedFlyerProduct.name;
              document.getElementById('cpiFlyerPrice').value = _selectedFlyerProduct.price_usd.toFixed(2);
              document.getElementById('cpiFlyerForm').style.display = 'block';
              renderCurrentFlyer();
            };
          });
        });
      }, 250);
    };

    document.getElementById('cpiRenderFlyerBtn').onclick = renderCurrentFlyer;
    document.getElementById('cpiCopyImgBtn').onclick = copyFlyerToClipboard;
    document.getElementById('cpiDownloadImgBtn').onclick = downloadFlyerPng;
    document.getElementById('cpiSendWaBtn').onclick = sendFlyerToWaActive;
  }

  async function renderCurrentFlyer() {
    if (!_selectedFlyerProduct) return;
    const canvas = document.getElementById('cpiCanvas');
    const customPrice = document.getElementById('cpiFlyerPrice').value;
    const note = document.getElementById('cpiFlyerNote').value;
    const profile = window.CURRENT_PROFILE || window.WA_ME || {};

    ensureGeminiClient(async () => {
      await window.GeminiClient.renderProductCard({
        product: _selectedFlyerProduct,
        customPriceUsd: customPrice,
        sellerName: profile.full_name || profile.name || '',
        sellerPhone: profile.phone || '',
        customNote: note,
        canvas
      });
    });
  }

  function downloadFlyerPng() {
    const canvas = document.getElementById('cpiCanvas');
    if (!canvas || !_selectedFlyerProduct) return;
    const a = document.createElement('a');
    a.download = `Flyer_${(_selectedFlyerProduct.name || 'Producto').replace(/\s+/g, '_')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  async function copyFlyerToClipboard() {
    const canvas = document.getElementById('cpiCanvas');
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        if (typeof showToast === 'function') showToast('¡Imagen copiada al portapapeles! Puedes pegarla en cualquier chat.');
        else alert('¡Flyer copiado al portapapeles! Pégalo con Ctrl+V.');
      });
    } catch (e) {
      alert('Tu navegador no permite copiar imágenes directamente. Usa el botón "Descargar PNG".');
    }
  }

  async function sendFlyerToWaActive() {
    const canvas = document.getElementById('cpiCanvas');
    if (!canvas || !window.waActive) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      if (typeof window.waSendGeneratedImage === 'function') {
        const caption = `🛍️ *${_selectedFlyerProduct.name}*\n💰 Precio Oficial: $${parseFloat(document.getElementById('cpiFlyerPrice').value).toFixed(2)} USD (Tasa BCV)`;
        await window.waSendGeneratedImage(blob, `flyer_${Date.now()}.png`, caption);
        document.getElementById('jjp-copilot-window').classList.add('cpi-hidden');
      }
    });
  }

  /* ---------------- Tab 3: Anti-Spam Variations ---------------- */
  async function handleGenAntiSpam() {
    const input = document.getElementById('cpiAntiSpamInput');
    const resBox = document.getElementById('cpiAntiSpamResults');
    const text = (input?.value || '').trim();
    if (!text) {
      alert('Por favor escribe el mensaje o promoción base.');
      return;
    }

    resBox.innerHTML = '<div style="color:#64748b;padding:8px">Generando 3 variaciones anti-baneo con IA…</div>';

    ensureGeminiClient(async () => {
      try {
        const vars = await window.GeminiClient.generateAntiSpamVariations(text);
        resBox.innerHTML = `
          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>⚡ Opción 1: Directa</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyText(this, \`${escapeJsStr(vars.variacion_a)}\`)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_a)}</div>
          </div>

          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>🤝 Opción 2: Cordial y Cercana</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyText(this, \`${escapeJsStr(vars.variacion_b)}\`)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_b)}</div>
          </div>

          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>💼 Opción 3: Formal Comercial</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyText(this, \`${escapeJsStr(vars.variacion_c)}\`)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_c)}</div>
          </div>
        `;
      } catch (err) {
        resBox.innerHTML = `<div style="color:#b91c1c;padding:8px">Error generando variaciones: ${err.message}</div>`;
      }
    });
  }

  window.cpiCopyText = function (btn, str) {
    navigator.clipboard.writeText(str).then(() => {
      const orig = btn.textContent;
      btn.textContent = '¡Copiado! ✓';
      setTimeout(() => btn.textContent = orig, 2000);
      
      // Si estamos en WhatsApp y hay un campo de mensaje, podemos inyectarlo
      const ci = document.getElementById('waComposerInput');
      if (ci) {
        ci.value = str;
        if (typeof waComposerButtons === 'function') waComposerButtons();
      }
    });
  };

  function escapeHtmlStr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeJsStr(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  }

  // Inicializar al cargar el DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createCopilotDOM);
  } else {
    createCopilotDOM();
  }
})();
