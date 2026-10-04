/* ======================================================
   JJ Paper — Barra lateral unificada (admin + vendedor)
   ------------------------------------------------------
   FUENTE ÚNICA DE VERDAD del sidebar de staff.
   Reconstruye el <nav class="aside-nav"> de cada página para que:
     • TODOS los botones estén siempre visibles (se acabó el drift
       de que "en WhatsApp no sale Correo", etc.).
     • Las secciones con sub-funciones se desplieguen con animación.
   Auto-inyecta su propio CSS: no toca ningún archivo .css compartido.
   (Distinto de assets/js/nav.js, que es el nav del sitio público.)
   ====================================================== */
(function () {
  const path = location.pathname;
  const isVendedor = /\/vendedor\//.test(path);
  const current = (path.split('/').pop() || 'index.html').toLowerCase() || 'index.html';

  /* ---- Config de navegación --------------------------------------
     item : { href, ico, label, ext?, action? }
     grupo: { group, ico, items:[item...] }  → desplegable animado
     título de sección: { section:'…' }                              */
  const ADMIN_NAV = [
    { section: 'Principal' },
    { href: 'index.html', ico: '📊', label: 'Dashboard' },
    { group: 'Ventas', ico: '🛒', items: [
      { href: 'pos.html',          ico: '📋', label: 'Crear Pedido' },
      { href: 'cotizador.html',    ico: '📋', label: 'Nueva Cotización' },
      { href: 'pedidos.html',      ico: '🛒', label: 'Pedidos' },
      { href: 'cotizaciones.html', ico: '📂', label: 'Cotizaciones' },
      { href: 'prospectos.html',   ico: '🎯', label: 'Prospectos B2B' },
    ]},
    { group: 'Comunicación', ico: '💬', items: [
      { href: 'whatsapp.html', ico: '💬', label: 'WhatsApp' },
      { href: 'difusion.html', ico: '📢', label: 'Difusión WA' },
      { href: 'campanas-email.html', ico: '📣', label: 'Campañas Email' },
      { href: 'correo.html',   ico: '📧', label: 'Correo' },
    ]},
    { section: 'Catálogo' },
    { group: 'Catálogo', ico: '📦', items: [
      { href: 'productos.html', ico: '📦', label: 'Productos' },
      { href: 'listas-precios.html', ico: '📑', label: 'Listas & MixNet' },
      { href: 'precios.html',   ico: '💱', label: 'Precios' },
      { href: 'clientes.html',  ico: '👥', label: 'Clientes CRM' },
      { href: 'marcas.html',    ico: '🔖', label: 'Marcas' },
      { href: 'unidades.html',  ico: '📐', label: 'Unidades' },
      { href: 'catalogo.html',     ico: '📗', label: 'Catálogo' },
    ]},
    { group: 'Inventario', ico: '📁', items: [
      { href: 'inventario.html', ico: '📁', label: 'Inventario' },
      { href: 'conteo.html',     ico: '🔢', label: 'Control de conteo' },
      { href: 'escaner.html',    ico: '📷', label: 'Escáner' },
      { href: 'lan.html',        ico: '📡', label: 'Conteo WiFi (LAN)' },
    ]},
    { href: 'facturas.html', ico: '📃', label: 'Cuentas por Pagar' },
    { section: 'Sistema' },
    { href: 'monitor.html',    ico: '⚡', label: 'Monitor & Cuotas' },
    { href: 'vendedores.html', ico: '👥', label: 'Vendedores' },
    { href: 'ajustes.html',    ico: '⚙', label: 'Ajustes' },
    { href: '../index.html',   ico: '🌐', label: 'Ver Sitio', ext: true },
    { action: 'logout', ico: '🔓', label: 'Cerrar Sesión' },
  ];

  const VENDEDOR_NAV = [
    { section: 'Ventas' },
    { href: 'index.html', ico: '📊', label: 'Mi Panel' },
    { group: 'Vender', ico: '💰', items: [
      { href: 'pos.html',          ico: '📋', label: 'Crear Pedido' },
      { href: 'cotizador.html',    ico: '📋', label: 'Cotizador' },
      { href: 'cotizaciones.html', ico: '📂', label: 'Mis cotizaciones' },
      { href: 'consulta.html',     ico: '🔎', label: 'Consultar stock' },
      { href: '../lista_costos.html', ico: '📄', label: 'Lista de precios', ext: true },
      { href: 'productos.html',    ico: '💱', label: 'Mis precios' },
      { href: 'catalogo.html',     ico: '📗', label: 'Catálogo' },
      { href: 'pedidos.html',      ico: '🛒', label: 'Mis pedidos' },
    ]},
    { group: 'Clientes', ico: '👥', items: [
      { href: 'clientes.html', ico: '👥', label: 'Mis clientes' },
      { href: 'difusion.html', ico: '📢', label: 'Difusión WA' },
      { href: 'campanas-email.html', ico: '📣', label: 'Campañas Email' },
    ]},
    { group: 'Comunicación', ico: '💬', items: [
      { href: 'whatsapp.html', ico: '💬', label: 'WhatsApp' },
      { href: 'correo.html',   ico: '📧', label: 'Correo' },
    ]},
    { section: 'Mi cuenta' },
    { href: 'ajustes.html', ico: '⚙', label: 'Mis ajustes' },
    { section: 'Sitio' },
    { href: '../catalogo.html', ico: '🌐', label: 'Ver catálogo', ext: true },
    { action: 'logout', ico: '🔓', label: 'Cerrar Sesión' },
  ];

  // Dirección y nav según el ROL de la sesión, no según la URL. Antes se decidía
  // por la ruta: un admin que abría /vendedor/catalogo.html veía el menú del
  // vendedor y todo parecía "cambiársele" la sesión. Ahora el rol manda; la URL
  // es solo un fallback mientras el perfil todavía no se carga.
  let NAV = isVendedor ? VENDEDOR_NAV : ADMIN_NAV;
  let DIR = isVendedor ? 'vendedor' : 'admin';

  // Resuelve un href del menú a ruta absoluta según el DIR de la sesión, para que
  // los enlaces funcionen aunque estés viendo el panel de admin o el de vendedor
  // (siteURL respeta la raíz real, incluso con file:// o una subcarpeta de dominio).
  function absHref(href) {
    if (!href || href === '#' || /^https?:/i.test(href) || href.startsWith('/')) return href;
    let rel = href;
    if (!rel.startsWith('..')) rel = DIR + '/' + rel;   // enlace relativo → dentro del panel del rol
    else rel = rel.replace(/^\.\.\//, '');              // '../x' → sale del panel → raíz/x
    return typeof siteURL === 'function' ? siteURL(rel) : rel;
  }

  function isActive(href) {
    if (!href) return false;
    const target = href.split('/').pop().toLowerCase();
    if (href.includes('/')) {
      const cleanHref = href.replace(/^\.\.\//, '');
      return path.toLowerCase().endsWith(cleanHref.toLowerCase()) || target === current;
    }
    return target === current;
  }

  function linkEl(it) {
    const a = document.createElement('a');
    a.href = it.href ? absHref(it.href) : '#';
    if (it.ext) a.target = '_blank';
    if (it.action === 'logout') {
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.adminLogout) window.adminLogout();
      });
    }
    if (isActive(it.href)) a.className = 'on';
    a.innerHTML = `<span class="a-ico">${it.ico || ''}</span> <span class="a-txt">${it.label}</span>`;
    return a;
  }

  function sectionEl(txt) {
    const s = document.createElement('span');
    s.className = 'a-section';
    s.textContent = txt;
    return s;
  }

  function groupEl(g) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-group';
    const hasActive = g.items.some((it) => isActive(it.href));
    if (hasActive) wrap.classList.add('open', 'has-active');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-group-btn';
    btn.setAttribute('aria-expanded', hasActive ? 'true' : 'false');
    btn.innerHTML =
      `<span class="a-ico">${g.ico || ''}</span>` +
      `<span class="a-txt">${g.group}</span>` +
      `<span class="nav-caret" aria-hidden="true">▾</span>`;

    const sub = document.createElement('div');
    sub.className = 'nav-sub';
    g.items.forEach((it) => sub.appendChild(linkEl(it)));

    btn.addEventListener('click', () => {
      const open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    wrap.appendChild(btn);
    wrap.appendChild(sub);
    return wrap;
  }

  function renderNav() {
    const host = document.querySelector('.aside-nav');
    if (!host) return;
    host.innerHTML = '';
    NAV.forEach((node) => {
      if (node.section) return host.appendChild(sectionEl(node.section));
      if (node.group)   return host.appendChild(groupEl(node));
      host.appendChild(linkEl(node));
    });
  }

  /* ---- CSS auto-inyectado (no toca archivos .css compartidos) ---- */
  function injectCSS() {
    if (document.getElementById('jjp-sidenav-css')) return;
    const css = `
    .aside-nav .nav-group { display:flex; flex-direction:column }
    .aside-nav .nav-group-btn {
      display:flex; align-items:center; gap:12px; width:100%;
      padding:12px 20px; font-size:14px; font-weight:500;
      color:rgba(255,255,255,.75); background:none; border:0; cursor:pointer;
      font-family:inherit; text-align:left; transition:var(--tr,.2s ease);
    }
    .aside-nav .nav-group-btn:hover { background:rgba(255,255,255,.1); color:#fff }
    .aside-nav .nav-group-btn .a-ico { font-size:18px; width:22px; text-align:center; flex-shrink:0 }
    .aside-nav .nav-group-btn .a-txt { flex:1 }
    .aside-nav .nav-caret {
      font-size:11px; opacity:.6; transition:transform .28s ease; flex-shrink:0;
    }
    .aside-nav .nav-group.open .nav-caret { transform:rotate(180deg) }
    /* resalta la sección que contiene la página activa */
    .aside-nav .nav-group.has-active > .nav-group-btn { color:#fff }
    .aside-nav .nav-group.has-active > .nav-group-btn .a-txt { font-weight:700 }

    /* submenú desplegable animado (grid 0fr→1fr, sin medir alturas) */
    .aside-nav .nav-sub {
      display:grid; grid-template-rows:0fr;
      transition:grid-template-rows .28s ease;
      background:rgba(0,0,0,.18);
    }
    .aside-nav .nav-group.open .nav-sub { grid-template-rows:1fr }
    .aside-nav .nav-sub > * { min-height:0; overflow:hidden }
    .aside-nav .nav-sub a {
      padding-left:44px; font-size:13px;
      color:rgba(255,255,255,.62);
    }
    .aside-nav .nav-sub a .a-ico { font-size:15px }
    .aside-nav .nav-sub a:hover { color:#fff }
    .aside-nav .nav-sub a.on {
      background:rgba(255,255,255,.15); color:#fff;
      border-right:3px solid var(--gm,#99CC33);
    }
    .jjp-cmd-pill {
      display:flex; align-items:center; justify-content:space-between;
      margin:8px 16px 12px; padding:7px 12px; background:rgba(255,255,255,0.08);
      border:1px solid rgba(255,255,255,0.12); border-radius:8px;
      color:rgba(255,255,255,0.85); font-size:12px; cursor:pointer;
      transition:all 0.2s ease;
    }
    .jjp-cmd-pill:hover { background:rgba(255,255,255,0.16); color:#fff; border-color:rgba(255,255,255,0.25); }
    .jjp-cmd-pill kbd {
      background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.2);
      border-radius:4px; padding:1px 5px; font-size:10px; font-family:monospace;
    }
    .jjp-palette-mask {
      position:fixed; inset:0; background:rgba(15,23,42,0.65);
      backdrop-filter:blur(4px); z-index:100000;
      display:flex; align-items:flex-start; justify-content:center;
      padding-top:12vh;
    }
    .jjp-palette-box {
      width:100%; max-width:580px; background:#ffffff;
      border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.25);
      overflow:hidden; border:1px solid #e2e8f0; animation:jjpPop 0.15s ease-out;
    }
    @keyframes jjpPop { from { transform:scale(0.96); opacity:0; } to { transform:scale(1); opacity:1; } }
    .jjp-palette-input-wrap {
      display:flex; align-items:center; padding:14px 18px;
      border-bottom:1px solid #e2e8f0; gap:12px; background:#fff;
    }
    .jjp-palette-search-icon { font-size:18px; opacity:0.6; }
    #jjpPaletteInput {
      flex:1; border:0; outline:0; font-size:15px; font-family:inherit; color:#0f172a;
    }
    .jjp-palette-badge {
      font-size:11px; background:#f1f5f9; color:#64748b; padding:3px 7px;
      border-radius:4px; font-weight:600;
    }
    .jjp-palette-list {
      max-height:380px; overflow-y:auto; padding:8px;
    }
    .jjp-palette-item {
      display:flex; align-items:center; gap:12px; padding:10px 14px;
      border-radius:8px; cursor:pointer; transition:background 0.15s;
    }
    .jjp-palette-item.active {
      background:#f0fdf4; color:#166534;
    }
    .jjp-palette-item-icon { font-size:18px; }
    .jjp-palette-item-text { flex:1; min-width:0; }
    .jjp-palette-item-title { font-weight:600; font-size:14px; color:#0f172a; }
    .jjp-palette-item.active .jjp-palette-item-title { color:#15803d; }
    .jjp-palette-item-sub { font-size:11.5px; color:#64748b; }
    .jjp-palette-item-arrow { opacity:0.3; font-size:13px; }
    .jjp-palette-item.active .jjp-palette-item-arrow { opacity:1; color:#15803d; }
    .jjp-palette-footer {
      display:flex; gap:16px; padding:10px 18px; background:#f8fafc;
      border-top:1px solid #e2e8f0; font-size:11px; color:#64748b;
    }
    .jjp-palette-footer kbd {
      background:#fff; border:1px solid #cbd5e1; border-radius:3px; padding:1px 4px;
    }
    .jjp-palette-empty {
      padding:30px; text-align:center; color:#94a3b8; font-size:14px;
    }
    .topbar-dialer-btn {
      display:inline-flex; align-items:center; gap:8px;
      background:linear-gradient(135deg, #059669, #047857);
      color:#ffffff !important; border:1px solid #10b981;
      padding:6px 14px; border-radius:9999px;
      font-size:12.5px; font-weight:700; cursor:pointer;
      box-shadow:0 2px 8px rgba(5, 150, 105, 0.35);
      transition:all .2s ease; user-select:none; font-family:inherit;
      margin-right:10px; text-decoration:none;
    }
    .topbar-dialer-btn:hover {
      background:linear-gradient(135deg, #10b981, #059669);
      transform:translateY(-1px);
      box-shadow:0 4px 14px rgba(5, 150, 105, 0.55);
      color:#ffffff !important;
    }
    .topbar-dialer-pulse {
      width:8px; height:8px; border-radius:50%;
      background:#34d399; display:inline-block;
      box-shadow:0 0 0 0 rgba(52, 211, 153, 0.7);
      animation:jjpPulseGreen 1.8s infinite;
    }
    @keyframes jjpPulseGreen {
      0% { transform:scale(0.95); box-shadow:0 0 0 0 rgba(52, 211, 153, 0.7); }
      70% { transform:scale(1); box-shadow:0 0 0 6px rgba(52, 211, 153, 0); }
      100% { transform:scale(0.95); box-shadow:0 0 0 0 rgba(52, 211, 153, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .aside-nav .nav-sub, .aside-nav .nav-caret { transition:none }
    }`;
    const style = document.createElement('style');
    style.id = 'jjp-sidenav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Corrige el menú cuando el rol real difiere del deducido por la URL
  // (ej: admin visitando /vendedor/catalogo.html debe ver el menú de admin).
  // Requiere admin/auth.js (loadProfile) — si no está, se queda con la URL.
  async function applyRole() {
    if (typeof loadProfile !== 'function') return;
    let role;
    try { role = (await loadProfile())?.role; } catch (e) { return; }
    if (!role) return;
    NAV = role === 'admin' ? ADMIN_NAV : VENDEDOR_NAV;
    DIR = role === 'admin' ? 'admin' : 'vendedor';
    renderNav();
  }

  function loadCopilot() {
    if (document.getElementById('jjp-copilot-script')) return;
    const s = document.createElement('script');
    s.id = 'jjp-copilot-script';
    s.src = '../assets/js/copilot-jj.js?v=20260910_cloud_images_v1';
    document.head.appendChild(s);
  }

  function loadKeyboardNav() {
    if (document.getElementById('jjp-keyboard-nav-script') || window.__JJ_KEYBOARD_NAV_INITIALIZED__) return;
    const s = document.createElement('script');
    s.id = 'jjp-keyboard-nav-script';
    s.src = '../assets/js/keyboard-nav.js?v=20260927_hub';
    document.head.appendChild(s);
  }

  function initCommandPalette() {
    if (window.__jjpCmdPaletteInit) return;
    window.__jjpCmdPaletteInit = true;

    // Inyectar botón pill en el header del sidebar
    const aside = document.querySelector('aside.aside');
    const asideLogo = aside?.querySelector('.aside-logo');
    if (asideLogo && !document.getElementById('jjpCmdPill')) {
      const pill = document.createElement('div');
      pill.id = 'jjpCmdPill';
      pill.className = 'jjp-cmd-pill';
      pill.innerHTML = `<span>🧭 Ir a módulo...</span><kbd>Ctrl+K</kbd>`;
      pill.onclick = openPalette;
      asideLogo.parentNode.insertBefore(pill, asideLogo.nextSibling);
    }

    let modal = document.getElementById('jjpCmdPaletteModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'jjpCmdPaletteModal';
      modal.className = 'jjp-palette-mask';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="jjp-palette-box" role="dialog" aria-modal="true" aria-label="Navegador Rápido">
          <div class="jjp-palette-input-wrap">
            <span class="jjp-palette-search-icon">🔍</span>
            <input type="text" id="jjpPaletteInput" placeholder="Escribe para ir a cualquier módulo (ej. pos, cotizador, clientes, whatsapp)..." autocomplete="off">
            <span class="jjp-palette-badge">ESC para cerrar</span>
          </div>
          <div class="jjp-palette-list" id="jjpPaletteList"></div>
          <div class="jjp-palette-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
            <span><kbd>Enter</kbd> abrir</span>
            <span><kbd>Esc</kbd> cerrar</span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.addEventListener('click', e => {
        if (e.target === modal) closePalette();
      });

      const inp = modal.querySelector('#jjpPaletteInput');
      inp.addEventListener('input', renderPaletteItems);
      inp.addEventListener('keydown', onPaletteKey);
    }

    let flatItems = [];
    let curCursor = 0;

    function buildFlatItems() {
      flatItems = [];
      NAV.forEach(n => {
        if (n.group && n.items) {
          n.items.forEach(it => {
            if (it.action === 'logout') return;
            flatItems.push({
              title: it.label,
              icon: it.ico || '📄',
              group: n.group,
              href: it.href ? absHref(it.href) : '#',
              ext: !!it.ext,
              action: it.action
            });
          });
        } else if (n.href && !n.section && n.action !== 'logout') {
          flatItems.push({
            title: n.label,
            icon: n.ico || '📄',
            group: 'Principal',
            href: absHref(n.href),
            ext: !!n.ext,
            action: n.action
          });
        }
      });
    }

    function openPalette() {
      buildFlatItems();
      curCursor = 0;
      modal.style.display = 'flex';
      const inp = document.getElementById('jjpPaletteInput');
      inp.value = '';
      renderPaletteItems();
      setTimeout(() => inp.focus(), 30);
    }

    function closePalette() {
      modal.style.display = 'none';
    }

    window.__jjpOpenCommandPalette = openPalette;
    window.__jjpCloseCommandPalette = closePalette;

    function renderPaletteItems() {
      const q = (document.getElementById('jjpPaletteInput')?.value || '').trim().toLowerCase();
      const listEl = document.getElementById('jjpPaletteList');
      const filtered = flatItems.filter(it => 
        !q || it.title.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
      );

      if (!filtered.length) {
        listEl.innerHTML = `<div class="jjp-palette-empty">No se encontraron módulos con "${escapeHTML(q)}"</div>`;
        return;
      }

      if (curCursor >= filtered.length) curCursor = 0;
      if (curCursor < 0) curCursor = 0;

      listEl.innerHTML = filtered.map((it, idx) => `
        <div class="jjp-palette-item ${idx === curCursor ? 'active' : ''}" data-idx="${idx}">
          <span class="jjp-palette-item-icon">${it.icon}</span>
          <div class="jjp-palette-item-text">
            <div class="jjp-palette-item-title">${escapeHTML(it.title)}</div>
            <div class="jjp-palette-item-sub">${escapeHTML(it.group)}</div>
          </div>
          <span class="jjp-palette-item-arrow">↵</span>
        </div>
      `).join('');

      const items = listEl.querySelectorAll('.jjp-palette-item');
      items.forEach(el => {
        el.addEventListener('mouseenter', () => {
          curCursor = Number(el.dataset.idx);
          items.forEach((x, i) => x.classList.toggle('active', i === curCursor));
        });
        el.addEventListener('click', () => {
          executeItem(filtered[curCursor]);
        });
      });

      items[curCursor]?.scrollIntoView({ block: 'nearest' });
    }

    function executeItem(item) {
      if (!item) return;
      closePalette();
      if (item.ext) window.open(item.href, '_blank');
      else window.location.href = item.href;
    }

    function onPaletteKey(e) {
      const q = (document.getElementById('jjpPaletteInput')?.value || '').trim().toLowerCase();
      const filtered = flatItems.filter(it => 
        !q || it.title.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
      );

      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) {
          curCursor = (curCursor + 1) % filtered.length;
          renderPaletteItems();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) {
          curCursor = (curCursor - 1 + filtered.length) % filtered.length;
          renderPaletteItems();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered.length && filtered[curCursor]) {
          executeItem(filtered[curCursor]);
        }
        return;
      }
    }

    window.addEventListener('keydown', e => {
      // Ctrl+K o Cmd+K o Alt+K abre la paleta de navegación desde cualquier pantalla
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modal.style.display === 'flex') closePalette();
        else openPalette();
      }
    });
  }

  function initModalScrollBridge() {
    // Redirigir el scroll del ratón hacia el cuerpo del modal si el cursor está sobre la cabecera, pie o el overlay
    document.addEventListener('wheel', (e) => {
      const overlay = e.target.closest('.modal-overlay.op, .modal-overlay.open');
      if (!overlay) return;
      const body = overlay.querySelector('.modal-body');
      if (!body) return;
      if (e.target.closest('.modal-hd') || e.target === overlay || e.target.closest('.modal-ft')) {
        body.scrollTop += e.deltaY;
      }
    }, { passive: true });
  }

  function init() {
    injectCSS();
    renderNav();
    applyRole();
    loadCopilot();
    loadKeyboardNav();
    initCommandPalette();
    initModalScrollBridge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
