/* ======================================================
   JJ Paper — Logo 3D interactivo (canvas, vanilla, aislado)
   ------------------------------------------------------
   - Moneda "JJ" que gira en 3D (rotación eje Y simulada).
   - Sigue la DIRECCIÓN del mouse: cámara/parallax + tilt.
   - Click = burst de partículas + impulso de giro + onda.
   - Partículas en órbita con profundidad (z-sort).
   - 100% autónomo: IIFE, no toca window salvo JJLogo3D.
   - Respeta prefers-reduced-motion. Pausa fuera de pantalla.

   USO:
     <div data-jj-logo3d style="width:420px;height:420px"></div>
   (auto-monta al cargar). O manual:
     JJLogo3D.mount(el, { opciones })
   ====================================================== */
(function () {
  'use strict';

  var BRAND = {
    dark:  '#106B3A',
    mid:   '#2BB673',
    mint:  '#77C99B',
    teal:  '#2E9E8B',
    white: '#ffffff'
  };

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- Instancia por contenedor ---------------------------------
  function LogoScene(host, opts) {
    opts = opts || {};
    this.host = host;
    this.opts = opts;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    var cv = document.createElement('canvas');
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    cv.style.cursor = 'pointer';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', opts.label || 'Logo JJ Paper animado');
    host.appendChild(cv);
    this.cv = cv;
    this.ctx = cv.getContext('2d');

    // Estado de animación
    this.spin = 0;            // ángulo de giro (rad)
    this.spinVel = reduce ? 0 : 0.012; // velocidad base
    this.tiltX = 0; this.tiltY = 0;      // inclinación destino (mouse)
    this.tiltXc = 0; this.tiltYc = 0;    // inclinación actual (suavizada)
    this.camX = 0; this.camY = 0;        // parallax destino
    this.camXc = 0; this.camYc = 0;      // parallax actual
    this.pointer = { x: 0.5, y: 0.5, inside: false };
    this.particles = [];
    this.bursts = [];
    this.ripples = [];
    this.hoverPulse = 0;
    this.running = false;
    this.t = 0;

    this._initParticles(reduce ? 14 : 34);
    this._bind();
    this._resize();

    // Pausa cuando no es visible (ahorra CPU, no interfiere con la página)
    var self = this;
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (e.isIntersecting) self.start(); else self.stop();
        });
      }, { threshold: 0.05 });
      this.io.observe(host);
    } else {
      this.start();
    }
  }

  LogoScene.prototype._initParticles = function (n) {
    this.particles.length = 0;
    for (var i = 0; i < n; i++) {
      this.particles.push({
        a: Math.random() * Math.PI * 2,        // ángulo orbital
        r: 0.62 + Math.random() * 0.55,        // radio (× radio moneda)
        sp: (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1),
        ph: Math.random() * Math.PI * 2,       // fase vertical
        sz: 1.5 + Math.random() * 3,
        tone: Math.random()
      });
    }
  };

  LogoScene.prototype._bind = function () {
    var self = this;
    this._onMove = function (e) {
      var rect = self.cv.getBoundingClientRect();
      var px = e.touches ? e.touches[0].clientX : e.clientX;
      var py = e.touches ? e.touches[0].clientY : e.clientY;
      self.pointer.x = clamp((px - rect.left) / rect.width, 0, 1);
      self.pointer.y = clamp((py - rect.top) / rect.height, 0, 1);
      self.pointer.inside = true;
      // Dirección relativa al centro → tilt + parallax de cámara
      var dx = self.pointer.x - 0.5, dy = self.pointer.y - 0.5;
      self.tiltY = dx * 0.6;           // giro extra según X del mouse
      self.tiltX = -dy * 0.5;          // cabeceo según Y
      self.camX = dx * 26;             // desplazamiento cámara (px)
      self.camY = dy * 26;
    };
    this._onLeave = function () {
      self.pointer.inside = false;
      self.tiltX = self.tiltY = 0;
      self.camX = self.camY = 0;
    };
    this._onDown = function (e) {
      var rect = self.cv.getBoundingClientRect();
      var px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      self._click(px * self.dpr, py * self.dpr);
    };

    // Mouse mueve la CÁMARA aunque el cursor esté fuera del canvas
    // (seguimiento global de dirección, sin capturar clicks ajenos)
    this._onWinMove = function (e) {
      if (self.pointer.inside) return; // dentro manda el handler local
      var rect = self.cv.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var dx = clamp((e.clientX - cx) / (window.innerWidth / 2), -1, 1);
      var dy = clamp((e.clientY - cy) / (window.innerHeight / 2), -1, 1);
      self.tiltY = dx * 0.28;
      self.tiltX = -dy * 0.24;
      self.camX = dx * 14;
      self.camY = dy * 14;
    };

    // Flechas del teclado: ← → dan impulso de giro, ↑ ↓ cabecean la chapa
    this._onKey = function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft')       self.spinVel -= 0.05;
      else if (e.key === 'ArrowRight') self.spinVel += 0.05;
      else if (e.key === 'ArrowUp')    self.tiltX = clamp(self.tiltX + 0.15, -0.5, 0.5);
      else if (e.key === 'ArrowDown')  self.tiltX = clamp(self.tiltX - 0.15, -0.5, 0.5);
    };

    // Scroll: la chapa se inclina según la velocidad del desplazamiento
    this._lastScrollY = window.scrollY || 0;
    this._onScroll = function () {
      var y = window.scrollY || 0;
      var dy = y - self._lastScrollY;
      self._lastScrollY = y;
      if (!self.pointer.inside) {
        self.tiltX = clamp(-dy * 0.004, -0.35, 0.35);
        self.spinVel += clamp(dy * 0.0004, -0.02, 0.02);
        // Al dejar de hacer scroll vuelve suave a su posición
        clearTimeout(self._scrollT);
        self._scrollT = setTimeout(function () {
          if (!self.pointer.inside) self.tiltX = 0;
        }, 160);
      }
    };

    this.cv.addEventListener('mousemove', this._onMove);
    this.cv.addEventListener('mouseenter', this._onMove);
    this.cv.addEventListener('mouseleave', this._onLeave);
    this.cv.addEventListener('mousedown', this._onDown);
    this.cv.addEventListener('touchstart', this._onDown, { passive: true });
    this.cv.addEventListener('touchmove', this._onMove, { passive: true });
    this.cv.addEventListener('touchend', this._onLeave);
    if (!reduce) {
      window.addEventListener('mousemove', this._onWinMove);
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }

    this._onResize = function () { self._resize(); };
    window.addEventListener('resize', this._onResize);
  };

  LogoScene.prototype._resize = function () {
    var r = this.host.getBoundingClientRect();
    var w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.W = this.cv.width; this.H = this.cv.height;
    this.cx = this.W / 2; this.cy = this.H / 2;
    this.R = Math.min(this.W, this.H) * 0.30; // radio moneda
    if (!this.running) this._draw(); // frame estático si está pausado
  };

  LogoScene.prototype._click = function (x, y) {
    this.spinVel += (this.spinVel >= 0 ? 1 : -1) * 0.18; // impulso de giro
    this.ripples.push({ x: x, y: y, r: 0, life: 1 });
    var n = reduce ? 8 : 26;
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      var sp = (2 + Math.random() * 5) * this.dpr;
      this.bursts.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1, sz: (1.5 + Math.random() * 3) * this.dpr,
        tone: Math.random()
      });
    }
  };

  LogoScene.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var self = this;
    (function loop() {
      if (!self.running) return;
      self._step();
      self._draw();
      self._raf = requestAnimationFrame(loop);
    })();
  };

  LogoScene.prototype.stop = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  };

  LogoScene.prototype._step = function () {
    this.t += 1;
    // Suavizado (easing) hacia destinos
    this.tiltXc = lerp(this.tiltXc, this.tiltX, 0.08);
    this.tiltYc = lerp(this.tiltYc, this.tiltY, 0.08);
    this.camXc = lerp(this.camXc, this.camX, 0.07);
    this.camYc = lerp(this.camYc, this.camY, 0.07);

    // Giro con retorno a velocidad base
    var base = reduce ? 0 : 0.012;
    this.spinVel = lerp(this.spinVel, base * (this.spinVel >= 0 ? 1 : -1), 0.03);
    this.spin += this.spinVel + this.tiltYc * 0.04;

    this.hoverPulse = lerp(this.hoverPulse, this.pointer.inside ? 1 : 0, 0.1);

    // Bursts
    for (var i = this.bursts.length - 1; i >= 0; i--) {
      var b = this.bursts[i];
      b.x += b.vx; b.y += b.vy; b.vx *= 0.94; b.vy *= 0.94;
      b.life -= 0.02;
      if (b.life <= 0) this.bursts.splice(i, 1);
    }
    // Ripples
    for (var j = this.ripples.length - 1; j >= 0; j--) {
      var rp = this.ripples[j];
      rp.r += this.R * 0.06; rp.life -= 0.03;
      if (rp.life <= 0) this.ripples.splice(j, 1);
    }
  };

  LogoScene.prototype._draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    var camx = this.camXc * this.dpr, camy = this.camYc * this.dpr;
    var cx = this.cx + camx, cy = this.cy + camy;
    var R = this.R * (1 + this.hoverPulse * 0.04);

    // Halo suave detrás
    var halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    halo.addColorStop(0, 'rgba(43,182,115,' + (0.20 + this.hoverPulse * 0.12) + ')');
    halo.addColorStop(1, 'rgba(43,182,115,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Partículas detrás (z<0)
    this._drawParticles(ctx, cx, cy, R, -1);

    // Moneda 3D
    this._drawCoin(ctx, cx, cy, R);

    // Partículas delante (z>0)
    this._drawParticles(ctx, cx, cy, R, 1);

    // Ripples de click
    for (var i = 0; i < this.ripples.length; i++) {
      var rp = this.ripples[i];
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(119,201,155,' + (rp.life * 0.5) + ')';
      ctx.lineWidth = 2 * this.dpr;
      ctx.stroke();
    }
    // Burst de click
    for (var k = 0; k < this.bursts.length; k++) {
      var b = this.bursts[k];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.sz * b.life, 0, Math.PI * 2);
      ctx.fillStyle = this._tone(b.tone, b.life);
      ctx.fill();
    }
  };

  LogoScene.prototype._tone = function (t, alpha) {
    var c = t < 0.5 ? BRAND.mint : BRAND.mid;
    return this._rgba(c, alpha == null ? 1 : alpha);
  };
  LogoScene.prototype._rgba = function (hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };

  LogoScene.prototype._drawParticles = function (ctx, cx, cy, R, side) {
    var tilt = this.tiltXc;
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var a = p.a + this.spin * 0.25 * p.sp;
      var z = Math.cos(a);                // profundidad -1..1
      if ((side < 0 && z >= 0) || (side > 0 && z < 0)) continue;
      var orb = R * (1.35 * p.r);
      var x = cx + Math.sin(a) * orb;
      var y = cy + Math.sin(this.t * 0.01 + p.ph) * R * 0.28
                 + Math.cos(a) * orb * tilt * 0.5;
      var depth = (z + 1) / 2;            // 0 atrás, 1 frente
      var sz = p.sz * (0.5 + depth) * this.dpr;
      var al = 0.15 + depth * 0.55;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fillStyle = this._tone(p.tone, al);
      ctx.fill();
    }
  };

  // Moneda: elipse comprimida horizontalmente por cos(spin) → 3D eje Y
  LogoScene.prototype._drawCoin = function (ctx, cx, cy, R) {
    var s = Math.cos(this.spin);          // factor de compresión (-1..1)
    var wface = Math.abs(s);              // ancho aparente de la cara
    var tiltX = this.tiltXc;
    var rimDepth = R * 0.12;              // grosor del canto

    ctx.save();
    ctx.translate(cx, cy);
    // Cabeceo vertical según mouse (escala Y sutil)
    ctx.scale(1, 1 - Math.abs(tiltX) * 0.18);

    // --- Canto (grosor) cuando la moneda está de perfil ---
    var edgeX = R * (1 - wface) * 0.0 + rimDepth * (1 - wface);
    if (wface < 0.98) {
      var eg = ctx.createLinearGradient(-R, 0, R, 0);
      eg.addColorStop(0, BRAND.dark);
      eg.addColorStop(0.5, BRAND.teal);
      eg.addColorStop(1, BRAND.dark);
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * wface + rimDepth, R, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Cara (mint) comprimida ---
    var faceW = Math.max(R * wface, 1);
    // Sombra/brillo direccional según lado visible
    var fg = ctx.createLinearGradient(-faceW, -R, faceW, R);
    if (s >= 0) { // cara frontal
      fg.addColorStop(0, BRAND.mint);
      fg.addColorStop(1, '#8fd6ab');
    } else {      // cara trasera (más oscura)
      fg.addColorStop(0, BRAND.teal);
      fg.addColorStop(1, BRAND.dark);
    }
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(0, 0, faceW, R, 0, 0, Math.PI * 2);
    ctx.fill();

    // Anillo teal
    ctx.strokeStyle = BRAND.teal;
    ctx.lineWidth = R * 0.10;
    ctx.beginPath();
    ctx.ellipse(0, 0, faceW * 0.80, R * 0.80, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Monograma JJ (solo legible en cara frontal)
    if (s > 0.12) {
      var alpha = clamp((s - 0.12) / 0.4, 0, 1);
      ctx.save();
      ctx.scale(wface, 1);               // texto se comprime con la cara
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + (R * 1.05) + 'px Georgia, "Times New Roman", serif';
      ctx.fillStyle = this._rgba(BRAND.teal, alpha * 0.5);
      ctx.fillText('JJ', R * 0.03, R * 0.10);
      ctx.fillStyle = this._rgba(BRAND.white, alpha);
      ctx.fillText('JJ', 0, R * 0.06);
      ctx.restore();
    }

    // Brillo especular que sigue al mouse
    var gx = this.tiltYc * faceW * 1.6;
    var gl = ctx.createRadialGradient(gx, -R * 0.4, 1, gx, -R * 0.4, R * 1.2);
    gl.addColorStop(0, 'rgba(255,255,255,' + (0.28 * wface) + ')');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(0, 0, faceW, R, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  LogoScene.prototype.destroy = function () {
    this.stop();
    if (this.io) this.io.disconnect();
    this.cv.removeEventListener('mousemove', this._onMove);
    this.cv.removeEventListener('mouseenter', this._onMove);
    this.cv.removeEventListener('mouseleave', this._onLeave);
    this.cv.removeEventListener('mousedown', this._onDown);
    this.cv.removeEventListener('touchstart', this._onDown);
    this.cv.removeEventListener('touchmove', this._onMove);
    this.cv.removeEventListener('touchend', this._onLeave);
    window.removeEventListener('mousemove', this._onWinMove);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('scroll', this._onScroll);
    clearTimeout(this._scrollT);
    window.removeEventListener('resize', this._onResize);
    if (this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
  };

  // ---- API pública (namespace único, no contamina la lógica) ----
  var API = {
    mount: function (el, opts) {
      if (!el) return null;
      if (el.__jjLogo3D) return el.__jjLogo3D;
      var s = new LogoScene(el, opts || {});
      el.__jjLogo3D = s;
      return s;
    },
    auto: function () {
      var nodes = document.querySelectorAll('[data-jj-logo3d]');
      for (var i = 0; i < nodes.length; i++) API.mount(nodes[i], {});
    }
  };
  window.JJLogo3D = API;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', API.auto);
  } else {
    API.auto();
  }
})();
