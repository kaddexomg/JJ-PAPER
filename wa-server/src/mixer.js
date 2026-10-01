/* ======================================================
   JJ Paper wa-server — Puente Bidireccional MixNet / Mixer
   ------------------------------------------------------
   1. JJ Paper ➔ MixNet (Exportación):
      - Exporta pedidos (jjp_orders) como pedido_[NUM].csv y .txt
      - Exporta cotizaciones (jjp_quotes) como cotizacion_[NUM].csv y .txt
      - Escribe en la carpeta principal y en TODAS las carpetas de
        intercambio detectadas (C:/JJ-PAPER-MIXER, C:/Pedidos JJ,
        M:/mixnet, etc.).
      - Escucha Realtime e integra barrido periódico cada 30s.
   
   2. MixNet ➔ JJ Paper (Importación):
      - Escanea carpetas de intercambio buscando archivos generados
        por Caja / MixNet (caja_*.csv, ped_*.csv, factura_*.csv, etc.).
      - Si la base de datos DBF de MixNet está conectada (M:/comp01),
        lee registros recientes de PED.DBF / PRESUP.DBF.
      - Asocia clientes en jjp_customers por RIF o teléfono.
      - Inserta automáticamente en jjp_orders (source: 'pos') o
        jjp_quotes (source: 'vendedor').
   
   3. Resiliencia & Monitoreo:
      - Historial persistente en exported-orders.json,
        exported-quotes.json e imported-mixnet.json.
      - getMixerStatus() para heartbeat y panel de control.
   ====================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbCore } from './supabase.js';
import { log } from './logger.js';
import { discoverMixnetEnvironment } from '../auto-detect-mixnet.js';
import {
  readDbfStruct as dbfReadStruct,
  readDbfRows as dbfReadRows,
  buildDbfRecord as dbfBuildRecord,
  appendDbfRecords as dbfAppend,
  getNextSerial as dbfNextSerial,
  getDbfControlSerial as dbfGetControlSerial,
  setDbfSerial as dbfSetSerial,
  findCliente as dbfFindCliente,
  upsertCliente as dbfUpsertCliente,
  upsertDbfHeader as dbfUpsertHeader,
  replaceDbfDetails as dbfReplaceDetails
} from './mixnet-dbf-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'mixnet-config.json');
const HISTORY_ORDERS_FILE = path.join(ROOT_DIR, 'exported-orders.json');
const HISTORY_QUOTES_FILE = path.join(ROOT_DIR, 'exported-quotes.json');
const HISTORY_IMPORTED_FILE = path.join(ROOT_DIR, 'imported-mixnet.json');
const HISTORY_ORDERS_FP_FILE = path.join(ROOT_DIR, 'exported-orders-fp.json');
const HISTORY_QUOTES_FP_FILE = path.join(ROOT_DIR, 'exported-quotes-fp.json');
const HISTORY_PRODUCTS_FP_FILE = path.join(ROOT_DIR, 'product-sync-fp.json');

// Estados en memoria y conjuntos de duplicados
let exportedOrders = new Set();
let exportedQuotes = new Set();
let importedHistory = new Set();
let orderFingerprints = new Map(); // order_number → fingerprint
let quoteFingerprints = new Map(); // quote_number → fingerprint
let productSyncFingerprints = new Map(); // sku → fingerprint (Dirty Check 0 egress)

// Genera una huella digital determinista del documento para detectar cambios reales
function computeDocFingerprint(doc) {
  if (!doc) return '';
  const num = String(doc.order_number || doc.quote_number || '').trim();
  const tot = parseFloat(doc.total_usd ?? doc.estimated_total_usd ?? 0).toFixed(2);
  const items = Array.isArray(doc.items) ? doc.items : (typeof doc.items === 'string' ? JSON.parse(doc.items || '[]') : []);
  const itemsSummary = items.map(i => `${String(i.sku || i.name || '').trim()}:${Number(i.qty || 1)}@${Number(i.price_usd || 0).toFixed(2)}`).join(';');
  const client = String(doc.client_name || '').trim().toLowerCase();
  const notes = String(doc.notes || '').trim().toLowerCase();
  const status = String(doc.status || '').trim().toLowerCase();
  return `${num}|${tot}|${client}|${itemsSummary}|${notes}|${status}`;
}

// Códigos de vendedor MixNet (MXENCPED.codven / MXENCCOT.codven) → vendedor JJ Paper
// En MixNet es estrictamente 005 (010 y 020 son segmentaciones de cartera en JJ Paper que corresponden a 005)
const SELLERS_BY_CODVEN = new Map([
  ['bddc57dc-5bf9-4a72-9e1c-751d07b03164', ['005', '010', '020']],        // Keyder Salazar (005 en MixNet)
  ['07540d9c-4ed9-46d2-95ce-0a0200be6083', ['004', '006']],        // Yovanni Araujo
  ['3c9b7ddd-4b98-45c6-a646-5c557a2bc043', ['008']],               // Marianela (marianela08)
  ['68c29cd3-760a-4282-8214-4e7c60413ec5', ['014']],               // Andreina (andreina)
  ['e6957754-de00-4088-8e54-affcaa172247', ['002']],               // Luis Alarcon (002 en MixNet)
  ['86b0ef8b-a41b-4385-a8f9-314a5052cb94', ['001']],               // Mary Garcia (001 en MixNet)
  ['7eeb41f2-55e1-4e5e-b6c2-3da87582b51b', ['025']],               // Ana Barajas (025 en MixNet)
  ['9201071b-ab77-4de3-90a4-a79c93c4213c', ['032']],               // JJ Paper 32 (032 en MixNet)
  ['4d76dc4c-503a-48ca-9c98-f9ea3d2af755', ['026']],               // JJ Paper 26 (026 en MixNet)
  ['23723fcb-b26d-4e5a-b451-c4ea118a7ce3', ['003']],               // JJ Paper 3 (003 en MixNet)
  ['485e3fde-f95d-4857-9175-147051a54748', ['033']],               // JJ Paper 33 (033 en MixNet)
]);
const CODVEN_HINT = new Map([
  ['005', 'Keyder Salazar (005)'],
  ['010', 'Keyder (Zona 010)'], ['020', 'Keyder (Zona 020)'],
  ['004', 'Yovanni'], ['006', 'Yovanni'],
  ['008', 'Marianela'], ['014', 'Andreina'],
  ['002', 'Luis Alarcon (002)'],
  ['001', 'Mary Garcia (001)'],
  ['025', 'Ana Barajas (025)'],
  ['032', 'Vendedor 032'],
  ['026', 'Vendedor 026'],
  ['003', 'Vendedor 003'],
  ['033', 'Vendedor 033']
]);
function sellerForCodven(codven) {
  const cv = String(codven || '').trim();
  for (const [sid, codes] of SELLERS_BY_CODVEN.entries()) {
    if (codes.includes(cv)) return { seller_id: sid, hint: CODVEN_HINT.get(cv) || cv };
  }
  return { seller_id: null, hint: cv || 'Caja MixNet' };
}
function codvenForSeller(sellerId) {
  if (!sellerId) return '';
  if (sellerId === 'bddc57dc-5bf9-4a72-9e1c-751d07b03164') return '005';
  for (const [sid, codes] of SELLERS_BY_CODVEN.entries()) {
    if (sid === sellerId) return codes[0];
  }
  return '';
}

let activePrimaryDir = null;
let activeDropDirs = [];
let activeDbfDir = null;

let lastSweepTime = null;
let lastImportTime = null;
let mixerInitialized = false;

/* ═══════════════ CARGA Y PERSISTENCIA DE HISTORIALES ═══════════════ */
function loadHistories() {
  try {
    if (fs.existsSync(HISTORY_ORDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_ORDERS_FILE, 'utf8'));
      exportedOrders = new Set(data || []);
    }
    if (fs.existsSync(HISTORY_QUOTES_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_QUOTES_FILE, 'utf8'));
      exportedQuotes = new Set(data || []);
    }
    if (fs.existsSync(HISTORY_IMPORTED_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_IMPORTED_FILE, 'utf8'));
      importedHistory = new Set(data || []);
    }
    if (fs.existsSync(HISTORY_ORDERS_FP_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(HISTORY_ORDERS_FP_FILE, 'utf8'));
        orderFingerprints = new Map(Object.entries(data || {}));
      } catch (_) {}
    }
    if (fs.existsSync(HISTORY_QUOTES_FP_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(HISTORY_QUOTES_FP_FILE, 'utf8'));
        quoteFingerprints = new Map(Object.entries(data || {}));
      } catch (_) {}
    }
    if (fs.existsSync(HISTORY_PRODUCTS_FP_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(HISTORY_PRODUCTS_FP_FILE, 'utf8'));
        productSyncFingerprints = new Map(Object.entries(data || {}));
      } catch (_) {}
    }
    log.info(`Puente Mixer: Historiales cargados (Pedidos: ${exportedOrders.size} [${orderFingerprints.size} huellas], Cotizaciones: ${exportedQuotes.size} [${quoteFingerprints.size} huellas], Catálogo: ${productSyncFingerprints.size} huellas, Importados: ${importedHistory.size})`);
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Advertencia cargando historiales');
  }
}

function saveHistories() {
  try {
    fs.writeFileSync(HISTORY_ORDERS_FILE, JSON.stringify(Array.from(exportedOrders), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_QUOTES_FILE, JSON.stringify(Array.from(exportedQuotes), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_IMPORTED_FILE, JSON.stringify(Array.from(importedHistory), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_ORDERS_FP_FILE, JSON.stringify(Object.fromEntries(orderFingerprints), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_QUOTES_FP_FILE, JSON.stringify(Object.fromEntries(quoteFingerprints), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_PRODUCTS_FP_FILE, JSON.stringify(Object.fromEntries(productSyncFingerprints), null, 2), 'utf8');
  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Error guardando historiales');
  }
}

/* ═══════════════ CONFIGURACIÓN Y AUTO-DESCUBRIMIENTO ═══════════════ */
function refreshEnvironmentConfig() {
  try {
    let cfg = null;
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } else {
      cfg = discoverMixnetEnvironment();
    }

    if (cfg) {
      activePrimaryDir = cfg.primary_dir || activePrimaryDir;
      activeDropDirs = Array.isArray(cfg.drop_dirs) ? cfg.drop_dirs : [];
      activeDbfDir = cfg.dbf_dir || null;
    }

    // Auto-sanación: si activeDbfDir es null o no existe, verificar si M:/MIX11/comp01 o primaryDir tienen DBFs
    if (!activeDbfDir || !fs.existsSync(activeDbfDir)) {
      const dbfCandidates = ['M:/MIX11/comp01', 'M:\\MIX11\\comp01', 'M:/comp01', 'M:\\comp01', activePrimaryDir, '//servidor/MIX11/comp01'].filter(Boolean);
      for (const cand of dbfCandidates) {
        try {
          if (fs.existsSync(cand) && (fs.existsSync(path.join(cand, 'MXCTAINV.DBF')) || fs.existsSync(path.join(cand, 'mxctainv.dbf')))) {
            activeDbfDir = cand.replace(/\\/g, '/');
            break;
          }
        } catch (_) {}
      }
    }

    // Mantener solo carpetas de intercambio que realmente existan físicamente
    activeDropDirs = activeDropDirs.filter(d => fs.existsSync(d));
    if (activeDbfDir && fs.existsSync(activeDbfDir) && !activeDropDirs.includes(activeDbfDir)) {
      activeDropDirs.unshift(activeDbfDir);
    }
    if (activePrimaryDir && fs.existsSync(activePrimaryDir) && !activeDropDirs.includes(activePrimaryDir)) {
      activeDropDirs.unshift(activePrimaryDir);
    }

    log.info(`Puente Mixer: Rutas activas -> Principal: ${activePrimaryDir || 'Pendiente'} | Drop dirs: [${activeDropDirs.join(', ') || 'Ninguna'}] | DBF: ${activeDbfDir || 'No detectado'}`);
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Error refrescando configuración de MixNet');
  }
}

/* ═══════════════ HELPERS DE FORMATEO CSV & TXT ═══════════════ */
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.includes(',') || str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function writeToAllDropDirs(filename, content) {
  let successCount = 0;
  for (const dir of activeDropDirs) {
    try {
      if (!fs.existsSync(dir)) continue; // NUNCA crear carpetas nuevas arbitrarias
      const targetPath = path.join(dir, filename);
      fs.writeFileSync(targetPath, content, 'utf8');
      successCount++;
    } catch (err) {
      log.warn({ err: err.message, dir, filename }, 'Puente Mixer: Error escribiendo en carpeta de MixNet');
    }
  }
  // Si activeDbfDir está presente pero no estaba en activeDropDirs, escribir allí
  if (successCount === 0 && activeDbfDir && fs.existsSync(activeDbfDir)) {
    try {
      fs.writeFileSync(path.join(activeDbfDir, filename), content, 'utf8');
      successCount++;
    } catch (_) {}
  }
  return successCount > 0;
}

/* ═══════════════ EXPORTACIÓN: JJ PAPER ➔ MIXNET ═══════════════ */

// 1. Exportar Pedido (jjp_orders)
export async function exportOrder(o) {
  if (!o || !o.order_number) return false;
  if (o.order_number.startsWith('MIX-')) return false;
  if (o.source === 'mixnet') return false;
  const fp = computeDocFingerprint(o);
  if (orderFingerprints.get(o.order_number) === fp) return false;

  const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || '[]') : []);

  // CSV
  const csvHeaders = [
    'Pedido', 'Fecha', 'Cliente', 'RIF', 'Telefono', 'Ciudad', 'Direccion',
    'SKU', 'Producto', 'Marca', 'Cantidad', 'PrecioUnitario', 'SubtotalLinea',
    'TotalPedidoUSD', 'TasaCambio', 'TotalPedidoBs', 'MetodoPago', 'Referencia', 'Notas'
  ];

  const csvRows = items.length > 0 ? items.map(i => [
    o.order_number,
    o.created_at,
    o.client_name,
    o.rif || '',
    o.phone || '',
    o.city || '',
    o.address || '',
    i.sku || '',
    i.name || '',
    i.brand || '',
    i.qty || 1,
    i.price_usd || 0,
    (i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))).toFixed(2),
    o.total_usd || 0,
    o.exchange_rate || 0,
    o.total_bs || (o.total_usd * (o.exchange_rate || 0)).toFixed(2),
    o.payment_method || '',
    o.payment_ref || '',
    o.notes || ''
  ].map(escapeCSV).join(',')) : [
    [
      o.order_number, o.created_at, o.client_name, o.rif || '', o.phone || '', o.city || '', o.address || '',
      '', 'Pedido sin ítems desglosados', '', 1, o.total_usd || 0, o.total_usd || 0,
      o.total_usd || 0, o.exchange_rate || 0, o.total_bs || 0, o.payment_method || '', o.payment_ref || '', o.notes || ''
    ].map(escapeCSV).join(',')
  ];

  const csvContent = csvHeaders.join(',') + '\n' + csvRows.join('\n');

  // TXT (formato amigable para lectura/ticket)
  const txtLines = [];
  txtLines.push('================================================');
  txtLines.push(`PEDIDO JJ PAPER: ${o.order_number}`);
  txtLines.push(`Fecha: ${new Date(o.created_at).toLocaleString('es-VE')}`);
  txtLines.push(`Cliente: ${o.client_name}`);
  if (o.rif) txtLines.push(`RIF/CI:  ${o.rif}`);
  if (o.phone) txtLines.push(`Teléfono: ${o.phone}`);
  if (o.city || o.address) txtLines.push(`Destino: ${[o.city, o.address].filter(Boolean).join(' - ')}`);
  if (o.payment_method) txtLines.push(`Pago:    ${o.payment_method}${o.payment_ref ? ` (Ref: ${o.payment_ref})` : ''}`);
  txtLines.push('================================================');
  txtLines.push('Cant.   Producto [Marca]            P.Unit   Subtotal');
  txtLines.push('------------------------------------------------');
  items.forEach(i => {
    const brandStr = i.brand ? ` [${i.brand}]` : '';
    const namePart = `${i.name || ''}${brandStr}`.substring(0, 28).padEnd(28, ' ');
    const qtyPart = String(i.qty || 1).padStart(4, ' ');
    const pricePart = parseFloat(i.price_usd || 0).toFixed(2).padStart(8, ' ');
    const subPart = parseFloat(i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))).toFixed(2).padStart(9, ' ');
    txtLines.push(`${qtyPart} x ${namePart} ${pricePart} ${subPart}`);
  });
  txtLines.push('------------------------------------------------');
  txtLines.push(`TOTAL USD: $${parseFloat(o.total_usd || 0).toFixed(2)}`);
  if (o.exchange_rate) {
    txtLines.push(`Tasa oficial: ${parseFloat(o.exchange_rate).toFixed(2)} Bs/$`);
    const totBs = o.total_bs || (parseFloat(o.total_usd || 0) * parseFloat(o.exchange_rate));
    txtLines.push(`TOTAL BS:  ${parseFloat(totBs).toFixed(2)} Bs`);
  }
  if (o.notes) {
    txtLines.push('------------------------------------------------');
    txtLines.push(`Notas: ${o.notes}`);
  }
  txtLines.push('================================================');
  const txtContent = txtLines.join('\n');

  // Escribir en todas las carpetas
  const okCsv = writeToAllDropDirs(`pedido_${o.order_number}.csv`, csvContent);
  const okTxt = writeToAllDropDirs(`pedido_${o.order_number}.txt`, txtContent);

  // Escritura nativa en DBF MixNet desactivada por seguridad para proteger índices NTX e integridad
  /*
  if (activeDbfDir && !o.order_number.startsWith('MIX-')) {
    try {
      const dbfRes = await exportOrderToDbf(o);
      if (!dbfRes.ok && dbfRes.reason && dbfRes.reason !== 'no-dbf-dir') {
        log.warn({ err: dbfRes.reason }, 'Puente Mixer: Fallo escritura DBF de pedido, se conserva CSV/TXT');
      }
    } catch (err) {
      log.warn({ err: err.message }, 'Puente Mixer: Excepción escritura DBF de pedido');
    }
  }
  */

  if (okCsv || okTxt) {
    exportedOrders.add(o.order_number);
    orderFingerprints.set(o.order_number, fp);
    saveHistories();
    log.info(`Puente Mixer: Pedido ${o.order_number} exportado correctamente a carpetas de intercambio.`);
    return true;
  }
  return false;
}

// 2. Exportar Cotización (jjp_quotes)
export async function exportQuote(q) {
  if (!q || !q.quote_number) return false;
  if (q.quote_number.startsWith('MIX-')) return false;
  if (q.source === 'mixnet') return false;
  const fp = computeDocFingerprint(q);
  if (quoteFingerprints.get(q.quote_number) === fp) return false;

  const items = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items || '[]') : []);

  // CSV
  const csvHeaders = [
    'Cotizacion', 'Fecha', 'Cliente', 'RIF', 'Telefono', 'Ciudad', 'Direccion',
    'SKU', 'Producto', 'Marca', 'Cantidad', 'PrecioUnitario', 'SubtotalLinea',
    'TotalCotizacionUSD', 'TasaCambio', 'TotalCotizacionBs', 'Notas'
  ];

  const totalUSD = q.estimated_total_usd || 0;
  const rate = q.exchange_rate || 0;
  const totalBs = (totalUSD * rate).toFixed(2);

  const csvRows = items.length > 0 ? items.map(i => [
    q.quote_number,
    q.created_at,
    q.client_name,
    q.rif || '',
    q.phone || '',
    q.city || '',
    q.address || '',
    i.sku || '',
    i.name || '',
    i.brand || '',
    i.qty || 1,
    i.price_usd || 0,
    (i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))).toFixed(2),
    totalUSD,
    rate,
    totalBs,
    q.notes || ''
  ].map(escapeCSV).join(',')) : [
    [
      q.quote_number, q.created_at, q.client_name, q.rif || '', q.phone || '', q.city || '', q.address || '',
      '', 'Cotización sin ítems desglosados', '', 1, totalUSD, totalUSD,
      totalUSD, rate, totalBs, q.notes || ''
    ].map(escapeCSV).join(',')
  ];

  const csvContent = csvHeaders.join(',') + '\n' + csvRows.join('\n');

  // TXT
  const txtLines = [];
  txtLines.push('================================================');
  txtLines.push(`COTIZACION JJ PAPER: ${q.quote_number}`);
  txtLines.push(`Fecha: ${new Date(q.created_at).toLocaleString('es-VE')}`);
  txtLines.push(`Cliente: ${q.client_name}`);
  if (q.rif) txtLines.push(`RIF/CI:  ${q.rif}`);
  if (q.phone) txtLines.push(`Teléfono: ${q.phone}`);
  if (q.city || q.address) txtLines.push(`Destino: ${[q.city, q.address].filter(Boolean).join(' - ')}`);
  txtLines.push('================================================');
  txtLines.push('Cant.   Producto [Marca]            P.Unit   Subtotal');
  txtLines.push('------------------------------------------------');
  items.forEach(i => {
    const brandStr = i.brand ? ` [${i.brand}]` : '';
    const namePart = `${i.name || ''}${brandStr}`.substring(0, 28).padEnd(28, ' ');
    const qtyPart = String(i.qty || 1).padStart(4, ' ');
    const pricePart = parseFloat(i.price_usd || 0).toFixed(2).padStart(8, ' ');
    const subPart = parseFloat(i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))).toFixed(2).padStart(9, ' ');
    txtLines.push(`${qtyPart} x ${namePart} ${pricePart} ${subPart}`);
  });
  txtLines.push('------------------------------------------------');
  txtLines.push(`TOTAL ESTIMADO USD: $${parseFloat(totalUSD).toFixed(2)}`);
  if (rate) {
    txtLines.push(`Tasa oficial: ${parseFloat(rate).toFixed(2)} Bs/$`);
    txtLines.push(`TOTAL ESTIMADO BS:  ${parseFloat(totalBs).toFixed(2)} Bs`);
  }
  if (q.notes) {
    txtLines.push('------------------------------------------------');
    txtLines.push(`Notas: ${q.notes}`);
  }
  txtLines.push('================================================');
  const txtContent = txtLines.join('\n');

  // Escribir en todas las carpetas
  const okCsv = writeToAllDropDirs(`cotizacion_${q.quote_number}.csv`, csvContent);
  const okTxt = writeToAllDropDirs(`cotizacion_${q.quote_number}.txt`, txtContent);

  // Escritura nativa en DBF MixNet desactivada por seguridad para proteger índices NTX e integridad
  /*
  if (activeDbfDir && !q.quote_number.startsWith('MIX-')) {
    try {
      const dbfRes = await exportQuoteToDbf(q);
      if (!dbfRes.ok && dbfRes.reason && dbfRes.reason !== 'no-dbf-dir') {
        log.warn({ err: dbfRes.reason }, 'Puente Mixer: Fallo escritura DBF de cotización, se conserva CSV/TXT');
      }
    } catch (err) {
      log.warn({ err: err.message }, 'Puente Mixer: Excepción escritura DBF de cotización');
    }
  }
  */

  if (okCsv || okTxt) {
    exportedQuotes.add(q.quote_number);
    quoteFingerprints.set(q.quote_number, fp);
    saveHistories();
    log.info(`Puente Mixer: Cotización ${q.quote_number} exportada correctamente a carpetas de intercambio.`);
    return true;
  }
  return false;
}

/* ═══════════════ EXPORTACIÓN NATIVA A DBF MIXNET (serial correlativo) ═══════════════ */

// Construye el objeto de cliente para MXCTACLI a partir de una cotización/pedido JJ.
function clienteForDoc(doc) {
  const name = String(doc.client_name || '').trim();
  const cif = String(doc.rif || '').trim();
  const phone = String(doc.phone || '').trim();
  const email = String(doc.email || '').trim();
  const direccion = [doc.address, doc.city].filter(v => v && String(v).trim()).join(', ');
  return { name, cif, phone, email, direccion, vendedor: codvenForSeller(doc.seller_id) };
}

// Fecha YYYYMMDD para campos D del DBF.
function dbfYmd(date) {
  const d = date ? new Date(date) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// Regresa el número de documento nuevo (NUMCOT/NUMPED) registrándolo en historiales
// para que el importador DBF no lo reimporte (guard anti round-trip con serial puro de 8 dígitos).
function registerDbfExport(isQuote, serial) {
  const pureSerial = String(serial).padStart(8, '0').slice(-8);
  const dbfKey = isQuote ? `dbf:cot:${pureSerial}` : `dbf:ped:${pureSerial}`;
  const finalNum = pureSerial;
  importedHistory.add(dbfKey);
  if (isQuote) exportedQuotes.add(finalNum);
  else exportedOrders.add(finalNum);
  saveHistories();
  return dbfKey;
}

// Crea un registro de cabecera de cotización para MXENCCOT.
function buildQuoteHeaderRecord(encStruct, q, numcot, codcli) {
  const today = dbfYmd(q.created_at || new Date());
  const totalUSD = parseFloat(q.estimated_total_usd || 0).toFixed(2);
  const rate = parseFloat(q.exchange_rate || 0).toFixed(2);
  const sellerCodven = codvenForSeller(q.seller_id);
  return dbfBuildRecord(encStruct, {
    numcot: String(numcot).padStart(8, '0').slice(-8),
    emision: today,
    cliente: codcli,
    codsuc: '',
    codven: sellerCodven,
    comen1: String(q.nombre_documento || q.notes || '').substring(0, 35),
    comen2: '',
    transp: '',
    estatus: 'PE',
    entrega: today,
    tot_cot: totalUSD,
    numrma: '',
    cambio: rate,
    moneda: 'US$',
    nomcli: String(q.client_name || '').trim().substring(0, 60),
    cif: String(q.rif || '').trim().substring(0, 15),
    nit: String(q.rif || '').trim().substring(0, 15),
    direc1: String(q.address || '').trim().substring(0, 25),
    direc2: String(q.city || '').trim().substring(0, 25),
    direc3: '',
    direc4: '',
    tlf1: String(q.phone || '').trim().substring(0, 15),
    tlf2: '',
    fax: '',
    email: String(q.email || '').trim().substring(0, 50)
  });
}

// Crea un renglón de detalle de cotización para MXRENCOT.
function buildQuoteDetailRecord(detStruct, q, numcot, codcli, i) {
  const today = dbfYmd(q.created_at || new Date());
  const sellerCodven = codvenForSeller(q.seller_id);
  const price = parseFloat(i.price_usd || 0).toFixed(2);
  const qty = parseFloat(i.qty || 1);
  const subtotal = parseFloat(((i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))))).toFixed(2);
  return dbfBuildRecord(detStruct, {
    item: String(i.sku || i.name || '').substring(0, 15),
    unidad: String(i.unit || 'UND').substring(0, 3).toUpperCase(),
    bulto: '0',
    cantidad: qty.toFixed(3),
    descrip: String(i.name || '').trim().substring(0, 50),
    numcot: String(numcot).padStart(8, '0').slice(-8),
    emision: today,
    estatus: 'PE',
    despacho: '0',
    desbulto: '0',
    precio: price,
    desc: '0.00',
    tot_ren: subtotal,
    iva: 'A',
    cliente: codcli,
    codven: sellerCodven,
    codsuc: '',
    codcon: '',
    coddpto: '',
    oferta: 'F',
    num_cex: '',
    numrma: ''
  });
}

// Crea un registro de cabecera de pedido para MXENCPED.
function buildOrderHeaderRecord(encStruct, o, numped, codcli) {
  const today = dbfYmd(o.created_at || new Date());
  const totalUSD = parseFloat(o.total_usd || 0).toFixed(2);
  const rate = parseFloat(o.exchange_rate || 0).toFixed(2);
  const sellerCodven = codvenForSeller(o.seller_id);
  return dbfBuildRecord(encStruct, {
    numped: String(numped).padStart(8, '0').slice(-8),
    emision: today,
    cliente: codcli,
    codsuc: '',
    codven: sellerCodven,
    comen1: String(o.notes || '').substring(0, 35),
    comen2: '',
    transp: '',
    estatus: 'PE',
    entrega: today,
    tot_ped: totalUSD,
    autorizado: '',
    id_autoriz: '',
    cambio: rate,
    moneda: 'US$'
  });
}

// Crea un renglón de detalle de pedido para MXRENPED.
function buildOrderDetailRecord(detStruct, o, numped, codcli, i) {
  const today = dbfYmd(o.created_at || new Date());
  const sellerCodven = codvenForSeller(o.seller_id);
  const price = parseFloat(i.price_usd || 0).toFixed(2);
  const qty = parseFloat(i.qty || 1);
  const subtotal = parseFloat(((i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1))))).toFixed(2);
  return dbfBuildRecord(detStruct, {
    item: String(i.sku || i.name || '').substring(0, 15),
    unidad: String(i.unit || 'UND').substring(0, 3).toUpperCase(),
    bulto: '0',
    cantidad: qty.toFixed(3),
    descrip: String(i.name || '').trim().substring(0, 50),
    numped: String(numped).padStart(8, '0').slice(-8),
    emision: today,
    estatus: 'PE',
    despacho: '0',
    desbulto: '0',
    precio: price,
    desc: '0.00',
    tot_ren: subtotal,
    iva: 'A',
    cliente: codcli,
    codven: sellerCodven,
    codsuc: '',
    numcot: '',
    numodr: '',
    codcon: '',
    coddpto: '',
    oferta: 'F'
  });
}

// Ruta a un DBF dentro de activeDbfDir (o null si no hay directorio).
function dbfPath(name, dbfDir) {
  const dir = dbfDir || activeDbfDir;
  if (!dir) return null;
  return path.join(dir, name);
}

// Exporta una cotización JJ (jjp_quotes) al DBF nativo de MixNet: MXENCCOT + MXRENCOT.
export async function exportQuoteToDbf(q, dbfDir) {
  // Blindado por seguridad: jamás escribir directamente sobre DBFs de producción de MixNet
  return { ok: false, reason: 'dbf-direct-write-disabled-for-safety' };
}

// Exporta un pedido JJ (jjp_orders) al DBF nativo de MixNet: MXENCPED + MXRENPED.
export async function exportOrderToDbf(o, dbfDir) {
  // Blindado por seguridad: jamás escribir directamente sobre DBFs de producción de MixNet
  return { ok: false, reason: 'dbf-direct-write-disabled-for-safety' };
}

// Barrido periódico saliente (JJ Paper ➔ MixNet)
async function sweepRecentOutgoing() {
  try {
    lastSweepTime = new Date().toISOString();
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Pedidos salientes — solo los activos (no cancelados ni rechazados)
    const { data: orders, error: oErr } = await dbCore.from('jjp_orders')
      .select('*')
      .gte('created_at', windowStart)
      .not('status', 'in', '("cancelado","rechazado")')
      .order('created_at', { ascending: true });


    if (!oErr && orders) {
      let count = 0;
      for (const o of orders) {
        if (o.order_number && o.order_number.startsWith('MIX-')) continue;
        if (o.source === 'mixnet') continue;
        const fp = computeDocFingerprint(o);
        if (orderFingerprints.get(o.order_number) !== fp) {
          if (await exportOrder(o)) count++;
        }
      }
      if (count > 0) {
        log.info(`Puente Mixer: Barrido saliente exportó ${count} pedidos pendientes/modificados.`);
      }
    }

    // 2. Cotizaciones salientes — solo las activas (no canceladas ni rechazadas)
    const { data: quotes, error: qErr } = await dbCore.from('jjp_quotes')
      .select('*')
      .gte('created_at', windowStart)
      .not('status', 'in', '("cancelado","rechazado")')
      .order('created_at', { ascending: true });

    if (!qErr && quotes) {
      let qCount = 0;
      for (const q of quotes) {
        if (q.quote_number && q.quote_number.startsWith('MIX-')) continue;
        if (q.source === 'mixnet') continue;
        const fp = computeDocFingerprint(q);
        if (quoteFingerprints.get(q.quote_number) !== fp) {
          if (await exportQuote(q)) qCount++;
        }
      }
      if (qCount > 0) {
        log.info(`Puente Mixer: Barrido saliente exportó ${qCount} cotizaciones pendientes/modificadas.`);
      }
    }

  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Excepción en barrido saliente');
  }
}

/* ═══════════════ IMPORTACIÓN: MIXNET ➔ JJ PAPER ═══════════════ */

// Decodificador CP1252 para tablas DBF antiguas
const CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178', 0xA0:' ',     0xA7:'\u00A7'
};

function decodeStr(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) {
    const b = buf[i];
    if (b === 0) break;
    if (b < 128) s += String.fromCharCode(b);
    else if (b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

function readDbfStructure(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;

    const numRecords = buf.readUInt32LE(4);
    const headerLen  = buf.readUInt16LE(8);
    const recordLen  = buf.readUInt16LE(10);
    if (headerLen < 33 || recordLen < 1 || headerLen > buf.length) return null;

    const fields = [];
    let off = 32;
    while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
      let rawName = '';
      for (let i = 0; i < 11; i++) {
        const c = buf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      const clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (clean.length > 0) {
        fields.push({
          name: clean,
          type: String.fromCharCode(buf[off + 11]),
          len:  buf[off + 16] || buf.readUInt16LE(off + 16)
        });
      }
      off += 32;
    }
    return { path: filePath, numRecords, headerLen, recordLen, fields };
  } catch (_) {
    return null;
  }
}

function readDbfRows(struct, maxLimit = 2000) {
  try {
    const buf = fs.readFileSync(struct.path);
    const rows = [];
    let pos = struct.headerLen;
    const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), buf.length);

    while (pos + struct.recordLen <= maxDataEnd && rows.length < maxLimit) {
      const flag = buf[pos];
      if (flag !== 0x2A && flag === 0x20) { // 0x2A = borrado
        const row = {};
        let fOff = 1;
        for (const f of struct.fields) {
          row[f.name] = decodeStr(buf, pos + fOff, f.len);
          fOff += f.len;
        }
        rows.push(row);
      }
      pos += struct.recordLen;
    }
    return rows;
  } catch (_) {
    return [];
  }
}

// Búsqueda de cliente en jjp_customers para asignación de vendedor
// Búsqueda de cliente en jjp_customers para asignación de vendedor y datos fiscales
async function matchCustomer(phone, rif, name) {
  try {
    // 1. Detectar si phone es en realidad un RIF venezolano
    let effectiveRif = rif;
    let effectivePhone = phone;
    if (phone && /^[JVGE]-?\d+/i.test(phone.trim())) {
      if (!rif || rif.includes('C.A') || rif.includes('CA') || !/^[JVGE]-?\d+/i.test(rif.trim())) {
        effectiveRif = phone.trim();
        effectivePhone = '';
      }
    }

    if (effectiveRif) {
      const cleanDigits = effectiveRif.replace(/\D/g, '');
      if (cleanDigits.length >= 6) {
        const { data } = await dbCore.from('jjp_customers')
          .select('id, seller_id, name, phone, rif, address, city')
          .not('address', 'is', null)
          .ilike('rif', `%${cleanDigits}%`)
          .limit(1);
        if (data?.[0]) return data[0];
      }
    }
    if (effectivePhone) {
      const cleanPhone = effectivePhone.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7) {
        const { data } = await dbCore.from('jjp_customers')
          .select('id, seller_id, name, phone, rif, address, city')
          .ilike('phone', `%${cleanPhone.slice(-7)}%`)
          .limit(1);
        if (data?.[0]) return data[0];
      }
    }
    if (name && name.length >= 4) {
      const cleanName = name.replace(/,\s*C\.?A\.?|\bC\.?A\.?\b|\bS\.?A\.?\b/gi, '').trim();
      const words = cleanName.split(/\s+/).filter(w => w.length >= 4);
      for (const w of words) {
        if (['SERVICIOS', 'ADMINISTRADORA', 'GRUPO', 'EMPRESA', 'DISTRIBUIDORA', 'INVERSIONES'].includes(w.toUpperCase())) continue;
        const { data } = await dbCore.from('jjp_customers')
          .select('id, seller_id, name, phone, rif, address, city')
          .not('address', 'is', null)
          .ilike('name', `%${w}%`)
          .limit(1);
        if (data?.[0]) return data[0];
      }
      const { data } = await dbCore.from('jjp_customers')
        .select('id, seller_id, name, phone, rif, address, city')
        .ilike('name', `%${cleanName.slice(0, 16)}%`)
        .limit(1);
      if (data?.[0]) return data[0];
    }
  } catch (_) {}
  return null;
}

// Obtener tasa oficial del sistema
async function getActiveExchangeRate() {
  try {
    const { data } = await dbCore.from('jjp_settings').select('bcv_rate').eq('id', 1).maybeSingle();
    return parseFloat(data?.bcv_rate || 0) || 0;
  } catch (_) {
    return 0;
  }
}

// 1. Barrido de archivos CSV entrantes desde Caja / MixNet
async function sweepIncomingFiles() {
  try {
    for (const dir of activeDropDirs) {
      if (!fs.existsSync(dir)) continue;
      let files = [];
      try {
        files = fs.readdirSync(dir);
      } catch (_) {
        continue;
      }

      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (ext !== '.csv') continue;

        const base = path.basename(f, ext).toLowerCase();

        // Ignorar si es un archivo saliente generado por JJ Paper que ya conocemos
        if (base.startsWith('pedido_')) {
          const num = base.replace('pedido_', '').trim();
          if (exportedOrders.has(num)) continue;
        }
        if (base.startsWith('cotizacion_')) {
          const num = base.replace('cotizacion_', '').trim();
          if (exportedQuotes.has(num)) continue;
        }

        // Ignorar archivos de productos, catálogo o inventario (no son pedidos de caja)
        if (base.startsWith('catalogo_') || base.startsWith('productos_') || base.startsWith('articulos_') || base.includes('catalogo') || base.includes('inventario') || base.includes('stock') || base.includes('lista') || base.includes('precio') || base.includes('tarifa') || base.includes('costo')) {
          continue;
        }

        const importKey = `file:${f}`;
        if (importedHistory.has(importKey)) continue;

        // Archivo entrante potencial de MixNet/Caja
        const filePath = path.join(dir, f);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length < 2) continue;

          // Parsear encabezado y separador (, o ;)
          const firstLine = lines[0];
          const sep = firstLine.includes(';') ? ';' : ',';
          const headers = firstLine.split(sep).map(h => h.trim().toLowerCase().replace(/^"+|"+$/g, ''));

          // Detectar si es Pedido o Cotización
          const isQuote = base.includes('cot') || base.includes('presup') || headers.some(h => h.includes('cotiz') || h.includes('presup'));

          // Mapear columnas
          const colOrder = headers.findIndex(h => h.includes('ped') || h.includes('orden') || h.includes('cot') || h.includes('presup') || h.includes('num'));
          const colClient = headers.findIndex(h => h.includes('cli') || h.includes('nom') || h.includes('razon'));
          const colRif = headers.findIndex(h => h.includes('rif') || h.includes('cif') || h.includes('cedula'));
          const colPhone = headers.findIndex(h => h.includes('tel') || h.includes('tlf') || h.includes('cel'));
          const colSku = headers.findIndex(h => h.includes('sku') || h.includes('cod') || h.includes('art'));
          const colProd = headers.findIndex(h => h.includes('prod') || h.includes('desc') || h.includes('nom'));
          const colBrand = headers.findIndex(h => h.includes('mar') || h.includes('brand'));
          const colQty = headers.findIndex(h => h.includes('cant') || h.includes('qty'));
          const colPrice = headers.findIndex(h => h.includes('precio') || h.includes('unit') || h.includes('punit'));
          const colSubtotal = headers.findIndex(h => h.includes('subtotal') || h.includes('linea'));
          const colTotal = headers.findIndex(h => h.includes('total'));
          const colNotes = headers.findIndex(h => h.includes('nota') || h.includes('obs') || h.includes('comen'));

          // Agrupar filas
          const items = [];
          let orderNumber = '';
          let clientName = '';
          let rif = '';
          let phone = '';
          let fileNotes = '';
          let totalUsd = 0;

          for (let i = 1; i < lines.length; i++) {
            const rawParts = lines[i].split(sep).map(p => p.trim().replace(/^"+|"+$/g, ''));
            if (rawParts.length < 2) continue;

            if (colOrder >= 0 && rawParts[colOrder]) orderNumber = rawParts[colOrder];
            if (colClient >= 0 && rawParts[colClient]) clientName = rawParts[colClient];
            if (colRif >= 0 && rawParts[colRif]) rif = rawParts[colRif];
            if (colPhone >= 0 && rawParts[colPhone]) phone = rawParts[colPhone];
            if (colNotes >= 0 && rawParts[colNotes] && !fileNotes) fileNotes = rawParts[colNotes];

            // Corrección ante coma sin comillas en razón social que desplace C.A hacia RIF y RIF hacia Teléfono
            if (rif && /^(?:C\.?A\.?|S\.?A\.?)$/i.test(rif.trim()) && phone && /^[JVGE]-?\d+/i.test(phone.trim())) {
              clientName = clientName + ', ' + rif.trim();
              rif = phone.trim();
              phone = '';
            }

            const sku = colSku >= 0 ? rawParts[colSku] : '';
            const name = colProd >= 0 ? rawParts[colProd] : 'Artículo MixNet';
            const brand = colBrand >= 0 ? rawParts[colBrand] : '';
            const qty = colQty >= 0 ? (parseFloat(rawParts[colQty]) || 1) : 1;
            const price = colPrice >= 0 ? (parseFloat(rawParts[colPrice].replace(/,/g, '.')) || 0) : 0;
            const subtotal = colSubtotal >= 0 ? (parseFloat(rawParts[colSubtotal].replace(/,/g, '.')) || (qty * price)) : (qty * price);

            items.push({ sku, name, brand, qty, price_usd: price, subtotal_usd: subtotal });
            totalUsd += subtotal;
          }

          if (colTotal >= 0) {
            const explicitTotal = parseFloat(lines[1].split(sep)[colTotal]?.replace(/^"+|"+$/g, '')?.replace(/,/g, '.'));
            if (!isNaN(explicitTotal) && explicitTotal > 0) totalUsd = explicitTotal;
          }

          if (!orderNumber) {
            orderNumber = `MIX-${base.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)}`;
          }

          if (!clientName) clientName = 'Cliente Caja MixNet';

          // Buscar cliente y vendedor asignado
          const matchedCust = await matchCustomer(phone, rif, clientName);
          const adminId = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164';
          const sellerId = matchedCust?.seller_id || adminId;
          const rate = await getActiveExchangeRate();
          const cleanDocNotes = (fileNotes && !fileNotes.includes('[MixNet') && !fileNotes.includes('COT-')) ? fileNotes : null;

          if (isQuote) {
            // Verificar si ya existe en Supabase
            const { data: existingQuote } = await dbCore.from('jjp_quotes').select('id').eq('quote_number', orderNumber).maybeSingle();
            if (!existingQuote) {
              const { error } = await dbCore.from('jjp_quotes').insert({
                quote_number: orderNumber,
                client_name: matchedCust?.name || clientName,
                rif: matchedCust?.rif || rif || null,
                phone: matchedCust?.phone || phone || null,
                customer_id: matchedCust?.id || null,
                address: matchedCust?.address || null,
                city: matchedCust?.city || null,
                items,
                estimated_total_usd: totalUsd,
                exchange_rate: rate,
                notes: cleanDocNotes,
                source: 'vendedor',
                status: 'pendiente',
                seller_id: sellerId
              });

              if (!error) {
                log.info(`Puente Mixer: Cotización importada desde MixNet (${orderNumber} - $${totalUsd.toFixed(2)})`);
                importedHistory.add(importKey);
                saveHistories();
                lastImportTime = new Date().toISOString();
              }
            } else {
              importedHistory.add(importKey);
            }
          } else {
            // Es un pedido
            const { data: existingOrder } = await dbCore.from('jjp_orders').select('id').eq('order_number', orderNumber).maybeSingle();
            if (!existingOrder) {
              const { error } = await dbCore.from('jjp_orders').insert({
                order_number: orderNumber,
                client_name: matchedCust?.name || clientName,
                rif: matchedCust?.rif || rif || null,
                phone: matchedCust?.phone || phone || null,
                customer_id: matchedCust?.id || null,
                address: matchedCust?.address || null,
                city: matchedCust?.city || null,
                items,
                subtotal_usd: totalUsd,
                total_usd: totalUsd,
                exchange_rate: rate,
                total_bs: rate > 0 ? (totalUsd * rate).toFixed(2) : 0,
                payment_method: 'efectivo',
                notes: cleanDocNotes,
                source: 'pos',
                status: 'pagado',
                seller_id: sellerId
              });

              if (!error) {
                log.info(`Puente Mixer: Pedido importado desde MixNet (${orderNumber} - $${totalUsd.toFixed(2)})`);
                importedHistory.add(importKey);
                saveHistories();
                lastImportTime = new Date().toISOString();
              }
            } else {
              importedHistory.add(importKey);
            }
          }
        } catch (e) {
          log.warn({ err: e.message, file: f }, 'Puente Mixer: Error procesando archivo entrante');
        }
      }
    }
  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Excepción en sweepIncomingFiles');
  }
}

// 2. Barrido de tablas DBF activas de MixNet (MXENCPED/MXRENPED = pedidos, MXENCCOT/MXRENCOT = cotizaciones)
async function sweepMixnetDbf() {
  if (!activeDbfDir || !fs.existsSync(activeDbfDir)) return;

  // Ventana de importación: solo pedidos/cotizaciones recientes (evita inundar con históricos)
  const recentDays = parseInt(process.env.MIXER_DBF_RECENT_DAYS || '7', 10) || 7;
  const cutoffMs = Date.now() - (recentDays * 86400000);

  try {
    // Mapa de clientes MixNet (código -> ficha) para resolver cliente/cif/teléfono
    const cliMap = new Map();
    const cliPath = path.join(activeDbfDir, 'MXCTACLI.DBF');
    if (fs.existsSync(cliPath)) {
      const cliStruct = readDbfStructure(cliPath);
      if (cliStruct && cliStruct.numRecords > 0) {
        for (const c of readDbfRows(cliStruct, 20000)) {
          const code = String(c.codcli || '').trim();
          if (code) cliMap.set(code, c);
        }
      }
    }

    const rate = await getActiveExchangeRate();

    const importHeader = async ({ encFile, detFile, kind }) => {
      const encPath = path.join(activeDbfDir, encFile);
      const detPath = path.join(activeDbfDir, detFile);
      if (!fs.existsSync(encPath)) return;
      const encStruct = readDbfStructure(encPath);
      if (!encStruct || encStruct.numRecords <= 0) return;

      const encRows = readDbfRows(encStruct, 25000);
      const isQuote = kind === 'quote';

      // Mapear campos reales de MixNet (usados en ambos encabezados/detalles)
      const candidates = [];
      const seenNums = new Set();
      for (const pr of encRows.slice().reverse()) { // Comenzar por los más recientes
        const emisionStr = String(pr.emision || '').trim();
        let rawNum = '';
        let totalVal = 0;
        if (isQuote) {
          rawNum = String(pr.numcot || pr.numped || pr.numero || '').trim();
          totalVal = parseFloat(String(pr.tot_cot || pr.tot_ped || pr.total || '0').replace(/,/g, '.')) || 0;
        } else {
          rawNum = String(pr.numped || pr.numero || pr.pedido || '').trim();
          totalVal = parseFloat(String(pr.tot_ped || pr.total || '0').replace(/,/g, '.')) || 0;
        }
        if (!rawNum) continue;
        const numDoc = rawNum.padStart(8, '0').slice(-8);

        // Si ya procesamos la versión más reciente de este documento en el barrido, ignorar las anteriores
        if (seenNums.has(numDoc)) continue;
        seenNums.add(numDoc);

        // Filtro de recencia por fecha de emisión (formato YYYYMMDD)
        if (emisionStr && /^\d{8}$/.test(emisionStr)) {
          const d = new Date(+emisionStr.slice(0, 4), +emisionStr.slice(4, 6) - 1, +emisionStr.slice(6, 8));
          if (d.getTime() < cutoffMs) continue;
        }

        const dbfKey = `dbf:${isQuote ? 'cot' : 'ped'}:${numDoc}`;
        const finalNum = numDoc;

        // Ya existe en Supabase por número o por nota de importación previa?
        const table = isQuote ? 'jjp_quotes' : 'jjp_orders';
        const numField = isQuote ? 'quote_number' : 'order_number';
        const selectCols = isQuote
          ? 'id, estimated_total_usd, client_name, source, notes, created_at, seller_id'
          : 'id, total_usd, client_name, source, notes, created_at, seller_id';
        let existing = null;
        const { data: byNum } = await dbCore.from(table)
          .select(selectCols)
          .eq(numField, finalNum)
          .limit(1);
        if (byNum && byNum.length > 0) {
          existing = byNum[0];
        } else {
          const { data: byNotes } = await dbCore.from(table)
            .select(selectCols)
            .ilike('notes', `%#${numDoc}%`)
            .limit(1);
          if (byNotes && byNotes.length > 0) {
            existing = byNotes[0];
          }
        }

        const clientCode = String(pr.cliente || '').trim();
        const cli = cliMap.get(clientCode) || null;
        const clientName = String(pr.nomcli || (cli && cli.nomcli) || pr.nombre || pr.razon || 'Cliente Caja MixNet').trim();

        let existingId = null;
        if (existing) {
          const currentTotal = isQuote ? (existing.estimated_total_usd || 0) : (existing.total_usd || 0);
          const totalMatches = Math.abs(currentTotal - totalVal) <= 0.05;
          const currentName = (existing.client_name || '').trim().toLowerCase();
          const targetName = clientName.toLowerCase();
          const nameMatches = (currentName === targetName) || (currentName.length > 0 && targetName === 'cliente caja mixnet');

          if (totalMatches && nameMatches) {
            importedHistory.add(dbfKey);
            continue;
          }
          existingId = existing.id;
        }

        candidates.push({ pr, numDoc, totalVal, dbfKey, finalNum, existingId, clientCode, cli, clientName });
      }

      if (candidates.length === 0) return;

      // Indexar detalle por renNum_cliente y por renNum
      let detMap = new Map();
      if (fs.existsSync(detPath)) {
        const detStruct = readDbfStructure(detPath);
        if (detStruct) {
          const detNumField = isQuote ? 'numcot' : 'numped';
          for (const rr of readDbfRows(detStruct, 400000)) {
            const renNum = String(rr[detNumField] || rr.numped || rr.num_ped || '').trim().padStart(8, '0').slice(-8);
            if (!renNum) continue;
            const renCli = String(rr.cliente || '').trim();
            const keyCli = `${renNum}_${renCli}`;
            if (!detMap.has(keyCli)) detMap.set(keyCli, []);
            detMap.get(keyCli).push(rr);
            if (!detMap.has(renNum)) detMap.set(renNum, []);
            detMap.get(renNum).push(rr);
          }
        }
      }

      for (const { pr, numDoc, totalVal, dbfKey, finalNum, existingId, clientCode, cli, clientName } of candidates) {
        const rif = String(pr.cif || (cli && cli.cif) || pr.rif || '').trim();
        const phone = String(pr.tlf1 || (cli && cli.tlf1) || pr.telefono || pr.tlf || '').trim();
        const moneda = String(pr.moneda || 'US$').trim();

        const emisionStr = String(pr.emision || pr.fecha || '').trim();
        const docCreatedAt = (emisionStr && /^\d{8}$/.test(emisionStr))
          ? new Date(+emisionStr.slice(0, 4), +emisionStr.slice(4, 6) - 1, +emisionStr.slice(6, 8), 12, 0, 0).toISOString()
          : new Date().toISOString();

        const rawItemRows = (clientCode && detMap.get(`${numDoc}_${clientCode}`)) || detMap.get(numDoc) || [];
        const items = rawItemRows.map(rr => {
          const sku = String(rr.item || rr.codart || rr.codigo || '').trim();
          const name = String(rr.descrip || rr.nomart || 'Artículo').trim();
          const qty = parseFloat(String(rr.cantidad || rr.cant || '1').replace(/,/g, '.')) || 1;
          const price = parseFloat(String(rr.precio || rr.precio_b || '0').replace(/,/g, '.')) || 0;
          const sub = parseFloat(String(rr.tot_ren || rr.total || rr.subtotal || (qty * price)).replace(/,/g, '.')) || (qty * price);
          return { sku, name, brand: '', qty, price_usd: price, subtotal_usd: sub };
        });

        if (items.length === 0 && totalVal > 0) {
          items.push({ sku: 'MIX-CAJA', name: `Consumo MixNet #${numDoc}`, brand: '', qty: 1, price_usd: totalVal, subtotal_usd: totalVal });
        }

        const matchedCust = await matchCustomer(phone, rif, clientName);
        const effectiveCustSeller = matchedCust?.seller_id || null;

        // Detallar el vendedor que realizó la operación en MixNet (codven)
        const codven = String(pr.codven || '').trim();
        const { seller_id: codvenSeller, hint: sellerHint } = sellerForCodven(codven);
        
        // Prioridad estricta al vendedor que ejecutó la venta/cotización en MixNet
        let finalSellerId = codvenSeller || effectiveCustSeller || null;
        // Extraer comentarios legítimos del documento en MixNet (COMEN1, COMEN2), sin marcas artificiales
        const rawComen = [pr.comen1, pr.comen2]
          .map(c => String(c || '').trim())
          .filter(c => c && !c.includes('[MixNet') && !c.includes('COT-') && !c.includes('importad'))
          .join(' - ');
        const cleanDocNotes = rawComen || null;

        if (isQuote) {
          // NOTA: jjp_quotes NO posee columna updated_at
          const quotePayload = {
            quote_number: finalNum,
            client_name: clientName,
            rif: rif || null,
            phone: phone || null,
            items,
            estimated_total_usd: totalVal,
            exchange_rate: rate,
            notes: cleanDocNotes,
            source: 'mixnet',
            status: 'pendiente',
            seller_id: finalSellerId,
            created_at: docCreatedAt
          };
          const { error } = existingId
            ? await dbCore.from('jjp_quotes').update(quotePayload).eq('id', existingId)
            : await dbCore.from('jjp_quotes').insert(quotePayload);

          if (error) {
            log.error({ err: error.message, quote: finalNum }, 'Puente Mixer: Error al guardar cotización en jjp_quotes');
          } else {
            log.info(`Puente Mixer: Cotización ${existingId ? 'actualizada' : 'importada'} desde DBF (${finalNum} - $${totalVal.toFixed(2)})`);
            importedHistory.add(dbfKey);
            exportedQuotes.add(finalNum);
            quoteFingerprints.set(finalNum, computeDocFingerprint(quotePayload));
            saveHistories();
            lastImportTime = new Date().toISOString();
          }
        } else {
          const orderPayload = {
            order_number: finalNum,
            client_name: clientName,
            rif: rif || null,
            phone: phone || null,
            items,
            subtotal_usd: totalVal,
            total_usd: totalVal,
            exchange_rate: rate,
            total_bs: rate > 0 ? (totalVal * rate).toFixed(2) : 0,
            payment_method: 'efectivo',
            notes: cleanDocNotes,
            source: 'mixnet',
            status: 'pagado',
            seller_id: finalSellerId,
            created_at: docCreatedAt,
            updated_at: docCreatedAt
          };
          const { error } = existingId
            ? await dbCore.from('jjp_orders').update(orderPayload).eq('id', existingId)
            : await dbCore.from('jjp_orders').insert(orderPayload);

          if (error) {
            log.error({ err: error.message, order: finalNum }, 'Puente Mixer: Error al guardar pedido en jjp_orders');
          } else {
            log.info(`Puente Mixer: Pedido ${existingId ? 'actualizado' : 'importado'} desde DBF (${finalNum} - $${totalVal.toFixed(2)})`);
            importedHistory.add(dbfKey);
            exportedOrders.add(finalNum);
            orderFingerprints.set(finalNum, computeDocFingerprint(orderPayload));
            saveHistories();
            lastImportTime = new Date().toISOString();
          }
        }
      }

    };

    await importHeader({ encFile: 'MXENCPED.DBF', detFile: 'MXRENPED.DBF', kind: 'order' });
    await importHeader({ encFile: 'MXENCCOT.DBF', detFile: 'MXRENCOT.DBF', kind: 'quote' });
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Advertencia al leer DBF de MixNet');
  }
}

// 3. Sincronización de Facturas Fiscales: MixNet ➔ JJ Paper (MXENCFAC / MXRENFAC)
// Detecta cuando un pedido JJ Paper es facturado en MixNet, asociando el número de factura,
// número de control fiscal SENIAT, fecha de emisión, desglose fiscal (IVA/Base) y actualizando
// el estado del pedido automáticamente.
export async function sweepMixnetInvoices() {
  if (!activeDbfDir || !fs.existsSync(activeDbfDir)) {
    refreshEnvironmentConfig();
  }
  if (!activeDbfDir || !fs.existsSync(activeDbfDir)) return;
  const encPath = path.join(activeDbfDir, 'MXENCFAC.DBF');
  const renPath = path.join(activeDbfDir, 'MXRENFAC.DBF');
  if (!fs.existsSync(encPath) || !fs.existsSync(renPath)) return;

  try {
    const sEnc = dbfReadStruct(encPath);
    const sRen = dbfReadStruct(renPath);
    if (!sEnc || !sRen || sEnc.numRecords <= 0) return;

    // 1. Mapear pedidos y cotizaciones asociados a facturas desde MXRENFAC
    const renRows = dbfReadRows(sRen, ['numfac', 'numped', 'numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], 40000);
    const facToPedMap = new Map();
    const facItemsMap = new Map();

    for (const r of renRows) {
      const numfac = String(r.numfac || '').trim().padStart(8, '0').slice(-8);
      const numped = String(r.numped || '').trim().padStart(8, '0').slice(-8);
      const numcot = String(r.numcot || '').trim().padStart(8, '0').slice(-8);

      if (numfac && numped && numped !== '00000000') {
        if (!facToPedMap.has(numfac)) {
          facToPedMap.set(numfac, { numped, numcot });
        }
      }

      if (numfac) {
        if (!facItemsMap.has(numfac)) facItemsMap.set(numfac, []);
        facItemsMap.get(numfac).push({
          sku: String(r.item || '').trim(),
          name: String(r.descrip || '').trim(),
          qty: parseFloat(String(r.cantidad || '1').replace(/,/g, '.')) || 1,
          price_usd: parseFloat(String(r.precio || '0').replace(/,/g, '.')) || 0,
          subtotal_usd: parseFloat(String(r.tot_ren || '0').replace(/,/g, '.')) || 0
        });
      }
    }

    if (facToPedMap.size === 0) return;

    // 2. Leer cabeceras de facturas en MXENCFAC (últimos registros)
    const encRows = dbfReadRows(sEnc, [
      'numfac', 'ncontrol', 'emision', 'hora', 'cliente', 'nomcli', 'cif',
      'cambio', 'tot_fac', 'base_a', 'imp_iva', 'por_iva', 'codven'
    ], 20000);

    let linkedCount = 0;
    for (const r of encRows.slice().reverse()) {
      const numfac = String(r.numfac || '').trim().padStart(8, '0').slice(-8);
      const pedInfo = facToPedMap.get(numfac);
      if (!pedInfo) continue;

      const numped = pedInfo.numped;
      const numcot = pedInfo.numcot;
      const ncontrol = String(r.ncontrol || '').trim();
      const emisionStr = String(r.emision || '').trim();
      let isoDate = null;
      if (emisionStr && /^\d{8}$/.test(emisionStr)) {
        isoDate = `${emisionStr.slice(0, 4)}-${emisionStr.slice(4, 6)}-${emisionStr.slice(6, 8)}`;
      }
      const cambio = parseFloat(String(r.cambio || '0').replace(/,/g, '.')) || 0;
      const totFacBs = parseFloat(String(r.tot_fac || '0').replace(/,/g, '.')) || 0;
      const baseABs = parseFloat(String(r.base_a || '0').replace(/,/g, '.')) || 0;
      const impIvaBs = parseFloat(String(r.imp_iva || '0').replace(/,/g, '.')) || 0;
      const porIva = parseFloat(String(r.por_iva || '16').replace(/,/g, '.')) || 16;
      const totFacUsd = cambio > 0 ? +(totFacBs / cambio).toFixed(2) : 0;

      // Buscar pedido en Supabase
      const { data: existingOrder } = await dbCore.from('jjp_orders')
        .select('id, order_number, invoice_number, control_number, status')
        .eq('order_number', numped)
        .maybeSingle();

      if (existingOrder && existingOrder.invoice_number !== numfac) {
        const updateData = {
          invoice_number: numfac,
          control_number: ncontrol || existingOrder.control_number || null,
          invoice_date: isoDate,
          invoice_total_bs: totFacBs,
          invoice_total_usd: totFacUsd > 0 ? totFacUsd : null,
          invoice_iva_bs: impIvaBs,
          invoice_rate: cambio > 0 ? cambio : null,
          invoice_data: {
            numfac,
            ncontrol,
            emision: isoDate,
            hora: String(r.hora || '').trim(),
            cliente: String(r.cliente || '').trim(),
            nomcli: String(r.nomcli || '').trim(),
            cif: String(r.cif || '').trim(),
            cambio,
            tot_fac_bs: totFacBs,
            base_imponible_bs: baseABs,
            imp_iva_bs: impIvaBs,
            por_iva: porIva,
            tot_fac_usd: totFacUsd,
            items: facItemsMap.get(numfac) || []
          },
          updated_at: new Date().toISOString()
        };

        if (!['rechazado', 'cancelado'].includes(existingOrder.status)) {
          updateData.status = 'pagado';
        }

        const { error: upErr } = await dbCore.from('jjp_orders').update(updateData).eq('id', existingOrder.id);
        if (!upErr) {
          linkedCount++;
          log.info(`Puente Mixer: Pedido #${numped} enlazado con Factura MixNet #${numfac} (Control: ${ncontrol || 'S/N'}, Bs ${totFacBs.toFixed(2)})`);
        }
      }

      if (numcot && numcot !== '00000000') {
        const { data: qList } = await dbCore.from('jjp_quotes').select('id, status').eq('quote_number', numcot).limit(1);
        if (qList && qList.length > 0 && qList[0].status !== 'convertido') {
          await dbCore.from('jjp_quotes').update({ status: 'convertido' }).eq('id', qList[0].id);
        }
      }
    }

    if (linkedCount > 0) {
      log.info(`Puente Mixer: ${linkedCount} pedidos fueron vinculados a sus facturas de MixNet.`);
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Advertencia al sincronizar facturas de MixNet');
  }
}

/* ═══════════════ SINCRONIZACIÓN BIDIRECCIONAL DE PRODUCTOS ═══════════════ */

// 1. JJ Paper ➔ MixNet: Exporta el catálogo consolidado (SKU, nombre, precio, stock)
export async function exportCatalogToMixnet() {
  try {
    const { data: prods, error } = await dbCore.from('jjp_products')
      .select('id, name, sku, price_usd, cost_usd, stock, active')
      .order('name');
    if (error || !prods) return false;

    const { data: vars } = await dbCore.from('jjp_product_variants')
      .select('id, product_id, variant_name, sku, price_usd, cost_usd, stock, active');

    const varMap = new Map();
    (vars || []).forEach(v => {
      if (!varMap.has(v.product_id)) varMap.set(v.product_id, []);
      varMap.get(v.product_id).push(v);
    });

    const headers = ['SKU', 'Producto', 'Variante', 'Precio_USD', 'Costo_USD', 'Stock', 'Activo'];
    const rows = [];

    for (const p of prods) {
      const pVars = varMap.get(p.id) || [];
      if (pVars.length > 0) {
        for (const v of pVars) {
          rows.push([
            v.sku || p.sku || '',
            p.name,
            v.variant_name || '',
            v.price_usd ?? p.price_usd ?? 0,
            v.cost_usd ?? p.cost_usd ?? 0,
            v.stock ?? p.stock ?? 0,
            (v.active && p.active) ? 'SI' : 'NO'
          ].map(escapeCSV).join(','));
        }
      } else {
        rows.push([
          p.sku || '',
          p.name,
          '',
          p.price_usd ?? 0,
          p.cost_usd ?? 0,
          p.stock ?? 0,
          p.active ? 'SI' : 'NO'
        ].map(escapeCSV).join(','));
      }
    }

    const csvContent = headers.join(',') + '\n' + rows.join('\n');
    writeToAllDropDirs('catalogo_jjpaper.csv', csvContent);
    writeToAllDropDirs('productos_jjpaper.csv', csvContent);
    log.info(`Puente Mixer: Catálogo sincronizado y exportado hacia MixNet (${rows.length} líneas)`);
    return true;
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Error exportando catálogo a MixNet');
    return false;
  }
}

// 2. MixNet ➔ JJ Paper: Lee existencias y precios desde tablas DBF o CSV de MixNet
export async function sweepMixnetProducts() {
  try {
    // Lee la tabla de precios vigente (MXCTAINV: maestro de precios actualizado
    // continuamente, incluida la unidad M:) y el inventario real (VICTAINV).
    // IMPORTANTE (17/09/2026): MXCTAINV.DBF es la fuente AUTORITATIVA de
    // precios y stock (fecha_mod 2025/2026); VICTAINV.DBF quedó con precios
    // congelados de 2024 (ej. LIBRETA FAMA TESIS CG-L100T: 1.13$ en MXCTAINV vs
    // 1.01$ en VICTAINV). Se fusionan ambos por SKU dándole prioridad a MXCTAINV.
    let masterRows = [];
    let stockRows = [];
    if (activeDbfDir && fs.existsSync(activeDbfDir)) {
      const mxfp = path.join(activeDbfDir, 'MXCTAINV.DBF');
      const mxfpL = path.join(activeDbfDir, 'mxctainv.dbf');
      const vifp = path.join(activeDbfDir, 'VICTAINV.DBF');
      const vifpL = path.join(activeDbfDir, 'victainv.dbf');

      for (const fp of [mxfp, mxfpL]) {
        if (fs.existsSync(fp)) {
          const st = readDbfStructure(fp);
          if (st && st.numRecords > 0) masterRows = readDbfRows(st, 5000);
          break;
        }
      }
      for (const fp of [vifp, vifpL]) {
        if (fs.existsSync(fp)) {
          const st = readDbfStructure(fp);
          if (st && st.numRecords > 0) stockRows = readDbfRows(st, 5000);
          break;
        }
      }
    }

    if (masterRows.length > 0) {
      let updatedCount = 0;
      let insertedCount = 0;
      const stockBySku = new Map(stockRows.map(r => [String(r.codart || r.codigo || r.sku || '').trim(), r]));
      for (const r of masterRows) {
        const sku = String(r.codart || r.codigo || r.sku || '').trim();
        if (!sku) continue;

        const priceA = parseFloat(String(r.precio_a || '0').replace(/,/g, '.')) || 0;
        const priceB = parseFloat(String(r.precio_b || r.precio_a || r.precio || '0').replace(/,/g, '.')) || 0;
        const priceCBs = parseFloat(String(r.precio_c || '0').replace(/,/g, '.')) || 0;
        const priceDBs = parseFloat(String(r.precio_d || '0').replace(/,/g, '.')) || 0;
        const cost = parseFloat(String(r.costo || r.costo_rep || r.ult_costo || '0').replace(/,/g, '.')) || 0;
        let stock = parseFloat(String(r.existe_act || r.existencia || r.stock || '0').replace(/,/g, '.')) || 0;
        if (stock === 0) {
          const sv = stockBySku.get(sku);
          if (sv) {
            stock = parseFloat(String(sv.existe_act || sv.existencia || sv.stock || '0').replace(/,/g, '.')) || 0;
          }
        }

        if (priceB > 0 || stock >= 0) {
          const fp = `${priceA}|${priceB}|${priceCBs}|${priceDBs}|${stock}|${cost}`;
          if (productSyncFingerprints.get(sku) === fp) {
            // DIRTY CHECK: El producto no ha cambiado en el DBF local. CERO consumo de egress.
            continue;
          }

          const updateObj = {};
          if (priceA > 0) updateObj.price_a = priceA;
          if (priceB > 0) {
            updateObj.price_b = priceB;
            updateObj.price_usd = priceB;
          }
          if (priceCBs > 0) updateObj.price_c_bs = priceCBs;
          if (priceDBs > 0) updateObj.price_d_bs = priceDBs;
          if (stock >= 0) updateObj.stock = Math.max(0, Math.floor(stock));
          if (cost > 0) {
            let costUsd = cost;
            // Si el costo en DBF está en Bolívares (supera el precio USD), convertir a USD real
            if (priceB > 0 && cost > priceB * 2.5) {
              const rate = (priceDBs > 0) ? (priceDBs / priceB) : 847.44;
              costUsd = Math.round((cost / rate) * 100) / 100;
            }
            updateObj.cost_usd = costUsd;
          }

          const { data: vUp } = await dbCore.from('jjp_product_variants').update(updateObj).eq('sku', sku).select('id');
          const { data: pUp } = await dbCore.from('jjp_products').update(updateObj).eq('sku', sku).select('id');
          if (vUp?.length || pUp?.length) {
            updatedCount++;
            productSyncFingerprints.set(sku, fp);
          } else {
            // El artículo existe en MixNet pero aún no en JJ Paper: auto-importarlo.
            // CRÍTICO (17/09/2026): Se debe crear TANTO el producto como su variante.
            // Sin variante en jjp_product_variants el POS/buscador no puede encontrar el
            // producto ni descontar stock (jjp_apply_order_stock usa variant_id).
            const nomart = String(r.nomart || r.nombre || r.descripcion || sku).trim();
            if (nomart && sku) {
              const unit = String(r.unidad || 'und').trim().toLowerCase() || 'und';
              const newProd = {
                name: nomart,
                sku: sku,
                ...updateObj,
                active: true,
                unit,
                mixnet_status: 'sincronizado'
              };
              const { data: ins } = await dbCore.from('jjp_products').insert(newProd).select('id, sku');
              if (ins?.length) {
                insertedCount++;
                const productId = ins[0].id;
                // Crear variante principal para que el POS/buscador lo encuentre y pueda
                // descontar stock al confirmar pago (jjp_apply_order_stock necesita variant_id).
                const newVariant = {
                  product_id: productId,
                  variant_name: 'Unidad',
                  sku: sku,
                  ...updateObj,
                  base_price_usd: updateObj.price_usd || updateObj.price_b || 0,
                  active: true,
                  mixnet_status: 'sincronizado'
                };
                const { error: varErr } = await dbCore.from('jjp_product_variants').insert(newVariant);
                if (varErr) {
                  log.warn({ err: varErr.message, sku }, 'Puente Mixer: Producto nuevo importado pero falló creación de variante.');
                } else {
                  log.info(`Puente Mixer: Producto nuevo importado con variante: ${sku} — ${nomart}`);
                }
              }
            }
          }
        }
      }
      if (updatedCount > 0 || insertedCount > 0) {
        saveHistories();
        log.info(`Puente Mixer: Sincronizados precios y stock de ${updatedCount} productos (${insertedCount} nuevos importados) desde MXCTAINV.DBF (maestro vigente).`);
      }
      return;
    }

    // Respaldo: solo VICTAINV.DBF disponible (sin maestro de precios)
    if (stockRows.length > 0) {
      let updatedCount = 0;
      let insertedCount = 0;
      for (const r of stockRows) {
        const sku = String(r.codart || r.codigo || r.sku || '').trim();
        if (!sku) continue;

        const priceB = parseFloat(String(r.precio_b || r.precio_a || r.precio || '0').replace(/,/g, '.')) || 0;
        const stock = parseFloat(String(r.existe_act || r.existencia || r.stock || '0').replace(/,/g, '.')) || 0;
        const cost = parseFloat(String(r.costo || r.costo_rep || r.ult_costo || '0').replace(/,/g, '.')) || 0;

        if (priceB > 0 || stock >= 0) {
          const updateObj = {};
          if (priceB > 0) {
            updateObj.price_b = priceB;
            updateObj.price_usd = priceB;
          }
          if (stock >= 0) updateObj.stock = Math.max(0, Math.floor(stock));
          if (cost > 0) {
            let costUsd = cost;
            if (priceB > 0 && cost > priceB * 2.5) {
              const rate = 847.44;
              costUsd = Math.round((cost / rate) * 100) / 100;
            }
            updateObj.cost_usd = costUsd;
          }

          const { data: vUp } = await dbCore.from('jjp_product_variants').update(updateObj).eq('sku', sku).select('id');
          const { data: pUp } = await dbCore.from('jjp_products').update(updateObj).eq('sku', sku).select('id');
          if (vUp?.length || pUp?.length) {
            updatedCount++;
          } else {
            // Mismo fix Fase 1: crear producto + variante para visibilidad en POS
            const nomart = String(r.nomart || r.nombre || r.descripcion || sku).trim();
            if (nomart && sku) {
              const unit = String(r.unidad || 'und').trim().toLowerCase() || 'und';
              const newProd = {
                name: nomart,
                sku: sku,
                ...updateObj,
                active: true,
                unit,
                mixnet_status: 'sincronizado'
              };
              const { data: ins } = await dbCore.from('jjp_products').insert(newProd).select('id, sku');
              if (ins?.length) {
                insertedCount++;
                const { error: varErr } = await dbCore.from('jjp_product_variants').insert({
                  product_id: ins[0].id,
                  variant_name: 'Unidad',
                  sku: sku,
                  ...updateObj,
                  base_price_usd: updateObj.price_usd || updateObj.price_b || 0,
                  active: true,
                  mixnet_status: 'sincronizado'
                });
                if (varErr) {
                  log.warn({ err: varErr.message, sku }, 'Puente Mixer (VICTAINV): Falló creación de variante para nuevo producto.');
                }
              }
            }
          }
        }
      }
      if (updatedCount > 0 || insertedCount > 0) {
        log.info(`Puente Mixer: Sincronizados precios y stock de ${updatedCount} productos (${insertedCount} nuevos importados) desde VICTAINV.DBF (respaldo).`);
      }
      return;
    }

    // 2. Respaldo HTTP: Consultar API de MixNet en la red local (192.168.0.185 o 192.168.0.172 en puerto 3000)
    const httpCandidates = [
      'http://192.168.0.185:3000/api/products?limit=2000',
      'http://192.168.0.172:3000/api/products?limit=2000',
      'http://localhost:3000/api/products?limit=2000'
    ];

    for (const apiUrl of httpCandidates) {
      try {
        const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(2500) });
        if (resp.ok) {
          const body = await resp.json();
          const pList = body.products || [];
          if (pList.length > 0) {
            let updatedCount = 0;
            for (const p of pList) {
              const sku = String(p.codigo || '').trim();
              if (!sku) continue;

              const priceA = parseFloat(p.precio_a || p.precio_cliente_usd || p.precio_usd || 0);
              const priceB = parseFloat(p.precio_b || p.precio_mayor_usd || p.precio_cliente_usd || 0);
              const priceCBs = parseFloat(p.precio_c_bs || p.precio_c || 0);
              const priceDBs = parseFloat(p.precio_d_bs || p.precio_d || 0);
              const stock = parseFloat(p.stock_actual || 0);
              const cost = parseFloat(p.costo_usd || 0);

              const updateObj = {};
              if (priceA > 0) updateObj.price_a = priceA;
              if (priceB > 0) {
                updateObj.price_b = priceB;
                updateObj.price_usd = priceB;
              }
              if (priceCBs > 0) updateObj.price_c_bs = priceCBs;
              if (priceDBs > 0) updateObj.price_d_bs = priceDBs;
              if (stock >= 0) updateObj.stock = Math.max(0, Math.floor(stock));
              if (cost > 0) {
                let costUsd = cost;
                if (priceB > 0 && cost > priceB * 2.5) {
                  const rate = (priceDBs > 0) ? (priceDBs / priceB) : 847.44;
                  costUsd = Math.round((cost / rate) * 100) / 100;
                }
                updateObj.cost_usd = costUsd;
              }

              if (Object.keys(updateObj).length > 0) {
                const { data: vUp } = await dbCore.from('jjp_product_variants').update(updateObj).eq('sku', sku).select('id');
                const { data: pUp } = await dbCore.from('jjp_products').update(updateObj).eq('sku', sku).select('id');
                if (vUp?.length || pUp?.length) updatedCount++;
              }
            }
            if (updatedCount > 0) {
              log.info(`Puente Mixer: Sincronizados ${updatedCount} productos desde API HTTP de MixNet (${apiUrl}).`);
            }
            return;
          }
        }
      } catch (_) {}
    }

    // 3. Si no hay DBF ni API activa, buscar archivos CSV de inventario/stock de MixNet en carpetas existentes
    for (const dir of activeDropDirs) {
      if (!fs.existsSync(dir)) continue;
      let files = [];
      try { files = fs.readdirSync(dir); } catch (_) { continue; }

      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (ext !== '.csv') continue;
        const base = path.basename(f, ext).toLowerCase();
        if (base.startsWith('catalogo_jj') || base.startsWith('productos_jj') || base.startsWith('pedido_') || base.startsWith('cotizacion_')) continue;

        if (base.includes('stock') || base.includes('articulo') || base.includes('producto') || base.includes('precio') || base.includes('existencia')) {
          const filePath = path.join(dir, f);
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length < 2) continue;

          const sep = lines[0].includes(';') ? ';' : ',';
          const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/^"+|"+$/g, ''));
          const colSku = headers.findIndex(h => h.includes('cod') || h.includes('sku') || h.includes('art'));
          const colPriceA = headers.findIndex(h => h === 'precio_a' || h === 'precio a');
          const colPriceB = headers.findIndex(h => h === 'precio_b' || h === 'precio b' || h.includes('precio') || h.includes('price') || h.includes('pvp'));
          const colPriceC = headers.findIndex(h => h === 'precio_c' || h === 'precio c');
          const colPriceD = headers.findIndex(h => h === 'precio_d' || h === 'precio d');
          const colStock = headers.findIndex(h => h.includes('stock') || h.includes('cant') || h.includes('exist'));
          const colCost = headers.findIndex(h => h.includes('cost'));

          if (colSku < 0) continue;

          let updatedCount = 0;
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(sep).map(p => p.trim().replace(/^"+|"+$/g, ''));
            const sku = parts[colSku];
            if (!sku) continue;

            const priceA = colPriceA >= 0 ? (parseFloat(parts[colPriceA].replace(/,/g, '.')) || 0) : 0;
            const priceB = colPriceB >= 0 ? (parseFloat(parts[colPriceB].replace(/,/g, '.')) || 0) : 0;
            const priceCBs = colPriceC >= 0 ? (parseFloat(parts[colPriceC].replace(/,/g, '.')) || 0) : 0;
            const priceDBs = colPriceD >= 0 ? (parseFloat(parts[colPriceD].replace(/,/g, '.')) || 0) : 0;
            const stock = colStock >= 0 ? (parseFloat(parts[colStock].replace(/,/g, '.')) || 0) : 0;
            const cost = colCost >= 0 ? (parseFloat(parts[colCost].replace(/,/g, '.')) || 0) : 0;

            const updateObj = {};
            if (priceA > 0) updateObj.price_a = priceA;
            if (priceB > 0) {
              updateObj.price_b = priceB;
              updateObj.price_usd = priceB;
            }
            if (priceCBs > 0) updateObj.price_c_bs = priceCBs;
            if (priceDBs > 0) updateObj.price_d_bs = priceDBs;
            if (stock >= 0) updateObj.stock = Math.max(0, Math.floor(stock));
            if (cost > 0) updateObj.cost_usd = cost;

            if (Object.keys(updateObj).length > 0) {
              const { data: vUp } = await dbCore.from('jjp_product_variants').update(updateObj).eq('sku', sku).select('id');
              const { data: pUp } = await dbCore.from('jjp_products').update(updateObj).eq('sku', sku).select('id');
              if (vUp?.length || pUp?.length) updatedCount++;
            }
          }
          if (updatedCount > 0) {
            log.info(`Puente Mixer: Sincronizados precios y stock de ${updatedCount} productos desde archivo ${f}.`);
          }
        }
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Error en sincronización de productos');
  }
}

/* ═══════════════ REALTIME LISTENERS ═══════════════ */
function setupRealtimeListeners() {
  log.info('Puente Mixer: Suscribiendo canal Realtime de pedidos (cotizaciones desactivadas — solo pedidos viajan a MixNet)...');


  // 1. Pedidos
  dbCore.channel('mixer-orders')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_orders' },
      p => {
        if (!p?.new) return;
        if (p.new.order_number && p.new.order_number.startsWith('MIX-')) return;
        if (p.new.source === 'mixnet') return;
        log.info(`Puente Mixer: Recibida inserción de pedido ${p.new.order_number} por Realtime.`);
        exportOrder(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando pedido'));
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_orders' },
      p => {
        if (!p?.new) return;
        if (p.new.order_number && p.new.order_number.startsWith('MIX-')) return;
        if (p.new.source === 'mixnet') return;
        log.info(`Puente Mixer: Recibida actualización de pedido ${p.new.order_number} por Realtime.`);
        exportOrder(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando pedido (update)'));
      }
    )
    .subscribe(status => {
      log.info(`Puente Mixer: Canal Realtime de pedidos: ${status}`);
    });

  // 2. Cotizaciones
  dbCore.channel('mixer-quotes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_quotes' },
      p => {
        if (!p?.new) return;
        if (p.new.quote_number && p.new.quote_number.startsWith('MIX-')) return;
        if (p.new.source === 'mixnet') return;
        log.info(`Puente Mixer: Recibida inserción de cotización ${p.new.quote_number} por Realtime.`);
        exportQuote(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando cotización'));
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_quotes' },
      p => {
        if (!p?.new) return;
        if (p.new.quote_number && p.new.quote_number.startsWith('MIX-')) return;
        if (p.new.source === 'mixnet') return;
        log.info(`Puente Mixer: Recibida actualización de cotización ${p.new.quote_number} por Realtime.`);
        exportQuote(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando cotización (update)'));
      }
    )
    .subscribe(status => {
      log.info(`Puente Mixer: Canal Realtime de cotizaciones: ${status}`);
    });
}


/* ═══════════════ ESTADO Y ARRANQUE DEL SERVICIO ═══════════════ */

export function getMixerStatus() {
  return {
    online: mixerInitialized,
    primary_dir: activePrimaryDir,
    drop_dirs: activeDropDirs,
    dbf_dir: activeDbfDir,
    exported_orders_count: exportedOrders.size,
    exported_quotes_count: exportedQuotes.size,
    imported_count: importedHistory.size,
    last_sweep_at: lastSweepTime,
    last_import_at: lastImportTime
  };
}

// Sincroniza el correlativo exacto desde los archivos de control DBF de MixNet hacia Supabase
export async function syncCorrelativesFromDbf() {
  try {
    if (!activeDbfDir || !fs.existsSync(activeDbfDir)) {
      refreshEnvironmentConfig();
    }
    if (!activeDbfDir || !fs.existsSync(activeDbfDir)) return;
    const pedPath = path.join(activeDbfDir, 'MXNUMPED.DBF');
    const cotPath = path.join(activeDbfDir, 'MXNUMCOT.DBF');
    if (fs.existsSync(pedPath)) {
      const s = dbfGetControlSerial(pedPath, 'numero');
      if (s && s.num > 0) {
        await dbCore.from('jjp_settings').upsert({
          key: 'mixnet_next_order_serial',
          value: String(s.num),
          updated_at: new Date().toISOString()
        });
      }
    }
    if (fs.existsSync(cotPath)) {
      const s = dbfGetControlSerial(cotPath, 'numero');
      if (s && s.num > 0) {
        await dbCore.from('jjp_settings').upsert({
          key: 'mixnet_next_quote_serial',
          value: String(s.num),
          updated_at: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Error sincronizando correlativos desde DBF');
  }
}

export function startMixer() {
  log.info('Puente Mixer: Inicializando puente bidireccional JJ Paper ⇄ MixNet...');
  refreshEnvironmentConfig();
  loadHistories();

  // 1. Barrido inicial inmediato (correlativos, pedidos, cotizaciones, facturas y catálogo)
  syncCorrelativesFromDbf().catch(() => {});
  sweepRecentOutgoing().catch(() => {});
  sweepIncomingFiles().catch(() => {});
  sweepMixnetDbf().catch(() => {});
  sweepMixnetInvoices().catch(() => {});
  sweepMixnetProducts().catch(() => {});
  exportCatalogToMixnet().catch(() => {});

  // 2. Barrido periódico de pedidos, facturas y cotizaciones cada 30 segundos
  setInterval(() => {
    syncCorrelativesFromDbf().catch(() => {});
    sweepRecentOutgoing().catch(() => {});
    sweepIncomingFiles().catch(() => {});
    sweepMixnetDbf().catch(() => {});
    sweepMixnetInvoices().catch(() => {});
  }, 30_000);


  // 3. Re-chequeo del entorno de unidades (por si se monta M: o P: en red) cada 10 minutos
  setInterval(() => {
    refreshEnvironmentConfig();
  }, 600_000);

  // 4. Activar listeners en tiempo real
  setupRealtimeListeners();

  mixerInitialized = true;
  log.info('Puente Mixer: Puente bidireccional completamente activo y enlazado.');
}
