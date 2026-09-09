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
    const isWa = typeof location !== 'undefined' && location.pathname.includes('whatsapp');
    const fabBottom = isWa ? '155px' : '22px';
    const winBottom = isWa ? '215px' : '82px';
    const style = document.createElement('style');
    style.id = 'jjp-copilot-css';
    style.textContent = `
      #jjp-copilot-fab {
        position: fixed; right: 22px; bottom: ${fabBottom}; z-index: 9998;
        display: flex; align-items: center; gap: 8px;
        background: linear-gradient(135deg, #16604A 0%, #0d3d2f 100%);
        color: #fff; padding: 10px 16px; border-radius: 999px;
        box-shadow: 0 4px 18px rgba(22, 96, 74, 0.45);
        cursor: grab; border: 1.5px solid rgba(255,255,255,0.25);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13.5px; font-weight: 700; user-select: none;
        touch-action: none;
      }
      #jjp-copilot-fab:active {
        cursor: grabbing;
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
        position: fixed; right: 22px; bottom: ${winBottom}; z-index: 9999;
        width: 390px; max-width: calc(100vw - 32px); height: 580px; max-height: calc(100vh - ${isWa ? '195px' : '110px'});
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
      .cpi-src-tab.active {
        background: #16604A !important; color: #fff !important;
      }
      .cpi-web-thumb:hover {
        transform: scale(1.04);
        box-shadow: 0 4px 10px rgba(0,0,0,0.12);
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
          <button class="cpi-tab" data-tab="flyer">📸 Foto & Flyer IA</button>
          <button class="cpi-tab" data-tab="antispam">🛡️ Anti-Spam</button>
        </div>

        <!-- Tab 1: Chat -->
        <div class="cpi-body" id="cpiTabChat">
          <div class="cpi-chips">
            <span class="cpi-chip" onclick="cpiQuickAsk('¿A cómo está la tasa BCV hoy?')">💵 Tasa BCV hoy</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('¿Cuánto cuesta la resma de papel bond carta?')">📄 Resma papel</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('Genera una foto de marcadores Expo azul')">📸 Foto Marcadores</span>
            <span class="cpi-chip" onclick="cpiQuickAsk('Genera un flyer de resma de papel')">🎨 Diseñar Flyer</span>
            <span class="cpi-chip" onclick="cpiLaunchCampaignModal()">🚀 Editor de Campaña</span>
          </div>
          <div class="cpi-chat-msgs" id="cpiChatMsgs">
            <div class="cpi-msg ai">
              ¡Hola! Soy tu Copiloto Inteligente de JJ Paper. Puedo responder dudas sobre productos, precios en $ y Bs a tasa BCV, y generar fotografías de estudio fotorrealistas de productos o flyers publicitarios. ¿Qué producto deseas consultar o fotografiar?
            </div>
          </div>
          <div class="cpi-chat-input-bar">
            <input type="text" class="cpi-chat-input" id="cpiChatInput" placeholder="Pregunta sobre productos, fotos o precios…">
            <button class="cpi-chat-send" id="cpiChatSendBtn">➤</button>
          </div>
        </div>

        <!-- Tab 2: Foto de Estudio & Flyer Generator -->
        <div class="cpi-body" id="cpiTabFlyer" style="display:none">
          <div class="cpi-flyer-panel">
            <div class="cpi-search-box">
              <label class="cpi-input-lbl">Selecciona un producto del catálogo:</label>
              <input type="text" class="cpi-chat-input" id="cpiFlyerSearch" placeholder="Buscar por nombre, marca o especificación…" autocomplete="off" style="width:100%">
              <div class="cpi-results-dropdown" id="cpiFlyerResults" style="display:none"></div>
            </div>

            <div id="cpiFlyerForm" style="display:none">
              <!-- Ficha de Detalles Comerciales Reales del Producto -->
              <div id="cpiFlyerSpecsCard" style="display:none;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:12px;color:#334155;line-height:1.5;margin-bottom:10px"></div>

              <!-- Switcher de Modo: Foto de Estudio Real vs Flyer Publicitario -->
              <div style="display:flex;gap:6px;background:#e2e8f0;padding:4px;border-radius:10px;margin-bottom:10px">
                <button type="button" id="cpiBtnModePhoto" class="cpi-mode-toggle active" style="flex:1;padding:7px;border-radius:8px;border:0;font-size:12px;font-weight:700;cursor:pointer;background:#16604A;color:#fff;transition:all 0.2s">📸 Foto Real de Estudio</button>
                <button type="button" id="cpiBtnModeFlyer" class="cpi-mode-toggle" style="flex:1;padding:7px;border-radius:8px;border:0;font-size:12px;font-weight:700;cursor:pointer;background:transparent;color:#475569;transition:all 0.2s">🎨 Flyer Comercial JJ</button>
              </div>

              <!-- Selector de Estilo de Fondo / Escenario -->
              <div style="margin-bottom:10px">
                <label class="cpi-input-lbl">Estilo de Fondo / Escenario:</label>
                <div style="display:flex;gap:8px;margin-top:3px">
                  <label style="flex:1;display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #cbd5e1;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:#1e293b">
                    <input type="radio" name="cpiFlyerTheme" value="white" checked> ⚪ Blanco Estudio
                  </label>
                  <label style="flex:1;display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #cbd5e1;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:#16604A">
                    <input type="radio" name="cpiFlyerTheme" value="emerald"> 🟢 Verde Esmeralda
                  </label>
                </div>
              </div>

              <!-- Sub-panel MODO 1: FOTOGRAFÍA REAL / ESTUDIO -->
              <div id="cpiPanelPhoto" style="display:block">
                <!-- Selector de Pestaña de Fuente -->
                <div style="display:flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:8px;margin-bottom:8px">
                  <button type="button" id="cpiSrcTabWeb" class="cpi-src-tab active" style="flex:1;padding:6px 4px;border-radius:6px;border:0;font-size:11px;font-weight:700;cursor:pointer;background:#16604A;color:#fff;transition:all 0.15s">🌐 Fotos Web Reales</button>
                  <button type="button" id="cpiSrcTabAi" class="cpi-src-tab" style="flex:1;padding:6px 4px;border-radius:6px;border:0;font-size:11px;font-weight:700;cursor:pointer;background:transparent;color:#475569;transition:all 0.15s">🤖 Generar con IA</button>
                  <button type="button" id="cpiSrcTabCustom" class="cpi-src-tab" style="flex:1;padding:6px 4px;border-radius:6px;border:0;font-size:11px;font-weight:700;cursor:pointer;background:transparent;color:#475569;transition:all 0.15s">📁 Subir / Enlace</button>
                </div>

                <!-- Fuente 1: Fotos Web Reales -->
                <div id="cpiSrcPanelWeb" style="display:block;margin-bottom:8px">
                  <div style="display:flex;gap:6px;margin-bottom:6px">
                    <input type="text" id="cpiWebQueryInput" class="cpi-chat-input" placeholder="Buscar fotos en internet…" style="flex:1;font-size:12px;padding:6px 8px">
                    <button type="button" id="cpiWebSearchBtn" class="cpi-chat-send" style="padding:0 10px;font-size:12px">🔍 Buscar</button>
                  </div>
                  <div id="cpiWebGrid" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;max-height:160px;overflow-y:auto;padding:2px">
                    <div style="grid-column:1/-1;text-align:center;padding:12px;color:#64748b;font-size:12px">Selecciona un producto para ver fotos reales en la web</div>
                  </div>
                </div>

                <!-- Fuente 2: Generación con IA (Flux Packshot) -->
                <div id="cpiSrcPanelAi" style="display:none;margin-bottom:8px">
                  <div style="font-size:11.5px;color:#475569;margin-bottom:6px;line-height:1.4">
                    ✨ Genera con IA una toma comercial de producto aislada sobre <strong>fondo blanco puro (#FFFFFF)</strong> sin elementos arquitectónicos.
                  </div>
                  <button type="button" id="cpiRegenPhotoBtn" class="cpi-chat-send" style="width:100%;padding:8px;font-size:12px">✨ Generar Fotografía con IA (Packshot)</button>
                </div>

                <!-- Fuente 3: Subir / Enlace Propio -->
                <div id="cpiSrcPanelCustom" style="display:none;margin-bottom:8px">
                  <label class="cpi-input-lbl">Pegar URL directa de foto (Google / MercadoLibre):</label>
                  <div style="display:flex;gap:6px;margin-bottom:6px">
                    <input type="url" id="cpiCustomUrlInput" class="cpi-chat-input" placeholder="https://..." style="flex:1;font-size:12px;padding:6px 8px">
                    <button type="button" id="cpiCustomUrlLoadBtn" class="cpi-chat-send" style="padding:0 10px;font-size:12px">Cargar</button>
                  </div>
                  <label class="cpi-input-lbl">O subir foto desde tu PC / Teléfono:</label>
                  <input type="file" id="cpiFileInput" accept="image/*" style="font-size:11.5px;width:100%">
                </div>

                <!-- Visor de Fotografía Seleccionada Activa -->
                <div style="position:relative;width:100%;aspect-ratio:1/1;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;background:#ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)">
                  <div id="cpiPhotoLoading" style="position:absolute;inset:0;background:rgba(255,255,255,0.92);display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;z-index:2;font-size:12.5px;color:#16604A;font-weight:600">
                    <span class="cpi-pulse" style="width:16px;height:16px"></span>
                    <span id="cpiPhotoLoadingText">Cargando fotografía…</span>
                  </div>
                  <img id="cpiPhotoImg" src="" alt="Fotografía comercial" style="width:100%;height:100%;object-fit:contain;display:block">
                </div>

                <!-- Acciones de la Fotografía -->
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                  <button class="cpi-chip" id="cpiSaveToCatalogBtn" style="flex:100%;text-align:center;padding:9px;background:#16604A;color:#fff;font-weight:700;box-shadow:0 2px 8px rgba(22,96,74,0.3)">💾 Guardar como Foto Oficial en Catálogo</button>
                  <button class="cpi-chip" id="cpiToFlyerBtn" style="flex:100%;text-align:center;padding:9px;background:#0369a1;color:#fff;font-weight:700">🎨 Convertir en Flyer Publicitario JJ Paper</button>
                  <button class="cpi-chip" id="cpiCopyPhotoBtn" style="flex:1;text-align:center;padding:7px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd">📋 Copiar Foto</button>
                  <button class="cpi-chip" id="cpiDownloadPhotoBtn" style="flex:1;text-align:center;padding:7px;background:#f0fdf4;color:#15803d;border-color:#bbf7d0">⬇️ Descargar Foto HD</button>
                  <button class="cpi-chip" id="cpiSendWaPhotoBtn" style="flex:100%;text-align:center;padding:8px;background:#16604A;color:#fff;display:none">💬 Enviar Foto a WhatsApp</button>
                </div>
              </div>

              <!-- Sub-panel MODO 2: FLYER PUBLICITARIO -->
              <div id="cpiPanelFlyer" style="display:none">
                <!-- Selector de Titular / Badge Publicitario -->
                <div style="margin-bottom:8px">
                  <label class="cpi-input-lbl">Titular Publicitario:</label>
                  <select id="cpiFlyerHeadline" class="cpi-chat-input" style="width:100%;font-weight:600">
                    <option value="🔥 OFERTA AL MAYOR" selected>🔥 OFERTA AL MAYOR</option>
                    <option value="⭐ PRODUCTO DESTACADO">⭐ PRODUCTO DESTACADO</option>
                    <option value="📦 LLEGANDO DE FÁBRICA">📦 LLEGANDO DE FÁBRICA</option>
                    <option value="⚡ DISPONIBILIDAD INMEDIATA">⚡ DISPONIBILIDAD INMEDIATA</option>
                    <option value="🛡️ CALIDAD GARANTIZADA">🛡️ CALIDAD GARANTIZADA</option>
                  </select>
                </div>

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
                <button class="cpi-chat-send" id="cpiRenderFlyerBtn" style="width:100%;margin-top:8px;padding:8px">🖼️ Actualizar Flyer</button>

                <canvas id="cpiCanvas" class="cpi-canvas-preview" width="1200" height="1200"></canvas>

                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                  <button class="cpi-chip" id="cpiCopyImgBtn" style="flex:1;text-align:center;padding:7px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd">📋 Copiar Flyer</button>
                  <button class="cpi-chip" id="cpiDownloadImgBtn" style="flex:1;text-align:center;padding:7px;background:#f0fdf4;color:#15803d;border-color:#bbf7d0">⬇️ Descargar PNG</button>
                  <button class="cpi-chip" id="cpiSendWaBtn" style="flex:100%;text-align:center;padding:8px;background:#16604A;color:#fff;display:none">💬 Enviar Flyer a este Chat de WhatsApp</button>
                  <button class="cpi-chip" id="cpiCampaignFlyerBtn" style="flex:100%;text-align:center;padding:8px;background:#0369a1;color:#fff;">📢 Usar este Producto en Difusión / Campaña</button>
                </div>
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

    makeDraggable(fab);

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

  /* ---------------- Arrastre Libre del Botón Flotante ---------------- */
  function makeDraggable(fabEl) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let hasMoved = false;

    try {
      const saved = localStorage.getItem('jjp_copilot_fab_pos');
      if (saved) {
        const pos = JSON.parse(saved);
        if (typeof pos.top === 'number' && typeof pos.left === 'number') {
          const maxLeft = Math.max(10, window.innerWidth - 160);
          const maxTop = Math.max(10, window.innerHeight - 60);
          const curLeft = Math.min(Math.max(10, pos.left), maxLeft);
          const curTop = Math.min(Math.max(10, pos.top), maxTop);
          fabEl.style.left = curLeft + 'px';
          fabEl.style.top = curTop + 'px';
          fabEl.style.right = 'auto';
          fabEl.style.bottom = 'auto';
        }
      }
    } catch (_) {}

    function onStart(e) {
      if (e.button !== undefined && e.button !== 0) return;
      isDragging = true;
      hasMoved = false;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;
      const rect = fabEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      window.addEventListener('mousemove', onMove, { passive: false });
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
    }

    function onMove(e) {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasMoved = true;
        if (e.cancelable) e.preventDefault();
        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;
        const maxLeft = Math.max(10, window.innerWidth - fabEl.offsetWidth - 10);
        const maxTop = Math.max(10, window.innerHeight - fabEl.offsetHeight - 10);
        newLeft = Math.min(Math.max(10, newLeft), maxLeft);
        newTop = Math.min(Math.max(10, newTop), maxTop);

        fabEl.style.left = newLeft + 'px';
        fabEl.style.top = newTop + 'px';
        fabEl.style.right = 'auto';
        fabEl.style.bottom = 'auto';
      }
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);

      if (hasMoved) {
        try {
          const rect = fabEl.getBoundingClientRect();
          localStorage.setItem('jjp_copilot_fab_pos', JSON.stringify({ left: rect.left, top: rect.top }));
        } catch (_) {}
      }
    }

    fabEl.addEventListener('mousedown', onStart);
    fabEl.addEventListener('touchstart', onStart, { passive: true });

    fabEl.addEventListener('click', (e) => {
      if (hasMoved) {
        e.stopImmediatePropagation();
        e.preventDefault();
        hasMoved = false;
      }
    }, true);
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

    const isFlyerRequest = /(imagen|flyer|foto|tarjeta|diseñ|afiche|volante|publicidad|crear imagen|generar imagen)/i.test(text);

    ensureGeminiClient(async () => {
      try {
        let matchedProduct = null;
        if (isFlyerRequest) {
          aiBubble.innerHTML = '<em>Buscando producto en catálogo para diseñar flyer…</em>';
          const queryClean = text.replace(/^(genera|crea|diseña|haz|dame|muestra|envia|quiero|necesito)?\s*(una|un|el|la)?\s*(imagen|flyer|foto|tarjeta|diseño|afiche|volante|publicidad)\s*(de|del|para)?\s*/i, '').trim();
          const q = queryClean.length >= 2 ? queryClean : text;
          const prods = await window.GeminiClient.searchProductsLive(q, 3);
          if (prods && prods.length > 0) {
            matchedProduct = prods[0];
          }
        }

        const profile = window.CURRENT_PROFILE || window.WA_ME || {};
        const reply = await window.GeminiClient.askCopilot({
          message: text,
          chatHistory: _chatHistory,
          userRole: profile.role || 'vendedor',
          userName: profile.full_name || profile.name || ''
        });

        _chatHistory.push({ sender: 'Copiloto', text: reply });

        if (matchedProduct) {
          const isWhiteBg = /(fondo blanco|blanco|estudio blanco)/i.test(text);
          const theme = isWhiteBg ? 'white' : 'emerald';

          if (typeof window.GeminiClient.enrichProductForMarketing === 'function') {
            const en = await window.GeminiClient.enrichProductForMarketing(matchedProduct);
            if (en) {
              matchedProduct.brand = en.brand;
              matchedProduct.measures = en.measures;
              matchedProduct.color = en.color;
              matchedProduct.presentation = en.presentation;
            }
          }

          aiBubble.innerHTML = '<em>Buscando foto real del producto...</em>';
          let mainPhotoUrl = matchedProduct.image_url || '';
          let isRealPhoto = !!mainPhotoUrl;

          if (!mainPhotoUrl && typeof window.GeminiClient.searchRealProductPhoto === 'function') {
            mainPhotoUrl = await window.GeminiClient.searchRealProductPhoto(matchedProduct.name);
            if (mainPhotoUrl) {
              isRealPhoto = true;
              matchedProduct.image_url = mainPhotoUrl;
            }
          }

          const wantsPurePhoto = /(foto|fotografia|imagen real|foto real|imagen del|foto del)/i.test(text) && !/(flyer|afiche|volante|publicidad|tarjeta)/i.test(text);

          if (wantsPurePhoto) {
            if (!mainPhotoUrl) {
              aiBubble.innerHTML = '<em>Generando fotografía de estudio con IA...</em>';
              const photoRes = await window.GeminiClient.generateProductStudioPhoto({ product: matchedProduct, theme });
              mainPhotoUrl = photoRes.imageUrl;
              matchedProduct._studio_photo_url = mainPhotoUrl;
            }

            aiBubble.innerHTML = `
              <div>${escapeHtmlStr(reply)}</div>
              <div style="margin-top:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                <div style="font-weight:700;color:#16604A;margin-bottom:4px;font-size:12.5px">
                  ${isRealPhoto ? '✅ Encontré la foto real del producto' : '🤖 Fotografía Generada con IA'}: ${escapeHtmlStr(matchedProduct.name)}
                </div>
                <div style="font-size:11.5px;color:#475569;margin-bottom:8px">🏷️ <strong>Marca:</strong> ${escapeHtmlStr(matchedProduct.brand || 'JJ Paper')} · 📦 ${escapeHtmlStr(matchedProduct.presentation || matchedProduct.unit || 'Comercial')} ${matchedProduct.measures && matchedProduct.measures !== 'Medida estándar' ? `· 📏 ${escapeHtmlStr(matchedProduct.measures)}` : ''} ${matchedProduct.color ? `· 🎨 ${escapeHtmlStr(matchedProduct.color)}` : ''}</div>
                <img src="${mainPhotoUrl}" alt="${escapeHtmlStr(matchedProduct.name)}" style="width:100%;height:auto;aspect-ratio:1/1;object-fit:contain;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,0.08);background:#fff" />
                <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd" onclick="cpiCopyPhotoDirect('${mainPhotoUrl}', this)">📋 Copiar Foto</button>
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#f0fdf4;color:#15803d;border-color:#bbf7d0" onclick="cpiDownloadPhotoDirect('${mainPhotoUrl}', '${escapeJsStr(matchedProduct.name)}')">⬇️ Descargar HD</button>
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#fef3c7;color:#92400e;border-color:#fde68a" onclick="cpiCustomizeProductFlyer('${escapeJsStr(matchedProduct.id || matchedProduct.name)}')">🎨 Ver en Estudio / Flyer</button>
                </div>
              </div>
            `;
          } else {
            const canvasId = 'cpiInlineCanvas_' + Date.now();
            let previewMsg = isRealPhoto ? '✅ Encontré la foto real del producto. Creando flyer publicitario...' : 'No encontré foto real. Ofreciendo flyer con imagen generada por IA...';
            
            aiBubble.innerHTML = `
              <div>${escapeHtmlStr(reply)}</div>
              <div style="margin-top:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                <div style="font-size:11.5px;color:#16604A;font-weight:600;margin-bottom:6px">${previewMsg}</div>
                <div style="font-weight:700;color:#16604A;margin-bottom:6px;font-size:12.5px">🎨 Flyer Promocional: ${escapeHtmlStr(matchedProduct.name)}</div>
                <canvas id="${canvasId}" class="cpi-canvas-preview" width="800" height="800" style="width:100%;height:auto;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,0.08)"></canvas>
                <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd" onclick="cpiCopyInlineFlyer(this)">📋 Copiar Flyer</button>
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#f0fdf4;color:#15803d;border-color:#bbf7d0" onclick="cpiDownloadInlineFlyer(this, '${escapeJsStr(matchedProduct.name)}')">⬇️ Descargar</button>
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#fef3c7;color:#92400e;border-color:#fde68a" onclick="cpiCustomizeProductFlyer('${escapeJsStr(matchedProduct.id || matchedProduct.name)}')">✏️ Personalizar</button>
                  <button class="cpi-chip" style="font-size:11px;padding:5px 8px;background:#16604A;color:#fff;border-color:#16604A" onclick="cpiLaunchProductCampaign('${escapeJsStr(matchedProduct.id || '')}')">📢 Lanzar Campaña</button>
                </div>
              </div>
            `;
            const cvs = document.getElementById(canvasId);
            if (cvs) {
              await window.GeminiClient.renderProductCard({
                product: matchedProduct,
                customPriceUsd: matchedProduct.price_usd,
                sellerName: profile.full_name || profile.name || '',
                sellerPhone: profile.phone || '',
                theme,
                canvas: cvs
              });
            }
          }
        } else {
          aiBubble.textContent = reply;
        }
      } catch (err) {
        aiBubble.innerHTML = `<span style="color:#b91c1c">⚠️ Error al consultar IA: ${err.message}</span>`;
      }
      msgsBox.scrollTop = msgsBox.scrollHeight;
    });
  }

  /* ---------------- Tab 2: Studio Photo & Flyer Generator ---------------- */
  let _flyerDebounce = null;
  let _flyerMode = 'photo'; // 'photo' | 'flyer'

  function initFlyerTab() {
    const searchInput = document.getElementById('cpiFlyerSearch');
    const resBox = document.getElementById('cpiFlyerResults');
    const sendWaBtn = document.getElementById('cpiSendWaBtn');
    const sendWaPhotoBtn = document.getElementById('cpiSendWaPhotoBtn');

    // Verificar si estamos en la página de WhatsApp con un chat activo
    const hasWa = !!(window.waActive && typeof window.waSendGeneratedImage === 'function');
    if (sendWaBtn) sendWaBtn.style.display = hasWa ? 'block' : 'none';
    if (sendWaPhotoBtn) sendWaPhotoBtn.style.display = hasWa ? 'block' : 'none';

    // Toggles de modo Foto vs Flyer
    const btnModePhoto = document.getElementById('cpiBtnModePhoto');
    const btnModeFlyer = document.getElementById('cpiBtnModeFlyer');
    const panelPhoto = document.getElementById('cpiPanelPhoto');
    const panelFlyer = document.getElementById('cpiPanelFlyer');

    if (btnModePhoto && btnModeFlyer) {
      btnModePhoto.onclick = () => {
        _flyerMode = 'photo';
        btnModePhoto.style.background = '#16604A';
        btnModePhoto.style.color = '#fff';
        btnModeFlyer.style.background = 'transparent';
        btnModeFlyer.style.color = '#475569';
        if (panelPhoto) panelPhoto.style.display = 'block';
        if (panelFlyer) panelFlyer.style.display = 'none';
        if (_selectedFlyerProduct) loadCurrentStudioPhoto();
      };

      btnModeFlyer.onclick = () => {
        _flyerMode = 'flyer';
        btnModeFlyer.style.background = '#16604A';
        btnModeFlyer.style.color = '#fff';
        btnModePhoto.style.background = 'transparent';
        btnModePhoto.style.color = '#475569';
        if (panelFlyer) panelFlyer.style.display = 'block';
        if (panelPhoto) panelPhoto.style.display = 'none';
        if (_selectedFlyerProduct) renderCurrentFlyer();
      };
    }

    const toFlyerBtn = document.getElementById('cpiToFlyerBtn');
    if (toFlyerBtn) {
      toFlyerBtn.onclick = () => {
        if (btnModeFlyer) btnModeFlyer.click();
      };
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
              <span style="color:#16604A;font-weight:600">$${Number(p.price_usd || 0).toFixed(2)} USD</span> · Bs ${Number(p.price_bs || 0).toFixed(2)}
            </div>
          `).join('');
          resBox.style.display = 'block';

          resBox.querySelectorAll('.cpi-res-item').forEach((el, idx) => {
            el.onclick = async () => {
              _selectedFlyerProduct = prods[idx];
              resBox.style.display = 'none';
              searchInput.value = _selectedFlyerProduct.name;
              document.getElementById('cpiFlyerPrice').value = Number(_selectedFlyerProduct.price_usd || 0).toFixed(2);

              // Extraer y enriquecer especificaciones comerciales
              if (typeof window.GeminiClient.enrichProductForMarketing === 'function') {
                const enriched = await window.GeminiClient.enrichProductForMarketing(_selectedFlyerProduct);
                if (enriched) {
                  _selectedFlyerProduct.brand = enriched.brand;
                  _selectedFlyerProduct.measures = enriched.measures;
                  _selectedFlyerProduct.color = enriched.color;
                  _selectedFlyerProduct.presentation = enriched.presentation;

                  const specsEl = document.getElementById('cpiFlyerSpecsCard');
                  if (specsEl) {
                    specsEl.style.display = 'block';
                    let specsHtml = `<div style="font-weight:700;color:#16604A;margin-bottom:4px;font-size:12.5px">📋 Ficha Comercial del Producto:</div>`;
                    specsHtml += `🏷️ <strong>Marca:</strong> ${enriched.brand}   ·   📦 <strong>Presentación:</strong> ${enriched.presentation}`;
                    if (enriched.measures && enriched.measures !== 'Medida estándar' && enriched.measures !== 'MEDIDA ESTÁNDAR') {
                      specsHtml += `<br>📏 <strong>Medidas:</strong> ${enriched.measures}`;
                    }
                    if (enriched.color) {
                      specsHtml += `   ·   🎨 <strong>Color:</strong> ${enriched.color}`;
                    }
                    specsEl.innerHTML = specsHtml;
                  }
                }
              }

              document.getElementById('cpiFlyerForm').style.display = 'block';
              const webQueryInput = document.getElementById('cpiWebQueryInput');
              if (webQueryInput) webQueryInput.value = _selectedFlyerProduct.name;

              if (_selectedFlyerProduct.image_url) {
                selectActivePhoto(_selectedFlyerProduct.image_url);
              }
              searchWebPhotos(_selectedFlyerProduct.name);

              if (_flyerMode === 'flyer') {
                renderCurrentFlyer();
              }
            };
          });
        });
      }, 250);
    };

    // Listeners para cambio de tema y titular publicitario en tiempo real
    document.querySelectorAll('input[name="cpiFlyerTheme"]').forEach(r => {
      r.onchange = () => {
        if (_flyerMode === 'photo') {
          const aiActive = document.getElementById('cpiSrcTabAi')?.classList.contains('active');
          if (aiActive) loadCurrentStudioPhoto();
        } else {
          renderCurrentFlyer();
        }
      };
    });

    const hlSelect = document.getElementById('cpiFlyerHeadline');
    if (hlSelect) hlSelect.onchange = renderCurrentFlyer;

    document.getElementById('cpiRenderFlyerBtn').onclick = renderCurrentFlyer;
    document.getElementById('cpiCopyImgBtn').onclick = copyFlyerToClipboard;
    document.getElementById('cpiDownloadImgBtn').onclick = downloadFlyerPng;
    if (sendWaBtn) sendWaBtn.onclick = sendFlyerToWaActive;
    document.getElementById('cpiCampaignFlyerBtn').onclick = launchProductCampaignFromFlyer;

    // Tabs de Fuente de Foto (Web, IA, Subir/Enlace)
    const srcTabWeb = document.getElementById('cpiSrcTabWeb');
    const srcTabAi = document.getElementById('cpiSrcTabAi');
    const srcTabCustom = document.getElementById('cpiSrcTabCustom');
    const panelSrcWeb = document.getElementById('cpiSrcPanelWeb');
    const panelSrcAi = document.getElementById('cpiSrcPanelAi');
    const panelSrcCustom = document.getElementById('cpiSrcPanelCustom');

    if (srcTabWeb && srcTabAi && srcTabCustom) {
      const setSrcTab = (tab) => {
        [srcTabWeb, srcTabAi, srcTabCustom].forEach(t => {
          t.style.background = 'transparent';
          t.style.color = '#475569';
          t.classList.remove('active');
        });
        [panelSrcWeb, panelSrcAi, panelSrcCustom].forEach(p => { if (p) p.style.display = 'none'; });

        if (tab === 'web') {
          srcTabWeb.style.background = '#16604A';
          srcTabWeb.style.color = '#fff';
          srcTabWeb.classList.add('active');
          if (panelSrcWeb) panelSrcWeb.style.display = 'block';
        } else if (tab === 'ai') {
          srcTabAi.style.background = '#16604A';
          srcTabAi.style.color = '#fff';
          srcTabAi.classList.add('active');
          if (panelSrcAi) panelSrcAi.style.display = 'block';
        } else if (tab === 'custom') {
          srcTabCustom.style.background = '#16604A';
          srcTabCustom.style.color = '#fff';
          srcTabCustom.classList.add('active');
          if (panelSrcCustom) panelSrcCustom.style.display = 'block';
        }
      };

      srcTabWeb.onclick = () => setSrcTab('web');
      srcTabAi.onclick = () => {
        setSrcTab('ai');
        if (!_selectedFlyerProduct?._studio_photo_url || !_selectedFlyerProduct._studio_photo_url.includes('pollinations')) {
          loadCurrentStudioPhoto();
        }
      };
      srcTabCustom.onclick = () => setSrcTab('custom');
    }

    // Buscador de Fotos en la Web
    const webQueryInput = document.getElementById('cpiWebQueryInput');
    const webSearchBtn = document.getElementById('cpiWebSearchBtn');
    if (webSearchBtn) {
      webSearchBtn.onclick = () => {
        const q = webQueryInput?.value.trim() || _selectedFlyerProduct?.name || '';
        if (q) searchWebPhotos(q);
      };
    }
    if (webQueryInput) {
      webQueryInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const q = webQueryInput.value.trim();
          if (q) searchWebPhotos(q);
        }
      };
    }

    // Carga de URL directa
    const customUrlInput = document.getElementById('cpiCustomUrlInput');
    const customUrlLoadBtn = document.getElementById('cpiCustomUrlLoadBtn');
    if (customUrlLoadBtn && customUrlInput) {
      customUrlLoadBtn.onclick = () => {
        const url = customUrlInput.value.trim();
        if (url) {
          selectActivePhoto(url);
          if (typeof showToast === 'function') showToast('Imagen cargada');
        }
      };
    }

    // Subida de Archivo desde PC / Teléfono
    const fileInput = document.getElementById('cpiFileInput');
    if (fileInput) {
      fileInput.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataUrl = evt.target.result;
          selectActivePhoto(dataUrl);
        };
        reader.readAsDataURL(file);
      };
    }

    // Guardar como foto oficial en catálogo
    const saveToCatalogBtn = document.getElementById('cpiSaveToCatalogBtn');
    if (saveToCatalogBtn) {
      saveToCatalogBtn.onclick = () => saveActivePhotoToCatalog(saveToCatalogBtn);
    }

    // Listeners para Foto de Estudio
    const copyPhotoBtn = document.getElementById('cpiCopyPhotoBtn');
    if (copyPhotoBtn) copyPhotoBtn.onclick = copyPhotoToClipboard;
    const dlPhotoBtn = document.getElementById('cpiDownloadPhotoBtn');
    if (dlPhotoBtn) dlPhotoBtn.onclick = downloadPhoto;
    const regenPhotoBtn = document.getElementById('cpiRegenPhotoBtn');
    if (regenPhotoBtn) regenPhotoBtn.onclick = () => loadCurrentStudioPhoto(true);
    if (sendWaPhotoBtn) sendWaPhotoBtn.onclick = sendPhotoToWaActive;
  }

  function selectActivePhoto(url) {
    if (!url || !_selectedFlyerProduct) return;
    _selectedFlyerProduct._studio_photo_url = url;
    const imgEl = document.getElementById('cpiPhotoImg');
    const loading = document.getElementById('cpiPhotoLoading');
    if (loading) loading.style.display = 'none';
    if (imgEl) {
      imgEl.src = url;
    }
  }

  async function searchWebPhotos(query) {
    const grid = document.getElementById('cpiWebGrid');
    const loading = document.getElementById('cpiPhotoLoading');
    const loadingText = document.getElementById('cpiPhotoLoadingText');
    if (!grid) return;

    if (loading) {
      loading.style.display = 'flex';
      if (loadingText) loadingText.textContent = '🧠 IA analizando producto… Buscando en Google, Bing y DuckDuckGo…';
    }
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:12px;color:#64748b;font-size:12px">🔍 Buscando fotos reales con IA inteligente…</div>';

    const serverUrl = (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && /^(192\.168\.|10\.|172\.)/.test(location.hostname))
      ? `${location.protocol}//${location.hostname}:8787`
      : 'http://localhost:8787';

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${serverUrl}/lan/products/search-images?q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      });
      clearTimeout(t);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const results = data.results || [];

      if (loading) loading.style.display = 'none';

      if (results.length === 0) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:12px;color:#64748b;font-size:12px;line-height:1.5">
            🔍 No se encontraron fotos exactas.<br>
            <span style="font-size:11px;color:#94a3b8">Prueba editando la búsqueda arriba con solo la marca y el tipo de producto (ej: "Sharpie marcador negro"), o genera con IA, o pega una URL directa.</span>
          </div>
        `;
        return;
      }

      grid.innerHTML = results.map((r, idx) => {
        const isTrusted = r.score >= 50;
        const badge = isTrusted ? '<span style="position:absolute;bottom:2px;left:2px;background:#f59e0b;color:#fff;font-size:8px;padding:1px 3px;border-radius:3px;font-weight:700">⭐</span>' : '';
        return `
        <div class="cpi-web-thumb ${idx === 0 ? 'selected' : ''}" data-url="${escapeHtmlStr(r.image)}" title="${escapeHtmlStr(r.title || r.source || 'Foto')}" style="position:relative;border-radius:8px;border:2px solid ${idx === 0 ? '#16604A' : '#e2e8f0'};overflow:hidden;background:#fff;aspect-ratio:1/1;cursor:pointer;transition:transform 0.15s, border-color 0.15s">
          <img src="${escapeHtmlStr(r.thumbnail || r.image)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block" loading="lazy" onerror="this.parentElement.style.display='none'">
          ${idx === 0 ? '<span style="position:absolute;top:2px;right:2px;background:#16604A;color:#fff;font-size:9px;padding:2px 4px;border-radius:4px;font-weight:700">✓ Activa</span>' : ''}
          ${badge}
        </div>
      `;
      }).join('');

      // Auto-seleccionar la primera imagen si no hay una ya fijada
      if (results[0] && !_selectedFlyerProduct._studio_photo_url) {
        selectActivePhoto(results[0].image);
      }

      grid.querySelectorAll('.cpi-web-thumb').forEach(el => {
        el.onclick = () => {
          grid.querySelectorAll('.cpi-web-thumb').forEach(x => {
            x.style.borderColor = '#e2e8f0';
            const b = x.querySelector('span');
            if (b) b.remove();
          });
          el.style.borderColor = '#16604A';
          el.insertAdjacentHTML('beforeend', '<span style="position:absolute;top:2px;right:2px;background:#16604A;color:#fff;font-size:9px;padding:2px 4px;border-radius:4px;font-weight:700">✓ Activa</span>');
          const url = el.getAttribute('data-url');
          if (url) selectActivePhoto(url);
        };
      });

    } catch (e) {
      if (loading) loading.style.display = 'none';
      grid.innerHTML = `
        <div style="grid-column:1/-1;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px;font-size:11.5px;color:#92400e;line-height:1.4">
          ℹ️ <strong>Búsqueda directa web:</strong> Servidor local ocupado o desconectado.<br>
          Puedes <strong>pegar el enlace</strong> de la foto en la pestaña <em>"📁 Subir / Enlace"</em> o generar una versión con IA.
        </div>
      `;
    }
  }

  async function saveActivePhotoToCatalog(btn) {
    if (!_selectedFlyerProduct) return alert('Selecciona un producto primero');
    const imgEl = document.getElementById('cpiPhotoImg');
    const currentSrc = imgEl?.src || _selectedFlyerProduct._studio_photo_url || _selectedFlyerProduct.image_url;
    if (!currentSrc) return alert('No hay ninguna foto seleccionada para guardar');

    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Guardando en catálogo…';
    }

    try {
      const serverUrl = (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && /^(192\.168\.|10\.|172\.)/.test(location.hostname))
        ? `${location.protocol}//${location.hostname}:8787`
        : 'http://localhost:8787';

      let savedUrl = null;

      // 1. Intentar vía wa-server local (bypasses CORS y descarga directa a Storage)
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(`${serverUrl}/lan/products/save-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: _selectedFlyerProduct.id,
            image_url: currentSrc
          }),
          signal: controller.signal
        });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.publicUrl) {
            savedUrl = data.publicUrl;
          }
        }
      } catch (_) {}

      // 2. Fallback: Guardar directamente en Supabase desde el navegador (Proyecto C Storage + Proyecto A Database)
      if (!savedUrl && window.sb) {
        let blob = null;
        if (currentSrc.startsWith('data:')) {
          const res = await fetch(currentSrc);
          blob = await res.blob();
        } else {
          try {
            const res = await fetch(currentSrc, { mode: 'cors' });
            if (res.ok) blob = await res.blob();
          } catch (_) {}
        }

        if (blob) {
          const ext = blob.type.includes('webp') ? 'webp' : (blob.type.includes('png') ? 'png' : 'jpg');
          const filePath = `${_selectedFlyerProduct.id}.${ext}`;
          const { error: upErr } = await window.sb.storage.from('jjp-products').upload(filePath, blob, { upsert: true });
          if (!upErr) {
            const { data: { publicUrl } } = window.sb.storage.from('jjp-products').getPublicUrl(filePath);
            await window.sb.from('jjp_products').update({ image_url: publicUrl }).eq('id', _selectedFlyerProduct.id);
            savedUrl = publicUrl;
          }
        }
      }

      if (savedUrl) {
        _selectedFlyerProduct.image_url = savedUrl;
        _selectedFlyerProduct._studio_photo_url = savedUrl;
        if (btn) {
          btn.textContent = '¡Foto Oficial Guardada! ✓';
          btn.style.background = '#15803d';
          setTimeout(() => {
            btn.textContent = '💾 Guardar como Foto Oficial en Catálogo';
            btn.style.background = '#16604A';
            btn.disabled = false;
          }, 3000);
        }
        if (typeof showToast === 'function') showToast('¡Foto guardada y vinculada en el catálogo con éxito!');
        else alert('¡Foto guardada y vinculada en el catálogo con éxito!');
      } else {
        throw new Error('No se pudo guardar la imagen. Si es un enlace externo, puedes guardar la foto a tu PC y subirla con el botón "Subir foto".');
      }
    } catch (err) {
      alert('Error guardando en catálogo: ' + err.message);
      if (btn) {
        btn.textContent = origText || '💾 Guardar como Foto Oficial en Catálogo';
        btn.disabled = false;
      }
    }
  }

  async function loadCurrentStudioPhoto(forceNew = false) {
    if (!_selectedFlyerProduct) return;
    const imgEl = document.getElementById('cpiPhotoImg');
    const loadingEl = document.getElementById('cpiPhotoLoading');
    const theme = document.querySelector('input[name="cpiFlyerTheme"]:checked')?.value || 'white';

    if (loadingEl) loadingEl.style.display = 'flex';

    ensureGeminiClient(async () => {
      try {
        const photoRes = await window.GeminiClient.generateProductStudioPhoto({
          product: _selectedFlyerProduct,
          theme,
          forceNew
        });

        if (photoRes?.imageUrl) {
          _selectedFlyerProduct._studio_photo_url = photoRes.imageUrl;
          if (imgEl) {
            imgEl.onload = () => {
              if (loadingEl) loadingEl.style.display = 'none';
            };
            imgEl.onerror = () => {
              if (loadingEl) loadingEl.style.display = 'none';
            };
            imgEl.src = photoRes.imageUrl;
          }
        }
      } catch (err) {
        console.error('Error generando foto de estudio:', err);
        if (loadingEl) loadingEl.style.display = 'none';
      }
    });
  }

  async function copyPhotoToClipboard() {
    const imgEl = document.getElementById('cpiPhotoImg');
    const btn = document.getElementById('cpiCopyPhotoBtn');
    if (!imgEl || !imgEl.src) return;
    try {
      if (btn) btn.textContent = '⏳ Copiando…';
      const resp = await fetch(imgEl.src, { mode: 'cors' });
      const blob = await resp.blob();
      let finalBlob = blob;
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        finalBlob = await new Promise(r => c.toBlob(r, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': finalBlob })]);
      if (btn) {
        btn.textContent = '¡Copiada! ✓';
        setTimeout(() => btn.textContent = '📋 Copiar Foto', 2000);
      }
      if (typeof showToast === 'function') showToast('¡Fotografía de estudio copiada al portapapeles!');
      else alert('¡Foto de estudio copiada! Pégala con Ctrl+V.');
    } catch (err) {
      if (btn) btn.textContent = '📋 Copiar Foto';
      alert('Tu navegador no permite copiar imágenes directamente. Usa el botón "Descargar Foto HD".');
    }
  }

  async function downloadPhoto() {
    const imgEl = document.getElementById('cpiPhotoImg');
    if (!imgEl || !imgEl.src || !_selectedFlyerProduct) return;
    try {
      const resp = await fetch(imgEl.src, { mode: 'cors' });
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Foto_Estudio_${(_selectedFlyerProduct.name || 'Producto').replace(/\s+/g, '_')}.png`;
      a.click();
    } catch (e) {
      window.open(imgEl.src, '_blank');
    }
  }

  async function sendPhotoToWaActive() {
    const imgEl = document.getElementById('cpiPhotoImg');
    if (!imgEl || !imgEl.src || !window.waActive) return;
    try {
      const resp = await fetch(imgEl.src, { mode: 'cors' });
      const blob = await resp.blob();
      if (typeof window.waSendGeneratedImage === 'function') {
        const price = parseFloat(document.getElementById('cpiFlyerPrice')?.value || _selectedFlyerProduct.price_usd || 0).toFixed(2);
        const caption = `📸 *${_selectedFlyerProduct.name}*\n🏷️ Marca: ${_selectedFlyerProduct.brand || 'Oficial'}\n💰 Precio Oficial: $${price} USD (Tasa BCV)`;
        await window.waSendGeneratedImage(blob, `foto_${Date.now()}.png`, caption);
        document.getElementById('jjp-copilot-window').classList.add('cpi-hidden');
      }
    } catch (e) {
      alert('Error enviando imagen a WhatsApp: ' + e.message);
    }
  }

  function launchProductCampaignFromFlyer() {
    if (!_selectedFlyerProduct) return;
    const win = document.getElementById('jjp-copilot-window');
    if (win) win.classList.add('cpi-hidden');

    if (window.CampaignEditor && typeof window.CampaignEditor.open === 'function') {
      window.CampaignEditor.open({
        defaultName: `Difusión ${_selectedFlyerProduct.name}`,
        onLaunch: async (config) => {
          if (typeof launchCampaignFromEditor === 'function') {
            await launchCampaignFromEditor(config);
          }
        }
      });
      setTimeout(() => {
        if (typeof window.CampaignEditor.onTypeChange === 'function') {
          const typeSel = document.getElementById('ceTypeSelect');
          if (typeSel) {
            typeSel.value = 'producto';
            window.CampaignEditor.onTypeChange();
          }
        }
      }, 150);
    } else {
      const path = location.pathname.includes('/admin/') ? '../vendedor/difusion.html' : 'difusion.html';
      location.href = path;
    }
  }

  window.cpiLaunchCampaignModal = function () {
    const win = document.getElementById('jjp-copilot-window');
    if (win) win.classList.add('cpi-hidden');

    if (window.CampaignEditor && typeof window.CampaignEditor.open === 'function') {
      window.CampaignEditor.open();
    } else if (typeof newCampaign === 'function') {
      newCampaign();
    } else if (typeof newEcCampaign === 'function') {
      newEcCampaign();
    } else {
      const path = location.pathname.includes('/admin/') ? '../vendedor/difusion.html' : 'difusion.html';
      location.href = path;
    }
  };

  async function renderCurrentFlyer() {
    if (!_selectedFlyerProduct) return;
    const canvas = document.getElementById('cpiCanvas');
    const customPrice = document.getElementById('cpiFlyerPrice').value;
    const note = document.getElementById('cpiFlyerNote').value;
    const theme = document.querySelector('input[name="cpiFlyerTheme"]:checked')?.value || 'white';
    const headline = document.getElementById('cpiFlyerHeadline')?.value || '🔥 OFERTA AL MAYOR';
    const profile = window.CURRENT_PROFILE || window.WA_ME || {};

    ensureGeminiClient(async () => {
      await window.GeminiClient.renderProductCard({
        product: _selectedFlyerProduct,
        customPriceUsd: customPrice,
        sellerName: profile.full_name || profile.name || '',
        sellerPhone: profile.phone || '',
        customNote: note,
        theme,
        headline,
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
        if (typeof showToast === 'function') showToast('¡Flyer copiado al portapapeles! Puedes pegarlo en cualquier chat.');
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

  window.cpiCopyPhotoDirect = async function (url, btn) {
    try {
      if (btn) btn.textContent = '⏳ Copiando…';
      const resp = await fetch(url, { mode: 'cors' });
      const blob = await resp.blob();
      let finalBlob = blob;
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        finalBlob = await new Promise(r => c.toBlob(r, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': finalBlob })]);
      if (btn) {
        btn.textContent = '¡Copiado! ✓';
        setTimeout(() => btn.textContent = '📋 Copiar Foto', 2000);
      }
      if (typeof showToast === 'function') showToast('Fotografía copiada al portapapeles');
      else alert('¡Foto de estudio copiada! Pégala con Ctrl+V.');
    } catch (e) {
      if (btn) btn.textContent = '📋 Copiar Foto';
      alert('Tu navegador no permite copiar imágenes directamente. Usa el botón "Descargar HD".');
    }
  };

  window.cpiDownloadPhotoDirect = async function (url, name) {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Foto_${(name || 'Producto').replace(/\s+/g, '_')}.png`;
      a.click();
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  /* ---------------- Tab 3: Anti-Spam Variations ---------------- */
  let _antiSpamResults = [];

  window.cpiCopyAntiSpam = function (idx, btn) {
    const text = _antiSpamResults[idx] || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '¡Copiado! ✓';
      setTimeout(() => btn.textContent = orig, 2000);

      // Si estamos en WhatsApp y hay un campo de mensaje, inyectarlo de inmediato
      const ci = document.getElementById('waComposerInput');
      if (ci) {
        ci.value = text;
        if (typeof waComposerButtons === 'function') waComposerButtons();
      }
      if (typeof showToast === 'function') showToast('Variación copiada al portapapeles');
    });
  };

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
        _antiSpamResults = [vars.variacion_a || '', vars.variacion_b || '', vars.variacion_c || ''];
        resBox.innerHTML = `
          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>⚡ Opción 1: Directa</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyAntiSpam(0, this)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_a)}</div>
          </div>

          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>🤝 Opción 2: Cordial y Cercana</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyAntiSpam(1, this)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_b)}</div>
          </div>

          <div class="cpi-var-box">
            <div class="cpi-var-title">
              <span>💼 Opción 3: Formal Comercial</span>
              <button class="cpi-var-copy-btn" onclick="cpiCopyAntiSpam(2, this)">Copiar</button>
            </div>
            <div>${escapeHtmlStr(vars.variacion_c)}</div>
          </div>
        `;
      } catch (err) {
        resBox.innerHTML = `<div style="color:#b91c1c;padding:8px">Error generando variaciones: ${err.message}</div>`;
      }
    });
  }

  window.cpiCopyInlineFlyer = function (btn) {
    const box = btn.closest('div').parentElement;
    const canvas = box.querySelector('canvas');
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        const orig = btn.textContent;
        btn.textContent = '¡Copiado! ✓';
        setTimeout(() => btn.textContent = orig, 2000);
        if (typeof showToast === 'function') showToast('Flyer copiado al portapapeles');
      });
    } catch (e) {
      alert('Tu navegador no permite copiar directamente imágenes. Usa el botón Descargar.');
    }
  };

  window.cpiDownloadInlineFlyer = function (btn, name) {
    const box = btn.closest('div').parentElement;
    const canvas = box.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `Flyer_${(name || 'Producto').replace(/\s+/g, '_')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  window.cpiCustomizeProductFlyer = async function (prodKey) {
    const flyerTabBtn = document.querySelector('.cpi-tab[data-tab="flyer"]');
    if (flyerTabBtn) flyerTabBtn.click();
    ensureGeminiClient(async () => {
      let prod = null;
      if (prodKey) {
        const prods = await window.GeminiClient.searchProductsLive(prodKey, 1);
        if (prods && prods.length) prod = prods[0];
      }
      if (!prod && _selectedFlyerProduct) prod = _selectedFlyerProduct;
      if (prod) {
        _selectedFlyerProduct = prod;
        const searchInput = document.getElementById('cpiFlyerSearch');
        if (searchInput) searchInput.value = prod.name;
        const priceInput = document.getElementById('cpiFlyerPrice');
        if (priceInput) priceInput.value = Number(prod.price_usd || 0).toFixed(2);
        const form = document.getElementById('cpiFlyerForm');
        if (form) form.style.display = 'block';
        renderCurrentFlyer();
      }
    });
  };

  window.cpiLaunchProductCampaign = async function (prodKey) {
    ensureGeminiClient(async () => {
      let prod = null;
      if (prodKey) {
        const prods = await window.GeminiClient.searchProductsLive(prodKey, 1);
        if (prods && prods.length) prod = prods[0];
      }
      if (prod) _selectedFlyerProduct = prod;
      launchProductCampaignFromFlyer();
    });
  };

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
