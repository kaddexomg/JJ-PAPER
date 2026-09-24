/**
 * JJ Paper — Motor Global de Temas (Liquid Glass: Claro / Oscuro)
 * Persistente en localStorage, sin parpadeos (FOUC) y con animaciones fluidas.
 */
(function() {
  const STORAGE_KEY = 'jjp_theme';

  // 1. Detectar tema inicial de inmediato para evitar flash visual
  function detectInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  const initialTheme = detectInitialTheme();
  document.documentElement.setAttribute('data-theme', initialTheme);

  // 2. API Global de Tema
  window.JJTheme = {
    get() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    },
    set(theme) {
      const target = (theme === 'dark') ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', target);
      try { localStorage.setItem(STORAGE_KEY, target); } catch (_) {}
      updateAllToggleButtons(target);
      window.dispatchEvent(new CustomEvent('jjp_theme_change', { detail: { theme: target } }));
    },
    toggle() {
      const next = this.get() === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    },
    mount() {
      mountThemeSwitcher();
    }
  };

  const SUN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  const MOON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  // Compatibilidad rápida
  window.toggleTheme = () => window.JJTheme.toggle();

  function updateAllToggleButtons(theme) {
    document.querySelectorAll('.liquid-theme-toggle').forEach(btn => {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('title', isDark ? 'Cambiar a Modo Claro (Crystal Glass)' : 'Cambiar a Modo Oscuro (Obsidian Glass)');
      const icon = btn.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.innerHTML = isDark ? MOON_SVG : SUN_SVG;
      }
      const text = btn.querySelector('.theme-toggle-text');
      if (text) {
        text.textContent = isDark ? 'Oscuro' : 'Claro';
      }
    });
  }

  // 3. Montar botón en barra superior automáticamente cuando cargue el DOM
  function mountThemeSwitcher() {
    updateAllToggleButtons(window.JJTheme.get());

    // Si ya existe un botón en la página, no montar duplicados
    if (document.querySelector('.liquid-theme-toggle')) return;

    // Buscar contenedor idóneo en el panel admin / vendedor o la web
    const container = document.querySelector('.topbar-right') ||
                      document.querySelector('.admin-topbar') ||
                      document.querySelector('.n-acts');
    if (!container) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'liquid-theme-toggle';
    btn.setAttribute('aria-label', 'Alternar modo oscuro y claro');
    const isDark = window.JJTheme.get() === 'dark';
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    btn.setAttribute('title', isDark ? 'Cambiar a Modo Claro (Crystal Glass)' : 'Cambiar a Modo Oscuro (Obsidian Glass)');

    btn.innerHTML = `
      <span class="theme-toggle-icon" style="width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;line-height:1;transition:transform .3s ease">${isDark ? MOON_SVG : SUN_SVG}</span>
      <span class="theme-toggle-text" style="font-size:12px;font-weight:700;letter-spacing:0.3px">${isDark ? 'Oscuro' : 'Claro'}</span>
    `;

    btn.addEventListener('click', () => {
      const next = window.JJTheme.toggle();
      const icon = btn.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.style.transform = 'scale(0.6) rotate(45deg)';
        setTimeout(() => {
          icon.style.transform = 'scale(1) rotate(0deg)';
        }, 150);
      }
    });

    // Insertar en la barra superior al inicio de los controles
    container.insertBefore(btn, container.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountThemeSwitcher);
  } else {
    mountThemeSwitcher();
  }

  // Si el navbar se inyecta dinámicamente con retardo (como nav.js):
  let retryCount = 0;
  const retryInterval = setInterval(() => {
    retryCount++;
    if (document.querySelector('.liquid-theme-toggle') || retryCount > 15) {
      clearInterval(retryInterval);
    } else {
      mountThemeSwitcher();
    }
  }, 200);
})();
