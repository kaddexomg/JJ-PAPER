/* ======================================================
   JJ Paper — Logo 3D interactivo (canvas, vanilla, aislado)
   ------------------------------------------------------
   - Chapa con el LOGO OFICIAL (disco verde + anillo claro +
     monograma JJ + PAPER + tagline) girando en 3D (eje Y).
   - Dos modos:
       * contenedor (default): <div data-jj-logo3d></div>
       * fondo:               <div data-jj-logo3d="bg"></div>
         → cubre a su padre, pointer-events:none, reacciona a
           mouse/scroll/clic GLOBALES. Es la "simulación de
           video" detrás del contenido del hero.
   - Click/tap = burst de partículas + impulso de giro + onda.
   - Respeta prefers-reduced-motion. Pausa fuera de pantalla.

   USO:
     <div data-jj-logo3d style="width:420px;height:420px"></div>
     <div data-jj-logo3d="bg"></div>   (dentro de un position:relative)
   O manual: JJLogo3D.mount(el, { opciones })
   ====================================================== */
(function () {
  'use strict';

  var BRAND = {
    deep:  '#003333',   /* verde profundo (canto/cara trasera) */
    disc:  '#16604A',   /* verde del disco del logo */
    disc2: '#1B6F56',   /* disco iluminado */
    ring:  '#A7D7A0',   /* anillo verde claro */
    lime:  '#99CC33',   /* lima martian (halo/partículas) */
    amber: '#C9A24B',   /* dorado latón apagado (chispas) */
    white: '#ffffff'
  };

  /* Monograma JJ — MISMOS paths que assets/img/logo.svg (espacio 512×512) */
  var JJ_PATHS = [
    'M208 152 L254 152 L254 252 C254 298 224 318 184 318 C156 318 136 306 128 286 L126 272 C140 284 162 290 182 287 C202 283 208 270 208 252 Z',
    'M286 92 L344 92 L344 248 C344 330 300 366 230 366 C196 366 168 352 154 330 L150 314 C166 332 194 342 226 338 C272 332 286 300 286 248 Z'
  ];

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Carga de la serif del "PAPER"; se redibuja al estar lista */
  var serifReady = false;
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 60px "Playfair Display"').then(function () {
      serifReady = true;
    }).catch(function () {});
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- Instancia por contenedor ---------------------------------
  function LogoScene(host, opts) {
    opts = opts || {};
    this.host = host;
    this.opts = opts;
    this.bg = opts.mode === 'bg';
    /* bg cubre todo el hero: DPR limitado para no saturar GPU */
    this.dpr = Math.min(window.devicePixelRatio || 1, this.bg ? 1.25 : 2);

    var cv = document.createElement('canvas');
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    if (!this.bg) cv.style.cursor = 'pointer';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', opts.label || 'Logo JJ Paper animado');
    host.appendChild(cv);
    this.cv = cv;
    this.ctx = cv.getContext('2d');

    // Path2D del monograma (una sola vez)
    this.jj = JJ_PATHS.map(function (d) { return new Path2D(d); });

    // Estado de animación
    this.spin = 0;
    this.spinVel = reduce ? 0 : 0.012;
    this.tiltX = 0; this.tiltY = 0;
    this.tiltXc = 0; this.tiltYc = 0;
    this.camX = 0; this.camY = 0;
    this.camXc = 0; this.camYc = 0;
    this.scrollPar = 0; this.scrollParC = 0;   // parallax vertical (modo bg)
    this.pointer = { x: 0.5, y: 0.5, inside: false };
    this.particles = [];
    this.bursts = [];
    this.ripples = [];
    this.hoverPulse = 0;
    this.running = false;
    this.t = 0;

    this._initParticles(reduce ? 14 : (this.bg ? 46 : 34));
    this._bind();
    this._resize();

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
        a: Math.random() * Math.PI * 2,
        r: 0.62 + Math.random() * (this.bg ? 0.9 : 0.55),
        sp: (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1),
        ph: Math.random() * Math.PI * 2,
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
      var dx = self.pointer.x - 0.5, dy = self.pointer.y - 0.5;
      self.tiltY = dx * 0.6;
      self.tiltX = -dy * 0.5;
      self.camX = dx * 26;
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

    // Mouse mueve la cámara/inclinación aunque esté fuera del canvas
    this._onWinMove = function (e) {
      if (!self.bg && self.pointer.inside) return;
      var rect = self.cv.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var dx = clamp((e.clientX - cx) / (window.innerWidth / 2), -1, 1);
      var dy = clamp((e.clientY - cy) / (window.innerHeight / 2), -1, 1);
      var k = self.bg ? 1 : 0.5;
      self.tiltY = dx * 0.5 * k;
      self.tiltX = -dy * 0.42 * k;
      self.camX = dx * (self.bg ? 34 : 14);
      self.camY = dy * (self.bg ? 22 : 14);
    };

    // Modo bg: el canvas no recibe eventos (pointer-events:none) →
    // capturamos clics del documento que caigan dentro del host.
    this._onDocDown = function (e) {
      var rect = self.cv.getBoundingClientRect();
      var px = e.clientX, py = e.clientY;
      if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) return;
      self._click((px - rect.left) * self.dpr, (py - rect.top) * self.dpr);
    };

    // Flechas: ← → impulso de giro, ↑ ↓ cabeceo
    this._onKey = function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft')       self.spinVel -= 0.05;
      else if (e.key === 'ArrowRight') self.spinVel += 0.05;
      else if (e.key === 'ArrowUp')    self.tiltX = clamp(self.tiltX + 0.15, -0.5, 0.5);
      else if (e.key === 'ArrowDown')  self.tiltX = clamp(self.tiltX - 0.15, -0.5, 0.5);
    };

    // Scroll: giro extra + cabeceo + parallax vertical (bg)
    this._lastScrollY = window.scrollY || 0;
    this._onScroll = function () {
      var y = window.scrollY || 0;
      var dy = y - self._lastScrollY;
      self._lastScrollY = y;
      self.spinVel += clamp(dy * (self.bg ? 0.0008 : 0.0004), -0.03, 0.03);
      if (self.bg) self.scrollPar = y;
      if (!self.pointer.inside) {
        self.tiltX = clamp(-dy * 0.004, -0.35, 0.35);
        clearTimeout(self._scrollT);
        self._scrollT = setTimeout(function () {
          if (!self.pointer.inside) self.tiltX = 0;
        }, 160);
      }
    };

    if (this.bg) {
      document.addEventListener('pointerdown', this._onDocDown, { passive: true });
    } else {
      this.cv.addEventListener('mousemove', this._onMove);
      this.cv.addEventListener('mouseenter', this._onMove);
      this.cv.addEventListener('mouseleave', this._onLeave);
      this.cv.addEventListener('mousedown', this._onDown);
      this.cv.addEventListener('touchstart', this._onDown, { passive: true });
      this.cv.addEventListener('touchmove', this._onMove, { passive: true });
      this.cv.addEventListener('touchend', this._onLeave);
    }
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
    if (this.bg) {
      // Desktop: chapa hacia la derecha (columna visual); mobile: centrada
      var mobile = window.innerWidth <= 992;
      this.cx = this.W * (mobile ? 0.5 : 0.72);
      this.cy = this.H * (mobile ? 0.44 : 0.50);
      this.R = Math.min(this.W, this.H) * (mobile ? 0.34 : 0.36);
    } else {
      this.cx = this.W / 2; this.cy = this.H / 2;
      this.R = Math.min(this.W, this.H) * 0.30;
    }
    if (!this.running) this._draw();
  };

  LogoScene.prototype._click = function (x, y) {
    this.spinVel += (this.spinVel >= 0 ? 1 : -1) * 0.18;
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
    this.tiltXc = lerp(this.tiltXc, this.tiltX, 0.08);
    this.tiltYc = lerp(this.tiltYc, this.tiltY, 0.08);
    this.camXc = lerp(this.camXc, this.camX, 0.07);
    this.camYc = lerp(this.camYc, this.camY, 0.07);
    this.scrollParC = lerp(this.scrollParC, this.scrollPar, 0.09);

    var base = reduce ? 0 : 0.012;
    this.spinVel = lerp(this.spinVel, base * (this.spinVel >= 0 ? 1 : -1), 0.03);
    this.spin += this.spinVel + this.tiltYc * 0.04;

    this.hoverPulse = lerp(this.hoverPulse, this.pointer.inside ? 1 : 0, 0.1);

    for (var i = this.bursts.length - 1; i >= 0; i--) {
      var b = this.bursts[i];
      b.x += b.vx; b.y += b.vy; b.vx *= 0.94; b.vy *= 0.94;
      b.life -= 0.02;
      if (b.life <= 0) this.bursts.splice(i, 1);
    }
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
    var cx = this.cx + camx;
    var cy = this.cy + camy - (this.bg ? this.scrollParC * 0.22 * this.dpr : 0);
    var R = this.R * (1 + this.hoverPulse * 0.04);

    // Halo lima suave detrás (acotado a la zona de la chapa: es más barato)
    var halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    halo.addColorStop(0, 'rgba(153,204,51,' + (0.16 + this.hoverPulse * 0.10) + ')');
    halo.addColorStop(1, 'rgba(153,204,51,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4);

    this._drawParticles(ctx, cx, cy, R, -1);
    this._drawCoin(ctx, cx, cy, R);
    this._drawParticles(ctx, cx, cy, R, 1);

    for (var i = 0; i < this.ripples.length; i++) {
      var rp = this.ripples[i];
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(167,215,160,' + (rp.life * 0.5) + ')';
      ctx.lineWidth = 2 * this.dpr;
      ctx.stroke();
    }
    for (var k = 0; k < this.bursts.length; k++) {
      var b = this.bursts[k];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.sz * b.life, 0, Math.PI * 2);
      ctx.fillStyle = this._tone(b.tone, b.life);
      ctx.fill();
    }
  };

  /* Partículas: verde anillo / lima / chispas ámbar */
  LogoScene.prototype._tone = function (t, alpha) {
    var c = t < 0.45 ? BRAND.ring : (t < 0.85 ? BRAND.lime : BRAND.amber);
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
      var z = Math.cos(a);
      if ((side < 0 && z >= 0) || (side > 0 && z < 0)) continue;
      var orb = R * (1.35 * p.r);
      var x = cx + Math.sin(a) * orb;
      var y = cy + Math.sin(this.t * 0.01 + p.ph) * R * 0.28
                 + Math.cos(a) * orb * tilt * 0.5;
      var depth = (z + 1) / 2;
      var sz = p.sz * (0.5 + depth) * this.dpr;
      var al = 0.15 + depth * 0.55;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fillStyle = this._tone(p.tone, al);
      ctx.fill();
    }
  };

  /* Badge oficial en espacio 512×512 centrado en (0,0).
     k = R/256. La compresión X (wface) la aplica el caller. */
  LogoScene.prototype._drawBadge = function (ctx, R, backFace) {
    var k = R / 256;
    ctx.save();
    ctx.scale(k, k);
    if (backFace) ctx.scale(-1, 1);   // cara trasera = espejo (como moneda real)
    ctx.translate(-256, -256);

    // Anillo verde claro
    ctx.beginPath();
    ctx.arc(256, 256, 244, 0, Math.PI * 2);
    ctx.strokeStyle = BRAND.ring;
    ctx.lineWidth = 9;
    ctx.stroke();

    // Disco verde (gradiente sutil para volumen)
    var dg = ctx.createLinearGradient(60, 40, 452, 472);
    dg.addColorStop(0, BRAND.disc2);
    dg.addColorStop(1, BRAND.disc);
    ctx.beginPath();
    ctx.arc(256, 256, 230, 0, Math.PI * 2);
    ctx.fillStyle = dg;
    ctx.fill();

    // Monograma JJ
    ctx.fillStyle = BRAND.white;
    for (var i = 0; i < this.jj.length; i++) ctx.fill(this.jj[i]);

    // PAPER (serif) + tagline
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var serif = serifReady ? '"Playfair Display", Georgia, serif' : 'Georgia, serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
    ctx.font = '600 62px ' + serif;
    ctx.fillText('PAPER', 261, 414);   // +5px compensa el letter-spacing final
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.font = '600 17px Montserrat, Arial, sans-serif';
    ctx.fillStyle = BRAND.ring;
    ctx.fillText('TU MEJOR OPCIÓN', 258, 450);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.strokeStyle = BRAND.ring;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(106, 444); ctx.lineTo(130, 444);
    ctx.moveTo(386, 444); ctx.lineTo(410, 444); ctx.stroke();

    ctx.restore();
  };

  /* Chapa: badge comprimido horizontalmente por cos(spin) → 3D eje Y */
  LogoScene.prototype._drawCoin = function (ctx, cx, cy, R) {
    var s = Math.cos(this.spin);
    var wface = Math.abs(s);
    var tiltX = this.tiltXc;
    var rimDepth = R * 0.10;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 1 - Math.abs(tiltX) * 0.18);

    // Canto (grosor) visible de perfil
    if (wface < 0.98) {
      var eg = ctx.createLinearGradient(-R, 0, R, 0);
      eg.addColorStop(0, BRAND.deep);
      eg.addColorStop(0.5, BRAND.disc2);
      eg.addColorStop(1, BRAND.deep);
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * wface + rimDepth, R, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cara: badge oficial comprimido. Clip elíptico por seguridad.
    var faceW = Math.max(R * wface, 1);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, faceW, R, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.scale(Math.max(wface, 0.02), 1);
    this._drawBadge(ctx, R, s < 0);
    ctx.restore();

    // Cara trasera ligeramente oscurecida
    if (s < 0) {
      ctx.beginPath();
      ctx.ellipse(0, 0, faceW, R, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,51,51,0.30)';
      ctx.fill();
    }

    // Brillo especular que sigue al mouse
    var gx = this.tiltYc * faceW * 1.6;
    var gl = ctx.createRadialGradient(gx, -R * 0.4, 1, gx, -R * 0.4, R * 1.2);
    gl.addColorStop(0, 'rgba(255,255,255,' + (0.22 * wface) + ')');
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
    if (this.bg) {
      document.removeEventListener('pointerdown', this._onDocDown);
    } else {
      this.cv.removeEventListener('mousemove', this._onMove);
      this.cv.removeEventListener('mouseenter', this._onMove);
      this.cv.removeEventListener('mouseleave', this._onLeave);
      this.cv.removeEventListener('mousedown', this._onDown);
      this.cv.removeEventListener('touchstart', this._onDown);
      this.cv.removeEventListener('touchmove', this._onMove);
      this.cv.removeEventListener('touchend', this._onLeave);
    }
    window.removeEventListener('mousemove', this._onWinMove);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('scroll', this._onScroll);
    clearTimeout(this._scrollT);
    window.removeEventListener('resize', this._onResize);
    if (this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
  };

  // ---- API pública ----------------------------------------------
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
      for (var i = 0; i < nodes.length; i++) {
        var mode = nodes[i].getAttribute('data-jj-logo3d') === 'bg' ? 'bg' : '';
        API.mount(nodes[i], mode ? { mode: 'bg' } : {});
      }
    }
  };
  window.JJLogo3D = API;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', API.auto);
  } else {
    API.auto();
  }
})();
