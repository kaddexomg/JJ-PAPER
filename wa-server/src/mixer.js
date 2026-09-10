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

let activePrimaryDir = 'C:/JJ-PAPER-MIXER';
let activeDropDirs = ['C:/JJ-PAPER-MIXER', 'C:/Pedidos JJ'];
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
      activeDropDirs = Array.isArray(cfg.drop_dirs) && cfg.drop_dirs.length > 0 ? cfg.drop_dirs : [activePrimaryDir];
      activeDbfDir = cfg.dbf_dir || null;
    }

    // Asegurar que las carpetas existan
    for (const d of activeDropDirs) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      } catch (_) {}
    }

    log.info(`Puente Mixer: Rutas activas -> Principal: ${activePrimaryDir} | Drop dirs: [${activeDropDirs.join(', ')}] | DBF: ${activeDbfDir || 'No detectado'}`);
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
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const targetPath = path.join(dir, filename);
      fs.writeFileSync(targetPath, content, 'utf8');
      successCount++;
    } catch (err) {
      log.warn({ err: err.message, dir, filename }, 'Puente Mixer: Error escribiendo en carpeta de intercambio');
    }
  }
  return successCount > 0;
}

/* ═══════════════ EXPORTACIÓN: JJ PAPER ➔ MIXNET ═══════════════ */

// 1. Exportar Pedido (jjp_orders)
export function exportOrder(o) {
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

  if (okCsv || okTxt) {
    exportedOrders.add(o.order_number);
    saveHistories();
    log.info(`Puente Mixer: Pedido ${o.order_number} exportado correctamente a carpetas de intercambio.`);
    return true;
  }
  return false;
}

// 2. Exportar Cotización (jjp_quotes)
export function exportQuote(q) {
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

  if (okCsv || okTxt) {
    exportedQuotes.add(q.quote_number);
    saveHistories();
    log.info(`Puente Mixer: Cotización ${q.quote_number} exportada correctamente a carpetas de intercambio.`);
    return true;
  }
  return false;
}

// Barrido periódico saliente (JJ Paper ➔ MixNet)
async function sweepRecentOutgoing() {
  try {
    lastSweepTime = new Date().toISOString();
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Pedidos salientes
    const { data: orders, error: oErr } = await dbCore.from('jjp_orders')
      .select('*')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true });

    if (!oErr && orders) {
      let count = 0;
      for (const o of orders) {
        if (!exportedOrders.has(o.order_number)) {
          if (exportOrder(o)) count++;
        }
      }
      if (count > 0) {
        log.info(`Puente Mixer: Barrido saliente exportó ${count} pedidos pendientes.`);
      }
    }

    // 2. Cotizaciones salientes
    const { data: quotes, error: qErr } = await dbCore.from('jjp_quotes')
      .select('*')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true });

    if (!qErr && quotes) {
      let count = 0;
      for (const q of quotes) {
        if (!exportedQuotes.has(q.quote_number)) {
          if (exportQuote(q)) count++;
        }
      }
      if (count > 0) {
        log.info(`Puente Mixer: Barrido saliente exportó ${count} cotizaciones pendientes.`);
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
          const sellerId = matchedCust?.seller_id || null;
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
                items: JSON.stringify(items),
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
                items: JSON.stringify(items),
                subtotal_usd: totalUsd,
                total_usd: totalUsd,
                exchange_rate: rate,
                total_bs: rate > 0 ? (totalUsd * rate).toFixed(2) : 0,
                payment_method: 'efectivo',
                notes: `[MixNet Caja] Pedido importado automáticamente desde archivo ${f}`,
                source: 'pos',
                status: 'pendiente_pago',
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

// 2. Barrido de tablas DBF activas de MixNet (PED.DBF / PRESUP.DBF)
async function sweepMixnetDbf() {
  if (!activeDbfDir || !fs.existsSync(activeDbfDir)) return;

  try {
    const pedPath = path.join(activeDbfDir, 'PED.DBF');
    const renPedPath = path.join(activeDbfDir, 'MXRENPED.DBF');

    if (fs.existsSync(pedPath)) {
      const pedStruct = readDbfStructure(pedPath);
      if (pedStruct && pedStruct.numRecords > 0) {
        // Leer últimos 200 registros de PED.DBF
        const pedRows = readDbfRows(pedStruct, 200);
        let renRows = [];
        if (fs.existsSync(renPedPath)) {
          const renStruct = readDbfStructure(renPedPath);
          if (renStruct) renRows = readDbfRows(renStruct, 2000);
        }

        const rate = await getActiveExchangeRate();

        for (const pr of pedRows.reverse()) { // Comenzar por los más recientes
          const numPed = String(pr.numped || pr.num_ped || pr.numero || pr.pedido || '').trim();
          if (!numPed) continue;

          const dbfOrderKey = `dbf:ped:${numPed}`;
          const finalOrderNum = `MIX-${numPed}`;

          if (importedHistory.has(dbfOrderKey) || exportedOrders.has(finalOrderNum)) continue;

          // Verificar si ya existe en Supabase
          const { data: existing } = await dbCore.from('jjp_orders').select('id').eq('order_number', finalOrderNum).maybeSingle();
          if (existing) {
            importedHistory.add(dbfOrderKey);
            continue;
          }

          const clientName = String(pr.nomcli || pr.nombre || pr.razon || 'Cliente Caja MixNet').trim();
          const rif = String(pr.rif || pr.cif || pr.cifoih || '').trim();
          const phone = String(pr.telefono || pr.tlf || '').trim();
          const totalVal = parseFloat(String(pr.total || pr.totped || pr.monto || '0').replace(/,/g, '.')) || 0;

          // Buscar renglones
          const items = [];
          for (const rr of renRows) {
            const renNum = String(rr.numped || rr.num_ped || '').trim();
            if (renNum === numPed) {
              const sku = String(rr.codart || rr.codigo || '').trim();
              const name = String(rr.nomart || rr.descrip || 'Artículo').trim();
              const qty = parseFloat(String(rr.cantidad || rr.cant || '1').replace(/,/g, '.')) || 1;
              const price = parseFloat(String(rr.precio || rr.precio_b || '0').replace(/,/g, '.')) || 0;
              const sub = parseFloat(String(rr.total || rr.subtotal || (qty * price)).replace(/,/g, '.')) || (qty * price);
              items.push({ sku, name, brand: '', qty, price_usd: price, subtotal_usd: sub });
            }
          }

          if (items.length === 0 && totalVal > 0) {
            items.push({ sku: 'MIX-CAJA', name: `Consumo Caja #${numPed}`, brand: '', qty: 1, price_usd: totalVal, subtotal_usd: totalVal });
          }

          const matchedCust = await matchCustomer(phone, rif, clientName);
          const sellerId = matchedCust?.seller_id || null;

          const { error } = await dbCore.from('jjp_orders').insert({
            order_number: finalOrderNum,
            client_name: clientName,
            rif: rif || null,
            phone: phone || null,
            items: JSON.stringify(items),
            subtotal_usd: totalVal,
            total_usd: totalVal,
            exchange_rate: rate,
            total_bs: rate > 0 ? (totalVal * rate).toFixed(2) : 0,
            payment_method: 'efectivo',
            notes: `[MixNet Caja] Importado automáticamente desde PED.DBF (#${numPed})`,
            source: 'pos',
            status: 'pendiente_pago',
            seller_id: sellerId
          });

          if (!error) {
            log.info(`Puente Mixer: Pedido importado desde DBF de MixNet (${finalOrderNum} - $${totalVal.toFixed(2)})`);
            importedHistory.add(dbfOrderKey);
            saveHistories();
            lastImportTime = new Date().toISOString();
          }
        }
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Puente Mixer: Advertencia al leer DBF de MixNet');
  }
}

/* ═══════════════ REALTIME LISTENERS ═══════════════ */
function setupRealtimeListeners() {
  log.info('Puente Mixer: Suscribiendo canales Realtime para pedidos y cotizaciones...');

  // 1. Pedidos
  dbCore.channel('mixer-orders')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_orders' },
      p => {
        log.info(`Puente Mixer: Recibida inserción de pedido ${p.new.order_number} por Realtime.`);
        exportOrder(p.new);
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_orders' },
      p => {
        if (!exportedOrders.has(p.new.order_number)) {
          log.info(`Puente Mixer: Recibida actualización de pedido no exportado ${p.new.order_number}. Exportando...`);
          exportOrder(p.new);
        }
      }
    )
    .subscribe(status => {
      log.info(`Puente Mixer: Canal Realtime de pedidos: ${status}`);
    });

  // 2. Cotizaciones
  dbCore.channel('mixer-quotes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_quotes' },
      p => {
        log.info(`Puente Mixer: Recibida inserción de cotización ${p.new.quote_number} por Realtime.`);
        exportQuote(p.new);
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

export function startMixer() {
  log.info('Puente Mixer: Inicializando puente bidireccional JJ Paper ⇄ MixNet...');
  refreshEnvironmentConfig();
  loadHistories();

  // 1. Barrido inicial inmediato
  sweepRecentOutgoing().catch(() => {});
  sweepIncomingFiles().catch(() => {});
  sweepMixnetDbf().catch(() => {});

  // 2. Barrido periódico bidireccional cada 30 segundos
  setInterval(() => {
    sweepRecentOutgoing().catch(() => {});
    sweepIncomingFiles().catch(() => {});
    sweepMixnetDbf().catch(() => {});
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
