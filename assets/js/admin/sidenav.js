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
      { href: 'pedidos.html',      ico: '🛒', label: 'Pedidos' },
      { href: 'cotizaciones.html', ico: '📋', label: 'Cotizaciones' },
      { href: 'promociones.html',  ico: '🔥', label: 'Promociones' },
      { href: 'resenas.html',      ico: '⭐', label: 'Reseñas' },
    ]},
    { group: 'Comunicación', ico: '💬', items: [
      { href: 'whatsapp.html', ico: '💬', label: 'WhatsApp' },
      { href: 'difusion.html', ico: '📢', label: 'Difusión WA' },
      { href: '../vendedor/campanas-email.html', ico: '📣', label: 'Campañas Email' },
      { href: 'correo.html',   ico: '✉️', label: 'Correo' },
    ]},
    { section: 'Catálogo' },
    { group: 'Catálogo', ico: '📦', items: [
      { href: 'productos.html', ico: '📦', label: 'Productos' },
      { href: 'precios.html',   ico: '💱', label: 'Precios' },
      { href: 'clientes.html',  ico: '👥', label: 'Clientes CRM' },
      { href: 'marcas.html',    ico: '🏷️', label: 'Marcas' },
      { href: 'unidades.html',  ico: '📐', label: 'Unidades' },
      { href: 'catalogo.html',     ico: '📗', label: 'Catálogo' },
    ]},
    { group: 'Inventario', ico: '🗃️', items: [
      { href: 'inventario.html', ico: '🗃️', label: 'Inventario' },
      { href: 'conteo.html',     ico: '🔢', label: 'Control de conteo' },
      { href: 'escaner.html',    ico: '📷', label: 'Escáner' },
      { href: 'lan.html',        ico: '📡', label: 'Conteo WiFi (LAN)' },
    ]},
    { href: 'facturas.html', ico: '🧾', label: 'Cuentas por Pagar' },
    { section: 'Sistema' },
    { href: 'vendedores.html', ico: '👥', label: 'Vendedores' },
    { href: 'ajustes.html',    ico: '⚙️', label: 'Ajustes' },
    { href: '../index.html',   ico: '🌐', label: 'Ver Sitio', ext: true },
    { action: 'logout', ico: '🚪', label: 'Cerrar Sesión' },
  ];

  const VENDEDOR_NAV = [
    { section: 'Ventas' },
    { href: 'index.html', ico: '📊', label: 'Mi Panel' },
    { group: 'Vender', ico: '🛍️', items: [
      { href: 'pos.html',          ico: '🛍️', label: 'Nueva venta (POS)' },
      { href: 'cotizador.html',    ico: '📋', label: 'Cotizador' },
      { href: 'cotizaciones.html', ico: '🗂️', label: 'Mis cotizaciones' },
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
      { href: 'correo.html',   ico: '✉️', label: 'Correo' },
    ]},
    { section: 'Mi cuenta' },
    { href: 'ajustes.html', ico: '⚙️', label: 'Mis ajustes' },
    { section: 'Sitio' },
    { href: '../catalogo.html', ico: '🌐', label: 'Ver catálogo', ext: true },
    { action: 'logout', ico: '🚪', label: 'Cerrar Sesión' },
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
    if (!href || href.startsWith('../')) return false;
    return href.split('/').pop().toLowerCase() === current;
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
    s.src = '../assets/js/copilot-jj.js?v=20260908_ai_v1';
    document.head.appendChild(s);
  }

  function init() { injectCSS(); renderNav(); applyRole(); loadCopilot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
