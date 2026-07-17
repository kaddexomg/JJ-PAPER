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
   - Motion orgánico: muelles amortiguados (no lerp seco), deriva
     por suma de senos (pasea "viva" por el hero), giro que respira,
     esquiva al cursor y las partículas se apartan de él.
   - Click/tap = burst suave + pop elástico + onda.
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

  /* ============ Útiles de papelería flotantes (modo bg) ============
     Dibujados en vectorial con la paleta de marca + tonos naturales
     (madera, grafito, acero, latón). Cada uno se pre-renderiza UNA vez
     a un sprite (con sombra horneada) y luego solo se hace drawImage:
     mismo costo por frame que un emoji, look consistente en todo OS.
     Espacio de dibujo: 120×120 con centro en (0,0). */
  var INK = {
    wood:  '#E8C99B', wood2: '#D9B98A',
    graph: '#3E3E3E',
    steel: '#CBD5DA', steel2: '#9FAEB5',
    paper: '#FDFDF8', fold:  '#DCE5DC',
    pink:  '#E4A9A0'
  };

  /* Rect redondeado compatible (arcTo: sin depender de ctx.roundRect) */
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function lgrad(g, y0, y1, c0, c1) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    return gr;
  }

  var FLOATER_KINDS = [
    // Lápiz: cuerpo verde marca, madera, grafito, ferrule latón y goma
    function (g) {
      g.rotate(-0.6);
      g.fillStyle = INK.pink; rr(g, -47, -7, 9, 14, 4); g.fill();
      g.fillStyle = BRAND.amber; g.fillRect(-40, -7, 6, 14);
      g.fillStyle = lgrad(g, -7, 7, BRAND.disc2, BRAND.disc);
      g.fillRect(-34, -7, 58, 14);
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-34, -2.5); g.lineTo(24, -2.5);
      g.moveTo(-34, 2.5);  g.lineTo(24, 2.5);
      g.stroke();
      g.fillStyle = INK.wood;
      g.beginPath(); g.moveTo(24, -7); g.lineTo(40, 0); g.lineTo(24, 7);
      g.closePath(); g.fill();
      g.fillStyle = INK.graph;
      g.beginPath(); g.moveTo(34, -2.6); g.lineTo(40, 0); g.lineTo(34, 2.6);
      g.closePath(); g.fill();
    },
    // Clip metálico
    function (g) {
      g.rotate(0.5);
      g.lineCap = 'round'; g.lineWidth = 5;
      g.strokeStyle = lgrad(g, -30, 30, INK.steel, INK.steel2);
      g.beginPath();
      g.moveTo(-11, 14);
      g.lineTo(-11, -16); g.arc(0, -16, 11, Math.PI, 2 * Math.PI);
      g.lineTo(11, 20);   g.arc(3.5, 20, 7.5, 0, Math.PI);
      g.lineTo(-4, -12);  g.arc(0.5, -12, 4.5, Math.PI, 2 * Math.PI);
      g.lineTo(5.5, 12);
      g.stroke();
    },
    // Regla de madera con marcas
    function (g) {
      g.rotate(0.35);
      g.fillStyle = lgrad(g, -9, 9, '#EBD3A7', INK.wood2);
      rr(g, -42, -9, 84, 18, 3); g.fill();
      g.strokeStyle = 'rgba(90,60,20,.55)'; g.lineWidth = 1.4;
      g.beginPath();
      for (var x = -36; x <= 36; x += 6) {
        g.moveTo(x, -9); g.lineTo(x, x % 12 === 0 ? -3 : -5.5);
      }
      g.stroke();
    },
    // Hoja de papel con esquina doblada y renglones
    function (g) {
      g.rotate(-0.25);
      g.fillStyle = INK.paper;
      g.beginPath();
      g.moveTo(-20, -27); g.lineTo(10, -27); g.lineTo(20, -17);
      g.lineTo(20, 27); g.lineTo(-20, 27);
      g.closePath(); g.fill();
      g.fillStyle = INK.fold;
      g.beginPath(); g.moveTo(10, -27); g.lineTo(20, -17); g.lineTo(10, -17);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(22,96,74,.30)'; g.lineWidth = 1.4;
      g.beginPath();
      for (var y = -10; y <= 20; y += 7) { g.moveTo(-14, y); g.lineTo(14, y); }
      g.stroke();
    },
    // Tijeras abiertas en X: hojas de acero cruzadas, pivote latón, aros verdes
    function (g) {
      g.rotate(0.4);
      for (var b = -1; b <= 1; b += 2) {
        g.save();
        g.rotate(b * 0.45);
        // Hoja (arriba) con filo que termina en punta
        g.fillStyle = lgrad(g, -32, 0, INK.steel, INK.steel2);
        g.beginPath();
        g.moveTo(-3.6, 0); g.quadraticCurveTo(-4.2, -18, 0, -31);
        g.quadraticCurveTo(4.2, -18, 3.6, 0);
        g.closePath(); g.fill();
        // Mango (abajo): brazo corto + aro
        g.strokeStyle = BRAND.disc; g.lineWidth = 3.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 9); g.stroke();
        g.beginPath(); g.arc(0, 15.5, 6.2, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      g.fillStyle = BRAND.amber;
      g.beginPath(); g.arc(0, 0, 2.8, 0, Math.PI * 2); g.fill();
    },
    // Goma de borrar con funda verde
    function (g) {
      g.rotate(-0.5);
      g.fillStyle = '#F4F1E8'; rr(g, -18, -10, 36, 20, 5); g.fill();
      g.save();
      rr(g, -18, -10, 36, 20, 5); g.clip();
      g.fillStyle = lgrad(g, -10, 10, BRAND.disc2, BRAND.disc);
      g.fillRect(-18, -10, 16, 20);
      g.restore();
    },
    // Chincheta con cabeza de latón
    function (g) {
      g.rotate(0.3);
      g.strokeStyle = INK.steel2; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 6); g.lineTo(0, 26); g.stroke();
      g.fillStyle = '#A88434';
      g.beginPath(); g.ellipse(0, 4, 8, 3.2, 0, 0, Math.PI * 2); g.fill();
      var rg = g.createRadialGradient(-3, -9, 1, 0, -6, 12);
      rg.addColorStop(0, '#E7C87E'); rg.addColorStop(1, BRAND.amber);
      g.fillStyle = rg;
      g.beginPath(); g.arc(0, -6, 10, 0, Math.PI * 2); g.fill();
    },
    // Cuaderno de espiral con etiqueta
    function (g) {
      g.rotate(0.2);
      g.fillStyle = lgrad(g, -26, 26, BRAND.disc2, BRAND.disc);
      rr(g, -19, -26, 38, 52, 4); g.fill();
      g.strokeStyle = INK.steel; g.lineWidth = 2.2; g.lineCap = 'round';
      g.beginPath();
      for (var y = -21; y <= 21; y += 7) {
        g.moveTo(-23, y); g.lineTo(-15, y - 3);
      }
      g.stroke();
      g.fillStyle = INK.paper; rr(g, -8, -9, 22, 14, 2); g.fill();
      g.strokeStyle = BRAND.lime; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-4, -2); g.lineTo(10, -2); g.stroke();
    },
    // Bolígrafo verde profundo con punta de latón
    function (g) {
      g.rotate(-0.7);
      g.fillStyle = lgrad(g, -4.5, 4.5, '#0A4A4A', BRAND.deep);
      rr(g, -32, -4.5, 54, 9, 4.5); g.fill();
      g.fillStyle = INK.steel2; rr(g, -30, -7.5, 15, 3.4, 1.7); g.fill();
      g.fillStyle = BRAND.amber;
      g.beginPath(); g.moveTo(22, -4.5); g.lineTo(34, 0); g.lineTo(22, 4.5);
      g.closePath(); g.fill();
      g.fillStyle = INK.graph;
      g.beginPath(); g.moveTo(31, -1.2); g.lineTo(35, 0); g.lineTo(31, 1.2);
      g.closePath(); g.fill();
    },
    // Sacapuntas lima con cuchilla y tornillo
    function (g) {
      g.rotate(0.25);
      g.fillStyle = lgrad(g, -12, 12, BRAND.lime, '#7FA82B');
      rr(g, -14, -12, 28, 24, 4); g.fill();
      g.fillStyle = lgrad(g, -12, 12, INK.steel, INK.steel2);
      rr(g, 4, -12, 10, 24, 3); g.fill();
      g.fillStyle = BRAND.amber;
      g.beginPath(); g.arc(9, -6, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0B3B2E';
      g.beginPath(); g.ellipse(-4, 0, 5.5, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)';
      g.beginPath(); g.ellipse(-5.5, -1.5, 2, 1.4, -0.5, 0, Math.PI * 2); g.fill();
    }
  ];

  /* Pre-render de sprites (compartidos entre instancias) */
  var SPRITE_PX = 144, spriteCache = [];
  function floaterSprite(kind) {
    if (spriteCache[kind]) return spriteCache[kind];
    var c = document.createElement('canvas');
    c.width = c.height = SPRITE_PX;
    var g = c.getContext('2d');
    g.translate(SPRITE_PX / 2, SPRITE_PX / 2);
    g.scale(SPRITE_PX / 120, SPRITE_PX / 120);
    g.shadowColor = 'rgba(0,25,20,.32)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 4;
    FLOATER_KINDS[kind](g);
    spriteCache[kind] = c;
    return c;
  }

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
    this.spinVel = reduce ? 0 : 0.009;
    this.tiltX = 0; this.tiltY = 0;
    this.tiltXc = 0; this.tiltYc = 0;
    this.tiltXv = 0; this.tiltYv = 0;          // velocidades de muelle
    this.camX = 0; this.camY = 0;
    this.camXc = 0; this.camYc = 0;
    this.camXv = 0; this.camYv = 0;
    this.scrollPar = 0; this.scrollParC = 0;   // parallax vertical (modo bg)
    this.pointer = { x: 0.5, y: 0.5, inside: false };
    this.particles = [];
    this.bursts = [];
    this.ripples = [];
    this.hoverPulse = 0;
    this.pop = 0;                              // "pop" elástico al hacer clic
    this.wx = 0; this.wy = 0;                  // deriva orgánica (paseo vivo)
    // Cursor suavizado en px de canvas (proximidad chapa/partículas)
    this.mx = -1e4; this.my = -1e4;
    this.mvx = 0; this.mvy = 0;
    this.mTx = -1e4; this.mTy = -1e4;
    this.mSeen = false;
    this.prox = 0;
    // Fases aleatorias fijas → cada carga pasea distinto, nunca en bucle exacto
    this.ph = [];
    for (var pi = 0; pi < 6; pi++) this.ph.push(Math.random() * Math.PI * 2);
    this.running = false;
    this.t = 0;

    this._initParticles(reduce ? 14 : (this.bg ? 46 : 34));
    if (this.bg) this._initFloaters(window.innerWidth <= 992 ? 6 : 10);
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

  // Registra la posición del mouse en px de canvas (para proximidad)
  LogoScene.prototype._mouse = function (x, y) {
    this.mTx = x * this.dpr; this.mTy = y * this.dpr;
    if (!this.mSeen) { this.mSeen = true; this.mx = this.mTx; this.my = this.mTy; }
  };

  /* Útiles flotantes: anclas repartidas por el hero; cada uno deriva con
     senos propios, tumba lento y guarda su impulso de clic (muelle a 0) */
  LogoScene.prototype._initFloaters = function (n) {
    this.floaters = [];
    for (var i = 0; i < n; i++) {
      this.floaters.push({
        img: floaterSprite(i % FLOATER_KINDS.length),
        bx: 0.05 + Math.random() * 0.90,     // ancla (fracción del canvas)
        by: 0.08 + Math.random() * 0.78,
        depth: 0.60 + Math.random() * 0.40,  // lejos=chico/tenue, cerca=grande
        sz: 22 + Math.random() * 17,
        ph: Math.random() * Math.PI * 2,
        ph2: Math.random() * Math.PI * 2,
        wa: 0.0026 + Math.random() * 0.0030, // velocidades de deriva
        wb: 0.0021 + Math.random() * 0.0034,
        rs: (Math.random() - 0.5) * 0.007,   // tumbado lento
        ax: 18 + Math.random() * 34,         // amplitud de paseo (px CSS)
        ay: 14 + Math.random() * 26,
        px: 0, py: 0,                        // última posición dibujada
        fx: 0, fy: 0, fvx: 0, fvy: 0         // impulso de clic
      });
    }
  };

  LogoScene.prototype._bind = function () {
    var self = this;
    this._onMove = function (e) {
      var rect = self.cv.getBoundingClientRect();
      var px = e.touches ? e.touches[0].clientX : e.clientX;
      var py = e.touches ? e.touches[0].clientY : e.clientY;
      self._mouse(px - rect.left, py - rect.top);
      self.pointer.x = clamp((px - rect.left) / rect.width, 0, 1);
      self.pointer.y = clamp((py - rect.top) / rect.height, 0, 1);
      self.pointer.inside = true;
      var dx = self.pointer.x - 0.5, dy = self.pointer.y - 0.5;
      self.tiltY = dx * 0.32;
      self.tiltX = -dy * 0.26;
      self.camX = dx * 14;
      self.camY = dy * 14;
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
      var rect = self.cv.getBoundingClientRect();
      self._mouse(e.clientX - rect.left, e.clientY - rect.top);
      if (!self.bg && self.pointer.inside) return;
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var dx = clamp((e.clientX - cx) / (window.innerWidth / 2), -1, 1);
      var dy = clamp((e.clientY - cy) / (window.innerHeight / 2), -1, 1);
      var k = self.bg ? 1 : 0.5;
      self.tiltY = dx * 0.26 * k;
      self.tiltX = -dy * 0.20 * k;
      self.camX = dx * (self.bg ? 18 : 10);
      self.camY = dy * (self.bg ? 11 : 10);
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
      if (e.key === 'ArrowLeft')       self.spinVel -= 0.022;
      else if (e.key === 'ArrowRight') self.spinVel += 0.022;
      else if (e.key === 'ArrowUp')    self.tiltX = clamp(self.tiltX + 0.15, -0.5, 0.5);
      else if (e.key === 'ArrowDown')  self.tiltX = clamp(self.tiltX - 0.15, -0.5, 0.5);
    };

    // Scroll: giro extra + cabeceo + parallax vertical (bg)
    this._lastScrollY = window.scrollY || 0;
    this._onScroll = function () {
      var y = window.scrollY || 0;
      var dy = y - self._lastScrollY;
      self._lastScrollY = y;
      self.spinVel += clamp(dy * (self.bg ? 0.00025 : 0.00015), -0.007, 0.007);
      if (self.bg) self.scrollPar = y;
      if (!self.pointer.inside) {
        self.tiltX = clamp(-dy * 0.0012, -0.14, 0.14);
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
      // Desktop: chapa hacia la derecha y ARRIBA (el carrusel de promos
      // se ancla abajo de esa columna → conviven sin taparse); mobile: centrada
      var mobile = window.innerWidth <= 992;
      this.cx = this.W * (mobile ? 0.5 : 0.72);
      this.cy = this.H * (mobile ? 0.44 : 0.40);
      // Chapa más contenida: protagonista sin dominar el hero
      this.R = Math.min(this.W, this.H) * (mobile ? 0.25 : 0.22);
    } else {
      this.cx = this.W / 2; this.cy = this.H / 2;
      this.R = Math.min(this.W, this.H) * 0.30;
    }
    if (!this.running) this._draw();
  };

  LogoScene.prototype._click = function (x, y) {
    // Impulso contenido + "pop" elástico (el muelle lo devuelve con rebote)
    this.spinVel += (this.spinVel >= 0 ? 1 : -1) * 0.05;
    this.pop = 0.7;
    this.ripples.push({ x: x, y: y, r: 0, life: 1 });
    // Los útiles cercanos al clic salen despedidos con suavidad y regresan
    if (this.floaters && !reduce) {
      var rad = this.R * 2.2;
      for (var fi = 0; fi < this.floaters.length; fi++) {
        var f = this.floaters[fi];
        var dx = f.px - x, dy = f.py - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < rad && d > 1) {
          var kick = (1 - d / rad) * 5.5 * this.dpr;
          f.fvx += (dx / d) * kick;
          f.fvy += (dy / d) * kick;
        }
      }
    }
    var n = reduce ? 6 : 18;
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      var sp = (1.2 + Math.random() * 3.2) * this.dpr;
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

  /* Muelle amortiguado: persigue el objetivo con inercia y leve rebote,
     en vez de lerp seco (movimiento natural, no robótico) */
  LogoScene.prototype._spring = function (p, v, target, k, d) {
    this[v] = (this[v] + (target - this[p]) * k) * d;
    this[p] += this[v];
  };

  LogoScene.prototype._step = function () {
    this.t += 1;
    var t = this.t, ph = this.ph;

    this._spring('tiltXc', 'tiltXv', this.tiltX, 0.030, 0.86);
    this._spring('tiltYc', 'tiltYv', this.tiltY, 0.030, 0.86);
    this._spring('camXc', 'camXv', this.camX, 0.028, 0.85);
    this._spring('camYc', 'camYv', this.camY, 0.028, 0.85);
    this.scrollParC = lerp(this.scrollParC, this.scrollPar, 0.07);

    // Cursor suavizado (muelle) para proximidad de chapa y partículas
    if (this.mSeen) {
      this.mvx = (this.mvx + (this.mTx - this.mx) * 0.06) * 0.85;
      this.mvy = (this.mvy + (this.mTy - this.my) * 0.06) * 0.85;
      this.mx += this.mvx; this.my += this.mvy;
    }

    // Proximidad del cursor a la chapa (0 lejos … 1 encima)
    var prox = 0, pdx = 0, pdy = 0, pd = 0;
    if (this.mSeen) {
      pdx = this.mx - (this.cx + this.wx);
      pdy = this.my - (this.cy + this.wy);
      pd = Math.sqrt(pdx * pdx + pdy * pdy);
      prox = clamp(1 - pd / (this.R * 1.7), 0, 1);
    }
    this.prox = prox;

    // Deriva orgánica: suma de senos desfasados → paseo "vivo" que nunca
    // repite un bucle evidente. En bg pasea más amplio por el hero.
    var amp = reduce ? 0 : this.R * (this.bg ? 0.20 : 0.08);
    var wxT = (Math.sin(t * 0.0047 + ph[0]) * 0.55 +
               Math.sin(t * 0.0083 + ph[1]) * 0.30 +
               Math.sin(t * 0.0139 + ph[2]) * 0.15) * amp * 1.15;
    var wyT = (Math.sin(t * 0.0053 + ph[3]) * 0.55 +
               Math.sin(t * 0.0091 + ph[4]) * 0.30 +
               Math.sin(t * 0.0127 + ph[5]) * 0.15) * amp * 0.55;
    // La chapa "esquiva" con suavidad al cursor cuando se le acerca
    if (prox > 0 && pd > 1) {
      var flee = prox * prox * this.R * 0.09;
      wxT -= (pdx / pd) * flee;
      wyT -= (pdy / pd) * flee;
    }
    this.wx = lerp(this.wx, wxT, 0.02);
    this.wy = lerp(this.wy, wyT, 0.02);

    // Giro que respira: acelera y frena solo; la cercanía del cursor lo anima
    var dir = this.spinVel >= 0 ? 1 : -1;
    var base = reduce ? 0
      : 0.009 * (0.72 + 0.40 * Math.sin(t * 0.005 + ph[1]) + prox * 0.5);
    this.spinVel = lerp(this.spinVel, base * dir, 0.02);
    this.spin += this.spinVel + this.tiltYc * 0.03;

    this.hoverPulse = lerp(this.hoverPulse,
      Math.max(this.pointer.inside ? 1 : 0, prox), 0.06);
    this.pop *= 0.93;

    // Impulso de clic de los útiles: muelle de vuelta a su paseo normal
    if (this.floaters) {
      for (var fi = 0; fi < this.floaters.length; fi++) {
        var f = this.floaters[fi];
        f.fvx = (f.fvx - f.fx * 0.015) * 0.92;
        f.fvy = (f.fvy - f.fy * 0.015) * 0.92;
        f.fx += f.fvx; f.fy += f.fvy;
      }
    }

    for (var i = this.bursts.length - 1; i >= 0; i--) {
      var b = this.bursts[i];
      b.x += b.vx; b.y += b.vy; b.vx *= 0.96; b.vy *= 0.96;
      b.life -= 0.014;
      if (b.life <= 0) this.bursts.splice(i, 1);
    }
    for (var j = this.ripples.length - 1; j >= 0; j--) {
      var rp = this.ripples[j];
      rp.r += this.R * 0.04; rp.life -= 0.022;
      if (rp.life <= 0) this.ripples.splice(j, 1);
    }
  };

  LogoScene.prototype._draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    var camx = this.camXc * this.dpr, camy = this.camYc * this.dpr;
    var cx = this.cx + camx + this.wx;
    var cy = this.cy + camy + this.wy
           - (this.bg ? this.scrollParC * 0.22 * this.dpr : 0);
    // Escala: respiración sutil + pulso de hover + pop elástico del clic
    var breathe = reduce ? 0 : 0.012 * Math.sin(this.t * 0.013 + this.ph[2]);
    var R = this.R * (1 + this.hoverPulse * 0.045 + this.pop * 0.10 + breathe);

    if (this.floaters) this._drawFloaters(ctx);

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

  /* Útiles de papelería flotando por el hero: deriva orgánica, parallax
     por profundidad, se apartan del cursor y vuelven tras un clic */
  LogoScene.prototype._drawFloaters = function (ctx) {
    var t = this.t, dpr = this.dpr;
    for (var i = 0; i < this.floaters.length; i++) {
      var f = this.floaters[i];
      var x = f.bx * this.W + f.fx
            + (reduce ? 0 : Math.sin(t * f.wa + f.ph) * f.ax * dpr)
            + this.camXc * dpr * f.depth * 0.7;
      var y = f.by * this.H + f.fy
            + (reduce ? 0 : Math.sin(t * f.wb + f.ph2) * f.ay * dpr)
            + this.camYc * dpr * f.depth * 0.7
            - this.scrollParC * 0.30 * dpr * f.depth;
      // Repulsión del cursor: se apartan y regresan solos (suave, sin saltos)
      if (this.mSeen && !reduce) {
        var rdx = x - this.mx, rdy = y - this.my;
        var rd = Math.sqrt(rdx * rdx + rdy * rdy);
        var rad = 120 * dpr;
        if (rd < rad && rd > 1) {
          var rf = 1 - rd / rad;
          x += (rdx / rd) * rf * rf * 44 * dpr;
          y += (rdy / rd) * rf * rf * 44 * dpr;
        }
      }
      f.px = x; f.py = y;
      var rot = reduce ? 0 : Math.sin(t * 0.005 + f.ph) * 0.24 + t * f.rs;
      // Sprite 120u con objeto de ~90u: ×2.4 da útiles de ~28-85px visibles
      var sz = f.sz * f.depth * dpr * 2.4 *
               (reduce ? 1 : 1 + 0.05 * Math.sin(t * 0.009 + f.ph2));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.28 + f.depth * 0.36;
      ctx.drawImage(f.img, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
      // Las partículas se apartan con suavidad del cursor (campo de repulsión)
      if (this.mSeen) {
        var rdx = x - this.mx, rdy = y - this.my;
        var rd = Math.sqrt(rdx * rdx + rdy * rdy);
        var rad = R * 0.9;
        if (rd < rad && rd > 1) {
          var rf = 1 - rd / rad;
          x += (rdx / rd) * rf * rf * R * 0.30;
          y += (rdy / rd) * rf * rf * R * 0.30;
        }
      }
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
