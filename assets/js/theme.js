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

  // Compatibilidad rápida
  window.toggleTheme = () => window.JJTheme.toggle();

  function updateAllToggleButtons(theme) {
    document.querySelectorAll('.liquid-theme-toggle').forEach(btn => {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('title', isDark ? 'Cambiar a Modo Claro (Crystal Glass)' : 'Cambiar a Modo Oscuro (Obsidian Glass)');
      const icon = btn.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.textContent = isDark ? '🌙' : '☀️';
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
      <span class="theme-toggle-icon" style="font-size:16px;line-height:1;transition:transform .3s ease">${isDark ? '🌙' : '☀️'}</span>
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
