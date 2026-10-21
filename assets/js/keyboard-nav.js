/**
 * ============================================================================
 * JJ Paper — Bus Unificado de Navegación y Atajos de Teclado (Keyboard Nav Hub)
 * Control transversal y fluido para POS, Cotizador, Prospectos, CRM y Campañas
 * ============================================================================
 */

(function () {
  'use strict';

  if (window.__JJ_KEYBOARD_NAV_INITIALIZED__) return;
  window.__JJ_KEYBOARD_NAV_INITIALIZED__ = true;

  const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // Determinar prefijo de ruta (/admin/ vs /vendedor/)
  function getAppArea() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('/admin/')) return 'admin';
    if (p.includes('/vendedor/')) return 'vendedor';
    return 'admin';
  }

  const BASE_URL = getAppArea() === 'vendedor' ? '../vendedor/' : '../admin/';

  // 1. Matriz de Navegación Global entre Pantallas (Alt+1 ... Alt+6)
  const GLOBAL_ROUTES = {
    '1': 'pos.html',
    '2': 'cotizador.html',
    '3': 'prospectos.html',
    '4': 'clientes.html',
    '5': 'whatsapp.html',
    '6': 'campanas-email.html'
  };

  // Helper para detectar si el elemento actual es un campo de escritura editable
  function isEditableInput(el) {
    if (!el) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'number', 'password', 'tel', 'url'].includes(type);
    }
    return false;
  }

  // Helper para saber si hay algún modal abierto en pantalla
  function getActiveModal() {
    // Buscar cualquier modal con clase .op o display flex/block
    const selectors = [
      '.modal-overlay.op',
      '.modal-overlay[style*="display: flex"]',
      '.modal-overlay[style*="display:flex"]',
      '.modal-overlay[style*="display: block"]',
      '.modal-overlay[style*="display:block"]',
      '.pf-popup-mask',
      '#posLoadQuoteModalOvl:not([style*="display: none"])',
      '#quoteSearchModal.op',
      '#customItemModal.op',
      '#posCustomItemModal:not([style*="display: none"])',
      '#quoteShortcutsHelpModal:not([style*="display: none"])',
      '#posShortcutsHelpModal:not([style*="display: none"])',
      '#jjAiQuoteModal.op'
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      } catch (e) {}
    }
    return null;
  }

  // 2. Manejador de Navegación de Celdas en la Tabla del Ticket (POS / Cotizador)
  function handleTicketCellNavigation(e, inputEl) {
    const field = inputEl.getAttribute('data-ticket-field');
    const rowIdx = parseInt(inputEl.getAttribute('data-ticket-idx') || '-1', 10);
    if (!field || rowIdx < 0) return false;

    const allRows = document.querySelectorAll('.pos-line, [data-ticket-line]');
    const totalRows = allRows.length;
    if (totalRows === 0) return false;

    // Enter: Confirmar y saltar al siguiente campo o siguiente fila
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'name') {
        const priceIn = document.querySelector(`input[data-ticket-field="price"][data-ticket-idx="${rowIdx}"]`);
        if (priceIn) { priceIn.focus(); priceIn.select?.(); return true; }
      } else if (field === 'price') {
        const qtyIn = document.querySelector(`input[data-ticket-field="qty"][data-ticket-idx="${rowIdx}"]`);
        if (qtyIn) { qtyIn.focus(); qtyIn.select?.(); return true; }
      } else if (field === 'qty') {
        // Si hay una siguiente fila, saltar al primer campo de la siguiente fila
        if (rowIdx + 1 < totalRows) {
          const nextQty = document.querySelector(`input[data-ticket-field="qty"][data-ticket-idx="${rowIdx + 1}"]`) ||
                          document.querySelector(`input[data-ticket-field="name"][data-ticket-idx="${rowIdx + 1}"]`);
          if (nextQty) { nextQty.focus(); nextQty.select?.(); return true; }
        } else {
          // Última fila completada: devolver foco al buscador de productos
          const searchIn = document.getElementById('posSearch');
          if (searchIn) {
            searchIn.focus();
            searchIn.select?.();
            if (typeof showToast === 'function') {
              showToast('Línea editada. Listo para buscar nuevo producto (F2).', 'info');
            }
            return true;
          }
        }
      }
      return true;
    }

    // Flechas Arriba y Abajo entre filas
    if (e.key === 'ArrowDown') {
      if (rowIdx + 1 < totalRows) {
        e.preventDefault();
        const nextIn = document.querySelector(`input[data-ticket-field="${field}"][data-ticket-idx="${rowIdx + 1}"]`);
        if (nextIn) { nextIn.focus(); nextIn.select?.(); return true; }
      }
    } else if (e.key === 'ArrowUp') {
      if (rowIdx - 1 >= 0) {
        e.preventDefault();
        const prevIn = document.querySelector(`input[data-ticket-field="${field}"][data-ticket-idx="${rowIdx - 1}"]`);
        if (prevIn) { prevIn.focus(); prevIn.select?.(); return true; }
      } else {
        // En la primera fila arriba: saltar al buscador
        e.preventDefault();
        const searchIn = document.getElementById('posSearch');
        if (searchIn) { searchIn.focus(); searchIn.select?.(); return true; }
      }
    }

    // Escape dentro de la celda: quitar el foco y volver al buscador
    if (e.key === 'Escape') {
      e.preventDefault();
      inputEl.blur();
      const searchIn = document.getElementById('posSearch');
      if (searchIn) { searchIn.focus(); searchIn.select?.(); }
      return true;
    }

    return false;
  }

  // 3. Ventana Emergente de Ayuda de Atajos Globales
  function showUniversalKeyboardHelp() {
    let modal = document.getElementById('jjUniversalKeyboardHelp');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'jjUniversalKeyboardHelp';
      modal.className = 'modal-overlay op';
      modal.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:999999;background:rgba(15,23,42,0.7);backdrop-filter:blur(4px);';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:560px;width:92%;background:var(--theme-bg-surface-solid, #ffffff);color:var(--theme-text-main, #0f172a);border-radius:16px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,0.3);border:1px solid var(--theme-border-subtle, #e2e8f0)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid var(--theme-border-subtle, #e2e8f0);padding-bottom:12px">
            <h3 style="margin:0;font-size:18px;display:flex;align-items:center;gap:8px;font-weight:800;color:var(--theme-text-main, #0f172a)">
              ⌨️ Atajos de Teclado Globales — JJ Paper
            </h3>
            <button type="button" class="btn-g sm" onclick="document.getElementById('jjUniversalKeyboardHelp').remove()" style="border-radius:8px;padding:4px 8px;cursor:pointer">✕</button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px">
            <div style="background:var(--theme-item-bg, #f8fafc);padding:12px;border-radius:10px;border:1px solid var(--theme-border-subtle, #e2e8f0)">
              <div style="font-weight:800;color:var(--theme-accent, #16604a);margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">🚀 Navegación de Pantallas</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;justify-content:space-between"><span>Punto de Venta (POS)</span><kbd class="jj-kbd">Alt + 1</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Cotizador</span><kbd class="jj-kbd">Alt + 2</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Prospectos B2B</span><kbd class="jj-kbd">Alt + 3</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Clientes / Cartera</span><kbd class="jj-kbd">Alt + 4</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>WhatsApp</span><kbd class="jj-kbd">Alt + 5</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Campañas Email</span><kbd class="jj-kbd">Alt + 6</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Paleta de Comandos</span><kbd class="jj-kbd">Ctrl + K</kbd></div>
              </div>
            </div>

            <div style="background:var(--theme-item-bg, #f8fafc);padding:12px;border-radius:10px;border:1px solid var(--theme-border-subtle, #e2e8f0)">
              <div style="font-weight:800;color:var(--theme-accent, #16604a);margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">⚡ POS & Cotizador</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;justify-content:space-between"><span>Buscar Producto</span><kbd class="jj-kbd">F2 / /</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Buscar Cliente</span><kbd class="jj-kbd">F3</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Cargar Cotización</span><kbd class="jj-kbd">F4</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Ítem Libre / Flete</span><kbd class="jj-kbd">F8</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Procesar / Emitir</span><kbd class="jj-kbd">Ctrl + Enter</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Navegar Ticket</span><kbd class="jj-kbd">↑ / ↓</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Sumar / Restar Qty</span><kbd class="jj-kbd">+ / -</kbd></div>
                <div style="display:flex;justify-content:space-between"><span>Cerrar / Volver</span><kbd class="jj-kbd">Esc</kbd></div>
              </div>
            </div>
          </div>

          <div style="margin-top:16px;text-align:right">
            <button class="btn-p" onclick="document.getElementById('jjUniversalKeyboardHelp').remove()" style="padding:6px 16px;font-size:13px">Entendido</button>
          </div>
        </div>
      `;
      modal.onclick = () => modal.remove();
      document.body.appendChild(modal);
    } else {
      modal.remove();
    }
  }

  // Inyectar estilos para los badges kbd
  function injectKeyboardStyles() {
    if (document.getElementById('jj-keyboard-nav-styles')) return;
    const style = document.createElement('style');
    style.id = 'jj-keyboard-nav-styles';
    style.textContent = `
      .jj-kbd {
        background: var(--theme-item-bg, #f1f5f9);
        color: var(--theme-text-main, #334155);
        border: 1px solid var(--theme-border-subtle, #cbd5e1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 11px;
        font-weight: 700;
        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
      }
      [data-theme="dark"] .jj-kbd {
        background: #1e293b;
        color: #f1f5f9;
        border-color: #475569;
      }
      .pos-line.ticket-row-active {
        border-color: var(--theme-accent, #10b981) !important;
        background: rgba(16, 185, 129, 0.08) !important;
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 4. Escuchador Maestro de Teclado (Fase de Captura para consistencia)
  window.addEventListener('keydown', function (e) {
    const isAlt = e.altKey;
    const isCtrl = e.ctrlKey || e.metaKey;
    const activeEl = document.activeElement;
    const inInput = isEditableInput(activeEl);

    // A. Atajos de Cambio de Pantalla: Alt+1 ... Alt+6 (funcionan en cualquier momento, incluso dentro de inputs)
    if (isAlt && !isCtrl && GLOBAL_ROUTES[e.key]) {
      e.preventDefault();
      const targetPage = GLOBAL_ROUTES[e.key];
      const area = getAppArea();
      const targetUrl = (area === 'vendedor' ? '../vendedor/' : '../admin/') + targetPage;
      if (!window.location.pathname.endsWith(targetPage)) {
        window.location.href = targetUrl;
      }
      return;
    }

    // B. Ayuda Visual: F1 o Alt+H o '?' fuera de inputs
    if (e.key === 'F1' || (isAlt && e.key.toLowerCase() === 'h') || (!inInput && e.key === '?')) {
      e.preventDefault();
      showUniversalKeyboardHelp();
      return;
    }

    // C. Si el elemento enfocado es una celda del ticket (Nombre, Precio, Qty), delegar a la navegación de celdas
    if (inInput && activeEl.hasAttribute('data-ticket-field')) {
      const handled = handleTicketCellNavigation(e, activeEl);
      if (handled) return;
    }

    // D. Escape Universal Limpio
    if (e.key === 'Escape') {
      const activeModal = getActiveModal();
      if (activeModal) {
        e.preventDefault();
        // Cerrar modal específico
        if (activeModal.id === 'jjUniversalKeyboardHelp') {
          activeModal.remove();
          return;
        }
        if (typeof closeQuoteSearchModal === 'function' && activeModal.id === 'quoteSearchModal') {
          closeQuoteSearchModal();
          return;
        }
        if (typeof closeCustomItemModal === 'function' && activeModal.id === 'customItemModal') {
          closeCustomItemModal();
          return;
        }
        if (typeof posCloseCustomItemModal === 'function' && activeModal.id === 'posCustomItemModal') {
          posCloseCustomItemModal();
          return;
        }
        if (typeof posCloseLoadQuoteModal === 'function' && activeModal.id === 'posLoadQuoteModalOvl') {
          posCloseLoadQuoteModal();
          return;
        }
        if (activeModal.querySelector('.modal-close')) {
          activeModal.querySelector('.modal-close').click();
          return;
        }
        if (activeModal.classList.contains('op')) {
          activeModal.classList.remove('op');
          activeModal.style.display = 'none';
          return;
        }
      }

      // Si no hay modal y el foco está en un input, desenfocar y volver al buscador
      if (inInput) {
        activeEl.blur();
        const searchIn = document.getElementById('posSearch');
        if (searchIn && activeEl !== searchIn) {
          e.preventDefault();
          searchIn.focus();
          searchIn.select?.();
        }
        return;
      }
    }

    // E. Si el usuario está escribiendo normalmente en un campo de texto regular (y no presionó Ctrl ni teclas de función Fx), no interferir
    if (inInput && !e.key.startsWith('F') && !isCtrl && e.key !== 'Escape') {
      return;
    }

    // F. Atajos Funcionales de POS y Cotizador
    // F2 o '/': Foco rápido al Buscador de Productos
    if (e.key === 'F2' || (!inInput && e.key === '/')) {
      const searchIn = document.getElementById('posSearch');
      if (searchIn) {
        e.preventDefault();
        searchIn.focus();
        searchIn.select?.();
      }
      return;
    }

    // F3: Foco rápido a Selección de Cliente
    if (e.key === 'F3') {
      const cliIn = document.getElementById('qCliName') || document.getElementById('custInput') || document.getElementById('posCliInput');
      if (cliIn) {
        e.preventDefault();
        cliIn.focus();
        cliIn.select?.();
      }
      return;
    }

    // F4: Abrir Historial / Cargar Cotización Existente
    if (e.key === 'F4') {
      e.preventDefault();
      if (typeof openQuoteSearchModal === 'function') {
        openQuoteSearchModal();
      } else if (typeof posOpenLoadQuoteModal === 'function') {
        posOpenLoadQuoteModal();
      }
      return;
    }

    // F7: Enfocar la primera fila del ticket
    if (e.key === 'F7') {
      e.preventDefault();
      const firstInput = document.querySelector('input[data-ticket-field="qty"]') ||
                         document.querySelector('input[data-ticket-field="price"]') ||
                         document.querySelector('input[data-ticket-field="name"]');
      if (firstInput) {
        firstInput.focus();
        firstInput.select?.();
      }
      return;
    }

    // F8: Abrir Ítem Libre / Personalizado
    if (e.key === 'F8') {
      e.preventDefault();
      if (typeof openCustomItemModal === 'function') {
        openCustomItemModal();
      } else if (typeof posOpenCustomItemModal === 'function') {
        posOpenCustomItemModal();
      }
      return;
    }

    // F9 o Ctrl+Enter: Emitir Cotización o Procesar Venta
    if (e.key === 'F9' || (isCtrl && e.key === 'Enter')) {
      e.preventDefault();
      // En Cotizador
      if (typeof quoteSaveOrPrint === 'function') {
        quoteSaveOrPrint();
      } else if (typeof posCheckout === 'function') {
        posCheckout();
      }
      return;
    }

  }, true); // Captura activa para garantizar respuesta inmediata

  // Inicializar estilos y exportar objeto global
  injectKeyboardStyles();
  window.JJKeyboard = {
    showHelp: showUniversalKeyboardHelp,
    getActiveModal
  };
})();
