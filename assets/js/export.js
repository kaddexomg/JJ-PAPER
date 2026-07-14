/* ======================================================
   JJ Paper — Descarga de catálogo (PDF folleto + Excel/CSV)
   - Exporta SIEMPRE el catálogo completo (ignora filtros).
   - Precios en USD y Bs calculados a la tasa BCV vigente
     (getRate() se refresca a diario), así el archivo queda
     al día con la brecha BCV/USDT sin editar nada.
   ====================================================== */

// ---- Filas de exportación (una por variante; si no hay, una por producto) ----
function exportRows() {
  const rows = [];
  const stockTxt = s => (s == null || s < 0) ? '∞' : String(s);
  const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
  (allProducts || []).forEach(p => {
    const cat = p.jjp_categories?.name || 'Otros';
    if (p.variants?.length) {
      p.variants.forEach(v => rows.push({
        cat, name: p.name || '—',
        brand: v.jjp_brands?.name || '',
        pres:  v.variant_name || '',
        sku:   v.sku || '',
        unit:  p.unit || 'unid',
        usd:   num(v.price_usd),
        bs:    num(toBs(num(v.price_usd))),
        stock: stockTxt(v.stock),
      }));
    } else {
      rows.push({
        cat, name: p.name || '—', brand: '', pres: '', sku: '',
        unit: p.unit || 'unid',
        usd: num(p.price_usd), bs: num(toBs(num(p.price_usd))),
        stock: stockTxt(p.stock),
      });
    }
  });
  // Ordena por categoría y luego por nombre para un archivo legible
  rows.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return rows;
}

// Fecha corta para nombre de archivo: AAAA-MM-DD
function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Descarga un Blob con nombre dado
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------
   Paleta de marca para los archivos exportados
   (misma que variables.css — mantener en sync)
   ------------------------------------------------------ */
const EXPORT_BRAND = {
  deep:  { rgb: [0, 51, 51],     hex: '003333' },  /* --gdk verde profundo */
  green: { rgb: [22, 96, 74],    hex: '16604A' },  /* --gd verde JJ */
  ring:  { rgb: [167, 215, 160], hex: 'A7D7A0' },  /* anillo del logo */
  brass: { rgb: [201, 162, 75],  hex: 'C9A24B' },  /* --am dorado latón */
  light: { rgb: [239, 246, 228], hex: 'EFF6E4' },  /* --gx fondo lima suave */
  zebra: { rgb: [246, 250, 244], hex: 'F6FAF4' },  /* fila alterna */
};

// Logo oficial (assets/img/logo.svg) rasterizado a PNG para jsPDF.
// Cachea la promesa; si el navegador no puede rasterizar, devuelve null
// y el PDF cae al badge dibujado a mano.
let _logoPngPromise = null;
function logoPngDataUrl(size = 256) {
  if (_logoPngPromise) return _logoPngPromise;
  _logoPngPromise = new Promise((resolve) => {
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
    img.src = 'assets/img/logo.svg';
  }).then(v => { if (!v) _logoPngPromise = null; return v; });
  return _logoPngPromise;
}

/* ------------------------------------------------------
   CSV — fallback si el generador de Excel (.xlsx) no carga
   - Separador ';' (Excel en español lo toma como columnas)
   - BOM ﻿ para que respete los acentos
   ------------------------------------------------------ */
async function exportCSV() {
  setDlBusy(true, 'Generando CSV...');
  try { await ensureProducts(); } finally { setDlBusy(false); }
  const rows = exportRows();
  if (!rows.length) { showToast('No hay productos para exportar', 'err'); return; }

  const rate = getRate();
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Categoría','Producto','Marca','Presentación','SKU','Unidad','Precio USD','Precio Bs','Stock'];
  const lines = [head.map(q).join(';')];

  rows.forEach(r => lines.push([
    q(r.cat), q(r.name), q(r.brand), q(r.pres), q(r.sku), q(r.unit),
    q(r.usd.toFixed(2)), q(r.bs.toFixed(2)), q(r.stock),
  ].join(';')));

  lines.push('');
  lines.push(q(`Precios a tasa BCV Bs ${rate.toFixed(2)}/USD — generado ${todayStamp()}. Sujetos a cambio.`));

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Catalogo-JJPaper-${todayStamp()}.csv`);
  showToast('Catálogo CSV descargado', 'ok');
}

/* ------------------------------------------------------
   PDF (folleto) — jsPDF + autoTable, cargados solo al pedirlo
   ------------------------------------------------------ */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

// Carga jsPDF + autoTable una sola vez. Reintenta con mirror (unpkg) si
// jsdelivr falla. Cachea la promesa: varios clics comparten la misma carga.
let _pdfPromise = null;
function ensurePdfLib() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return Promise.resolve();
  if (_pdfPromise) return _pdfPromise;
  const mirrors = [
    ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
     'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'],
    ['https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
     'https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'],
  ];
  _pdfPromise = (async () => {
    let lastErr;
    for (const [core, plugin] of mirrors) {
      try { await loadScript(core); await loadScript(plugin); return; }
      catch (e) { lastErr = e; }
    }
    _pdfPromise = null;           // permite reintentar en el próximo clic
    throw lastErr;
  })();
  return _pdfPromise;
}

// Precarga en segundo plano (hover/focus del botón) → el clic se siente instantáneo
function prefetchPdfLib() {
  ensurePdfLib().catch(() => {});
  logoPngDataUrl().catch(() => {});   // el logo también se precachea
}

// Garantiza que el catálogo esté cargado antes de exportar (clave en index.html)
async function ensureProducts() {
  if (!Array.isArray(allProducts) || !allProducts.length) {
    if (typeof loadProducts === 'function') await loadProducts();
  }
}

// Estado ocupado del botón de descarga (evita doble clic, muestra progreso)
function setDlBusy(on, label) {
  const btn = document.getElementById('dlBtn');
  if (!btn) return;
  btn.disabled = on;
  btn.style.opacity = on ? '.7' : '';
  btn.style.pointerEvents = on ? 'none' : '';
  if (on) { btn.dataset.txt = btn.dataset.txt || btn.textContent; btn.textContent = label || 'Generando...'; }
  else if (btn.dataset.txt) { btn.textContent = btn.dataset.txt; delete btn.dataset.txt; }
}

async function exportPDF() {
  setDlBusy(true, 'Generando PDF...');
  try {
    await ensureProducts();
    await ensurePdfLib();
  } catch (e) {
    setDlBusy(false);
    showToast('No se pudo cargar el generador de PDF. Revisa tu conexión.', 'err');
    return;
  }
  setDlBusy(false);

  const rows = exportRows();
  if (!rows.length) { showToast('No hay productos para exportar', 'err'); return; }

  // Logo real (puede tardar unos ms la primera vez; null → badge dibujado)
  const logoPng = await logoPngDataUrl().catch(() => null);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const rate  = getRate();
  const B     = EXPORT_BRAND;
  const s     = APP.SETTINGS || {};
  const phone = s.phone_display || '+58 412-1234567';
  const mail  = s.email || 'ventas@jjpaper.com.ve';

  // ---- Cuerpo agrupado por categoría: banda de sección + productos ----
  const cats = [...new Set(rows.map(r => r.cat))];
  const body = [];
  cats.forEach(cat => {
    const items = rows.filter(r => r.cat === cat);
    body.push([{
      content: `${cat.toUpperCase()}  ·  ${items.length} producto${items.length !== 1 ? 's' : ''}`,
      colSpan: 6,
      styles: { fillColor: B.light.rgb, textColor: B.green.rgb, fontStyle: 'bold',
                fontSize: 9.5, cellPadding: { top: 7, bottom: 6, left: 8 }, halign: 'left' },
    }]);
    items.forEach(r => body.push([
      r.name,
      [r.brand, r.pres].filter(Boolean).join(' · ') || '—',
      r.unit,
      `$${r.usd.toFixed(2)}`,
      `Bs ${r.bs.toFixed(2)}`,
      r.stock,
    ]));
  });

  const HEAD_H = 74;
  doc.autoTable({
    head: [['Producto', 'Marca / Presentación', 'Unidad', 'Precio USD', 'Precio Bs', 'Stock']],
    body,
    startY: 108,
    margin: { top: HEAD_H + 26, bottom: 46, left: 40, right: 40 },
    styles: { fontSize: 8, cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
              overflow: 'linebreak', textColor: [40, 44, 42], lineColor: [228, 237, 231], lineWidth: 0.5 },
    headStyles: { fillColor: B.green.rgb, textColor: 255, fontStyle: 'bold', fontSize: 8.5,
                  cellPadding: { top: 6, bottom: 6, left: 6, right: 6 } },
    alternateRowStyles: { fillColor: B.zebra.rgb },
    columnStyles: {
      0: { cellWidth: 168 },
      1: { cellWidth: 108 },
      2: { cellWidth: 46, halign: 'center' },
      3: { cellWidth: 60, halign: 'right', fontStyle: 'bold', textColor: B.green.rgb },
      4: { cellWidth: 72, halign: 'right' },
      5: { cellWidth: 38, halign: 'center' },
    },
    didDrawPage: () => {
      // ---- Encabezado: banda verde profundo + filo dorado latón ----
      doc.setFillColor(...B.deep.rgb);
      doc.rect(0, 0, pageW, HEAD_H, 'F');
      doc.setFillColor(...B.green.rgb);
      doc.rect(0, HEAD_H - 26, pageW, 26, 'F');   // franja inferior verde JJ
      doc.setFillColor(...B.brass.rgb);
      doc.rect(0, HEAD_H, pageW, 2.5, 'F');       // filo latón

      // Logo oficial (o badge dibujado como fallback)
      if (logoPng) {
        doc.addImage(logoPng, 'PNG', 36, 9, 56, 56);
      } else {
        const bx = 62, by = 36, br = 24;
        doc.setFillColor(...B.green.rgb);
        doc.circle(bx, by, br, 'F');
        doc.setDrawColor(...B.ring.rgb); doc.setLineWidth(2.6);
        doc.circle(bx, by, br - 3.5, 'S');
        doc.setTextColor(255);
        doc.setFont('times', 'bold'); doc.setFontSize(24);
        doc.text('JJ', bx, by + 8, { align: 'center' });
      }

      // Wordmark + tagline
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(21);
      doc.text('JJ Paper', 102, 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.setTextColor(...B.ring.rgb);
      doc.text('Catálogo Mayorista  ·  Calidad · Compromiso · Confianza', 102, 46);

      // Datos de emisión (derecha, sobre la franja verde)
      doc.setTextColor(255); doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.text(`Tasa BCV Bs ${rate.toFixed(2)} / USD`, pageW - 40, HEAD_H - 16, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(`Emitido: ${todayStamp()}  ·  Precios sujetos a cambio`, pageW - 40, HEAD_H - 6.5, { align: 'right' });

      // ---- Pie: contacto + página ----
      const page = doc.internal.getNumberOfPages();
      doc.setDrawColor(...B.brass.rgb); doc.setLineWidth(1);
      doc.line(40, pageH - 34, pageW - 40, pageH - 34);
      doc.setTextColor(...B.green.rgb); doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(`WhatsApp ${phone}`, 40, pageH - 20);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
      doc.text(`${mail}  ·  jj-paper.netlify.app`, pageW / 2, pageH - 20, { align: 'center' });
      doc.text(`Página ${page}`, pageW - 40, pageH - 20, { align: 'right' });
    },
  });

  // ---- Resumen bajo el encabezado de la primera página ----
  doc.setPage(1);
  doc.setTextColor(...B.green.rgb);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(`${rows.length} presentaciones  ·  ${cats.length} categorías`, 40, 96);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.setFontSize(8.5);
  doc.text('Pedidos al mayor por WhatsApp o en jj-paper.netlify.app', pageW - 40, 96, { align: 'right' });

  doc.save(`Catalogo-JJPaper-${todayStamp()}.pdf`);
  showToast('Catálogo PDF descargado', 'ok');
}

/* ------------------------------------------------------
   Excel (.xlsx) con estilos de marca — xlsx-js-style por CDN.
   Si la librería no carga, cae al CSV clásico.
   ------------------------------------------------------ */
let _xlsxPromise = null;
function ensureXlsxLib() {
  if (window.XLSX?.utils && window.XLSX.utils.book_new) return Promise.resolve();
  if (_xlsxPromise) return _xlsxPromise;
  const mirrors = [
    'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
    'https://unpkg.com/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  ];
  _xlsxPromise = (async () => {
    let lastErr;
    for (const src of mirrors) {
      try { await loadScript(src); return; }
      catch (e) { lastErr = e; }
    }
    _xlsxPromise = null;          // permite reintentar en el próximo clic
    throw lastErr;
  })();
  return _xlsxPromise;
}

async function exportExcel() {
  setDlBusy(true, 'Generando Excel...');
  try {
    await ensureProducts();
    await ensureXlsxLib();
  } catch (e) {
    setDlBusy(false);
    showToast('Generador Excel no disponible; descargando CSV', 'warn');
    exportCSV();                  // fallback con los mismos datos
    return;
  }
  setDlBusy(false);

  const rows = exportRows();
  if (!rows.length) { showToast('No hay productos para exportar', 'err'); return; }

  const rate = getRate();
  const B = EXPORT_BRAND;
  const border = (c = 'E4EDE7') => ({
    top: { style: 'thin', color: { rgb: c } }, bottom: { style: 'thin', color: { rgb: c } },
    left: { style: 'thin', color: { rgb: c } }, right: { style: 'thin', color: { rgb: c } },
  });
  const S = {
    title:    { font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: B.deep.hex } },
                alignment: { vertical: 'center', horizontal: 'left', indent: 1 } },
    subtitle: { font: { sz: 10, color: { rgb: B.ring.hex } },
                fill: { fgColor: { rgb: B.deep.hex } },
                alignment: { vertical: 'center', horizontal: 'left', indent: 1 } },
    meta:     { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: B.green.hex } },
                alignment: { vertical: 'center', horizontal: 'left', indent: 1 } },
    catBand:  { font: { bold: true, sz: 11, color: { rgb: B.green.hex } },
                fill: { fgColor: { rgb: B.light.hex } },
                alignment: { vertical: 'center', indent: 1 },
                border: border('D5EADE') },
    head:     { font: { bold: true, sz: 9.5, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: B.green.hex } },
                alignment: { vertical: 'center', horizontal: 'center' },
                border: border(B.green.hex) },
    cell:     (alt) => ({ font: { sz: 9.5 },
                fill: alt ? { fgColor: { rgb: B.zebra.hex } } : undefined,
                alignment: { vertical: 'center' }, border: border() }),
    usd:      (alt) => ({ font: { sz: 9.5, bold: true, color: { rgb: B.green.hex } },
                numFmt: '"$"#,##0.00',
                fill: alt ? { fgColor: { rgb: B.zebra.hex } } : undefined,
                alignment: { vertical: 'center', horizontal: 'right' }, border: border() }),
    bs:       (alt) => ({ font: { sz: 9.5 }, numFmt: '"Bs "#,##0.00',
                fill: alt ? { fgColor: { rgb: B.zebra.hex } } : undefined,
                alignment: { vertical: 'center', horizontal: 'right' }, border: border() }),
    center:   (alt) => ({ font: { sz: 9.5 },
                fill: alt ? { fgColor: { rgb: B.zebra.hex } } : undefined,
                alignment: { vertical: 'center', horizontal: 'center' }, border: border() }),
    note:     { font: { italic: true, sz: 9, color: { rgb: '707070' } },
                alignment: { vertical: 'center', indent: 1 } },
  };

  const NCOLS = 6;
  const aoa = [];      // valores
  const styles = [];   // estilo por celda (paralelo a aoa)
  const merges = [];
  const rowHts = [];
  const push = (vals, sts, ht) => { aoa.push(vals); styles.push(sts); rowHts.push({ hpt: ht || 16 }); };
  const fullRow = (v, st, ht) => {
    merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: NCOLS - 1 } });
    push([v, '', '', '', '', ''], [st, st, st, st, st, st], ht);
  };

  // Cabecera de documento
  fullRow('JJ PAPER — Catálogo Mayorista', S.title, 30);
  fullRow('Calidad · Compromiso · Confianza  ·  jj-paper.netlify.app', S.subtitle, 16);
  fullRow(`Emitido: ${todayStamp()}   ·   Tasa BCV: Bs ${rate.toFixed(2)} / USD   ·   Precios sujetos a cambio`, S.meta, 18);
  push(['', '', '', '', '', ''], Array(NCOLS).fill(undefined), 8);

  const HEADERS = ['Producto', 'Marca / Presentación', 'SKU', 'Unidad', 'Precio USD', 'Precio Bs'];
  const cats = [...new Set(rows.map(r => r.cat))];
  cats.forEach(cat => {
    const items = rows.filter(r => r.cat === cat);
    fullRow(`${cat.toUpperCase()}  ·  ${items.length} producto${items.length !== 1 ? 's' : ''}`, S.catBand, 22);
    push(HEADERS, Array(NCOLS).fill(S.head), 18);
    items.forEach((r, i) => {
      const alt = i % 2 === 1;
      push(
        [r.name, [r.brand, r.pres].filter(Boolean).join(' · '), r.sku, r.unit, r.usd, r.bs],
        [S.cell(alt), S.cell(alt), S.center(alt), S.center(alt), S.usd(alt), S.bs(alt)],
        16
      );
    });
    push(['', '', '', '', '', ''], Array(NCOLS).fill(undefined), 8);
  });
  fullRow(`${rows.length} presentaciones en ${cats.length} categorías. Pedidos al mayor por WhatsApp ${APP.SETTINGS?.phone_display || ''}.`.trim(), S.note, 16);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Aplicar estilos celda a celda
  styles.forEach((rowSt, r) => rowSt.forEach((st, c) => {
    if (!st) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].s = st;
  }));
  ws['!merges'] = merges;
  ws['!rows']   = rowHts;
  ws['!cols']   = [{ wch: 38 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
  XLSX.writeFile(wb, `Catalogo-JJPaper-${todayStamp()}.xlsx`);
  showToast('Catálogo Excel descargado', 'ok');
}

/* ------------------------------------------------------
   UI: botón + menú de descarga
   ------------------------------------------------------ */
function downloadCatalog(fmt) {
  closeDlMenu();
  if (fmt === 'pdf') exportPDF();
  else exportExcel();   // 'csv' legado → Excel con estilos (CSV queda de fallback)
}

function toggleDlMenu() {
  const menu = document.getElementById('dlMenu');
  const btn  = document.getElementById('dlBtn');
  if (!menu) return;
  const open = menu.hasAttribute('hidden');
  if (open) {
    menu.removeAttribute('hidden');
    btn?.setAttribute('aria-expanded', 'true');
    prefetchPdfLib();   // arranca la carga del generador PDF mientras el usuario decide
    document.addEventListener('click', onDlOutside, true);
    document.addEventListener('keydown', onDlEsc);
  } else {
    closeDlMenu();
  }
}

function closeDlMenu() {
  const menu = document.getElementById('dlMenu');
  const btn  = document.getElementById('dlBtn');
  if (menu && !menu.hasAttribute('hidden')) menu.setAttribute('hidden', '');
  btn?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onDlOutside, true);
  document.removeEventListener('keydown', onDlEsc);
}

function onDlOutside(e) {
  if (!e.target.closest('.dl-wrap')) closeDlMenu();
}
function onDlEsc(e) {
  if (e.key === 'Escape') { closeDlMenu(); document.getElementById('dlBtn')?.focus(); }
}
