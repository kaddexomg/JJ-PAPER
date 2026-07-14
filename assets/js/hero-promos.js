/* ======================================================
   JJ Paper — Carrusel de promociones del hero (index)
   ------------------------------------------------------
   Banner compacto que rota las promos vigentes como si
   pasara de página: auto-avance, arrastre (mouse/dedo)
   con umbral de distancia + velocidad, y puntos.
   - Se alimenta de jjp_promos vía loadPromos() (promos.js).
   - Sin promos vigentes → se oculta y no deja rastro.
   - Pausa con hover, con la pestaña oculta y en
     prefers-reduced-motion (ahí solo cambia con los dots).
   Solo presentación: no toca lógica de negocio.
   ====================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var AUTO_MS = 5000;          // auto-avance
  var OFFSET_MIN = 50;         // px de arrastre para pasar página
  var VELOCITY_MIN = 0.45;     // px/ms — swipe rápido también pasa

  function slideHTML(p, i, total) {
    var theme = (typeof promoThemeClass === 'function')
      ? promoThemeClass(p.theme) : 'pr-theme-green';
    var kind = (typeof PROMO_KIND_LABEL !== 'undefined' && PROMO_KIND_LABEL[p.kind]) || '🔥 Oferta';
    var save = (typeof promoSavePct === 'function') ? promoSavePct(p) : null;
    var media = p.image_url
      ? '<img src="' + escapeHTML(optImg(p.image_url, 800)) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="hp-emoji">' + escapeHTML(p.emoji || '🎉') + '</span>';
    return '' +
      '<a class="hp-slide ' + theme + '" href="promociones.html" ' +
         'role="group" aria-roledescription="promoción" ' +
         'aria-label="' + escapeHTML(p.title) + ' (' + (i + 1) + ' de ' + total + ')" draggable="false">' +
        '<div class="hp-media">' + media + '</div>' +
        '<div class="hp-txt">' +
          '<span class="hp-kind">' + kind + '</span>' +
          '<strong class="hp-title">' + escapeHTML(p.title) + '</strong>' +
          (p.price_usd
            ? '<span class="hp-price">' + fmtPrice(p.price_usd) +
              (save ? ' <em class="hp-save">-' + save + '%</em>' : '') + '</span>'
            : (p.badge ? '<span class="hp-price">' + escapeHTML(p.badge) + '</span>' : '')) +
        '</div>' +
        '<span class="hp-go" aria-hidden="true">→</span>' +
      '</a>';
  }

  async function initHeroPromos(hostId) {
    var host = document.getElementById(hostId);
    if (!host) return;

    var promos = (typeof promosCache !== 'undefined' && promosCache.length)
      ? promosCache
      : (typeof loadPromos === 'function' ? await loadPromos() : []);
    promos = (promos || []).slice(0, 6);

    if (!promos.length) { host.style.display = 'none'; return; }

    host.style.display = '';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-roledescription', 'carrusel');
    host.setAttribute('aria-label', 'Promociones vigentes');
    host.innerHTML =
      '<div class="hp-viewport"><div class="hp-track">' +
        promos.map(function (p, i) { return slideHTML(p, i, promos.length); }).join('') +
      '</div></div>' +
      (promos.length > 1
        ? '<div class="hp-dots" role="tablist">' + promos.map(function (_, i) {
            return '<button role="tab" aria-label="Promoción ' + (i + 1) + '"' +
                   (i === 0 ? ' class="on" aria-selected="true"' : ' aria-selected="false"') + '></button>';
          }).join('') + '</div>'
        : '');

    var track = host.querySelector('.hp-track');
    var viewport = host.querySelector('.hp-viewport');
    var dots = [].slice.call(host.querySelectorAll('.hp-dots button'));
    var idx = 0, timer = null, hovering = false;

    function goTo(i) {
      idx = (i + promos.length) % promos.length;
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      dots.forEach(function (d, j) {
        d.classList.toggle('on', j === idx);
        d.setAttribute('aria-selected', j === idx ? 'true' : 'false');
      });
    }

    function play() {
      stop();
      if (REDUCED || promos.length < 2) return;
      timer = setInterval(function () { if (!hovering) goTo(idx + 1); }, AUTO_MS);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    dots.forEach(function (d, i) {
      d.addEventListener('click', function () { goTo(i); play(); });
    });

    host.addEventListener('mouseenter', function () { hovering = true; });
    host.addEventListener('mouseleave', function () { hovering = false; });

    // Pausa con pestaña oculta (no quemar CPU/batería en background)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stop(); else play();
    });

    // ---- Arrastre / swipe (pointer events: mouse + táctil) ----
    var drag = null;
    viewport.addEventListener('pointerdown', function (e) {
      drag = { x0: e.clientX, t0: performance.now(), moved: false };
      track.style.transition = 'none';
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 6) drag.moved = true;
      track.style.transform =
        'translateX(calc(' + (-idx * 100) + '% + ' + dx + 'px))';
    });
    function endDrag(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x0;
      var vel = Math.abs(dx) / Math.max(1, performance.now() - drag.t0);
      track.style.transition = '';
      // Umbral explícito: distancia O velocidad (nunca solo velocidad)
      if (dx < -OFFSET_MIN || (dx < -12 && vel > VELOCITY_MIN)) goTo(idx + 1);
      else if (dx > OFFSET_MIN || (dx > 12 && vel > VELOCITY_MIN)) goTo(idx - 1);
      else goTo(idx);
      // Si hubo arrastre real, el click posterior no debe navegar.
      // Solo tras pointerup: pointercancel no genera click, y el listener
      // once:true quedaría armado tragándose el siguiente clic legítimo.
      if (drag.moved && e.type === 'pointerup') {
        var swallow = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
        host.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(function () {
          host.removeEventListener('click', swallow, { capture: true });
        }, 350);
      }
      drag = null;
      play();
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    goTo(0);
    play();
  }

  window.initHeroPromos = initHeroPromos;
})();
