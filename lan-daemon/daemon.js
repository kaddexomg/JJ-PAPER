/* ======================================================================
   JJ Paper — Demonio Autónomo de Sincronización ERP MixNet (LAN Daemon)
   ----------------------------------------------------------------------
   Diseñado para ejecutarse de forma independiente en la estación local o
   servidor de red (192.168.0.185).

   Características:
   1. Multi-Target Inteligente: Detecta y escribe simultáneamente en TODOS
      los directorios de MixNet encontrados (M:\comp01, M:\MIX11\comp01,
      Z:\comp01) para que cualquier terminal MixNet vea los cambios.
   2. Soberanía Absoluta de Correlativos: Consulta y avanza MXNUMCOT.DBF y
      MXNUMPED.DBF en todas las unidades sin inventar números.
   3. Escritura Nativa dBase III / Clipper con EOF 0x1A e IVA Exento 'E'.
   4. Cero Spam: Importa sólo documentos recientes (<= 48h) de MixNet.
   5. Enlace en Tiempo Real con JJ Paper UI: Reporta estado a
      jjp_server_control y atiende comandos remotos de sincronización.
   6. Micro-API HTTP local en puerto 8790 (/status, /sync-now, /restart, /next-serial).
   ====================================================================== */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  readDbfStruct, readDbfRows, buildDbfRecord,
  getDbfControlSerial, setDbfSerial,
  upsertDbfHeader, replaceDbfDetails
} from './dbf-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credenciales oficiales Supabase Core (Proyecto A)
const SUPABASE_URL = process.env.SUPABASE_URL_CORE || 'http://166.0.112.247';
const SERVICE_KEY  = process.env.SERVICE_KEY_CORE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3Mjk1MDAwMDAsImV4cCI6MjA0NTAwMDAwMH0.Re_nlxR74OCn2LLRN78SKEHt8FxFYanYLsZr2Cvyf8s';

const HTTP_PORT = parseInt(process.env.DAEMON_PORT || '8790', 10);
const HISTORY_FILE = path.join(__dirname, 'daemon-history.json');

// Mapeo canónico de vendedores por nómina MixNet (CODVEN)
const CODVEN_MAP = {
  '002': 'Luis Alarcon',
  '004': 'Yovanni Araujo',
  '006': 'Yovanni Araujo',
  '008': 'Marianela',
  '014': 'Andreina',
  '010': 'Keyder Salazar (Admin)',
  '020': 'Keyder Salazar (Admin)',
  '005': 'Mostrador / Tienda Fisica',
  '001': 'Mary Garcia',
  '025': 'Ana Barajas'
};

const SELLER_UUID_TO_CODVEN = {
  'bddc57dc-5bf9-4a72-9e1c-751d07b03164': '010'
};

// Estado del demonio
let activeDbfDirs = [];
let lastSyncTime = null;
let lastExportedQuote = '00053494 ($616.85 - Aerotransporte Caribe)';
let lastExportedOrder = null;
let exportedHistory = new Set();
let importedHistory = new Set();
let docFingerprints = new Map();

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

/* ═══════════════ DETECCIÓN MULTI-TARGET DE DIRECTORIOS MIXNET ═══════════════ */
export function detectMixnetDirs() {
  const candidates = [
    process.env.MIXNET_DIR,
    'M:\\comp01',
    'M:\\MIX11\\comp01',
    'Z:\\comp01',
    'C:\\MIX11\\comp01',
    'D:\\MIX11\\comp01',
    'C:\\comp01',
    'D:\\comp01',
    '\\\\192.168.0.185\\MIX11\\comp01',
    '\\\\servidor\\MIX11\\comp01'
  ].filter(Boolean);

  const found = new Set();
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        const testFile1 = path.join(cand, 'MXNUMCOT.DBF');
        const testFile2 = path.join(cand, 'MXCTAINV.DBF');
        const testFile3 = path.join(cand, 'MXENCCOT.DBF');
        if (fs.existsSync(testFile1) || fs.existsSync(testFile2) || fs.existsSync(testFile3)) {
          found.add(cand);
        }
      }
    } catch (_) {}
  }

  activeDbfDirs = Array.from(found);
  if (activeDbfDirs.length > 0) {
    log(`Directorios MixNet activos detectados (${activeDbfDirs.length}): ${activeDbfDirs.join(' | ')}`);
  } else {
    log(`ADVERTENCIA: No se detectaron tablas de MixNet en las rutas predeterminadas.`, 'WARN');
  }
  return activeDbfDirs;
}

/* ═══════════════ CLIENTE REST SUPABASE NATIVO (CERO NPM) ═══════════════ */
async function sbQuery(endpoint, options = {}) {
  const urlStr = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {})
  };

  if (typeof fetch === 'function') {
    const resp = await fetch(urlStr, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} en ${endpoint}: ${text}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await resp.json();
    }
    return null;
  }

  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyStr = options.body ? JSON.stringify(options.body) : null;
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        ...headers,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve(null);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} en ${endpoint}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout en ${endpoint}`)); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/* ═══════════════ HISTORIALES Y PERSISTENCIA ═══════════════ */
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      exportedHistory = new Set(data.exported || []);
      importedHistory = new Set(data.imported || []);
      docFingerprints = new Map(Object.entries(data.fingerprints || {}));
      log(`Historial recuperado: ${exportedHistory.size} exportados, ${importedHistory.size} importados.`);
    }
  } catch (e) {
    log(`Aviso al cargar historial: ${e.message}`, 'WARN');
  }
}

function saveHistory() {
  try {
    const payload = {
      exported: Array.from(exportedHistory),
      imported: Array.from(importedHistory),
      fingerprints: Object.fromEntries(docFingerprints)
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    log(`Error guardando historial: ${e.message}`, 'WARN');
  }
}

/* ═══════════════ 1. SOBERANÍA Y SINCRONIZACIÓN DE CORRELATIVOS ═══════════════ */
export async function syncCorrelatives() {
  if (activeDbfDirs.length === 0) detectMixnetDirs();
  if (activeDbfDirs.length === 0) return;

  let maxPedNum = 0;
  let maxCotNum = 0;

  for (const dir of activeDbfDirs) {
    const pedPath = path.join(dir, 'MXNUMPED.DBF');
    const cotPath = path.join(dir, 'MXNUMCOT.DBF');

    if (fs.existsSync(pedPath)) {
      const sPed = getDbfControlSerial(pedPath, 'numero');
      if (sPed && sPed.num > maxPedNum) maxPedNum = sPed.num;
    }

    if (fs.existsSync(cotPath)) {
      const sCot = getDbfControlSerial(cotPath, 'numero');
      if (sCot && sCot.num > maxCotNum) maxCotNum = sCot.num;
    }
  }

  // Igualar seriales en todas las carpetas para evitar desfases
  if (maxPedNum > 0) {
    for (const dir of activeDbfDirs) {
      const pedPath = path.join(dir, 'MXNUMPED.DBF');
      if (fs.existsSync(pedPath)) {
        const cur = getDbfControlSerial(pedPath, 'numero');
        if (!cur || cur.num < maxPedNum) setDbfSerial(pedPath, maxPedNum);
      }
    }
  }

  if (maxCotNum > 0) {
    for (const dir of activeDbfDirs) {
      const cotPath = path.join(dir, 'MXNUMCOT.DBF');
      if (fs.existsSync(cotPath)) {
        const cur = getDbfControlSerial(cotPath, 'numero');
        if (!cur || cur.num < maxCotNum) setDbfSerial(cotPath, maxCotNum);
      }
    }
  }

  const updates = [];
  const nowIso = new Date().toISOString();
  if (maxPedNum > 0) {
    updates.push({ key: 'mixnet_next_order_serial', value: String(maxPedNum + 1), updated_at: nowIso });
  }
  if (maxCotNum > 0) {
    updates.push({ key: 'mixnet_next_quote_serial', value: String(maxCotNum + 1), updated_at: nowIso });
  }

  if (updates.length > 0) {
    try {
      await sbQuery('jjp_settings?on_conflict=key', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: updates
      });
    } catch (e) {
      log(`Aviso sincronizando correlativos con Supabase: ${e.message}`, 'WARN');
    }
  }
}

/* ═══════════════ 2. IMPORTACIÓN: MIXNET ➔ JJ PAPER (SOLO NOVEDADES) ═══════════════ */
async function importMixnetDocuments(encFilename, detFilename, isQuote) {
  if (activeDbfDirs.length === 0) return;
  const primaryDir = activeDbfDirs[0];
  const encPath = path.join(primaryDir, encFilename);
  const detPath = path.join(primaryDir, detFilename);
  if (!fs.existsSync(encPath) || !fs.existsSync(detPath)) return;

  try {
    const sEnc = readDbfStruct(encPath);
    const sDet = readDbfStruct(detPath);
    if (!sEnc || !sDet || sEnc.numRecords <= 0) return;

    const numField = isQuote ? 'numcot' : 'numped';
    // Limitar a los últimos 40 registros para captar novedades reales sin reimportar basura histórica
    const encRows = readDbfRows(sEnc, [numField, 'emision', 'cliente', 'nomcli', 'cif', 'codven', 'comen1', 'comen2', isQuote ? 'tot_cot' : 'tot_ped', 'cambio'], 40);

    const detRows = readDbfRows(sDet, [numField, 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], 500);
    const detMap = new Map();
    for (const d of detRows) {
      const num = String(d[numField] || '').trim().padStart(8, '0').slice(-8);
      if (!num || num === '00000000') continue;
      if (!detMap.has(num)) detMap.set(num, []);
      detMap.get(num).push(d);
    }

    const minDateStr = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    let count = 0;

    for (const r of encRows.slice().reverse()) {
      const num = String(r[numField] || '').trim().padStart(8, '0').slice(-8);
      if (!num || num === '00000000') continue;

      const histKey = `${isQuote ? 'cot' : 'ped'}:${num}`;
      if (importedHistory.has(histKey) || exportedHistory.has(num)) continue;

      // Filtro de fecha: solo documentos de las últimas 48h
      const emision = String(r.emision || '').trim().replace(/\D/g, '');
      if (emision && emision < minDateStr) {
        importedHistory.add(histKey);
        continue;
      }

      const total = parseFloat(String(r[isQuote ? 'tot_cot' : 'tot_ped'] || '0').replace(/,/g, '.')) || 0;
      const rate = parseFloat(String(r.cambio || '0').replace(/,/g, '.')) || 0;
      const codven = String(r.codven || '').trim();
      const clientName = String(r.nomcli || 'CLIENTE MIXNET').trim();
      const rawComen = [r.comen1, r.comen2].map(c => String(c || '').trim()).filter(Boolean).join(' - ');

      const rawItems = detMap.get(num) || [];
      const items = rawItems.map(i => ({
        sku: String(i.item || '').trim(),
        name: String(i.descrip || 'Articulo').trim(),
        qty: parseFloat(String(i.cantidad || '1').replace(/,/g, '.')) || 1,
        price_usd: parseFloat(String(i.precio || '0').replace(/,/g, '.')) || 0,
        subtotal_usd: parseFloat(String(i.tot_ren || '0').replace(/,/g, '.')) || 0
      }));

      let sellerId = null;
      if (codven === '010' || codven === '020') {
        sellerId = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164'; // Keyder
      }

      if (isQuote) {
        const payload = {
          quote_number: num,
          client_name: clientName,
          rif: String(r.cif || '').trim() || null,
          items,
          estimated_total_usd: total,
          exchange_rate: rate,
          notes: rawComen || null,
          source: 'mixnet',
          status: 'pendiente',
          seller_id: sellerId
        };
        await sbQuery('jjp_quotes', { method: 'POST', body: payload });
        log(`Cotización #${num} importada de MixNet a JJ Paper ($${total.toFixed(2)} - CODVEN: ${codven})`);
      } else {
        const payload = {
          order_number: num,
          client_name: clientName,
          rif: String(r.cif || '').trim() || null,
          items,
          subtotal_usd: total,
          total_usd: total,
          exchange_rate: rate,
          total_bs: rate > 0 ? +(total * rate).toFixed(2) : 0,
          payment_method: 'efectivo',
          notes: rawComen || null,
          source: 'mixnet',
          status: 'pagado',
          seller_id: sellerId
        };
        await sbQuery('jjp_orders', { method: 'POST', body: payload });
        log(`Pedido #${num} importado de MixNet a JJ Paper ($${total.toFixed(2)} - CODVEN: ${codven})`);
      }

      importedHistory.add(histKey);
      exportedHistory.add(num);
      count++;
    }

    if (count > 0) saveHistory();
  } catch (e) {
    log(`Aviso en importación de ${encFilename}: ${e.message}`, 'WARN');
  }
}

export function isTestEntity(name = '', rif = '', notes = '') {
  const str = `${name || ''} ${rif || ''} ${notes || ''}`.toLowerCase();
  return /\b(e2e|prueba|test|verificacion|verificación|mps|dummy|tester|testing)\b/i.test(str) ||
         /cliente\s+(prueba|test|e2e)/i.test(str);
}

/* ═══════════════ 3. EXPORTACIÓN: JJ PAPER ➔ MIXNET (MULTI-TARGET) ═══════════════ */
export async function exportJJQuotesToMixnet() {
  if (activeDbfDirs.length === 0) detectMixnetDirs();
  if (activeDbfDirs.length === 0) return;

  try {
    // Buscar cotizaciones recientes creadas en JJ Paper (no provenientes de MixNet)
    const windowIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const quotes = await sbQuery(`jjp_quotes?created_at=gte.${windowIso}&source=neq.mixnet&status=neq.cancelado&order=created_at.asc`);
    if (!quotes || quotes.length === 0) return;

    for (const q of quotes) {
      let numcot = String(q.quote_number || '').trim();
      if (!/^\d{8}$/.test(numcot)) continue;
      if (isTestEntity(q.client_name, q.rif, q.notes)) {
        log(`[FILTRO TEST] Omitiendo cotización de prueba/E2E #${numcot} (${q.client_name}) para proteger MixNet.`, 'INFO');
        continue;
      }

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const totalUSD = parseFloat(q.estimated_total_usd || 0).toFixed(2);
      const rate = parseFloat(q.exchange_rate || 0).toFixed(2);
      const sellerCodven = (q.seller_id && SELLER_UUID_TO_CODVEN[q.seller_id]) ? SELLER_UUID_TO_CODVEN[q.seller_id] : '';

      const rawItems = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items || '[]') : []);
      // Exigir renglones reales: nunca inventar renglones ficticios
      if (rawItems.length === 0) continue;

      // Validar que todos los renglones tengan SKU real (prohibido 'LIBRE' o 'COTIZACION')
      const validItems = rawItems.filter(i => {
        const s = String(i.sku || '').trim().toUpperCase();
        return s && s !== 'LIBRE' && s !== 'COTIZACION' && s !== 'PEDIDO';
      });
      if (validItems.length !== rawItems.length) {
        log(`Aviso: Cotización #${numcot} rechazada por contener artículos sin SKU válido o marcados como LIBRE.`, 'WARN');
        continue;
      }

      const clientName = String(q.client_name || 'CTA. RECUPERADA: 000-001').slice(0, 60);
      let writtenAny = false;

      // Escribir en TODOS los directorios MixNet detectados
      for (const dir of activeDbfDirs) {
        const encPath = path.join(dir, 'MXENCCOT.DBF');
        const renPath = path.join(dir, 'MXRENCOT.DBF');
        const numPath = path.join(dir, 'MXNUMCOT.DBF');
        if (!fs.existsSync(encPath) || !fs.existsSync(renPath)) continue;

        const encStruct = readDbfStruct(encPath);
        const renStruct = readDbfStruct(renPath);
        if (!encStruct || !renStruct) continue;

        const headerBuf = buildDbfRecord(encStruct, {
          numcot,
          emision: today,
          cliente: '000-001',
          codsuc: '',
          codven: sellerCodven,
          comen1: String(q.notes || '').slice(0, 35),
          comen2: '',
          tot_cot: totalUSD,
          estatus: 'PE',
          moneda: 'US$',
          cambio: rate,
          nomcli: clientName,
          cif: String(q.rif || '').slice(0, 15)
        });

        const detailBufs = validItems.map(i => buildDbfRecord(renStruct, {
          item: String(i.sku || '').trim().slice(0, 15),
          unidad: String(i.unit || 'UND').slice(0, 3).toUpperCase(),
          cantidad: (parseFloat(i.qty || 1)).toFixed(3),
          descrip: String(i.name || '').slice(0, 50),
          numcot,
          emision: today,
          estatus: 'PE',
          precio: (parseFloat(i.price_usd || 0)).toFixed(2),
          tot_ren: (parseFloat(i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1)))).toFixed(2),
          iva: 'E', // Exento de IVA para que MixNet facture exactamente
          cliente: '000-001',
          codven: sellerCodven
        }));

        const backupDir = path.join(dir, 'backups');
        await upsertDbfHeader(encPath, 'numcot', numcot, headerBuf, { backupPrefix: path.join(backupDir, `SAFETY_MXENCCOT_${numcot}.DBF`) });
        await replaceDbfDetails(renPath, 'numcot', numcot, detailBufs, { backupPrefix: path.join(backupDir, `SAFETY_MXRENCOT_${numcot}.DBF`) });

        if (numPath && fs.existsSync(numPath)) {
          const writtenNum = parseInt(numcot, 10);
          const cur = getDbfControlSerial(numPath, 'numero');
          if (!cur || cur.num <= writtenNum) {
            setDbfSerial(numPath, writtenNum);
          }
        }

        writtenAny = true;
      }

      if (writtenAny) {
        lastExportedQuote = `${numcot} ($${totalUSD} - ${clientName})`;
        exportedHistory.add(numcot);
        importedHistory.add(`cot:${numcot}`);
        saveHistory();

        // Actualizar estatus en Supabase para feedback inmediato en UI
        if (q.status !== 'confirmado_mixnet') {
          await sbQuery(`jjp_quotes?id=eq.${q.id}`, {
            method: 'PATCH',
            body: { status: 'confirmado_mixnet' }
          }).catch(() => {});
        }

        log(`Cotización #${numcot} inyectada nativamente en MixNet (${activeDbfDirs.length} carpetas DBF) - Cliente: ${clientName}`);
      }
    }
  } catch (e) {
    log(`Error exportando cotizaciones a MixNet: ${e.message}`, 'WARN');
  }
}

export async function exportJJOrdersToMixnet() {
  if (activeDbfDirs.length === 0) detectMixnetDirs();
  if (activeDbfDirs.length === 0) return;

  try {
    const windowIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const orders = await sbQuery(`jjp_orders?created_at=gte.${windowIso}&source=neq.mixnet&status=neq.cancelado&status=neq.rechazado&order=created_at.asc`);
    if (!orders || orders.length === 0) return;

    for (const o of orders) {
      let numped = String(o.order_number || '').trim();
      if (!/^\d{8}$/.test(numped)) continue;
      if (isTestEntity(o.client_name, o.rif, o.notes)) {
        log(`[FILTRO TEST] Omitiendo pedido de prueba/E2E #${numped} (${o.client_name}) para proteger MixNet.`, 'INFO');
        continue;
      }

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const totalUSD = parseFloat(o.total_usd || 0).toFixed(2);
      const rate = parseFloat(o.exchange_rate || 0).toFixed(2);
      const sellerCodven = (o.seller_id && SELLER_UUID_TO_CODVEN[o.seller_id]) ? SELLER_UUID_TO_CODVEN[o.seller_id] : '';

      const rawItems = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || '[]') : []);
      if (rawItems.length === 0) continue;

      const validItems = rawItems.filter(i => {
        const s = String(i.sku || '').trim().toUpperCase();
        return s && s !== 'LIBRE' && s !== 'COTIZACION' && s !== 'PEDIDO';
      });
      if (validItems.length !== rawItems.length) {
        log(`Aviso: Pedido #${numped} rechazado por contener artículos sin SKU válido o marcados como LIBRE.`, 'WARN');
        continue;
      }

      const clientName = String(o.client_name || 'CTA. RECUPERADA: 000-001').slice(0, 60);
      let writtenAny = false;

      // Escribir en TODOS los directorios MixNet detectados
      for (const dir of activeDbfDirs) {
        const encPath = path.join(dir, 'MXENCPED.DBF');
        const renPath = path.join(dir, 'MXRENPED.DBF');
        const numPath = path.join(dir, 'MXNUMPED.DBF');
        if (!fs.existsSync(encPath) || !fs.existsSync(renPath)) continue;

        const encStruct = readDbfStruct(encPath);
        const renStruct = readDbfStruct(renPath);
        if (!encStruct || !renStruct) continue;

        const headerBuf = buildDbfRecord(encStruct, {
          numped,
          emision: today,
          cliente: '000-001',
          codsuc: '',
          codven: sellerCodven,
          comen1: String(o.notes || '').slice(0, 35),
          comen2: '',
          tot_ped: totalUSD,
          estatus: 'PE',
          moneda: 'US$',
          cambio: rate,
          nomcli: clientName,
          cif: String(o.rif || '').slice(0, 15)
        });

        const detailBufs = validItems.map(i => buildDbfRecord(renStruct, {
          item: String(i.sku || '').trim().slice(0, 15),
          unidad: String(i.unit || 'UND').slice(0, 3).toUpperCase(),
          cantidad: (parseFloat(i.qty || 1)).toFixed(3),
          descrip: String(i.name || '').slice(0, 50),
          numped,
          emision: today,
          estatus: 'PE',
          precio: (parseFloat(i.price_usd || 0)).toFixed(2),
          tot_ren: (parseFloat(i.subtotal_usd ?? ((i.price_usd || 0) * (i.qty || 1)))).toFixed(2),
          iva: 'E',
          cliente: '000-001',
          codven: sellerCodven
        }));

        const backupDir = path.join(dir, 'backups');
        await upsertDbfHeader(encPath, 'numped', numped, headerBuf, { backupPrefix: path.join(backupDir, `SAFETY_MXENCPED_${numped}.DBF`) });
        await replaceDbfDetails(renPath, 'numped', numped, detailBufs, { backupPrefix: path.join(backupDir, `SAFETY_MXRENPED_${numped}.DBF`) });

        if (numPath && fs.existsSync(numPath)) {
          const writtenNum = parseInt(numped, 10);
          const cur = getDbfControlSerial(numPath, 'numero');
          if (!cur || cur.num <= writtenNum) {
            setDbfSerial(numPath, writtenNum);
          }
        }

        writtenAny = true;
      }

      if (writtenAny) {
        lastExportedOrder = `${numped} ($${totalUSD} - ${o.client_name || 'Cliente'})`;
        exportedHistory.add(numped);
        importedHistory.add(`ped:${numped}`);
        saveHistory();
        log(`Pedido #${numped} inyectado nativamente en MixNet (${activeDbfDirs.length} carpetas DBF) - Cliente: ${o.client_name}`);
      }
    }
  } catch (e) {
    log(`Error exportando pedidos a MixNet: ${e.message}`, 'WARN');
  }
}

/* ═══════════════ 4. ENLACE EN TIEMPO REAL CON JJ PAPER WEB UI ═══════════════ */
async function reportHeartbeatAndPollCommands() {
  try {
    const nowIso = new Date().toISOString();
    let curCot = null;
    let curPed = null;

    for (const d of activeDbfDirs) {
      if (!curCot) curCot = getDbfControlSerial(path.join(d, 'MXNUMCOT.DBF'), 'numero');
      if (!curPed) curPed = getDbfControlSerial(path.join(d, 'MXNUMPED.DBF'), 'numero');
    }

    // Consultar registro de control de servidor (id: 1)
    const existing = await sbQuery('jjp_server_control?id=eq.1');
    const row = (existing && existing[0]) ? existing[0] : null;

    // Verificar si el usuario pulsó "Sincronizar MixNet" en la interfaz web
    if (row?.command === 'sync_mixnet') {
      log('Comando "sync_mixnet" recibido desde el panel web de JJ Paper. Ejecutando ciclo forzado...');
      await runSyncCycle();
      await sbQuery('jjp_server_control?id=eq.1', {
        method: 'PATCH',
        body: { command: null, command_at: null }
      }).catch(() => {});
    }

    const bridgeData = {
      online: true,
      host: os.hostname(),
      active_dirs: activeDbfDirs,
      current_cot_serial: curCot?.formatted || null,
      current_ped_serial: curPed?.formatted || null,
      last_sync_at: nowIso,
      exported_count: exportedHistory.size,
      imported_count: importedHistory.size,
      last_exported_quote: lastExportedQuote,
      last_exported_order: lastExportedOrder
    };

    const existingModules = row?.modules || {};
    await sbQuery('jjp_server_control?id=eq.1', {
      method: 'PATCH',
      body: {
        modules: {
          ...existingModules,
          mixer: {
            online: true,
            primary_dir: activeDbfDirs[0] || 'M:/comp01',
            dbf_dir: activeDbfDirs.join(' | '),
            exported_orders_count: exportedHistory.size,
            exported_quotes_count: exportedHistory.size,
            imported_count: importedHistory.size,
            last_sweep_at: nowIso
          },
          lan_bridge: bridgeData
        }
      }
    });
  } catch (_) {}
}

/* ═══════════════ CICLO PRINCIPAL DE BARRIDO ═══════════════ */
async function runSyncCycle() {
  try {
    await syncCorrelatives();
    await importMixnetDocuments('MXENCPED.DBF', 'MXRENPED.DBF', false);
    await importMixnetDocuments('MXENCCOT.DBF', 'MXRENCOT.DBF', true);
    await exportJJQuotesToMixnet();
    await exportJJOrdersToMixnet();
    lastSyncTime = new Date().toISOString();
    await reportHeartbeatAndPollCommands();
  } catch (err) {
    log(`Error en ciclo de sincronización: ${err.message}`, 'WARN');
  }
}

/* ═══════════════ MICRO-API HTTP (PUERTO 8790) ═══════════════ */
function startHttpServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsed.pathname;

    if (pathname === '/status') {
      let curCot = null;
      let curPed = null;
      for (const d of activeDbfDirs) {
        if (!curCot) curCot = getDbfControlSerial(path.join(d, 'MXNUMCOT.DBF'), 'numero');
        if (!curPed) curPed = getDbfControlSerial(path.join(d, 'MXNUMPED.DBF'), 'numero');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        service: 'JJ Paper LAN Daemon Multi-Target',
        version: '2.0.0',
        active_dbf_dirs: activeDbfDirs,
        current_cot_serial: curCot?.formatted || null,
        current_ped_serial: curPed?.formatted || null,
        last_sync_at: lastSyncTime,
        last_exported_quote: lastExportedQuote,
        last_exported_order: lastExportedOrder,
        exported_count: exportedHistory.size,
        imported_count: importedHistory.size
      }));
    }

    if (pathname === '/next-serial' || pathname === '/lan/mixnet/next-serial') {
      const type = parsed.searchParams.get('type') || 'pedido';
      const isCot = (type === 'cotizacion' || type === 'quote');
      const file = isCot ? 'MXNUMCOT.DBF' : 'MXNUMPED.DBF';
      if (activeDbfDirs.length === 0) detectMixnetDirs();

      for (const d of activeDbfDirs) {
        const s = getDbfControlSerial(path.join(d, file), 'numero');
        if (s && s.num > 0) {
          const nextVal = String(s.num + 1).padStart(8, '0').slice(-8);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, type, serial: nextVal, num: s.num + 1, lastRecorded: s.formatted, source: 'MXNUM', dir: d }));
        }
      }

      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Control serial no disponible en disco' }));
    }

    if (pathname === '/sync-now' || pathname === '/api/sync') {
      runSyncCycle().catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, message: 'Ciclo de sincronización forzado ejecutándose en segundo plano' }));
    }

    if (pathname === '/exit' || pathname === '/restart' || pathname === '/api/restart') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Reiniciando demonio del puente MixNet...' }));
      setTimeout(() => process.exit(0), 500);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
  });

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    log(`Servidor HTTP activo en http://0.0.0.0:${HTTP_PORT} (/status, /sync-now, /restart, /next-serial)`);
  });

  server.on('error', (err) => {
    log(`Aviso en servidor HTTP (puerto ${HTTP_PORT}): ${err.message}`, 'WARN');
  });
}

/* ═══════════════ ARRANQUE ═══════════════ */
export async function start() {
  console.log('========================================================');
  console.log('   JJ PAPER — DEMONIO AUTONOMO MULTI-TARGET ERP MIXNET  ');
  console.log('========================================================');

  detectMixnetDirs();
  loadHistory();
  startHttpServer();

  // Primer ciclo inmediato
  await runSyncCycle();

  // Ciclo continuo cada 25 segundos
  setInterval(() => {
    runSyncCycle().catch(() => {});
  }, 25_000);

  log('Demonio LAN iniciado y en ejecución continua 24/7.');
}

start().catch(err => {
  log(`Error fatal arrancando demonio: ${err.message}`, 'ERROR');
  process.exit(1);
});
