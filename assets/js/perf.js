/* ======================================================
   JJ Paper — Modo equipo lento (paneles admin / vendedor)

   Decide si la PC es floja y pone .perf-low en <html> ANTES de
   que se pinte nada (por eso este archivo va en el <head>).
   El usuario siempre manda: si toca el interruptor, su decisión
   se guarda en ese equipo y ya no se vuelve a autodetectar.
   ====================================================== */
(function () {
  'use strict';

  var KEY = 'jjp_perf_low';   // '1' = forzado lento, '0' = forzado completo

  function guessSlow() {
    try {
      // Poca RAM o pocos núcleos = PC de tienda, no de diseño
      if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
      // El usuario pidió ahorrar datos o menos movimiento
      if (navigator.connection && navigator.connection.saveData) return true;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (e) { /* si algo no existe, se asume equipo normal */ }
    return false;
  }

  function apply(on) {
    document.documentElement.classList.toggle('perf-low', !!on);
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  var active = saved === null ? guessSlow() : saved === '1';
  apply(active);

  window.JJPerf = {
    isLow: function () { return document.documentElement.classList.contains('perf-low'); },
    set: function (on) {
      apply(on);
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      if (typeof showToast === 'function') {
        showToast(on ? 'Modo equipo lento activado (sin efectos)' : 'Efectos visuales activados');
      }
    },
    toggle: function () { window.JJPerf.set(!window.JJPerf.isLow()); }
  };

  // Botón en la barra superior del panel, si existe
  function mountToggle() {
    var bar = document.querySelector('.topbar-right');
    if (!bar || document.getElementById('perfToggle')) return;
    var b = document.createElement('button');
    b.id = 'perfToggle';
    b.type = 'button';
    b.className = 'perf-toggle';
    b.setAttribute('aria-pressed', String(window.JJPerf.isLow()));
    b.title = 'Apaga los efectos visuales para que el panel vuele en PCs viejas';
    b.textContent = window.JJPerf.isLow() ? '⚡ Modo rápido' : '✨ Efectos';
    b.onclick = function () {
      window.JJPerf.toggle();
      b.setAttribute('aria-pressed', String(window.JJPerf.isLow()));
      b.textContent = window.JJPerf.isLow() ? '⚡ Modo rápido' : '✨ Efectos';
    };
    bar.appendChild(b);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  } else { mountToggle(); }
})();
