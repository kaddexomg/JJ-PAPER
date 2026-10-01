/* ======================================================
   JJ Paper — Navigation (injects shared nav + footer)
   ====================================================== */

const NAV_LINKS = [
  { label: 'Catálogo',  href: 'catalogo.html', key: 'catalogo' },
  { label: 'Contacto',  href: '#contacto',     key: 'contacto' },
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
  <a class="n-brand" href="catalogo.html">
    <img class="n-logo-img" src="${BRAND_LOGO}" alt="JJ Paper" width="38" height="38">
    <div class="n-name">JJ <em>Paper</em></div>
  </a>
  <div class="n-links">${linksHTML}</div>
  <div class="n-acts">
    <a class="n-wa-btn" id="navWaBtn" href="https://wa.me/584121234567" target="_blank" rel="noopener" aria-label="Atención por WhatsApp" style="display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#fff;padding:6px 13px;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.351.226-.652.075s-1.272-.469-2.423-1.496c-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.151-.176.201-.301.301-.502.1-.2.05-.376-.025-.526-.075-.15-.678-1.635-.929-2.241-.244-.59-.492-.51-.678-.52-.176-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376s-1.054 1.029-1.054 2.509c0 1.48 1.079 2.909 1.229 3.11.15.2 2.122 3.24 5.141 4.544.718.31 1.279.495 1.716.634.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/></svg>
      <span>WhatsApp</span>
    </a>
    <button class="n-tog" id="menuTog" aria-label="Abrir menú" aria-expanded="false" aria-controls="mmenu">&#9776;</button>
  </div>
</nav>
<div class="m-menu" id="mmenu">${mobileHTML}</div>`;

  const placeholder = document.getElementById('nav-placeholder');
  if (placeholder) placeholder.outerHTML = html;

  // Wire up events after injection
  document.getElementById('menuTog')?.addEventListener('click', toggleMenu);
  document.querySelectorAll('.m-menu a').forEach(a =>
    a.addEventListener('click', () => closeMenu())
  );

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
<footer id="contacto">
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
  const navWa = document.getElementById('navWaBtn');
  if (s.whatsapp_number) {
    if (navWa) navWa.href = `https://wa.me/${s.whatsapp_number}`;
  }
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
