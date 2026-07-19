/* ======================================================
   JJ Paper — FX de botones
   Inyecta capas y coordina los 6 efectos hover:
   ripple · scratch(foil) · grass · heat · lantern · helix
   Los ::before/::after de los botones ya los usa glass.css,
   por eso las capas son <span> inyectados.
   Tolera contenido dinámico (modal, carrito) vía MutationObserver.
   ====================================================== */
(function () {
  'use strict';
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  var SEL = {
    ripple:  '.btn-p:not(.c-checkout), .prod-modal-add, .pd-add, .f-sub, .add-btn',
    scratch: '.pm-buy',
    grass:   '',            // .dl-btn ya no lleva briznas: es un botón secundario
    heat:    '.btn-wa',
    lantern: '.pm-quote, .btn-o',
    helix:   '.c-checkout'
  };

  /* ---------- SVGs generados (paleta de marca) ---------- */

  // Briznas de grama: verdes de marca con variación natural
  function grassSVG() {
    var GREENS = ['#99CC33', '#67A427', '#4E8F3A', '#16604A', '#7ABB2E'];
    var blades = '';
    for (var i = 0; i < 26; i++) {
      var x    = 4 + i * 3.85 + (Math.sin(i * 7.3) * 1.4);
      var h    = 16 + ((i * 37) % 17);            // alto pseudoaleatorio estable
      var lean = ((i * 13) % 9) - 4;              // inclinación
      var c    = GREENS[i % GREENS.length];
      blades += '<path class="gb" d="M' + x + ' 40 Q' + (x + lean * 0.4) + ' ' +
        (40 - h * 0.6) + ' ' + (x + lean) + ' ' + (40 - h) +
        '" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
    }
    return '<svg viewBox="0 0 104 40" preserveAspectRatio="none" aria-hidden="true">' +
      blades + '</svg>';
  }

  // Doble hebra senoidal (lima + latón) con peldaños tenues.
  // Periodo 100 en viewBox 800 → el bucle de -25% (2 periodos) es continuo.
  function helixSVG() {
    function strand(phase, color, w) {
      var d = 'M0 ' + (30 + 18 * Math.sin(phase));
      for (var x = 0; x <= 800; x += 8) {
        d += ' L' + x + ' ' + (30 + 18 * Math.sin(x * Math.PI * 2 / 100 + phase)).toFixed(1);
      }
      return '<path d="' + d + '" stroke="' + color + '" stroke-width="' + w +
        '" fill="none" stroke-linecap="round" opacity=".9"/>';
    }
    var rungs = '';
    for (var x = 25; x <= 800; x += 50) {
      var y1 = 30 + 18 * Math.sin(x * Math.PI * 2 / 100);
      var y2 = 30 + 18 * Math.sin(x * Math.PI * 2 / 100 + Math.PI);
      rungs += '<line x1="' + x + '" y1="' + y1.toFixed(1) + '" x2="' + x +
        '" y2="' + y2.toFixed(1) + '" stroke="rgba(255,255,255,.30)" stroke-width="1"/>';
    }
    return '<svg viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden="true">' +
      '<g class="hx1">' + strand(0, '#C7EC94', 2.4) + '</g>' +
      '<g class="hx2">' + strand(Math.PI, '#C9A24B', 2.4) + rungs + '</g></svg>';
  }

  /* ---------- Decoración de botones ---------- */
  function layer(cls, html) {
    var s = document.createElement('span');
    s.className = 'fx-layer ' + cls;
    s.setAttribute('aria-hidden', 'true');
    if (html) s.innerHTML = html;
    return s;
  }

  function decorate(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    // Un selector vacío significa "efecto desactivado". querySelectorAll('')
    // lanzaría SyntaxError, así que se corta antes.
    var q = function (sel) { return sel ? root.querySelectorAll(sel) : []; };

    q(SEL.scratch).forEach(function (b) {
      if (b.dataset.fx) return; b.dataset.fx = '1';
      b.classList.add('fx-host', 'fx-scratch');
      b.appendChild(layer('fx-foil'));
    });
    q(SEL.grass).forEach(function (b) {
      if (b.dataset.fx) return; b.dataset.fx = '1';
      b.classList.add('fx-host', 'fx-grass');
      b.appendChild(layer('fx-grass-layer', grassSVG()));
    });
    q(SEL.heat).forEach(function (b) {
      if (b.dataset.fx) return; b.dataset.fx = '1';
      b.classList.add('fx-host', 'fx-heat');
      b.appendChild(layer('fx-heat-layer'));
    });
    q(SEL.lantern).forEach(function (b) {
      if (b.dataset.fx) return; b.dataset.fx = '1';
      b.classList.add('fx-host', 'fx-lantern');
      b.appendChild(layer('fx-lantern-layer'));
    });
    q(SEL.helix).forEach(function (b) {
      if (b.dataset.fx) return; b.dataset.fx = '1';
      b.classList.add('fx-host', 'fx-helix');
      b.appendChild(layer('fx-helix-layer', helixSVG()));
    });
    // Ripple no necesita capa previa; solo marca la clase host
    q(SEL.ripple).forEach(function (b) {
      if (b.dataset.fxr) return; b.dataset.fxr = '1';
      b.classList.add('fx-host');
    });
  }

  /* ---------- Ripple (onda desde el punto de contacto) ---------- */
  function spawnRipple(btn, clientX, clientY, soft) {
    if (reduce) return;
    var r = btn.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 2.2;
    var s = document.createElement('span');
    s.className = 'fx-ripple' + (soft ? ' soft' : '');
    s.style.width = s.style.height = d + 'px';
    s.style.marginLeft = s.style.marginTop = (-d / 2) + 'px';
    s.style.setProperty('--rx', (clientX - r.left) + 'px');
    s.style.setProperty('--ry', (clientY - r.top) + 'px');
    btn.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
    // Failsafe por si animationend no dispara
    setTimeout(function () { s.remove(); }, 1200);
  }

  /* ---------- Eventos delegados ---------- */
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest(SEL.ripple);
    if (b) spawnRipple(b, e.clientX, e.clientY, false);
  }, { passive: true });

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;
    var b = e.target.closest && e.target.closest(SEL.ripple);
    if (b && !b.contains(e.relatedTarget)) spawnRipple(b, e.clientX, e.clientY, true);
  }, { passive: true });

  // Farol: la luz sigue al cursor dentro del botón
  document.addEventListener('pointermove', function (e) {
    var b = e.target.closest && e.target.closest(SEL.lantern);
    if (!b || !b.classList.contains('fx-lantern')) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty('--fx-x', (e.clientX - r.left) + 'px');
    b.style.setProperty('--fx-y', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- Contenido dinámico (modal, carrito, promos) ---------- */
  var pending = null;
  var mo = new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = null; decorate(document); }, 120);
  });

  function init() {
    decorate(document);
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
