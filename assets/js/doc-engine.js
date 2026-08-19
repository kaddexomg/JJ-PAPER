/* ======================================================
   JJ Paper — Motor de documentos (PDF)

   Un solo lugar donde se dibujan el catálogo, la lista de precios,
   la cotización, la factura y la orden de recibo. Devuelve el PDF
   como archivo (Blob), no como descarga: así el mismo documento
   sirve para bajarlo, adjuntarlo a un correo o mandarlo por WhatsApp.

   Antes esto vivía dentro de export.js atado a las variables de
   index.html y terminaba en doc.save(): no había forma de adjuntarlo
   a nada. Este módulo se carga solo — consulta lo que necesita.

   Depende de: config.js (sb, APP, getRate, loadSettings).
   ====================================================== */

/* ---------------- Paleta e identidad ---------------- */
const DOC_BRAND = {
  deep:  { rgb: [0, 51, 51],   hex: '003333' },  /* verde profundo */
  green: { rgb: [22, 96, 74],  hex: '16604A' },  /* verde JJ */
  ring:  { rgb: [167, 215, 160] },               /* anillo del logo */
  brass: { rgb: [201, 162, 75] },                /* dorado latón */
  light: { rgb: [239, 246, 228] },               /* lima suave */
  zebra: { rgb: [246, 250, 244] },               /* fila alterna */
};

// '#16604A' → [22,96,74]. Los colores del documento son configurables
// desde Ajustes (doc_color / doc_accent); si vienen mal, se ignoran.
function docHexRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Colores efectivos del documento según los ajustes del negocio
function docColors() {
  const s = APP.SETTINGS || {};
  return {
    main:  docHexRgb(s.doc_color,  DOC_BRAND.green.rgb),
    acc:   docHexRgb(s.doc_accent, DOC_BRAND.brass.rgb),
    deep:  DOC_BRAND.deep.rgb,
    light: DOC_BRAND.light.rgb,
    zebra: DOC_BRAND.zebra.rgb,
    ring:  DOC_BRAND.ring.rgb,
  };
}

function docToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------- Carga de la librería ----------------
   jsPDF + autoTable por CDN, con espejo de respaldo. Se cachea la
   promesa: varios botones a la vez comparten la misma carga.        */
let _docPdfLib = null;
function docEnsurePdfLib() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return Promise.resolve();
  if (_docPdfLib) return _docPdfLib;
  const espejos = [
    ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
     'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'],
    ['https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
     'https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'],
  ];
  const cargar = src => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = ok; s.onerror = () => fail(new Error('no cargó ' + src));
    document.head.appendChild(s);
  });
  _docPdfLib = (async () => {
    let ultimo;
    for (const [core, plugin] of espejos) {
      try { await cargar(core); await cargar(plugin); return; }
      catch (e) { ultimo = e; }
    }
    _docPdfLib = null;              // permite reintentar en el próximo clic
    throw ultimo;
  })();
  return _docPdfLib;
}

// Logo oficial rasterizado a PNG (jsPDF no dibuja SVG). Si el navegador
// no puede, se cae al badge dibujado a mano y el PDF igual sale.
let _docLogo = null;
function docLogoPng(size = 256) {
  if (_docLogo) return _docLogo;
  const base = location.pathname.includes('/admin/') || location.pathname.includes('/vendedor/') ? '../' : '';
  _docLogo = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL('image/png'));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = base + 'assets/img/logo.svg';
  }).then(v => { if (!v) _docLogo = null; return v; });
  return _docLogo;
}

// Los ajustes hacen falta para el nombre, el RIF y los colores
async function docEnsureSettings() {
  if (!APP.SETTINGS || !Object.keys(APP.SETTINGS).length) await loadSettings();
}

/* ====================================================================
   CATÁLOGO Y LISTA DE PRECIOS
   ==================================================================== */

// Trae el catálogo completo (una fila por presentación). No reusa las
// variables de catalogo.js a propósito: este módulo corre también en el
// panel, donde esa página no existe.
async function docLoadCatalogRows() {
  const [{ data: grupos }, { data: prods }] = await Promise.all([
    sb.from('jjp_category_groups').select('id,name,slug').order('sort_order'),
    sb.from('jjp_products')
      .select('id,name,unit,price_usd,stock,essential,sort_order,jjp_categories(name,group_id),' +
              'jjp_product_variants(variant_name,sku,price_usd,stock,active,sort_order,jjp_brands(name))')
      .eq('active', true)
      .order('sort_order'),
  ]);

  const G = grupos || [];
  const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
  const stockTxt = s => (s == null || s < 0) ? '∞' : String(s);
  const rate = getRate();

  const filas = [];
  (prods || []).forEach(p => {
    const gid = p.jjp_categories?.group_id;
    const idx = G.findIndex(g => g.id === gid);
    const base = {
      cat: (idx >= 0 ? G[idx].name : 'Otros'),
      sub: p.jjp_categories?.name || '',
      ord: idx < 0 ? 99 : idx,
      essential: !!p.essential,
      unit: p.unit || 'unid',
    };
    const vars = (p.jjp_product_variants || []).filter(v => v.active);
    if (vars.length) {
      vars.forEach(v => filas.push({
        ...base, name: p.name || '—',
        brand: v.jjp_brands?.name || '',
        pres: v.variant_name || '',
        sku: v.sku || '',
        usd: num(v.price_usd), bs: num(v.price_usd) * rate,
        stock: stockTxt(v.stock), stockNum: v.stock,
      }));
    } else {
      filas.push({
        ...base, name: p.name || '—', brand: '', pres: '', sku: '',
        usd: num(p.price_usd), bs: num(p.price_usd) * rate,
        stock: stockTxt(p.stock), stockNum: p.stock,
      });
    }
  });

  // Familia → esenciales primero → subcategoría → nombre
  filas.sort((a, b) =>
    a.ord - b.ord
    || (b.essential ? 1 : 0) - (a.essential ? 1 : 0)
    || a.sub.localeCompare(b.sub)
    || a.name.localeCompare(b.name));
  return filas;
}

/* Encabezado y pie comunes del folleto */
function docFolletoChrome(doc, { subtitulo, logoPng, rate }) {
  const C = docColors();
  const s = APP.SETTINGS || {};
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const HEAD_H = 74;
  const tel = s.phone_display || s.whatsapp_number || '';
  const mail = s.email || '';

  doc.setFillColor(...C.deep);  doc.rect(0, 0, pageW, HEAD_H, 'F');
  doc.setFillColor(...C.main);  doc.rect(0, HEAD_H - 26, pageW, 26, 'F');
  doc.setFillColor(...C.acc);   doc.rect(0, HEAD_H, pageW, 2.5, 'F');

  if (logoPng) {
    doc.addImage(logoPng, 'PNG', 36, 9, 56, 56);
  } else {
    const bx = 62, by = 36, br = 24;
    doc.setFillColor(...C.main); doc.circle(bx, by, br, 'F');
    doc.setDrawColor(...C.ring); doc.setLineWidth(2.6); doc.circle(bx, by, br - 3.5, 'S');
    doc.setTextColor(255); doc.setFont('times', 'bold'); doc.setFontSize(24);
    doc.text('JJ', bx, by + 8, { align: 'center' });
  }

  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(21);
  doc.text(s.business_name || 'JJ Paper', 102, 32);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.setTextColor(...C.ring);
  doc.text(subtitulo, 102, 46);

  doc.setTextColor(255); doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Tasa BCV Bs ${rate.toFixed(2)} / USD`, pageW - 40, HEAD_H - 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Emitido: ${docToday()}  ·  Precios sujetos a cambio`, pageW - 40, HEAD_H - 6.5, { align: 'right' });

  const pag = doc.internal.getNumberOfPages();
  doc.setDrawColor(...C.acc); doc.setLineWidth(1);
  doc.line(40, pageH - 34, pageW - 40, pageH - 34);
  doc.setTextColor(...C.main); doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  if (tel) doc.text(`WhatsApp ${tel}`, 40, pageH - 20);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
  doc.text(`${mail}${mail ? '  ·  ' : ''}jj-paper.pages.dev`, pageW / 2, pageH - 20, { align: 'center' });
  doc.text(`Página ${pag}`, pageW - 40, pageH - 20, { align: 'right' });
}

/* Folleto de productos. conStock=false → LISTA DE PRECIOS para el cliente:
   nunca lleva existencias, para no tener que decirle "Agotado" a nadie. */
async function docPdfProductos({ conStock = true, titulo = 'Catálogo Mayorista' } = {}) {
  await docEnsureSettings();
  await docEnsurePdfLib();
  const filas = await docLoadCatalogRows();
  if (!filas.length) throw new Error('No hay productos para exportar');

  const logoPng = await docLogoPng().catch(() => null);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const C = docColors();
  const rate = getRate();

  const cats = [...new Set(filas.map(f => f.cat))];
  const body = [];
  const ncols = conStock ? 6 : 5;
  cats.forEach(cat => {
    const items = filas.filter(f => f.cat === cat);
    body.push([{
      content: `${cat.toUpperCase()}  ·  ${items.length} producto${items.length !== 1 ? 's' : ''}`,
      colSpan: ncols,
      styles: { fillColor: C.light, textColor: C.main, fontStyle: 'bold',
                fontSize: 9.5, cellPadding: { top: 7, bottom: 6, left: 8 }, halign: 'left' },
    }]);
    items.forEach(f => {
      const fila = [
        f.name,
        [f.brand, f.pres].filter(Boolean).join(' · ') || '—',
        f.unit,
        `$${f.usd.toFixed(2)}`,
        `Bs ${f.bs.toFixed(2)}`,
      ];
      if (conStock) fila.push(f.stock);
      body.push(fila);
    });
  });

  const head = ['Producto', 'Marca / Presentación', 'Unidad', 'Precio USD', 'Precio Bs'];
  if (conStock) head.push('Stock');

  const colStyles = conStock
    ? { 0: { cellWidth: 168 }, 1: { cellWidth: 108 }, 2: { cellWidth: 46, halign: 'center' },
        3: { cellWidth: 60, halign: 'right', fontStyle: 'bold', textColor: C.main },
        4: { cellWidth: 72, halign: 'right' }, 5: { cellWidth: 38, halign: 'center' } }
    : { 0: { cellWidth: 190 }, 1: { cellWidth: 122 }, 2: { cellWidth: 52, halign: 'center' },
        3: { cellWidth: 68, halign: 'right', fontStyle: 'bold', textColor: C.main },
        4: { cellWidth: 82, halign: 'right' } };

  doc.autoTable({
    head: [head], body, startY: 108,
    margin: { top: 100, bottom: 46, left: 40, right: 40 },
    styles: { fontSize: 8, cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
              overflow: 'linebreak', textColor: [40, 44, 42], lineColor: [228, 237, 231], lineWidth: 0.5 },
    headStyles: { fillColor: C.main, textColor: 255, fontStyle: 'bold', fontSize: 8.5,
                  cellPadding: { top: 6, bottom: 6, left: 6, right: 6 } },
    alternateRowStyles: { fillColor: C.zebra },
    columnStyles: colStyles,
    didDrawPage: () => docFolletoChrome(doc, {
      rate, logoPng,
      subtitulo: `${titulo}  ·  Calidad · Compromiso · Confianza`,
    }),
  });

  doc.setPage(1);
  doc.setTextColor(...C.main);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(`${filas.length} presentaciones  ·  ${cats.length} categorías`, 40, 96);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.setFontSize(8.5);
  doc.text('Pedidos al mayor por WhatsApp o en jj-paper.pages.dev', pageW - 40, 96, { align: 'right' });

  const nombre = `${conStock ? 'Catalogo' : 'Lista-de-precios'}-JJPaper-${docToday()}.pdf`;
  return { blob: doc.output('blob'), filename: nombre, doc };
}

const docPdfCatalogo     = () => docPdfProductos({ conStock: true,  titulo: 'Catálogo Mayorista' });
const docPdfListaPrecios = () => docPdfProductos({ conStock: false, titulo: 'Lista de Precios' });

/* ====================================================================
   CATÁLOGO CON FOTOS — tarjetas visuales (panel vendedor)
   Una tarjeta por producto con su foto, nombre, descripción, SKU y
   precio. La vista "Catálogo" del vendedor lo genera así:
     · conSku=false → PDF para el CLIENTE (foto, nombre, descripción,
       precio $ y Bs; sin SKU ni costo).
     · conSku=true  → PDF interno (además el código), para imprimir o
       descargar en el negocio.
   Las filas las arma la página (con sus precios ya editados) y se pasan
   como { name, desc, sku, img, emoji, brand, usd, unit }. Si no llegan,
   se cargan desde el catálogo (una fila por producto, precio mínimo).
   ==================================================================== */

// Normaliza cualquier formato de imagen (incluido webp) a JPEG para jsPDF.
// Primero intenta fetch→blob (evita el "taint" del canvas; funciona si el
// origen manda CORS — Supabase Storage sí lo hace). Si falla, intenta el
// método clásico con crossOrigin. Si nada funciona, devuelve null y la
// tarjeta se dibuja con las iniciales del producto.
function docImagenJpeg(url) {
  return new Promise(resolve => {
    const u = encodeURI(url);
    const dibuja = (src) => {
      const img = new Image();
      img.onload = () => {
        try {
          const max = 800;
          const w = img.naturalWidth || max, h = img.naturalHeight || max;
          const esc = Math.min(1, max / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.round(w * esc); c.height = Math.round(h * esc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    };
    fetch(u)
      .then(r => { if (!r.ok) throw 0; return r.blob(); })
      .then(b => new Promise((ok, no) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = no;
        fr.readAsDataURL(b);
      }))
      .then(dataUrl => dibuja(dataUrl))
      .catch(() => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const max = 800;
            const w = img.naturalWidth || max, h = img.naturalHeight || max;
            const esc = Math.min(1, max / Math.max(w, h));
            const c = document.createElement('canvas');
            c.width = Math.round(w * esc); c.height = Math.round(h * esc);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.82));
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = u;
      });
  });
}

// Carga las fotos con límite de concurrencia para no ahogar las PCs viejas
async function docCargaFotos(filas, concurrentes = 4) {
  let idx = 0;
  async function worker() {
    while (idx < filas.length) {
      const f = filas[idx++];
      f.imgData = f.img ? await docImagenJpeg(f.img) : null;
    }
  }
  await Promise.all([...Array(concurrentes)].map(worker));
}

async function docPdfCatalogoFotos({ filas, conSku = false, titulo = 'Catálogo', showBs = true } = {}) {
  await docEnsureSettings();
  await docEnsurePdfLib();

  let lista = (filas || []).filter(f => f && f.name);
  if (!lista.length) {
    lista = await docLoadCatalogRows().then(rows => {
      // Agrupa por producto: una tarjeta por nombre (precio mínimo) para no
      // repetir la misma foto por cada presentación.
      const porNombre = new Map();
      rows.forEach(r => {
        const cur = porNombre.get(r.name);
        if (!cur || r.usd < cur.usd) porNombre.set(r.name, r);
      });
      return [...porNombre.values()];
    });
  }
  if (!lista.length) throw new Error('No hay productos para armar el catálogo');

  const logoPng = await docLogoPng().catch(() => null);
  await docCargaFotos(lista);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const C = docColors();
  const rate = getRate();
  const pageW = doc.internal.pageSize.getWidth();
  const M = 36;

  const subtitulo = `${titulo}  ·  ${lista.length} producto${lista.length === 1 ? '' : 's'}  ·  Precios en $${showBs ? ' y Bs (tasa BCV)' : ''}` +
    (conSku ? '' : '  ·  Pedidos por WhatsApp');

  docFolletoChrome(doc, { rate, logoPng, subtitulo });

  // Tarjetas: 2 columnas × 3 filas por página
  const GX = 10, GY = 14;
  const cw = (pageW - M * 2 - GX) / 2;
  const ch = 212;
  const topY = 88;
  const imgH = 106;

  lista.forEach((f, i) => {
    const perX = 2, perY = 3;
    const col = i % perX;
    const row = Math.floor(i / perX) % perY;
    if (i > 0 && col === 0 && row === 0) {
      doc.addPage();
      docFolletoChrome(doc, { rate, logoPng, subtitulo });
    }
    const cx = M + col * (cw + GX);
    const cy = topY + row * (ch + GY);

    // caja de la tarjeta
    doc.setDrawColor(...C.main); doc.setLineWidth(0.6);
    doc.roundedRect(cx, cy, cw, ch, 4, 4, 'S');

    // foto
    const ix = cx + 7, iy = cy + 7, iw = cw - 14;
    if (f.imgData) {
      doc.addImage(f.imgData, 'JPEG', ix, iy, iw, imgH, undefined, 'FAST');
      doc.setDrawColor(235, 240, 237); doc.setLineWidth(0.5);
      doc.line(ix, iy + imgH, ix + iw, iy + imgH);
    } else {
      doc.setFillColor(241, 245, 243);
      doc.roundedRect(ix, iy, iw, imgH, 3, 3, 'F');
      const ini = String(f.name || 'JJ').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, '').trim()
        .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'JJ';
      doc.setTextColor(...C.main); doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
      doc.text(ini, ix + iw / 2, iy + imgH / 2 + 9, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(160);
      doc.text('sin foto', ix + iw / 2, iy + imgH / 2 + 24, { align: 'center' });
    }

    // zona de texto
    let ty = iy + imgH + 11;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(28, 32, 30);
    const nom = doc.splitTextToSize(String(f.name || ''), cw - 14).slice(0, 2);
    doc.text(nom, ix, ty); ty += nom.length * 10.5 + 1;
    if (conSku && f.sku) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(150);
      doc.text('Cód.: ' + String(f.sku), ix, ty); ty += 8.5;
    }
    if (f.brand) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120);
      doc.text(doc.splitTextToSize('Marca: ' + String(f.brand), cw - 14)[0], ix, ty); ty += 9;
    }
    if (f.desc) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120);
      const d = doc.splitTextToSize(String(f.desc), cw - 14).slice(0, 2);
      doc.text(d, ix, ty); ty += d.length * 8.5 + 1;
    }

    // precio abajo
    const usd = Number(f.usd) || 0;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.main);
    doc.text(`$${usd.toFixed(2)}`, ix, cy + ch - 12);
    if (showBs) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text(`Bs ${(usd * rate).toFixed(2)}`, cx + cw - 7, cy + ch - 12, { align: 'right' });
    }
  });

  const nombre = `${conSku ? 'Catalogo-interno' : 'Catalogo'}-JJPaper-${docToday()}.pdf`;
  return { blob: doc.output('blob'), filename: nombre, doc };
}

/* ====================================================================
   DOCUMENTOS DE VENTA — factura, orden de recibo, presupuesto
   Misma información y mismos ajustes que comprobante.html, pero como
   archivo enviable. El que se imprime y el que se manda dicen lo mismo.
   ==================================================================== */

const DOC_TITULOS = {
  factura:     'FACTURA',
  recibo:      'ORDEN DE RECIBO',
  presupuesto: 'PRESUPUESTO',
  comprobante: 'COMPROBANTE',
  pedido:      'RESUMEN DE PEDIDO',
};

// Cotización → misma forma que un pedido, solo para dibujarla
function docNormalizeQuote(q) {
  const items = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);
  const subtotal = items.reduce((s, i) =>
    s + Number(i.subtotal_usd ?? (Number(i.price_usd) || 0) * (Number(i.qty) || 0)), 0);
  return {
    order_number: q.quote_number,
    client_name: q.client_name, rif: q.rif, phone: q.phone, email: q.email,
    city: q.city, address: q.address,
    items, subtotal_usd: subtotal,
    total_usd: Number(q.estimated_total_usd) || subtotal,
    discount_pct: q.discount_pct,
    discount_status: Number(q.discount_pct) > 0 ? 'approved' : 'none',
    exchange_rate: q.exchange_rate, notes: q.notes,
    status: q.status, created_at: q.created_at,
  };
}

async function docFetchPedido(numero) {
  const { data, error } = await sb.from('jjp_orders').select('*').eq('order_number', numero).maybeSingle();
  if (error || !data) throw new Error('No se encontró el pedido ' + numero);
  return data;
}
async function docFetchCotizacion(numero) {
  const { data, error } = await sb.from('jjp_quotes').select('*').eq('quote_number', numero).maybeSingle();
  if (error || !data) throw new Error('No se encontró la cotización ' + numero);
  return docNormalizeQuote(data);
}

/* Algunos sitios (la ficha del cliente en el chat) solo tienen el resumen
   del documento: número, fecha y total. Para dibujarlo hace falta el
   detalle completo, así que se recarga por número. */
async function docResolvePedido(o) {
  if (o && Array.isArray(o.items) && 'control_number' in o) return o;
  const num = o?.order_number || o?.numero;
  if (!num) throw new Error('No se pudo identificar el pedido');
  return await docFetchPedido(num);
}
async function docResolveCotizacion(q) {
  if (q && Array.isArray(q.items) && q.items.length) return q;
  const num = q?.order_number || q?.quote_number || q?.numero;
  if (!num) throw new Error('No se pudo identificar la cotización');
  return await docFetchCotizacion(num);
}

async function docPdfDocumento(o, tipo = 'factura') {
  await docEnsureSettings();
  await docEnsurePdfLib();

  const s = APP.SETTINGS || {};
  const C = docColors();
  const logoPng = await docLogoPng().catch(() => null);
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
  const rate = Number(o.exchange_rate) || getRate();
  const total = Number(o.total_usd) || 0;
  const anulado = ['rechazado', 'cancelado', 'anulado', 'descartado', 'descartada']
    .includes(String(o.status || '').toLowerCase());

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const M = 40;                       // margen lateral
  const ivaPct = (s.iva_pct !== undefined && s.iva_pct !== '') ? parseFloat(s.iva_pct) : 16;

  /* ============ Cabecera ============
     Razón social, RIF y domicilio a la izquierda; a la derecha el recuadro
     con tipo de documento, número, Nº de Control y fecha — el bloque que
     en una factura formal va preimpreso. */
  doc.setFillColor(...C.main);
  doc.rect(0, 0, pageW, 4, 'F');

  const cajaX = pageW - M - 218, cajaY = 26, cajaW = 218;
  let y = 46;

  if (logoPng) doc.addImage(logoPng, 'PNG', M, y - 22, 52, 52);
  const txtX = logoPng ? M + 62 : M;
  doc.setTextColor(...C.main);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(doc.splitTextToSize((s.business_name || 'JJ Paper').toUpperCase(), cajaX - txtX - 14)[0], txtX, y);
  if (s.rif) {
    doc.setTextColor(45); doc.setFontSize(10.5);
    doc.text('RIF: ' + s.rif, txtX, y + 15);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(95);
  let my = y + 28;
  const anchoMeta = cajaX - txtX - 14;
  if (s.address) {
    doc.splitTextToSize('Domicilio fiscal: ' + s.address, anchoMeta).slice(0, 2)
       .forEach(t => { doc.text(t, txtX, my); my += 10; });
  }
  const contacto = [
    (s.phone_display || s.whatsapp_number) ? 'Teléfono: ' + (s.phone_display || s.whatsapp_number) : '',
    s.email ? 'Correo: ' + s.email : '',
  ].filter(Boolean).join('  ·  ');
  if (contacto) doc.text(doc.splitTextToSize(contacto, anchoMeta)[0], txtX, my);

  // Recuadro del documento
  const filas = [
    ['N°', String(o.order_number || '')],
    ...(o.control_number ? [['N° de Control', String(o.control_number), true]] : []),
    ['Fecha de emisión', o.created_at ? new Date(o.created_at).toLocaleDateString('es-VE') : docToday()],
    ...(tipo === 'presupuesto' ? [] : [['Condición',
      (o.payment_ref || ['pagado', 'preparando', 'entregado'].includes(o.status)) ? 'Contado' : 'Por confirmar']]),
  ];
  const cajaH = 24 + filas.length * 16;
  doc.setDrawColor(...C.main); doc.setLineWidth(1.4);
  doc.roundedRect(cajaX, cajaY, cajaW, cajaH, 4, 4, 'S');
  doc.setFillColor(...C.main);
  doc.rect(cajaX + 1, cajaY + 1, cajaW - 2, 22, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(DOC_TITULOS[tipo] || (s.doc_title || 'COMPROBANTE'), cajaX + cajaW / 2, cajaY + 16, { align: 'center' });

  let fy = cajaY + 22;
  filas.forEach(([et, vl, esControl]) => {
    if (esControl) {                       // el Nº de Control resalta, como en una factura
      doc.setFillColor(253, 246, 246);
      doc.rect(cajaX + 1, fy, cajaW - 2, 16, 'F');
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(...(esControl ? [154, 32, 32] : [110, 110, 110]));
    doc.text(et, cajaX + 8, fy + 11);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(esControl ? 9.5 : 9);
    doc.setTextColor(...(esControl ? [176, 0, 32] : [26, 26, 26]));
    doc.text(vl, cajaX + cajaW - 8, fy + 11, { align: 'right' });
    fy += 16;
  });

  /* ============ Datos del cliente ============ */
  const cliY = Math.max(my + 16, cajaY + cajaH + 14);
  const cliW = pageW - M * 2;
  const cliH = tipo === 'presupuesto' ? 62 : 76;
  doc.setDrawColor(207, 218, 213); doc.setLineWidth(0.8);
  doc.roundedRect(M, cliY, cliW, cliH, 4, 4, 'S');
  doc.setFillColor(...C.main);
  doc.rect(M + 1, cliY + 1, cliW - 2, 16, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('DATOS DEL CLIENTE', M + 10, cliY + 12);

  const metodo = { pago_movil: 'Pago Móvil', transferencia: 'Transferencia', efectivo: 'Efectivo' }[o.payment_method]
    || o.payment_method || '—';
  const col2X = M + cliW / 2 + 6;
  const campo = (et, vl, x, cy, ancho) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(et, x, cy);
    const wEt = doc.getTextWidth(et);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(26);
    doc.text(doc.splitTextToSize(String(vl || '—'), ancho - wEt - 6)[0], x + wEt + 5, cy);
  };
  campo('Razón social / Nombre:', o.client_name, M + 10, cliY + 32, cliW - 20);
  campo('RIF / C.I.:', o.rif, M + 10, cliY + 46, cliW / 2 - 20);
  campo('Teléfono:', o.phone, col2X, cliY + 46, cliW / 2 - 20);
  campo('Domicilio fiscal:', [o.address, o.city].filter(Boolean).join(', '), M + 10, cliY + 60, cliW - 20);
  if (tipo !== 'presupuesto') {
    campo('Forma de pago:', metodo, M + 10, cliY + 72, cliW / 2 - 20);
    campo('Referencia:', o.payment_ref, col2X, cliY + 72, cliW / 2 - 20);
  }

  /* ============ Líneas ============
     Con código y alícuota por línea, como una factura formal. */
  const cuerpo = items.map(i => {
    const fila = [
      i.sku || '—',
      (i.name || i.product || '—') + (i.brand ? `  (${i.brand})` : ''),
      `${i.qty} ${i.unit || ''}`.trim(),
      `$${Number(i.price_usd || 0).toFixed(2)}`,
    ];
    if (ivaPct > 0) fila.push(`${ivaPct}%`);
    fila.push(`$${Number((i.subtotal_usd ?? (i.price_usd * i.qty)) || 0).toFixed(2)}`);
    return fila;
  });
  const cabecera = ['Código', 'Descripción', 'Cant.', 'Precio Unit.'];
  if (ivaPct > 0) cabecera.push('Alíc.');
  cabecera.push('Total');

  const colsBase = {
    0: { cellWidth: 72, halign: 'center', textColor: [140, 140, 140], fontSize: 7 },
    1: { cellWidth: 'auto' },
    2: { cellWidth: 58, halign: 'center' },
    3: { cellWidth: 68, halign: 'right' },
  };
  if (ivaPct > 0) {
    colsBase[4] = { cellWidth: 40, halign: 'center', textColor: [110, 110, 110] };
    colsBase[5] = { cellWidth: 74, halign: 'right', fontStyle: 'bold' };
  } else {
    colsBase[4] = { cellWidth: 74, halign: 'right', fontStyle: 'bold' };
  }

  doc.autoTable({
    head: [cabecera],
    body: cuerpo,
    startY: cliY + cliH + 12,
    // El margen inferior reserva justo lo que ocupan firma, aviso y pie:
    // con más, la tabla saltaba de página antes de tiempo.
    margin: { left: M, right: M, bottom: 132 },
    styles: { fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 7, right: 7 },
              textColor: [40, 44, 42], lineColor: [229, 233, 231], lineWidth: 0.5 },
    headStyles: { fillColor: C.main, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: colsBase,
  });

  /* ============ Totales ============ */
  let ty = doc.lastAutoTable.finalY + 13;
  const totX = pageW - M - 250;             // ancho del bloque de totales
  const lineaTotal = (etiqueta, valor, opts = {}) => {
    doc.setFont('helvetica', opts.fuerte ? 'bold' : 'normal');
    doc.setFontSize(opts.tam || 9);
    doc.setTextColor(...(opts.color || [85, 85, 85]));
    doc.text(etiqueta, totX + 10, ty);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(opts.colorVal || opts.color || [40, 40, 40]));
    doc.text(valor, pageW - M - 10, ty, { align: 'right' });
    ty += opts.salto || 14;
  };

  if (o.discount_status === 'approved' && Number(o.discount_pct) > 0) {
    lineaTotal('Subtotal', `$${Number(o.subtotal_usd || 0).toFixed(2)}`);
    lineaTotal(`Descuento ${o.discount_pct}%`,
      `−$${(Number(o.subtotal_usd || 0) * Number(o.discount_pct) / 100).toFixed(2)}`);
  }
  if (o.delivery_type === 'delivery') {
    lineaTotal(`Envío${o.delivery_distance_km ? ` (~${o.delivery_distance_km} km)` : ''}`,
      Number(o.delivery_fee_usd) > 0 ? `$${Number(o.delivery_fee_usd).toFixed(2)}` : 'Gratis');
  }
  if (ivaPct > 0) {
    const base = total / (1 + ivaPct / 100);
    doc.setDrawColor(223, 230, 226); doc.setLineWidth(0.7);
    doc.line(totX + 10, ty - 10, pageW - M - 10, ty - 10);
    lineaTotal('Base imponible', `$${base.toFixed(2)}`);
    lineaTotal(`IVA (${ivaPct}%)`, `$${(total - base).toFixed(2)}`);
  }

  // Total a pagar: banda verde, el dato que el cliente busca primero
  doc.setFillColor(...C.main);
  doc.rect(totX, ty - 11, 250, 24, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(223, 240, 231);
  doc.text('TOTAL A PAGAR (USD)', totX + 10, ty + 4);
  doc.setFontSize(14); doc.setTextColor(255);
  doc.text(`$${total.toFixed(2)}`, pageW - M - 10, ty + 5, { align: 'right' });
  ty += 30;

  if (s.doc_show_bs !== '0') {
    lineaTotal('TOTAL (Bs)',
      'Bs ' + (total * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      { color: C.acc, colorVal: C.acc, fuerte: true, tam: 10 });
    lineaTotal('Tasa BCV del día', `Bs ${rate.toFixed(2)} / $`, { color: [140, 140, 140], colorVal: [140, 140, 140], tam: 7.5 });
  }

  /* --- Firma y sello ---
     Una sola línea para firma y fecha, y al lado un recuadro discreto para
     el sello: hay clientes que sellan al recibir y otros no. */
  const firmaEtiqueta = {
    factura:     'Firma y fecha del cliente',
    recibo:      'Recibí conforme — firma y fecha',
    presupuesto: 'Firma de aceptación y fecha',
  }[tipo] || 'Firma y fecha';
  const selloW = 128, selloH = 46;
  const firmaY = Math.min(ty + 46, pageH - 132);
  const firmaW = pageW - M * 2 - selloW - 24;
  doc.setDrawColor(120); doc.setLineWidth(0.9);
  doc.line(M, firmaY, M + firmaW, firmaY);
  doc.setFontSize(8.5); doc.setTextColor(90); doc.setFont('helvetica', 'normal');
  doc.text(firmaEtiqueta, M, firmaY + 11);
  doc.setDrawColor(195, 204, 200); doc.setLineWidth(0.7);
  doc.setLineDashPattern([2, 2], 0);
  doc.roundedRect(pageW - M - selloW, firmaY - selloH + 8, selloW, selloH, 4, 4, 'S');
  doc.setLineDashPattern([], 0);
  doc.setFontSize(7.5); doc.setTextColor(168, 178, 174);
  doc.text('SELLO', pageW - M - selloW / 2, firmaY - selloH / 2 + 11, { align: 'center' });

  /* --- Pie legal --- */
  const legal = tipo === 'presupuesto'
    ? 'Presupuesto sin validez fiscal. Precios sujetos a cambio según la tasa del día y la disponibilidad de inventario.'
    : tipo === 'recibo'
      ? 'Orden de recibo / entrega de mercancía. La firma del cliente deja constancia de recepción conforme.'
      : (s.doc_footer_legal !== undefined && s.doc_footer_legal !== ''
          ? s.doc_footer_legal
          : 'Este documento es un comprobante interno de la operación y NO constituye una factura fiscal a los efectos del SENIAT.');

  // Aviso enmarcado: el documento imita la forma de una factura, no su valor.
  // Decirlo claro protege al negocio y al cliente.
  // El texto legal se escribe desde Ajustes y suele pegarse entre comillas:
  // se limpian para que no salgan impresas en el documento.
  const legalLimpio = String(legal || '').trim().replace(/^["“”']+|["“”']+$/g, '');
  const avisoLineas = doc.splitTextToSize(legalLimpio, pageW - M * 2 - 20).slice(0, 3);
  const avisoH = 16 + avisoLineas.length * 8.5;
  const avisoY = pageH - 34 - avisoH;
  doc.setFillColor(253, 250, 241);
  doc.setDrawColor(201, 185, 138); doc.setLineWidth(0.7);
  doc.roundedRect(M, avisoY, pageW - M * 2, avisoH, 3, 3, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(106, 90, 45);
  doc.text('DOCUMENTO SIN VALOR FISCAL', M + 10, avisoY + 11);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 106, 61);
  avisoLineas.forEach((t, i) => doc.text(t, M + 10, avisoY + 21 + i * 8.5));

  doc.setFontSize(7.5); doc.setTextColor(130); doc.setFont('helvetica', 'normal');
  if (o.notes) {
    doc.text(doc.splitTextToSize('Notas: ' + o.notes, pageW - M * 2).slice(0, 2), M, avisoY - 12);
  }
  doc.text(`${s.business_name || 'JJ Paper'} · ${s.doc_footer_note || 'Gracias por su compra.'}`,
           M, pageH - 22);

  /* --- Marca ANULADO ---
     La transparencia depende de la API avanzada de jsPDF; si no está,
     se dibuja en rojo claro. Un adorno nunca debe impedir que salga
     el documento. */
  if (anulado) {
    try {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(90);
      if (doc.setGState && doc.GState) {
        doc.setTextColor(200, 60, 60);
        doc.setGState(new doc.GState({ opacity: 0.16 }));
        doc.text('ANULADO', pageW / 2, pageH / 2, { align: 'center', angle: 22 });
        doc.setGState(new doc.GState({ opacity: 1 }));
      } else {
        doc.setTextColor(240, 205, 205);
        doc.text('ANULADO', pageW / 2, pageH / 2, { align: 'center', angle: 22 });
      }
    } catch (e) { /* sin marca de agua, pero con documento */ }
  }

  const etiqueta = { factura: 'Factura', recibo: 'Recibo', presupuesto: 'Presupuesto' }[tipo] || 'Comprobante';
  return {
    blob: doc.output('blob'),
    filename: `${etiqueta}-${o.order_number || docToday()}.pdf`,
    doc,
  };
}

/* ====================================================================
   Caché del día: el catálogo son 600 presentaciones y las PC de la
   tienda son viejas. Se genera UNA vez por día y por usuario, se guarda
   en Storage y los envíos siguientes reusan ese archivo.
   ==================================================================== */
const _docCacheSesion = {};   // clave → {path, blob, filename}

async function docArchivoDelDia(clase, bucket = 'jjp-wa-media') {
  const clave = `${clase}:${bucket}`;
  if (_docCacheSesion[clave]) return _docCacheSesion[clave];

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Sin sesión');

  const nombre = clase === 'catalogo'
    ? `Catalogo-JJPaper-${docToday()}.pdf`
    : `Lista-de-precios-JJPaper-${docToday()}.pdf`;
  const path = `${user.id}/_docs/${nombre}`;

  // ¿Ya está subido hoy? La política de Storage exige que la primera
  // carpeta sea el uid, por eso el archivo es por usuario.
  const { data: existentes } = await sb.storage.from(bucket)
    .list(`${user.id}/_docs`, { search: nombre, limit: 1 });
  if (existentes?.some(f => f.name === nombre)) {
    const listo = { path, filename: nombre, blob: null, bucket };
    _docCacheSesion[clave] = listo;
    return listo;
  }

  const { blob } = clase === 'catalogo' ? await docPdfCatalogo() : await docPdfListaPrecios();
  const { error } = await sb.storage.from(bucket)
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error('No se pudo guardar el PDF: ' + error.message);

  const listo = { path, filename: nombre, blob, bucket };
  _docCacheSesion[clave] = listo;
  return listo;
}

/* Descarga directa (lo que ya hacía el botón del sitio público) */
function docDescargar(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
