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
  findCliente as dbfFindCliente,
  upsertCliente as dbfUpsertCliente
} from './mixnet-dbf-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'mixnet-config.json');
const HISTORY_ORDERS_FILE = path.join(ROOT_DIR, 'exported-orders.json');
const HISTORY_QUOTES_FILE = path.join(ROOT_DIR, 'exported-quotes.json');
const HISTORY_IMPORTED_FILE = path.join(ROOT_DIR, 'imported-mixnet.json');

// Estados en memoria y conjuntos de duplicados
let exportedOrders = new Set();
let exportedQuotes = new Set();
let importedHistory = new Set();

// Códigos de vendedor MixNet (MXENCPED.codven / MXENCCOT.codven) → vendedor JJ Paper
// Referencia: Yovanni (004/006), Keyder (005), Marianela (008), Andreina (014)
// NOTA: 010 y 020 en MixNet representan Caja Mostrador / Cartera General de Tienda (seller_id: null).
const SELLERS_BY_CODVEN = new Map([
  ['95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', ['004', '006']], // Yovanni Araujo
  ['bddc57dc-5bf9-4a72-9e1c-751d07b03164', ['005']],        // Keyder Salazar (005 en MixNet)
  ['3c9b7ddd-4b98-45c6-a646-5c557a2bc043', ['008']],        // Marianela (marianela08)
  ['68c29cd3-760a-4282-8214-4e7c60413ec5', ['014']],        // Andreina (andreina)
]);
const CODVEN_HINT = new Map([
  ['004', 'Yovanni'], ['006', 'Yovanni'], ['005', 'Keyder'], ['008', 'Marianela'], ['014', 'Andreina']
]);
function sellerForCodven(codven) {
  const cv = String(codven || '').trim();
  for (const [sid, codes] of SELLERS_BY_CODVEN.entries()) {
    if (codes.includes(cv)) return { seller_id: sid, hint: CODVEN_HINT.get(cv) || cv };
  }
  return { seller_id: null, hint: cv || 'Caja MixNet' };
}
function codvenForSeller(sellerId) {
  if (!sellerId) return '010';
  for (const [sid, codes] of SELLERS_BY_CODVEN.entries()) {
    if (sid === sellerId) return codes[0];
  }
  return '010';
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
    log.info(`Puente Mixer: Historiales cargados (Pedidos exportados: ${exportedOrders.size}, Cotizaciones exportadas: ${exportedQuotes.size}, Importados: ${importedHistory.size})`);
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Advertencia cargando historiales');
  }
}

function saveHistories() {
  try {
    fs.writeFileSync(HISTORY_ORDERS_FILE, JSON.stringify(Array.from(exportedOrders), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_QUOTES_FILE, JSON.stringify(Array.from(exportedQuotes), null, 2), 'utf8');
    fs.writeFileSync(HISTORY_IMPORTED_FILE, JSON.stringify(Array.from(importedHistory), null, 2), 'utf8');
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
  if (exportedOrders.has(o.order_number)) return false;

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

  // Escritura nativa en DBF MixNet (serial correlativo) — el canal primario
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

  if (okCsv || okTxt) {
    exportedOrders.add(o.order_number);
    saveHistories();
    log.info(`Puente Mixer: Pedido ${o.order_number} exportado correctamente a carpetas de intercambio.`);
    return true;
  }
  return false;
}

// 2. Exportar Cotización (jjp_quotes)
export async function exportQuote(q) {
  if (!q || !q.quote_number) return false;
  if (exportedQuotes.has(q.quote_number)) return false;

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

  // Escritura nativa en DBF MixNet (serial correlativo) — el canal primario
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

  if (okCsv || okTxt) {
    exportedQuotes.add(q.quote_number);
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
// para que el importador DBF no lo reimporte como documento MIX-* (guard anti round-trip).
function registerDbfExport(isQuote, serial) {
  const dbfKey = isQuote ? `dbf:cot:${serial}` : `dbf:ped:${serial}`;
  const finalNum = isQuote ? `MIX-COT-${serial}` : `MIX-${serial}`;
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
  try {
    const dir = dbfDir || activeDbfDir;
    if (!dir) return { ok: false, reason: 'no-dbf-dir' };
    const encPath = dbfPath('MXENCCOT.DBF', dir);
    const detPath = dbfPath('MXRENCOT.DBF', dir);
    const cliPath = dbfPath('MXCTACLI.DBF', dir);
    if (!encPath || !detPath || !cliPath || !fs.existsSync(encPath) || !fs.existsSync(detPath) || !fs.existsSync(cliPath)) {
      return { ok: false, reason: 'no-cot-dbf' };
    }
    const items = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items || '[]') : []);
    if (items.length === 0) return { ok: false, reason: 'no-items' };

    // 1. Siguiente serial correlativo (NUMCOT)
    const serial = dbfNextSerial(encPath, 'numcot');
    if (!serial.ok) return { ok: false, reason: serial.error || 'no-serial' };
    const numcot = serial.nextFormatted;

    // 2. Resolver/crear cliente en MXCTACLI
    const cli = clienteForDoc(q);
    const cliRes = await dbfUpsertCliente(cliPath, cli, dir);
    if (!cliRes.ok) return { ok: false, reason: cliRes.error || 'no-cli' };
    const codcli = cliRes.codcli;

    // 3. Cabecera + renglones
    const encStruct = dbfReadStruct(encPath);
    const detStruct = dbfReadStruct(detPath);
    const header = buildQuoteHeaderRecord(encStruct, q, numcot, codcli);
    const details = items.map(i => buildQuoteDetailRecord(detStruct, q, numcot, codcli, i));

    // 4. Append atómico con backup
    const encRes = await dbfAppend(encPath, [header], { backupPrefix: 'backups/backup_MXENCCOT' });
    if (!encRes.ok) return { ok: false, reason: `cabecera: ${encRes.error}` };
    const detRes = await dbfAppend(detPath, details, { backupPrefix: 'backups/backup_MXRENCOT' });
    if (!detRes.ok) return { ok: false, reason: `detalle: ${detRes.error}` };

    registerDbfExport(true, numcot);
    log.info(`Puente Mixer (DBF): Cotización ${q.quote_number} → NUMCOT ${numcot} / cliente ${codcli} en ${dir}.`);
    return { ok: true, serial: numcot, codcli, createdCli: !!cliRes.created };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// Exporta un pedido JJ (jjp_orders) al DBF nativo de MixNet: MXENCPED + MXRENPED.
export async function exportOrderToDbf(o, dbfDir) {
  try {
    const dir = dbfDir || activeDbfDir;
    if (!dir) return { ok: false, reason: 'no-dbf-dir' };
    const encPath = dbfPath('MXENCPED.DBF', dir);
    const detPath = dbfPath('MXRENPED.DBF', dir);
    const cliPath = dbfPath('MXCTACLI.DBF', dir);
    if (!encPath || !detPath || !cliPath || !fs.existsSync(encPath) || !fs.existsSync(detPath) || !fs.existsSync(cliPath)) {
      return { ok: false, reason: 'no-ped-dbf' };
    }
    const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || '[]') : []);
    if (items.length === 0) return { ok: false, reason: 'no-items' };

    // 1. Siguiente serial correlativo (NUMPED)
    const serial = dbfNextSerial(encPath, 'numped');
    if (!serial.ok) return { ok: false, reason: serial.error || 'no-serial' };
    const numped = serial.nextFormatted;

    // 2. Resolver/crear cliente en MXCTACLI
    const cli = clienteForDoc(o);
    const cliRes = await dbfUpsertCliente(cliPath, cli, dir);
    if (!cliRes.ok) return { ok: false, reason: cliRes.error || 'no-cli' };
    const codcli = cliRes.codcli;

    // 3. Cabecera + renglones
    const encStruct = dbfReadStruct(encPath);
    const detStruct = dbfReadStruct(detPath);
    const header = buildOrderHeaderRecord(encStruct, o, numped, codcli);
    const details = items.map(i => buildOrderDetailRecord(detStruct, o, numped, codcli, i));

    // 4. Append atómico con backup
    const encRes = await dbfAppend(encPath, [header], { backupPrefix: 'backups/backup_MXENCPED' });
    if (!encRes.ok) return { ok: false, reason: `cabecera: ${encRes.error}` };
    const detRes = await dbfAppend(detPath, details, { backupPrefix: 'backups/backup_MXRENPED' });
    if (!detRes.ok) return { ok: false, reason: `detalle: ${detRes.error}` };

    registerDbfExport(false, numped);
    log.info(`Puente Mixer (DBF): Pedido ${o.order_number} → NUMPED ${numped} / cliente ${codcli} en ${dir}.`);
    return { ok: true, serial: numped, codcli, createdCli: !!cliRes.created };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
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
        // Los MIX-* son documentos importados DESDE MixNet (DBF/CSV): no deben re-exportarse
        if (o.order_number && o.order_number.startsWith('MIX-')) continue;
        if (!exportedOrders.has(o.order_number)) {
          if (await exportOrder(o)) count++;
        }
      }
      if (count > 0) {
        log.info(`Puente Mixer: Barrido saliente exportó ${count} pedidos pendientes.`);
      }
    }

    // 2. Cotizaciones salientes — DESACTIVADO (17/09/2026)
    // Las cotizaciones NO se exportan a MixNet directamente. Solo los PEDIDOS viajan
    // a MixNet. Una cotización llegará allí únicamente cuando el vendedor la convierta
    // en venta (POS → posSubmit → crea jjp_orders → sweepRecentOutgoing exporta el pedido).
    // Exportar cotizaciones sin confirmar llenaba MixNet con documentos pendientes que
    // el sistema de Caja no debería ver hasta ser pedidos reales.

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
async function matchCustomer(phone, rif, name) {
  try {
    if (phone) {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7) {
        const { data } = await dbCore.from('jjp_customers')
          .select('id, seller_id, name, phone, rif')
          .ilike('phone', `%${cleanPhone.slice(-7)}%`)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }
    }
    if (rif) {
      const cleanRif = rif.toUpperCase().replace(/[\s.-]/g, '');
      if (cleanRif.length >= 5) {
        const { data } = await dbCore.from('jjp_customers')
          .select('id, seller_id, name, phone, rif')
          .ilike('rif', `%${cleanRif}%`)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }
    }
    if (name && name.length >= 4) {
      const { data } = await dbCore.from('jjp_customers')
        .select('id, seller_id, name, phone, rif')
        .ilike('name', `%${name.trim()}%`)
        .limit(1)
        .maybeSingle();
      if (data) return data;
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

          // Agrupar filas
          const items = [];
          let orderNumber = '';
          let clientName = '';
          let rif = '';
          let phone = '';
          let totalUsd = 0;

          for (let i = 1; i < lines.length; i++) {
            const rawParts = lines[i].split(sep).map(p => p.trim().replace(/^"+|"+$/g, ''));
            if (rawParts.length < 2) continue;

            if (colOrder >= 0 && rawParts[colOrder]) orderNumber = rawParts[colOrder];
            if (colClient >= 0 && rawParts[colClient]) clientName = rawParts[colClient];
            if (colRif >= 0 && rawParts[colRif]) rif = rawParts[colRif];
            if (colPhone >= 0 && rawParts[colPhone]) phone = rawParts[colPhone];

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
          const sellerId = (matchedCust?.seller_id === adminId) ? null : (matchedCust?.seller_id || null);
          const rate = await getActiveExchangeRate();

          if (isQuote) {
            // Verificar si ya existe en Supabase
            const { data: existingQuote } = await dbCore.from('jjp_quotes').select('id').eq('quote_number', orderNumber).maybeSingle();
            if (!existingQuote) {
              const { error } = await dbCore.from('jjp_quotes').insert({
                quote_number: orderNumber,
                client_name: clientName,
                rif: rif || null,
                phone: phone || null,
                items,
                estimated_total_usd: totalUsd,
                exchange_rate: rate,
                notes: `[MixNet Caja] Cotización importada automáticamente desde archivo ${f}`,
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
                client_name: clientName,
                rif: rif || null,
                phone: phone || null,
                items,
                subtotal_usd: totalUsd,
                total_usd: totalUsd,
                exchange_rate: rate,
                total_bs: rate > 0 ? (totalUsd * rate).toFixed(2) : 0,
                payment_method: 'efectivo',
                notes: `[MixNet Caja] Pedido importado automáticamente desde archivo ${f}`,
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
      for (const pr of encRows.slice().reverse()) { // Comenzar por los más recientes
        const emisionStr = String(pr.emision || '').trim();
        let numDoc = '';
        let totalVal = 0;
        if (isQuote) {
          numDoc = String(pr.numcot || pr.numped || pr.numero || '').trim();
          totalVal = parseFloat(String(pr.tot_cot || pr.tot_ped || pr.total || '0').replace(/,/g, '.')) || 0;
        } else {
          numDoc = String(pr.numped || pr.numero || pr.pedido || '').trim();
          totalVal = parseFloat(String(pr.tot_ped || pr.total || '0').replace(/,/g, '.')) || 0;
        }
        if (!numDoc) continue;

        // Filtro de recencia por fecha de emisión (formato YYYYMMDD)
        if (emisionStr && /^\d{8}$/.test(emisionStr)) {
          const d = new Date(+emisionStr.slice(0, 4), +emisionStr.slice(4, 6) - 1, +emisionStr.slice(6, 8));
          if (d.getTime() < cutoffMs) continue;
        }

        const dbfKey = `dbf:${isQuote ? 'cot' : 'ped'}:${numDoc}`;
        const finalNum = isQuote ? `MIX-COT-${numDoc}` : `MIX-${numDoc}`;

        if (importedHistory.has(dbfKey) || (isQuote ? exportedQuotes : exportedOrders).has(finalNum)) continue;

        // Ya existe en Supabase?
        const table = isQuote ? 'jjp_quotes' : 'jjp_orders';
        const numField = isQuote ? 'quote_number' : 'order_number';
        const { data: existing } = await dbCore.from(table).select('id').eq(numField, finalNum).maybeSingle();
        if (existing) {
          importedHistory.add(dbfKey);
          continue;
        }

        candidates.push({ pr, numDoc, totalVal, dbfKey, finalNum });
      }

      if (candidates.length === 0) return;

      // Solo leer el detalle si hay documentos nuevos (evita escanear 100K renglones en cada barrido)
      let detMap = new Map();
      if (fs.existsSync(detPath)) {
        const detStruct = readDbfStructure(detPath);
        if (detStruct) {
          const detNumField = isQuote ? 'numcot' : 'numped';
          const newestFound = candidates[candidates.length - 1].numDoc;
          // Rebalse temprano: detener registro de docs si ya no aparecen los recientes
          for (const rr of readDbfRows(detStruct, 300000)) {
            const renNum = String(rr[detNumField] || rr.numped || rr.num_ped || '').trim();
            if (!renNum || renNum < newestFound) continue;
            if (!detMap.has(renNum)) detMap.set(renNum, []);
            detMap.get(renNum).push(rr);
          }
        }
      }

      for (const { pr, numDoc, totalVal, dbfKey, finalNum } of candidates) {
        // Resolver cliente desde la cabecera (puede ser código 003-409 o nombre directo)
        const clientCode = String(pr.cliente || '').trim();
        const cli = cliMap.get(clientCode) || null;
        const clientName = String(pr.nomcli || (cli && cli.nomcli) || pr.nombre || pr.razon || 'Cliente Caja MixNet').trim();
        const rif = String(pr.cif || (cli && cli.cif) || pr.rif || '').trim();
        const phone = String(pr.tlf1 || (cli && cli.tlf1) || pr.telefono || pr.tlf || '').trim();
        const moneda = String(pr.moneda || 'US$').trim();

        const items = (detMap.get(numDoc) || []).map(rr => {
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
        const adminId = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164';
        const effectiveCustSeller = (matchedCust?.seller_id === adminId) ? null : (matchedCust?.seller_id || null);

        // Detallar el vendedor que realizó la operación en MixNet (codven)
        const codven = String(pr.codven || '').trim();
        const { seller_id: codvenSeller, hint: sellerHint } = sellerForCodven(codven);
        const finalSellerId = codvenSeller || effectiveCustSeller;
        const vendorNote = codven ? ` · Vendedor MixNet #${codven} (${sellerHint})` : '';

        if (isQuote) {
          const { error } = await dbCore.from('jjp_quotes').insert({
            quote_number: finalNum,
            client_name: clientName,
            rif: rif || null,
            phone: phone || null,
            items,
            estimated_total_usd: totalVal,
            exchange_rate: rate,
            notes: `[MixNet Caja] Cotización importada automáticamente desde ${encFile} (#${numDoc})${vendorNote}`,
            source: 'vendedor',
            status: 'pendiente',
            seller_id: finalSellerId
          });
          if (!error) {
            log.info(`Puente Mixer: Cotización importada desde DBF de MixNet (${finalNum} - $${totalVal.toFixed(2)}${vendorNote})`);
            importedHistory.add(dbfKey);
            saveHistories();
            lastImportTime = new Date().toISOString();
          }
        } else {
          const { error } = await dbCore.from('jjp_orders').insert({
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
            notes: `[MixNet Caja] Importado automáticamente desde ${encFile} (#${numDoc}, ${moneda})${vendorNote}`,
            source: 'pos',
            status: 'pagado',
            seller_id: finalSellerId
          });
          if (!error) {
            log.info(`Puente Mixer: Pedido importado desde DBF de MixNet (${finalNum} - $${totalVal.toFixed(2)}${vendorNote})`);
            importedHistory.add(dbfKey);
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
        log.info(`Puente Mixer: Recibida inserción de pedido ${p.new.order_number} por Realtime.`);
        exportOrder(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando pedido'));
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_orders' },
p => {
          if (!exportedOrders.has(p.new.order_number)) {
            log.info(`Puente Mixer: Recibida actualización de pedido no exportado ${p.new.order_number}. Exportando...`);
            exportOrder(p.new).catch(err => log.warn({ err: err.message }, 'Puente Mixer: Error Realtime exportando pedido (update)'));
          }
        }
    )
    .subscribe(status => {
      log.info(`Puente Mixer: Canal Realtime de pedidos: ${status}`);
    });

  // 2. Cotizaciones — Realtime DESACTIVADO (17/09/2026)
  // Las cotizaciones NO se exportan a MixNet por Realtime. Solo van al crearse un
  // PEDIDO (jjp_orders INSERT). El canal 'mixer-quotes' ya no dispara exportQuote().
  // Si en el futuro se requiere exportar cotizaciones aprobadas, reactivar aquí
  // filtrando por status === 'aprobado' o 'convertido'.
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

export function startMixer() {
  log.info('Puente Mixer: Inicializando puente bidireccional JJ Paper ⇄ MixNet...');
  refreshEnvironmentConfig();
  loadHistories();

  // 1. Barrido inicial inmediato (pedidos, cotizaciones y catálogo)
  sweepRecentOutgoing().catch(() => {});
  sweepIncomingFiles().catch(() => {});
  sweepMixnetDbf().catch(() => {});
  sweepMixnetProducts().catch(() => {});
  exportCatalogToMixnet().catch(() => {});

  // 2. Barrido periódico de pedidos y cotizaciones cada 30 segundos
  setInterval(() => {
    sweepRecentOutgoing().catch(() => {});
    sweepIncomingFiles().catch(() => {});
    sweepMixnetDbf().catch(() => {});
  }, 30_000);

  // 3. Sincronización periódica de productos y catálogo cada 5 minutos
  setInterval(() => {
    sweepMixnetProducts().catch(() => {});
    exportCatalogToMixnet().catch(() => {});
  }, 300_000);

  // 3. Re-chequeo del entorno de unidades (por si se monta M: o P: en red) cada 10 minutos
  setInterval(() => {
    refreshEnvironmentConfig();
  }, 600_000);

  // 4. Activar listeners en tiempo real
  setupRealtimeListeners();

  mixerInitialized = true;
  log.info('Puente Mixer: Puente bidireccional completamente activo y enlazado.');
}
