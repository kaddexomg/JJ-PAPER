/* ======================================================
   JJ Paper — Descarga de catálogo (PDF folleto + Excel/CSV)

   El PDF lo dibuja doc-engine.js: el archivo que el cliente
   descarga del sitio y el que el vendedor le manda por WhatsApp
   son EXACTAMENTE el mismo documento. Aquí queda solo la parte
   de Excel/CSV y el menú del botón.

   Exporta SIEMPRE el catálogo completo (ignora filtros), con
   precios en USD y Bs a la tasa BCV vigente.
   ====================================================== */

// Fecha corta para nombre de archivo: AAAA-MM-DD
function todayStamp() { return docToday(); }

// Descarga un Blob con nombre dado
function downloadBlob(blob, filename) { docDescargar(blob, filename); }

/* ------------------------------------------------------
   CSV — fallback si el generador de Excel (.xlsx) no carga
   - Separador ';' (Excel en español lo toma como columnas)
   - BOM ﻿ para que respete los acentos
   ------------------------------------------------------ */
async function exportCSV() {
  setDlBusy(true, 'Generando CSV...');
  let rows;
  try { rows = await docLoadCatalogRows(); }
  finally { setDlBusy(false); }
  if (!rows.length) { showToast('No hay productos para exportar', 'err'); return; }

  const rate = getRate();
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Familia','Subcategoría','Producto','Marca','Presentación','SKU','Unidad','Precio USD','Precio Bs','Stock'];
  const lines = [head.map(q).join(';')];

  rows.forEach(r => lines.push([
    q(r.cat), q(r.sub), q(r.name), q(r.brand), q(r.pres), q(r.sku), q(r.unit),
    q(r.usd.toFixed(2)), q(r.bs.toFixed(2)), q(r.stock),
  ].join(';')));

  lines.push('');
  lines.push(q(`Precios a tasa BCV Bs ${rate.toFixed(2)}/USD — generado ${todayStamp()}. Sujetos a cambio.`));

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Catalogo-JJPaper-${todayStamp()}.csv`);
  showToast('Catálogo CSV descargado', 'ok');
}

// Carga un script por URL (lo usa el generador de Excel)
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

// Precarga en segundo plano (hover/focus del botón) → el clic se siente instantáneo
function prefetchPdfLib() {
  docEnsurePdfLib().catch(() => {});
  docLogoPng().catch(() => {});
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

/* ------------------------------------------------------
   PDF — lo genera el motor de documentos
   ------------------------------------------------------ */
async function exportPDF() {
  setDlBusy(true, 'Generando PDF...');
  try {
    const { blob, filename } = await docPdfCatalogo();
    downloadBlob(blob, filename);
    showToast('Catálogo PDF descargado', 'ok');
  } catch (e) {
    console.error('exportPDF:', e);
    showToast('No se pudo generar el PDF. Revisa tu conexión.', 'err');
  } finally {
    setDlBusy(false);
  }
}

/* Lista de precios para el cliente (sin existencias) */
async function exportListaPrecios() {
  setDlBusy(true, 'Generando lista...');
  try {
    const { blob, filename } = await docPdfListaPrecios();
    downloadBlob(blob, filename);
    showToast('Lista de precios descargada', 'ok');
  } catch (e) {
    console.error('exportListaPrecios:', e);
    showToast('No se pudo generar la lista de precios', 'err');
  } finally {
    setDlBusy(false);
  }
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
  let rows;
  try {
    rows = await docLoadCatalogRows();
    await ensureXlsxLib();
  } catch (e) {
    setDlBusy(false);
    showToast('Generador Excel no disponible; descargando CSV', 'warn');
    exportCSV();                  // fallback con los mismos datos
    return;
  }
  setDlBusy(false);

  if (!rows.length) { showToast('No hay productos para exportar', 'err'); return; }

  const rate = getRate();
  // Misma paleta que el PDF (doc-engine) y que variables.css
  const B = {
    deep:  { hex: '003333' }, green: { hex: '16604A' }, ring: { hex: 'A7D7A0' },
    brass: { hex: 'C9A24B' }, light: { hex: 'EFF6E4' }, zebra: { hex: 'F6FAF4' },
  };
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
  fullRow('Calidad · Compromiso · Confianza  ·  jj-paper.pages.dev', S.subtitle, 16);
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
  else if (fmt === 'lista') exportListaPrecios();
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
