/* ======================================================
   JJ Paper — Barra lateral unificada con Liquid Glass y Control Agéntico
   ------------------------------------------------------
   FUENTE ÚNICA DE VERDAD del sidebar de staff (admin + vendedor).
   • Colapso/Expansión fluido con persistencia en localStorage.
   • Efecto Liquid Glass (blur + transparencia + saturación).
   • Cuadros de categoría con luz y halo de color independiente al colapsar:
       - Ventas: Esmeralda / Verde Neón (#10b981)
       - Comunicación: Cyan / Celeste (#06b6d4)
       - Catálogo: Púrpura / Violeta (#8b5cf6)
       - Inventario: Ámbar / Dorado Cálido (#f59e0b)
       - Sistema: Magenta / Rosa Neón (#ec4899)
       - Dashboard: Azul Eléctrico (#3b82f6)
   • Submenús desplegables fluidos y flyout en hover al estar colapsado.
   • Animación inclusiva en el Logo JJ Paper arriba.
   • Botón preciso y visible para Cerrar Sesión.
   • Paleta rápida de comandos (Ctrl+K).
   ====================================================== */
(function () {
  const path = location.pathname;
  const isVendedor = /\/vendedor(\/|$)/i.test(path);
  const current = (path.split('/').pop() || 'index.html').toLowerCase() || 'index.html';

  /* ---- Config de navegación con colores y halos propios ---- */
  const ADMIN_NAV = [
    { section: 'Principal' },
    { href: 'index.html', ico: '📊', label: 'Dashboard', color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.45)' },
    { 
      group: 'Ventas', 
      ico: '🛒', 
      color: '#10b981', 
      glow: 'rgba(16, 185, 129, 0.45)',
      items: [
        { href: 'pos.html',          ico: '📋', label: 'Crear Pedido' },
        { href: 'cotizador.html',    ico: '📋', label: 'Nueva Cotización' },
        { href: 'pedidos.html',      ico: '🛒', label: 'Pedidos' },
        { href: 'cotizaciones.html', ico: '📂', label: 'Cotizaciones' },
        { href: 'prospectos.html',   ico: '🎯', label: 'Prospectos B2B' },
        { href: 'documentos.html',   ico: '📝', label: 'Documentos & Formas' },
      ]
    },
    { 
      group: 'Comunicación', 
      ico: '💬', 
      color: '#06b6d4', 
      glow: 'rgba(6, 182, 212, 0.45)',
      items: [
        { href: 'whatsapp.html', ico: '💬', label: 'WhatsApp' },
        { href: 'difusion.html', ico: '📢', label: 'Difusión WA' },
        { href: 'campanas-email.html', ico: '📣', label: 'Campañas Email' },
        { href: 'correo.html',   ico: '📧', label: 'Correo' },
      ]
    },
    { section: 'Catálogo' },
    { 
      group: 'Catálogo', 
      ico: '📦', 
      color: '#8b5cf6', 
      glow: 'rgba(139, 92, 246, 0.45)',
      items: [
        { href: 'productos.html', ico: '📦', label: 'Productos' },
        { href: 'estudio-fotos.html', ico: '🧠', label: 'Estudio IA de Fotos' },
        { href: 'listas-precios.html', ico: '📑', label: 'Listas & MixNet' },
        { href: 'precios.html',   ico: '💱', label: 'Precios' },
        { href: 'clientes.html',  ico: '👥', label: 'Clientes CRM' },
        { href: 'marcas.html',    ico: '🔖', label: 'Marcas' },
        { href: 'unidades.html',  ico: '📐', label: 'Unidades' },
        { href: 'catalogo.html',     ico: '📗', label: 'Catálogo' },
      ]
    },
    { 
      group: 'Inventario', 
      ico: '📁', 
      color: '#f59e0b', 
      glow: 'rgba(245, 158, 11, 0.45)',
      items: [
        { href: 'inventario.html', ico: '📁', label: 'Inventario' },
        { href: 'conteo.html',     ico: '🔢', label: 'Control de conteo' },
        { href: 'escaner.html',    ico: '📷', label: 'Escáner' },
        { href: 'lan.html',        ico: '📡', label: 'Conteo WiFi (LAN)' },
        { href: 'facturas.html',   ico: '📃', label: 'Cuentas por Pagar' },
      ]
    },
    { section: 'Sistema' },
    { 
      group: 'Sistema', 
      ico: '⚡', 
      color: '#ec4899', 
      glow: 'rgba(236, 72, 153, 0.45)',
      items: [
        { href: 'mixnet.html',     ico: '📁', label: 'Puente MixNet ERP' },
        { href: 'monitor.html',    ico: '⚡', label: 'Monitor & Cuotas' },
        { href: 'vendedores.html', ico: '👥', label: 'Vendedores' },
        { href: 'ajustes.html',    ico: '⚙️', label: 'Ajustes' },
        { href: '/catalogo',       ico: '🌐', label: 'Catálogo Cliente', ext: true },
        { href: '/catalogo_impreso', ico: '🖨️', label: 'Catálogo con QR (Calle)', ext: true },
      ]
    }
  ];

  const VENDEDOR_NAV = [
    { section: 'Principal' },
    { href: 'index.html', ico: '📊', label: 'Mi Panel', color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.45)' },
    { 
      group: 'Vender', 
      ico: '💰', 
      color: '#10b981', 
      glow: 'rgba(16, 185, 129, 0.45)',
      items: [
        { href: 'pos.html',          ico: '📋', label: 'Crear Pedido' },
        { href: 'cotizador.html',    ico: '📋', label: 'Cotizador' },
        { href: 'cotizaciones.html', ico: '📂', label: 'Mis cotizaciones' },
        { href: 'documentos.html',   ico: '📝', label: 'Documentos & Formas' },
        { href: 'consulta.html',     ico: '🔎', label: 'Consultar stock' },
        { href: '../lista_costos.html', ico: '📄', label: 'Lista de precios', ext: true },
        { href: 'productos.html',    ico: '💱', label: 'Mis precios' },
        { href: 'catalogo.html',     ico: '📗', label: 'Catálogo' },
        { href: 'pedidos.html',      ico: '🛒', label: 'Mis pedidos' },
      ]
    },
    { 
      group: 'Clientes', 
      ico: '👥', 
      color: '#06b6d4', 
      glow: 'rgba(6, 182, 212, 0.45)',
      items: [
        { href: 'clientes.html', ico: '👥', label: 'Mis clientes' },
        { href: 'difusion.html', ico: '📢', label: 'Difusión WA' },
        { href: 'campanas-email.html', ico: '📣', label: 'Campañas Email' },
      ]
    },
    { 
      group: 'Comunicación', 
      ico: '💬', 
      color: '#8b5cf6', 
      glow: 'rgba(139, 92, 246, 0.45)',
      items: [
        { href: 'whatsapp.html', ico: '💬', label: 'WhatsApp' },
        { href: 'correo.html',   ico: '📧', label: 'Correo' },
      ]
    },
    { section: 'Mi Cuenta' },
    { 
      group: 'Mi Cuenta', 
      ico: '⚙️', 
      color: '#ec4899', 
      glow: 'rgba(236, 72, 153, 0.45)',
      items: [
        { href: 'ajustes.html', ico: '⚙️', label: 'Mis ajustes' },
        { href: '/catalogo', ico: '🌐', label: 'Catálogo Cliente', ext: true },
        { href: '/catalogo_impreso', ico: '🖨️', label: 'Catálogo con QR (Calle)', ext: true },
      ]
    }
  ];

  let NAV = isVendedor ? VENDEDOR_NAV : ADMIN_NAV;
  let DIR = isVendedor ? 'vendedor' : 'admin';

  function absHref(href) {
    if (!href || href === '#' || /^https?:/i.test(href)) return href;
    if (href.startsWith('/')) return href;
    if (href.startsWith('../')) return '/' + href.replace(/^\.\.\//, '');
    return '/' + DIR + '/' + href.replace(/^\/+/, '');
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
        else if (typeof adminLogout === 'function') adminLogout();
      });
    }
    if (isActive(it.href)) a.className = 'on';
    if (it.color) a.style.setProperty('--cat-color', it.color);
    if (it.glow) a.style.setProperty('--cat-glow', it.glow);
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
    if (g.color) wrap.style.setProperty('--cat-color', g.color);
    if (g.glow) wrap.style.setProperty('--cat-glow', g.glow);

    const hasActive = g.items.some((it) => isActive(it.href));
    if (hasActive) wrap.classList.add('open', 'has-active');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-group-btn';
    btn.setAttribute('aria-expanded', hasActive ? 'true' : 'false');
    btn.title = g.group;
    btn.innerHTML =
      `<span class="a-ico">${g.ico || ''}</span>` +
      `<span class="a-txt">${g.group}</span>` +
      `<span class="nav-caret" aria-hidden="true">▾</span>`;

    const sub = document.createElement('div');
    sub.className = 'nav-sub';
    g.items.forEach((it) => sub.appendChild(linkEl(it)));

    btn.addEventListener('click', (e) => {
      const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
      if (aside && aside.classList.contains('collapsed')) {
        // En estado colapsado, hacer clic en el cuadro expande la barra lateral
        toggleCollapse(false);
        return;
      }
      const open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    wrap.appendChild(btn);
    wrap.appendChild(sub);
    return wrap;
  }

  function toggleCollapse(forceState) {
    const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
    if (!aside) return;

    const shouldCollapse = (typeof forceState === 'boolean')
      ? forceState
      : !aside.classList.contains('collapsed');

    if (shouldCollapse) {
      aside.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
      localStorage.setItem('jjp_sidebar_collapsed', '1');
    } else {
      aside.classList.remove('collapsed');
      document.body.classList.remove('sidebar-collapsed');
      localStorage.setItem('jjp_sidebar_collapsed', '0');
    }

    const tBtn = document.getElementById('jjpAsideToggleBtn');
    if (tBtn) {
      tBtn.innerHTML = shouldCollapse ? '▶' : '◀';
      tBtn.title = shouldCollapse ? 'Expandir barra lateral' : 'Colapsar barra lateral';
    }
  }
  window.__jjpToggleSidebar = toggleCollapse;

  function renderNav() {
    const host = document.querySelector('.aside-nav');
    if (!host) return;
    host.innerHTML = '';
    NAV.forEach((node) => {
      if (node.section) return host.appendChild(sectionEl(node.section));
      if (node.group)   return host.appendChild(groupEl(node));
      host.appendChild(linkEl(node));
    });

    // Inyectar botón de colapso y animación al logo en .aside-brand
    const asideBrand = document.querySelector('.aside-brand');
    if (asideBrand && !document.getElementById('jjpAsideToggleBtn')) {
      const logoImg = asideBrand.querySelector('.n-logo-img');
      if (logoImg) logoImg.classList.add('jjp-logo-animated');

      const leftWrap = document.createElement('div');
      leftWrap.className = 'aside-brand-left';
      while (asideBrand.firstChild) {
        leftWrap.appendChild(asideBrand.firstChild);
      }
      asideBrand.appendChild(leftWrap);

      const tBtn = document.createElement('button');
      tBtn.type = 'button';
      tBtn.id = 'jjpAsideToggleBtn';
      tBtn.className = 'jjp-aside-toggle';
      tBtn.setAttribute('aria-label', 'Colapsar menú');
      tBtn.title = 'Colapsar / Expandir barra';
      tBtn.innerHTML = '◀';
      tBtn.addEventListener('click', () => toggleCollapse());
      asideBrand.appendChild(tBtn);
    }

    // Inyectar botón de Cerrar Sesión en .aside-ft
    const asideFt = document.querySelector('.aside-ft');
    if (asideFt && !document.getElementById('jjpAsideLogoutBtn')) {
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.id = 'jjpAsideLogoutBtn';
      logoutBtn.className = 'jjp-aside-logout-btn';
      logoutBtn.title = 'Cerrar Sesión Segura';
      logoutBtn.innerHTML = `<span class="jjp-logout-ico">🔓</span><span class="jjp-logout-txt">Cerrar Sesión</span>`;
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.adminLogout) window.adminLogout();
        else if (typeof adminLogout === 'function') adminLogout();
      });
      asideFt.appendChild(logoutBtn);
    }

    // Aplicar estado colapsado inicial si estaba guardado
    const savedCollapsed = localStorage.getItem('jjp_sidebar_collapsed') === '1';
    if (savedCollapsed && window.innerWidth > 900) {
      toggleCollapse(true);
    }
  }

  /* ---- CSS auto-inyectado con estilo Liquid Glass y Halos ---- */
  function injectCSS() {
    if (document.getElementById('jjp-sidenav-css')) return;
    const css = `
    /* ==============================================================
       LIQUID GLASS SIDENAV & GLOW CATEGORY TILES
       ============================================================== */
    .admin-aside, aside.aside {
      background: rgba(10, 16, 26, 0.85) !important;
      backdrop-filter: blur(24px) saturate(190%) !important;
      -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
      border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
      box-shadow: 4px 0 30px rgba(0, 0, 0, 0.35) !important;
      transition: width 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s ease !important;
      z-index: 200 !important;
    }

    .admin-main, main.admin-main {
      transition: margin-left 0.32s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    body.sidebar-collapsed .admin-main,
    body.sidebar-collapsed main.admin-main {
      margin-left: 72px !important;
    }

    /* Cabecera y botón toggle */
    .aside-brand {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 16px 14px !important;
      position: relative !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    }
    .aside-brand-left {
      display: flex; align-items: center; gap: 10px; overflow: hidden; white-space: nowrap;
    }
    .jjp-aside-toggle {
      width: 28px; height: 28px; border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.7);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.2s ease;
      flex-shrink: 0; font-size: 11px; font-weight: 700;
      backdrop-filter: blur(8px);
    }
    .jjp-aside-toggle:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #fff; border-color: rgba(255, 255, 255, 0.25);
      transform: scale(1.06);
    }

    /* Animación institucional del Logo JJ Paper */
    .jjp-logo-animated {
      width: 38px; height: 38px; border-radius: 50%;
      filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.45));
      animation: jjpLogoPulse 4s ease-in-out infinite;
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    .jjp-logo-animated:hover {
      transform: rotate(8deg) scale(1.12);
    }
    @keyframes jjpLogoPulse {
      0%   { filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.4)); }
      50%  { filter: drop-shadow(0 0 14px rgba(6, 182, 212, 0.8)); transform: scale(1.04) rotate(2deg); }
      100% { filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.4)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .jjp-logo-animated { animation: none !important; }
    }

    /* Grupos y acordeones */
    .aside-nav .nav-group { display:flex; flex-direction:column; position:relative }
    .aside-nav .nav-group-btn {
      display:flex; align-items:center; gap:12px; width:100%;
      padding:11px 18px; font-size:13.5px; font-weight:500;
      color:rgba(255,255,255,.78); background:none; border:0; cursor:pointer;
      font-family:inherit; text-align:left; transition:var(--tr,.2s ease);
      border-radius: 8px; margin: 1px 8px; width: calc(100% - 16px);
    }
    .aside-nav .nav-group-btn:hover {
      background:rgba(255,255,255,.08); color:#fff;
      box-shadow: 0 0 12px var(--cat-glow, transparent);
    }
    .aside-nav .nav-group-btn .a-ico {
      font-size:17px; width:22px; text-align:center; flex-shrink:0;
      filter: drop-shadow(0 0 4px var(--cat-color, transparent));
    }
    .aside-nav .nav-group-btn .a-txt { flex:1 }
    .aside-nav .nav-caret {
      font-size:11px; opacity:.6; transition:transform .28s ease; flex-shrink:0;
    }
    .aside-nav .nav-group.open .nav-caret { transform:rotate(180deg) }
    .aside-nav .nav-group.has-active > .nav-group-btn { color:#fff; font-weight:700 }

    /* Submenú desplegable fluido */
    .aside-nav .nav-sub {
      display:grid; grid-template-rows:0fr;
      transition:grid-template-rows .28s cubic-bezier(0.16, 1, 0.3, 1);
      background:rgba(0,0,0,.15);
      border-radius: 8px; margin: 0 8px 4px 8px;
    }
    .aside-nav .nav-group.open .nav-sub { grid-template-rows:1fr }
    .aside-nav .nav-sub > * { min-height:0; overflow:hidden }
    .aside-nav .nav-sub a {
      padding: 9px 12px 9px 38px; font-size:12.5px;
      color:rgba(255,255,255,.65);
      transition: all 0.18s ease;
      text-decoration:none; display:flex; align-items:center; gap:8px;
    }
    .aside-nav .nav-sub a:hover { color:#fff; background:rgba(255,255,255,.08); padding-left:42px }
    .aside-nav .nav-sub a.on {
      background:var(--cat-glow, rgba(16, 185, 129, 0.2)); color:#fff;
      border-left:3px solid var(--cat-color, #10b981);
      font-weight:600;
    }

    /* Enlaces individuales */
    .aside-nav a {
      display:flex; align-items:center; gap:12px; padding:11px 18px;
      font-size:13.5px; font-weight:500; color:rgba(255,255,255,.78);
      transition:var(--tr,.2s ease); cursor:pointer; text-decoration:none;
      border-radius: 8px; margin: 1px 8px; width: calc(100% - 16px);
    }
    .aside-nav a:hover { background:rgba(255,255,255,.08); color:#fff }
    .aside-nav a.on {
      background:rgba(255,255,255,.14); color:#fff;
      border-left:3px solid var(--cat-color, var(--gm,#10b981));
      font-weight:600;
    }

    /* ==============================================================
       ESTADO COLAPSADO: CUADROS GLASS CON LUZ INDIVIDUAL
       ============================================================== */
    .admin-aside.collapsed, aside.aside.collapsed {
      width: 72px !important;
    }
    .admin-aside.collapsed .aside-brand span,
    .admin-aside.collapsed .aside-brand em,
    .admin-aside.collapsed .jjp-cmd-pill,
    .admin-aside.collapsed .a-section,
    .admin-aside.collapsed .aside-ft > div:first-child,
    .admin-aside.collapsed .nav-group-btn .a-txt,
    .admin-aside.collapsed .nav-group-btn .nav-caret,
    .admin-aside.collapsed .aside-nav > a .a-txt {
      display: none !important;
    }

    .admin-aside.collapsed .aside-brand {
      justify-content: center !important;
      padding: 14px 8px !important;
    }
    .admin-aside.collapsed .aside-brand-left {
      margin-bottom: 8px;
    }
    .admin-aside.collapsed .jjp-aside-toggle {
      position: absolute; bottom: -12px; right: 22px; z-index: 10;
    }

    .admin-aside.collapsed .nav-group,
    .admin-aside.collapsed .aside-nav > a {
      margin: 8px auto !important;
      width: 48px !important;
      display: flex !important;
      justify-content: center !important;
      position: relative !important;
    }

    .admin-aside.collapsed .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a {
      width: 48px !important;
      height: 48px !important;
      padding: 0 !important;
      margin: 0 !important;
      border-radius: 12px !important;
      background: rgba(255, 255, 255, 0.04) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
      border: 1px solid rgba(255, 255, 255, 0.09) !important;
      box-shadow: 0 0 12px var(--cat-glow, rgba(255, 255, 255, 0.08)) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.24s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .admin-aside.collapsed .nav-group-btn .a-ico,
    .admin-aside.collapsed .aside-nav > a .a-ico {
      font-size: 21px !important;
      margin: 0 !important;
      width: auto !important;
      filter: drop-shadow(0 0 6px var(--cat-color, #fff)) !important;
      transition: transform 0.2s ease !important;
    }

    .admin-aside.collapsed .nav-group:hover .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a:hover {
      transform: scale(1.08) translateY(-1px) !important;
      background: rgba(255, 255, 255, 0.12) !important;
      border-color: var(--cat-color, rgba(255, 255, 255, 0.35)) !important;
      box-shadow: 0 0 22px var(--cat-glow, rgba(255, 255, 255, 0.35)), inset 0 0 10px rgba(255, 255, 255, 0.1) !important;
    }

    .admin-aside.collapsed .nav-group:hover .nav-group-btn .a-ico,
    .admin-aside.collapsed .aside-nav > a:hover .a-ico {
      transform: scale(1.15) !important;
    }

    .admin-aside.collapsed .nav-group.has-active .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a.on {
      border-color: var(--cat-color, #10b981) !important;
      background: var(--cat-glow, rgba(16, 185, 129, 0.25)) !important;
      box-shadow: 0 0 18px var(--cat-glow, rgba(16, 185, 129, 0.5)) !important;
    }

    /* Submenú Flotante Flyout Glass en Colapsado */
    .admin-aside.collapsed .nav-group .nav-sub {
      display: none !important;
      position: absolute !important;
      left: 56px !important;
      top: 0 !important;
      width: 220px !important;
      background: rgba(11, 18, 30, 0.95) !important;
      backdrop-filter: blur(24px) saturate(190%) !important;
      -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
      border: 1.5px solid var(--cat-color, rgba(255, 255, 255, 0.2)) !important;
      border-radius: 14px !important;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65), 0 0 20px var(--cat-glow, transparent) !important;
      padding: 8px !important;
      z-index: 99999 !important;
    }

    .admin-aside.collapsed .nav-group:hover .nav-sub {
      display: flex !important;
      flex-direction: column !important;
      gap: 3px !important;
      animation: jjpFlyoutPop 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .admin-aside.collapsed .nav-group .nav-sub a {
      padding: 9px 12px !important;
      border-radius: 8px !important;
      font-size: 13px !important;
      color: rgba(255, 255, 255, 0.8) !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      text-decoration: none !important;
      transition: all 0.16s ease !important;
      border-left: none !important;
      width: 100% !important;
      margin: 0 !important;
    }

    .admin-aside.collapsed .nav-group .nav-sub a:hover {
      background: rgba(255, 255, 255, 0.12) !important;
      color: #fff !important;
      transform: translateX(3px) !important;
    }

    .admin-aside.collapsed .nav-group .nav-sub a.on {
      background: var(--cat-glow, rgba(16, 185, 129, 0.25)) !important;
      border-left: 3px solid var(--cat-color, #10b981) !important;
      color: #fff !important;
      font-weight: 700 !important;
    }

    @keyframes jjpFlyoutPop {
      0%   { opacity: 0; transform: translateX(-8px) scale(0.96); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }

    /* Botón Preciso de Cerrar Sesión */
    .jjp-aside-logout-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      width: 100% !important;
      margin-top: 10px !important;
      padding: 10px 14px !important;
      background: rgba(239, 68, 68, 0.12) !important;
      border: 1px solid rgba(239, 68, 68, 0.28) !important;
      border-radius: 10px !important;
      color: #fca5a5 !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      font-family: inherit !important;
      backdrop-filter: blur(10px) !important;
    }
    .jjp-aside-logout-btn:hover {
      background: rgba(239, 68, 68, 0.25) !important;
      border-color: #ef4444 !important;
      color: #ffffff !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4) !important;
    }
    .admin-aside.collapsed .jjp-aside-logout-btn {
      width: 48px !important;
      height: 48px !important;
      padding: 0 !important;
      margin: 10px auto !important;
      border-radius: 12px !important;
    }
    .admin-aside.collapsed .jjp-aside-logout-btn .jjp-logout-txt {
      display: none !important;
    }

    @media (max-width: 900px) {
      .admin-aside.collapsed { width: 240px !important; }
      body.sidebar-collapsed .admin-main { margin-left: 0 !important; }
      .jjp-aside-toggle { display: none !important; }
    }

    /* Command Palette */
    .jjp-cmd-pill {
      display:flex; align-items:center; justify-content:space-between;
      margin:8px 14px 12px; padding:7px 12px; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.1); border-radius:8px;
      color:rgba(255,255,255,0.8); font-size:12px; cursor:pointer;
      transition:all 0.2s ease;
    }
    .jjp-cmd-pill:hover { background:rgba(255,255,255,0.14); color:#fff; border-color:rgba(255,255,255,0.22); }
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
    `;
    const style = document.createElement('style');
    style.id = 'jjp-sidenav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function applyRole() {
    if (typeof loadProfile !== 'function') return;
    let role;
    try { role = (await loadProfile())?.role; } catch (e) { return; }
    if (!role) return;
    NAV = role === 'admin' ? ADMIN_NAV : VENDEDOR_NAV;
    DIR = role === 'admin' ? 'admin' : 'vendedor';
    renderNav();
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

    const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
    const asideBrand = aside?.querySelector('.aside-brand');
    if (asideBrand && !document.getElementById('jjpCmdPill')) {
      const pill = document.createElement('div');
      pill.id = 'jjpCmdPill';
      pill.className = 'jjp-cmd-pill';
      pill.innerHTML = `<span>🧭 Ir a módulo...</span><kbd>Ctrl+K</kbd>`;
      pill.onclick = openPalette;
      asideBrand.parentNode.insertBefore(pill, asideBrand.nextSibling);
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
      window.addEventListener('keydown', onPaletteKey);
    }

    let flatItems = [];
    let curCursor = 0;

    function buildFlatItems() {
      flatItems = [];
      NAV.forEach(n => {
        if (n.group && n.items) {
          n.items.forEach(it => {
            flatItems.push({
              title: it.label,
              icon: it.ico || '📄',
              group: n.group,
              href: absHref(it.href),
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
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modal.style.display === 'flex') closePalette();
        else openPalette();
      }
    });
  }

  function initModalScrollBridge() {
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
    loadKeyboardNav();
    initCommandPalette();
    initModalScrollBridge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
