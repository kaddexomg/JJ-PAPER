/* ======================================================
   JJ Paper — Navigation (injects shared nav + footer)
   ====================================================== */

const NAV_LINKS = [
  { label: 'Inicio',    href: 'index.html',    key: 'inicio'   },
  { label: 'Catálogo',  href: 'catalogo.html', key: 'catalogo' },
  { label: 'Promociones', href: 'promociones.html', key: 'promos' },
  { label: 'Pedidos',   href: 'pedidos.html',  key: 'pedidos'  },
  { label: 'Rastreo',   href: 'rastreo.html',  key: 'rastreo'  },
  { label: 'Nosotros',  href: 'index.html#nosotros', key: 'nosotros' },
  { label: 'Contacto',  href: 'index.html#contacto', key: 'contacto' },
];

const BRAND_LOGO = 'assets/img/logo.svg';

function injectNav(activeKey = '') {
  const linksHTML = NAV_LINKS.map(l =>
    `<a href="${l.href}" class="${l.key === activeKey ? 'on' : ''}">${l.label}</a>`
  ).join('');

  const mobileHTML = NAV_LINKS.map(l =>
    `<a href="${l.href}">${l.label}</a>`
  ).join('');

  const html = `
<nav id="nav">
  <a class="n-brand" href="index.html">
    <img class="n-logo-img" src="${BRAND_LOGO}" alt="JJ Paper" width="38" height="38">
    <div class="n-name">JJ <em>Paper</em></div>
  </a>
  <div class="n-links">${linksHTML}</div>
  <div class="n-acts">
    <button class="n-cart" id="openCartBtn" aria-label="Abrir carrito">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg><span class="n-cart-lbl">Carrito</span> <span class="n-cbadge" id="cartBadge">0</span>
    </button>
    <button class="n-tog" id="menuTog" aria-label="Abrir menú" aria-expanded="false" aria-controls="mmenu">&#9776;</button>
  </div>
</nav>
<div class="m-menu" id="mmenu">${mobileHTML}</div>`;

  const placeholder = document.getElementById('nav-placeholder');
  if (placeholder) placeholder.outerHTML = html;

  // Wire up events after injection
  document.getElementById('menuTog')?.addEventListener('click', toggleMenu);
  document.getElementById('openCartBtn')?.addEventListener('click', () => {
    if (typeof openCart === 'function') openCart();
  });
  document.querySelectorAll('.m-menu a').forEach(a =>
    a.addEventListener('click', () => closeMenu())
  );

  // El badge se inyecta después de cartLoad(): sincronizarlo con el carrito guardado
  if (typeof cartUpdateBadge === 'function') cartUpdateBadge();

  // Montar botón de modo Claro / Oscuro Liquid Glass
  if (window.JJTheme && typeof window.JJTheme.mount === 'function') {
    window.JJTheme.mount();
  }

  // Escanear y renderizar iconos vectoriales SVG para compatibilidad total con Windows 7
  if (window.JJIcons && typeof window.JJIcons.scan === 'function') {
    window.JJIcons.scan(document.getElementById('nav'));
  }
}

// Cargar theme.js si aún no está presente
if (typeof window !== 'undefined' && !window.JJTheme && !document.querySelector('script[src*="theme.js"]')) {
  const ts = document.createElement('script');
  ts.src = 'assets/js/theme.js';
  ts.defer = true;
  document.head.appendChild(ts);
}

// Cargar icons.js si aún no está presente (Soporte Windows 7)
if (typeof window !== 'undefined' && !window.JJIcons && !document.querySelector('script[src*="icons.js"]')) {
  const is = document.createElement('script');
  is.src = 'assets/js/icons.js';
  is.defer = true;
  document.head.appendChild(is);
}

function injectFooter() {
  // Las 8 familias de jjp_category_groups (?grupo=). Hardcodeadas a propósito:
  // el footer se inyecta en páginas que no cargan el catálogo.
  const cats = [
    ['escritura',     '🖊️ Escritura'],
    ['papel',         '📄 Papel y cuadernos'],
    ['escolar_arte',  '🎨 Escolar y arte'],
    ['corte_pegado',  '✂️ Corte y pegado'],
    ['archivo',       '🗂️ Archivo y carpetas'],
    ['administracion','🧾 Administración'],
    ['sujecion',      '📎 Sujeción'],
    ['tecnologia',    '🧰 Tecnología y otros'],
  ];

  const year = new Date().getFullYear();

  const html = `
<footer>
  <div class="ft-in">
    <div class="ft-brand">
      <div class="ft-logo">
        <img class="ft-logo-img" src="${BRAND_LOGO}" alt="JJ Paper" width="36" height="36">
        <div class="ft-logo-n">JJ <em>Paper</em></div>
      </div>
      <p>Distribuidores al mayor de papelería, material de oficina y suministros. Atendemos todo Venezuela con calidad y compromiso.</p>
      <p class="ft-tag" id="ftTagline">Calidad · Compromiso · Confianza</p>
    </div>
    <div class="ft-col">
      <h5>Navegación</h5>
      ${NAV_LINKS.map(l => `<a href="${l.href}">${l.label}</a>`).join('')}
    </div>
    <div class="ft-col">
      <h5>Categorías</h5>
      ${cats.map(([slug, label]) =>
        `<a href="catalogo.html?grupo=${slug}">${label}</a>`
      ).join('')}
    </div>
    <div class="ft-col">
      <h5>Contacto</h5>
      <a id="ftWa" href="https://wa.me/584121234567" target="_blank">📱 +58 412-1234567</a>
      <a id="ftEmail" href="mailto:ventas@jjpaper.com.ve">📧 ventas@jjpaper.com.ve</a>
      <a id="ftAddress">📍 Caracas, Venezuela</a>
      <a id="ftHours1">🕐 Lun-Vie: 8am - 6pm</a>
      <a id="ftHours2">🕐 Sábado: 8am - 1pm</a>
    </div>
  </div>
  <div class="ft-bot">
    <span>&copy; ${year} <em>JJ Paper</em> · Todos los derechos reservados</span>
    <span>Hecho con 💚 en Venezuela</span>
  </div>
</footer>`;

  const placeholder = document.getElementById('footer-placeholder');
  if (placeholder) placeholder.outerHTML = html;

  refreshContactUI();
}

// Sync contact info (footer + any [data-*] element) with settings loaded from Supabase.
// Called after injectFooter() and again from applySettings() once settings arrive.
function refreshContactUI() {
  const s = (typeof APP !== 'undefined' && APP.SETTINGS) || {};
  const wa = document.getElementById('ftWa');
  if (wa && (s.whatsapp_number || s.phone_display)) {
    if (s.whatsapp_number) wa.href = `https://wa.me/${s.whatsapp_number}`;
    wa.textContent = `📱 ${s.phone_display || '+' + s.whatsapp_number}`;
  }
  const em = document.getElementById('ftEmail');
  if (em && s.email) { em.href = `mailto:${s.email}`; em.textContent = `📧 ${s.email}`; }
  const ad = document.getElementById('ftAddress');
  if (ad && s.address) ad.textContent = `📍 ${s.address}`;
  const h1 = document.getElementById('ftHours1');
  if (h1 && s.hours_weekday) h1.textContent = `🕐 ${s.hours_weekday}`;
  const h2 = document.getElementById('ftHours2');
  if (h2 && s.hours_saturday) h2.textContent = `🕐 ${s.hours_saturday}`;
  const tag = document.getElementById('ftTagline');
  if (tag && s.site_tagline) tag.textContent = s.site_tagline;
}

function toggleMenu() {
  const open = document.getElementById('mmenu')?.classList.toggle('op');
  const tog  = document.getElementById('menuTog');
  if (tog) {
    tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    tog.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  }
}
function closeMenu() {
  document.getElementById('mmenu')?.classList.remove('op');
  const tog = document.getElementById('menuTog');
  if (tog) { tog.setAttribute('aria-expanded', 'false'); tog.setAttribute('aria-label', 'Abrir menú'); }
}

// Back-to-top + scroll nav highlight (for single-page sections)
window.addEventListener('scroll', () => {
  const btt = document.getElementById('btt');
  if (btt) btt.classList.toggle('sh', window.scrollY > 400);
  // Vidrio del nav más sólido tras hacer scroll (glass.css #nav.scrolled)
  document.getElementById('nav')?.classList.toggle('scrolled', window.scrollY > 24);
});
