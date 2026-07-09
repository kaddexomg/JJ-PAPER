/* ======================================================
   JJ Paper — Motion Pack (JS)
   Parallax, count-up, tilt 3D, botones magnéticos, ripple,
   partículas de papel y cursor glow.
   Auto-init, idempotente, respeta prefers-reduced-motion.
   Uso:
     [data-parallax="0.15"]     capa que se mueve con scroll/mouse
     [data-count="58"]          número que cuenta 0→58 al entrar en viewport
     .tilt   (opcional .tilt-inner)   tarjeta con inclinación 3D
     .magnetic                  botón/elemento que sigue al cursor + ripple
     .rv-up/.rv-left/.rv-right/.rv-zoom   reveal direccional (usa reveal.js .vi)
     .rv-stagger  en el padre    aplica retraso escalonado a hijos rv-*
   ====================================================== */
(function () {
  'use strict';

  const REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE_POINTER = window.matchMedia &&
    window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 1. Parallax (scroll + mouse) con rAF ---------- */
  function initParallax() {
    if (REDUCED) return;
    const nodes = [...document.querySelectorAll('[data-parallax]')];
    if (!nodes.length) return;
    let mx = 0, my = 0, ticking = false;

    function apply() {
      const sy = window.scrollY || 0;
      nodes.forEach(n => {
        const sp = parseFloat(n.dataset.parallax) || 0.12;
        const ty = -sy * sp + my * sp * 40;
        const tx = mx * sp * 40;
        n.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0)`;
      });
      ticking = false;
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(apply); } }

    window.addEventListener('scroll', req, { passive: true });
    if (FINE_POINTER) {
      window.addEventListener('mousemove', e => {
        mx = (e.clientX / window.innerWidth - 0.5);
        my = (e.clientY / window.innerHeight - 0.5);
        req();
      }, { passive: true });
    }
    apply();
  }

  /* ---------- 2. Count-up al entrar en viewport ---------- */
  // Anima un nodo hasta data-count. Cancela cualquier animación previa
  // del mismo nodo (para reasignar el objetivo con datos en vivo).
  function runCount(el) {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const suffix = el.dataset.countSuffix || '';
    const dur = parseInt(el.dataset.countDur) || 1400;
    const isInt = Number.isInteger(target);
    const fmt = n => isInt ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
    if (el._countRAF) cancelAnimationFrame(el._countRAF);
    if (REDUCED) { el.textContent = fmt(target) + suffix; return; }
    const start = performance.now();
    (function tick(now) {
      const p = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);        // easeOutCubic
      el.textContent = fmt(target * eased) + suffix;
      if (p < 1) el._countRAF = requestAnimationFrame(tick);
    })(start);
  }

  // Reasigna el objetivo y re-anima (para conteos con datos en vivo).
  function recount(el, value, suffix) {
    if (!el) return;
    if (value != null) el.dataset.count = value;
    if (suffix != null) el.dataset.countSuffix = suffix;
    el._counted = true;
    runCount(el);
  }

  function initCountUp() {
    const nodes = [...document.querySelectorAll('[data-count]')];
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) { nodes.forEach(n => { n._counted = true; runCount(n); }); return; }
    const io = new IntersectionObserver((ents) => {
      ents.forEach(e => {
        if (e.isIntersecting) { e.target._counted = true; runCount(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    nodes.forEach(n => io.observe(n));
  }

  /* ---------- 3. Reveal escalonado (delays a hijos) ---------- */
  function initStagger() {
    document.querySelectorAll('.rv-stagger').forEach(parent => {
      const kids = parent.querySelectorAll(':scope > .rv-up, :scope > .rv-left, :scope > .rv-right, :scope > .rv-zoom, :scope > .rv');
      kids.forEach((k, i) => k.style.setProperty('--rv-delay', (i * 90) + 'ms'));
    });
  }

  /* ---------- 4. Tilt 3D ---------- */
  function initTilt() {
    if (REDUCED || !FINE_POINTER) return;
    document.querySelectorAll('.tilt').forEach(card => {
      const MAX = parseFloat(card.dataset.tilt) || 8;
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(700px) rotateY(${(px * MAX).toFixed(2)}deg) rotateX(${(-py * MAX).toFixed(2)}deg)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(700px) rotateX(0) rotateY(0)';
      });
    });
  }

  /* ---------- 5. Botón magnético (física de resorte) + ripple ---------- */
  // Resorte real: el botón persigue al cursor con inercia y suelta con rebote,
  // en vez de pegarse linealmente (se siente vivo, no de plantilla).
  function initMagnetic() {
    document.querySelectorAll('.magnetic').forEach(el => {
      if (FINE_POINTER && !REDUCED) {
        const STR = parseFloat(el.dataset.magnet) || 0.3;
        const K = 0.14, DAMP = 0.72;          // rigidez y amortiguación
        let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, raf = null;

        function step() {
          vx = (vx + (tx - x) * K) * DAMP;
          vy = (vy + (ty - y) * K) * DAMP;
          x += vx; y += vy;
          el.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
          if (Math.abs(vx) + Math.abs(vy) + Math.abs(tx - x) + Math.abs(ty - y) > 0.05) {
            raf = requestAnimationFrame(step);
          } else {
            el.style.transform = (tx || ty) ? el.style.transform : '';
            raf = null;
          }
        }
        function wake() { if (!raf) raf = requestAnimationFrame(step); }

        el.addEventListener('mousemove', e => {
          const r = el.getBoundingClientRect();
          tx = (e.clientX - r.left - r.width / 2) * STR;
          ty = (e.clientY - r.top - r.height / 2) * STR;
          wake();
        });
        el.addEventListener('mouseleave', () => { tx = 0; ty = 0; wake(); });
      }
      // Ripple en clic (siempre, salvo reduced)
      el.addEventListener('click', e => {
        if (REDUCED) return;
        const r = el.getBoundingClientRect();
        const ink = document.createElement('span');
        const size = Math.max(r.width, r.height);
        ink.className = 'ripple-ink';
        ink.style.width = ink.style.height = size + 'px';
        ink.style.left = (e.clientX - r.left - size / 2) + 'px';
        ink.style.top = (e.clientY - r.top - size / 2) + 'px';
        el.appendChild(ink);
        setTimeout(() => ink.remove(), 620);
      });
    });
  }

  /* ---------- 5b. Título palabra por palabra ---------- */
  // [data-word-reveal] envuelve cada palabra en un span con retraso
  // escalonado, preservando <em>, <br> y demás hijos.
  function initWordReveal() {
    document.querySelectorAll('[data-word-reveal]').forEach(host => {
      if (host._wordsDone) return;
      host._wordsDone = true;
      if (REDUCED) return;
      let i = 0;
      (function wrap(node) {
        [...node.childNodes].forEach(child => {
          if (child.nodeType === 3) {           // texto → palabras
            const frag = document.createDocumentFragment();
            child.textContent.split(/(\s+)/).forEach(tk => {
              if (!tk) return;
              if (/^\s+$/.test(tk)) { frag.appendChild(document.createTextNode(tk)); return; }
              const s = document.createElement('span');
              s.className = 'wr-w';
              s.style.transitionDelay = (i++ * 70) + 'ms';
              s.textContent = tk;
              frag.appendChild(s);
            });
            node.replaceChild(frag, child);
          } else if (child.nodeType === 1 && child.tagName !== 'BR') {
            wrap(child);                        // <em> u otros → recursivo
          }
        });
      })(host);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => host.classList.add('wr-in')));
    });
  }

  /* ---------- 6. Partículas de papel (canvas) ---------- */
  function initParticles() {
    if (REDUCED) return;
    const host = document.querySelector('[data-particles]');
    if (!host) return;
    const cv = document.createElement('canvas');
    cv.className = 'particles';
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    let w, h, parts = [];
    const COUNT = clamp(Math.round((host.clientWidth || 1200) / 26), 14, 46);

    function resize() {
      w = cv.width = host.clientWidth;
      h = cv.height = host.clientHeight;
    }
    function mk() {
      return {
        x: Math.random() * w, y: Math.random() * h,
        s: 1.5 + Math.random() * 3.5,
        vx: -0.25 + Math.random() * 0.5,
        vy: 0.15 + Math.random() * 0.5,
        rot: Math.random() * Math.PI, vr: -0.02 + Math.random() * 0.04,
        a: 0.15 + Math.random() * 0.35
      };
    }
    function seed() { parts = Array.from({ length: COUNT }, mk); }
    let running = false, raf = null;
    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.fillRect(-p.s, -p.s, p.s * 2, p.s * 2);
        ctx.restore();
      });
      raf = requestAnimationFrame(frame);
    }
    function play() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); }
    resize(); seed(); play();
    window.addEventListener('resize', () => { resize(); seed(); }, { passive: true });
    // Pausa con pestaña oculta: la animación infinita no quema CPU/GPU en background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop(); else play();
    });
  }

  /* ---------- 7. Cursor glow ---------- */
  function initCursorGlow() {
    if (REDUCED || !FINE_POINTER) return;
    if (!document.body.hasAttribute('data-cursor-glow')) return;
    const g = document.createElement('div');
    g.className = 'cursor-glow';
    document.body.appendChild(g);
    let x = 0, y = 0, cx = 0, cy = 0, on = false;
    window.addEventListener('mousemove', e => {
      x = e.clientX; y = e.clientY;
      if (!on) { on = true; g.style.opacity = '1'; }
    }, { passive: true });
    (function loop() {
      cx += (x - cx) * 0.15; cy += (y - cy) * 0.15;
      g.style.left = cx + 'px'; g.style.top = cy + 'px';
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- init ---------- */
  function boot(root) {
    initParallax();
    initCountUp();
    initStagger();
    initTilt();
    initMagnetic();
    initWordReveal();
    initParticles();
    initCursorGlow();
  }
  window.JJMotion = { boot, recount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else { boot(); }
})();
