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
   CSV (abre en Excel / Google Sheets)
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
function prefetchPdfLib() { ensurePdfLib().catch(() => {}); }

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

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const rate = getRate();
  const GREEN = [16, 107, 58];

  const body = rows.map(r => [
    r.cat,
    r.name + (r.brand ? ` — ${r.brand}` : '') + (r.pres ? ` (${r.pres})` : ''),
    r.unit,
    `$${r.usd.toFixed(2)}`,
    `Bs ${r.bs.toFixed(2)}`,
    r.stock,
  ]);

  doc.autoTable({
    head: [['Categoría', 'Producto', 'Unidad', 'USD', 'Bs', 'Stock']],
    body,
    startY: 96,
    margin: { top: 96, bottom: 40 },
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 247, 242] },
    columnStyles: {
      0: { cellWidth: 78 },
      2: { cellWidth: 44, halign: 'center' },
      3: { cellWidth: 52, halign: 'right' },
      4: { cellWidth: 62, halign: 'right' },
      5: { cellWidth: 40, halign: 'center' },
    },
    didDrawPage: (data) => {
      // Encabezado verde
      doc.setFillColor(...GREEN);
      doc.rect(0, 0, pageW, 66, 'F');

      // Badge de logo (círculo menta + anillo blanco + monograma JJ)
      const bx = 52, by = 33, br = 21;
      doc.setFillColor(119, 201, 155);            // menta #77C99B
      doc.circle(bx, by, br, 'F');
      doc.setDrawColor(255); doc.setLineWidth(2.4);
      doc.circle(bx, by, br - 3, 'S');            // anillo
      doc.setTextColor(255);
      doc.setFont('times', 'bold'); doc.setFontSize(22);
      doc.text('JJ', bx, by + 7, { align: 'center' });

      // Wordmark
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text('JJ Paper', 84, 30);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.text('Catálogo mayorista', 84, 48);
      doc.setFontSize(9);
      doc.text(`Tasa BCV Bs ${rate.toFixed(2)}/USD · ${todayStamp()}`, pageW - 40, 30, { align: 'right' });
      doc.text('Precios sujetos a cambio', pageW - 40, 46, { align: 'right' });
      // Pie con número de página
      const page = doc.internal.getNumberOfPages();
      doc.setTextColor(150); doc.setFontSize(8);
      doc.text(`JJ Paper  ·  Página ${page}`, pageW / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' });
    },
  });

  doc.save(`Catalogo-JJPaper-${todayStamp()}.pdf`);
  showToast('Catálogo PDF descargado', 'ok');
}

/* ------------------------------------------------------
   UI: botón + menú de descarga
   ------------------------------------------------------ */
function downloadCatalog(fmt) {
  closeDlMenu();
  if (fmt === 'pdf') exportPDF();
  else exportCSV();
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
