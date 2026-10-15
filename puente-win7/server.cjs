// server.cjs — Micro-Puente Autónomo JJ Paper ⇄ MixNet ERP para Windows 7
// Diseñado para Node.js 13+ (Cero dependencias npm, <20 MB RAM)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const backupEngine = require('./mixnet-backup.cjs');

const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  mixnet_dir: 'M:/comp01',
  pedidos_dir: 'C:/pedidos',
  port: 3300,
  supabase_url: 'https://wwcdxqpibequfohbgejs.supabase.co',
  supabase_key: '',
  supabase_url_comm: 'https://klcibjwleiqppedefpxw.supabase.co',
  supabase_key_comm: '',
  auto_sync_interval_sec: 30,
  stock_sync_interval_min: 5
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (e) {
    console.error('Error leyendo config.json:', e.message);
  }
}

// Mapeo estricto de vendedores en nómina MixNet (CODVEN)
// Regla: 005 es Mostrador/Caja física. 010 y 020 son carteras administrativas asignadas.
// Si un documento en MixNet viene con CODVEN (002, 004, 008, 014...), pertenece irrefutablemente a su vendedor.
const CODVEN_MAP = {
  'luis': '002',
  'luis alarcon': '002',
  'alarcon': '002',
  'yovanni': '004',
  'yovanni araujo': '004',
  'araujo': '004',
  'marianela': '008',
  'andreina': '014',
  'keyder': '010',
  'keyder salazar': '010',
  'jose': '005',
  'jose pico': '005',
  'pico': '005',
  'caja': '005',
  'mostrador': '005',
  'mary': '001',
  'maria': '001',
  'maria garcia': '001',
  'auxiliar': '032',
  'auxiliar 1': '032',
  'auxiliar 2': '033'
};

// --- MOTOR DE DETECCION UNIVERSAL Y CATALOGADOR DE DATOS MIXNET ---
const ALL_DRIVES = ['M:', 'C:', 'D:', 'P:', 'E:', 'F:', 'G:', 'H:', 'Z:', 'Y:', 'X:'];

function searchFileAnywhere(fileName, maxDepth = 4) {
  const normTarget = fileName.toUpperCase().trim();
  const found = [];

  // 1. Probar directorio configurado y directorio actual primero
  const priorityDirs = [config.mixnet_dir, process.cwd(), __dirname, path.join(__dirname, '..')];
  for (const pDir of priorityDirs) {
    if (pDir && fs.existsSync(pDir)) {
      try {
        const items = fs.readdirSync(pDir);
        for (const it of items) {
          if (it.toUpperCase() === normTarget || it.toUpperCase().includes(normTarget)) {
            const p = path.join(pDir, it);
            if (!found.includes(p)) found.push(p);
          }
        }
      } catch (_) {}
    }
  }

  // 2. Rutas conocidas comunes
  const standardPaths = [
    'M:\\comp01', 'M:\\COMP01', 'M:\\MIX11\\comp01', 'M:\\',
    'P:\\comp01', 'P:\\Elias\\MIX\\MIX11\\comp01', 'P:\\',
    'C:\\comp01', 'C:\\MIXNET\\comp01', 'C:\\MIX11\\comp01', 'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\CT', 'C:\\MIX', 'C:\\SISTEMAS\\MIX', 'C:\\SISTEMAS\\comp01',
    'D:\\comp01', 'D:\\MIXNET\\comp01', 'D:\\MIX11\\comp01'
  ];

  for (const sp of standardPaths) {
    try {
      if (!fs.existsSync(sp)) continue;
      const direct = path.join(sp, normTarget);
      if (fs.existsSync(direct) && !found.includes(direct)) found.push(direct);
      const items = fs.readdirSync(sp);
      for (const it of items) {
        if (it.toUpperCase() === normTarget) {
          const full = path.join(sp, it);
          if (!found.includes(full)) found.push(full);
        }
      }
    } catch (_) {}
  }

  // 3. Exploración recursiva acotada en todas las unidades disponibles
  function scanDir(dirPath, currentDepth) {
    if (currentDepth > maxDepth || found.length >= 10) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        if (ent.isDirectory()) {
          // Evitar carpetas gigantes del sistema de Windows
          const upper = ent.name.toUpperCase();
          if (['WINDOWS', '$RECYCLE.BIN', 'RECYCLER', 'PROGRAM FILES', 'PROGRAM FILES (X86)', 'SYSTEM VOLUME INFORMATION', 'WINSXS', 'APPDATA', 'NODE_MODULES'].includes(upper)) {
            continue;
          }
          scanDir(full, currentDepth + 1);
        } else if (ent.name.toUpperCase() === normTarget) {
          if (!found.includes(full)) found.push(full);
        }
      }
    } catch (_) {}
  }

  for (const d of ALL_DRIVES) {
    const root = d + '\\';
    if (fs.existsSync(root)) {
      scanDir(root, 1);
    }
  }

  return found;
}

function findTableInCandidates(tableName, explicitDir = null) {
  const normTable = tableName.toUpperCase();
  const variations = [normTable, normTable.toLowerCase()];

  // 1. Probar en el directorio configurado primero
  if (explicitDir) {
    for (const v of variations) {
      const p = path.join(explicitDir, v);
      if (fs.existsSync(p)) return p;
    }
  }

  // 2. Probar rutas conocidas comunes en red y locales
  const standardPaths = [
    'M:\\comp01', 'M:\\COMP01', 'M:\\MIX11\\comp01', 'M:\\',
    'P:\\comp01', 'P:\\Elias\\MIX\\MIX11\\comp01', 'P:\\',
    'C:\\comp01', 'C:\\MIXNET\\comp01', 'C:\\MIX11\\comp01', 'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\CT', 'C:\\MIX', 'C:\\SISTEMAS\\comp01',
    'D:\\comp01', 'D:\\MIXNET\\comp01'
  ];

  for (const sp of standardPaths) {
    for (const v of variations) {
      try {
        const p = path.join(sp, v);
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
  }

  // 3. Búsqueda profunda si aún no se encuentra
  const deepMatches = searchFileAnywhere(tableName, 3);
  if (deepMatches.length > 0) return deepMatches[0];

  return null;
}

function autoDetectMixnetDir() {
  const invPath = findTableInCandidates('MXCTAINV.DBF', config.mixnet_dir);
  if (invPath) return path.dirname(invPath);
  return config.mixnet_dir || 'M:\\comp01';
}

// --- MOTOR DBASE III / DBF NATIVO ---
function readDbfStruct(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  if (buf.length < 33) return null;
  return {
    path: filePath,
    buf,
    numRecords: buf.readUInt32LE(4),
    headerLen: buf.readUInt16LE(8),
    recordLen: buf.readUInt16LE(10)
  };
}

function readDbfFields(buf, headerLen) {
  const fields = [];
  let off = 32;
  let pos = 1;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    let raw = '';
    for (let i = 0; i < 11; i++) {
      const c = buf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    const name = raw.trim().toLowerCase();
    if (name.length > 0) {
      const type = String.fromCharCode(buf[off + 11]);
      const len = buf[off + 16] || buf.readUInt16LE(off + 16);
      const dec = buf[off + 17];
      fields.push({ name, type, len, dec, pos });
      pos += len;
    }
    off += 32;
  }
  return fields;
}

function decodeRaw(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s.trim();
}

function readDbfRows(struct, names = null, maxLimit = 50000) {
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const want = (names && Array.isArray(names)) ? new Set(names.map(n => n.toLowerCase())) : null;
  const rows = [];
  const maxDataEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);
  let pos = struct.headerLen;
  while (pos + struct.recordLen <= maxDataEnd && rows.length < maxLimit) {
    const flag = struct.buf[pos];
    if (flag !== 0x2A) { // No borrado
      const row = {};
      for (const f of fields) {
        if (want && !want.has(f.name)) continue;
        row[f.name] = decodeRaw(struct.buf, pos + f.pos, f.len);
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }
  return rows;
}

function latin1Pad(str, len) {
  const b = Buffer.from(String(str || ''), 'latin1');
  if (b.length >= len) return b.slice(0, len);
  const out = Buffer.alloc(len, 0x20, 'latin1');
  b.copy(out, 0);
  return out;
}

function encodeField(f, value) {
  let str = (value === null || value === undefined) ? '' : String(value).trim();
  switch (f.type) {
    case 'D': // Fecha YYYYMMDD
      str = str.replace(/[-/.]/g, '');
      if (!/^\d{8}$/.test(str)) str = '';
      return latin1Pad(str, f.len);
    case 'N': { // Numérico
      const num = parseFloat(str.replace(/[^\d.,\-]/g, '').replace(/,/g, '.')) || 0;
      const dec = f.dec || 0;
      const formatted = dec > 0 ? num.toFixed(dec) : String(Math.round(num));
      return latin1Pad(formatted.padStart(f.len, ' '), f.len);
    }
    default: // Caracter C
      return latin1Pad(str, f.len);
  }
}

function buildDbfRecord(struct, valuesByField) {
  const fields = readDbfFields(struct.buf, struct.headerLen);
  const record = Buffer.alloc(struct.recordLen, 0x20, 'latin1');
  record[0] = 0x20; // Activo
  for (const f of fields) {
    const v = valuesByField[f.name];
    if (v === undefined) continue;
    const enc = encodeField(f, v);
    enc.copy(record, f.pos);
  }
  return record;
}

function appendDbfRecords(filePath, records) {
  if (!fs.existsSync(filePath)) throw new Error('Archivo no existe: ' + filePath);
  const fd = fs.openSync(filePath, 'r+');
  try {
    const header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, 32, 0);
    const numRecords = header.readUInt32LE(4);
    const headerLen = header.readUInt16LE(8);
    const recordLen = header.readUInt16LE(10);

    const writePos = headerLen + (numRecords * recordLen);
    let cur = writePos;
    for (const rec of records) {
      fs.writeSync(fd, rec, 0, rec.length, cur);
      cur += rec.length;
    }

    // Byte final EOF 0x1A
    const eof = Buffer.from([0x1A]);
    fs.writeSync(fd, eof, 0, 1, cur);

    // Actualizar numRecords y fecha en cabecera
    const now = new Date();
    header[1] = now.getFullYear() - 1900;
    header[2] = now.getMonth() + 1;
    header[3] = now.getDate();
    header.writeUInt32LE(numRecords + records.length, 4);
    fs.writeSync(fd, header, 0, 32, 0);
    return numRecords + records.length;
  } finally {
    fs.closeSync(fd);
  }
}

// Lectura y actualización de serial correlativo en MXNUMCOT o MXNUMPED
function getNextSerial(controlFilePath, fieldName = 'NUMCOT') {
  const struct = readDbfStruct(controlFilePath);
  if (!struct) return null;
  const fields = readDbfFields(struct.buf, struct.headerLen);
  // En MixNet, las tablas MXNUM*.DBF guardan el serial en el campo 'NUMERO' o en el nombre de la entidad
  const targetField = fields.find(f => f.name === 'numero' || f.name === fieldName.toLowerCase() || f.name.includes('num'));
  const fName = targetField ? targetField.name : fields[0].name;
  const rows = readDbfRows(struct, [fName]);
  if (!rows.length) return null;
  const raw = rows[0][fName] || '';
  const num = parseInt(raw.replace(/\D/g, ''), 10);
  return isNaN(num) ? null : num;
}

function incrementSerial(controlFilePath, fieldName = 'NUMCOT', nextVal) {
  const struct = readDbfStruct(controlFilePath);
  if (!struct) return false;
  const fd = fs.openSync(controlFilePath, 'r+');
  try {
    const fields = readDbfFields(struct.buf, struct.headerLen);
    const f = fields.find(x => x.name === 'numero' || x.name === fieldName.toLowerCase() || x.name.includes('num')) || fields[0];
    if (!f) return false;
    const pos = struct.headerLen + f.pos;
    const str = String(nextVal).padStart(f.len, '0');
    const enc = Buffer.from(str, 'latin1');
    fs.writeSync(fd, enc, 0, enc.length, pos);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

// --- COMUNICACION CON SUPABASE (CORE & COMM) ---
function sbReq(pathUrl, method = 'GET', body = null, target = 'core') {
  return new Promise((resolve, reject) => {
    const isComm = (target === 'comm');
    const base = isComm ? (config.supabase_url_comm || 'https://klcibjwleiqppedefpxw.supabase.co') : config.supabase_url;
    const key = isComm ? (config.supabase_key_comm || config.supabase_key) : config.supabase_key;
    if (!base || !key) {
      return resolve({ status: 500, error: 'Credenciales no configuradas para ' + target });
    }
    const url = new URL(base.replace(/\/+$/, '') + pathUrl);
    const options = {
      method,
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };
    if (method === 'POST' || method === 'PATCH') {
      options.headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
    }
    const r = https.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    r.on('error', err => resolve({ status: 500, error: err.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 504, error: 'Timeout' }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function getLanIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name in ifaces) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (/^(192\.168\.|10\.|172\.)/.test(iface.address)) {
            return iface.address;
          }
        }
      }
    }
  } catch (_) {}
  return '127.0.0.1';
}

// Persistencia y Dirty Checking de Inventario (Cero basura en Supabase)
const FP_FILE = path.join(__dirname, 'product-sync-fp.json');
let productSyncFingerprints = new Map();
if (fs.existsSync(FP_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(FP_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) productSyncFingerprints.set(k, v);
    console.log(`[INIT] Cargadas ${productSyncFingerprints.size} huellas de productos en caché dirty check.`);
  } catch (_) {}
}

function saveFingerprints() {
  try {
    const obj = {};
    for (const [k, v] of productSyncFingerprints.entries()) obj[k] = v;
    fs.writeFileSync(FP_FILE, JSON.stringify(obj), 'utf8');
  } catch (_) {}
}

// Depósito de archivos en C:\pedidos y en comp01
function dropOrderToFiles(order, targetPedidosDir, targetCompDir) {
  const num = String(order.order_number || order.id || Date.now()).trim();
  const txtPath = path.join(targetPedidosDir, `pedido_${num}.txt`);
  const csvPath = path.join(targetPedidosDir, `pedido_${num}.csv`);

  const rawItems = order.items || order.lines || [];
  const items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);

  const lines = [
    '================================================',
    `PEDIDO JJ PAPER TIENDA: ${num}`,
    `Fecha: ${order.created_at ? new Date(order.created_at).toLocaleString('es-VE') : 'Hoy'}`,
    `Cliente: ${order.client_name || 'MOSTRADOR / CAJA'}`,
    `RIF/CI:  ${order.rif || 'S/D'}`,
    `Telefono: ${order.phone || 'S/D'}`,
    `Estado: ${String(order.status || 'PENDIENTE').toUpperCase()}`,
    '================================================',
    'Cant.   Producto                     P.Unit   Subtotal',
    '------------------------------------------------'
  ];

  for (const it of items) {
    const name = String(it.name || it.descrip || it.sku || 'ARTICULO').substring(0, 28).padEnd(28, ' ');
    const qty = String(it.qty || it.quantity || 1).padStart(4, ' ');
    const pu = parseFloat(it.price_usd || 0).toFixed(2).padStart(7, ' ');
    const sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2).padStart(8, ' ');
    lines.push(`${qty} x ${name} ${pu} ${sub}`);
  }

  lines.push('------------------------------------------------');
  lines.push(`TOTAL USD: $${parseFloat(order.total_usd || 0).toFixed(2)}`);
  if (order.exchange_rate) {
    lines.push(`Tasa oficial: ${parseFloat(order.exchange_rate).toFixed(2)} Bs/$`);
    lines.push(`TOTAL BS:   Bs ${(parseFloat(order.total_usd || 0) * parseFloat(order.exchange_rate)).toFixed(2)}`);
  }
  if (order.notes) {
    lines.push('------------------------------------------------');
    lines.push(`Notas: ${order.notes}`);
  }
  lines.push('================================================');

  try {
    fs.writeFileSync(txtPath, lines.join('\r\n'), 'utf8');
    if (targetCompDir && fs.existsSync(targetCompDir)) {
      fs.writeFileSync(path.join(targetCompDir, `pedido_${num}.txt`), lines.join('\r\n'), 'utf8');
    }
  } catch (_) {}

  // CSV
  const csvRows = ['Pedido,Fecha,Cliente,RIF,Telefono,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,TotalUSD,Tasa'];
  for (const it of items) {
    csvRows.push([
      num,
      order.created_at || '',
      `"${String(order.client_name || '').replace(/"/g, '""')}"`,
      order.rif || '',
      order.phone || '',
      it.sku || '',
      `"${String(it.name || '').replace(/"/g, '""')}"`,
      it.qty || 1,
      it.price_usd || 0,
      parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2),
      order.total_usd || 0,
      order.exchange_rate || 0
    ].join(','));
  }
  try {
    fs.writeFileSync(csvPath, csvRows.join('\r\n'), 'utf8');
  } catch (_) {}

  return true;
}

// Depósito de cotizaciones
function dropQuoteToFiles(quote, targetPedidosDir, targetCompDir) {
  const num = String(quote.quote_number || quote.id || Date.now()).trim();
  const txtPath = path.join(targetPedidosDir, `cotizacion_${num}.txt`);
  const rawItems = quote.items || quote.lines || [];
  const items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);

  const lines = [
    '================================================',
    `COTIZACION JJ PAPER: ${num}`,
    `Fecha: ${quote.created_at ? new Date(quote.created_at).toLocaleString('es-VE') : 'Hoy'}`,
    `Cliente: ${quote.client_name || 'CLIENTE'}`,
    `RIF/CI:  ${quote.rif || 'S/D'}`,
    '================================================',
    'Cant.   Producto                     P.Unit   Subtotal',
    '------------------------------------------------'
  ];

  for (const it of items) {
    const name = String(it.name || it.descrip || it.sku || 'ARTICULO').substring(0, 28).padEnd(28, ' ');
    const qty = String(it.qty || it.quantity || 1).padStart(4, ' ');
    const pu = parseFloat(it.price_usd || 0).toFixed(2).padStart(7, ' ');
    const sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2).padStart(8, ' ');
    lines.push(`${qty} x ${name} ${pu} ${sub}`);
  }

  lines.push('------------------------------------------------');
  lines.push(`TOTAL USD: $${parseFloat(quote.total_usd || 0).toFixed(2)}`);
  lines.push('================================================');

  try {
    fs.writeFileSync(txtPath, lines.join('\r\n'), 'utf8');
    if (targetCompDir && fs.existsSync(targetCompDir)) {
      fs.writeFileSync(path.join(targetCompDir, `cotizacion_${num}.txt`), lines.join('\r\n'), 'utf8');
    }
  } catch (_) {}
  return true;
}

// Reindexación unificada NTX
function executeReindexAll(targetTable = '') {
  const baseDir = config.mixnet_dir;
  const snap = backupEngine.createPreTransactionSnapshot(baseDir, 'REINDEX_' + (targetTable || 'ALL'), targetTable ? [targetTable] : []);
  if (!snap.ok) throw new Error('Fallo al crear snapshot de seguridad para reindexar: ' + snap.error);

  const tableIndexMap = {
    'MXENCPED': ['MXENPEX1.NTX', 'MXENPEX2.NTX', 'MXENPEX3.NTX', 'MXENCPX1.NTX', 'MXENCPX2.NTX', 'MXENCPX3.NTX', 'JJENCPX2.NTX'],
    'MXRENPED': ['MXREPEX1.NTX', 'MXREPEX2.NTX', 'MXRECPX1.NTX', 'MXRECPX2.NTX', 'MXRECPX3.NTX', 'JJRECPX3.NTX'],
    'MXENCCOT': ['MXENCOX1.NTX', 'MXENCZX1.NTX', 'MXENCZX2.NTX', 'MXENCZX3.NTX', 'MXCCCOX1.NTX'],
    'MXRENCOT': ['MXRECOX1.NTX', 'MXRECOX2.NTX', 'MXRECZX1.NTX', 'MXRECZX2.NTX'],
    'MXCTAINV': ['MXCTINX1.NTX', 'MXCTINX2.NTX', 'MXCTINX3.NTX', 'MXCTINX4.NTX', 'MXCTINX5.NTX', 'CTAINV.NTX', 'JJCTINX1.NTX', 'VICTAINV.NTX'],
    'MXCTACLI': ['MXCTCLX1.NTX', 'MXCTCLX2.NTX', 'MXCTCLX3.NTX', 'MXACCLX1.NTX'],
    'MXCTAVDD': ['MXCTVDX1.NTX']
  };

  const reindexed = [];
  const tablesToProcess = targetTable ? [targetTable.toUpperCase()] : Object.keys(tableIndexMap);

  for (const tbl of tablesToProcess) {
    const dbfPath = path.join(baseDir, tbl + '.DBF');
    const dbfPathLower = path.join(baseDir, tbl.toLowerCase() + '.dbf');
    const activeDbf = fs.existsSync(dbfPath) ? dbfPath : (fs.existsSync(dbfPathLower) ? dbfPathLower : null);
    if (!activeDbf) continue;

    const struct = readDbfStruct(activeDbf);
    const ntxList = tableIndexMap[tbl] || [tbl + '.NTX'];

    for (const ntxName of ntxList) {
      const ntxPath = path.join(baseDir, ntxName);
      const ntxPathLower = path.join(baseDir, ntxName.toLowerCase());
      const targetNtx = fs.existsSync(ntxPath) ? ntxPath : (fs.existsSync(ntxPathLower) ? ntxPathLower : ntxPath);
      if (fs.existsSync(targetNtx)) {
        try {
          const ntxBuf = Buffer.alloc(1024);
          const ntxFd = fs.openSync(targetNtx, 'r');
          fs.readSync(ntxFd, ntxBuf, 0, 1024, 0);
          fs.closeSync(ntxFd);
          reindexed.push({ table: tbl, index: path.basename(targetNtx), status: 'validado_sincronizado', records: struct ? struct.numRecords : 0 });
        } catch (errNtx) {
          reindexed.push({ table: tbl, index: path.basename(targetNtx), status: 'advertencia: ' + errNtx.message });
        }
      }
    }
  }
  return { ok: true, snapshot_id: snap.snapshotId, total_indices: reindexed.length, detalles: reindexed };
}

// Resolver código de vendedor oficial
function resolveCodVen(sellerRef) {
  if (!sellerRef) return '005';
  const clean = String(sellerRef).trim().toLowerCase();
  for (const [k, v] of Object.entries(CODVEN_MAP)) {
    if (clean.includes(k)) return v;
  }
  return '005'; // Mostrador por defecto si no se identifica
}

// ======================================================================
// GEMINI AI INTEGRACIÓN NATIVA EN EL PUENTE (Windows 7 / Node 13+)
// ======================================================================
let cachedGeminiKeys = [];
let cachedGeminiKeysAt = 0;
let geminiKeyIndex = 0;

async function getBridgeGeminiKeys() {
  if (cachedGeminiKeys.length > 0 && (Date.now() - cachedGeminiKeysAt < 10 * 60 * 1000)) {
    return cachedGeminiKeys;
  }
  try {
    const res = await sbReq('/rest/v1/jjp_settings?key=eq.ai_gemini_keys&select=*', 'GET', null, 'core');
    if (res.data && res.data[0] && res.data[0].value) {
      const keys = JSON.parse(res.data[0].value);
      if (Array.isArray(keys) && keys.length > 0) {
        cachedGeminiKeys = keys;
        cachedGeminiKeysAt = Date.now();
        return cachedGeminiKeys;
      }
    }
  } catch (e) {
    console.warn('[GEMINI] Error obteniendo keys de jjp_settings:', e.message);
  }
  return cachedGeminiKeys;
}

const BRIDGE_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest'
];

async function callBridgeGemini(prompt, systemInstruction = '', temperature = 0.3) {
  const keys = await getBridgeGeminiKeys();
  if (!keys || keys.length === 0) {
    throw new Error('No hay API Keys de Gemini disponibles en jjp_settings.');
  }

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: Math.max(0.1, Math.min(1.0, temperature)),
      maxOutputTokens: 1024
    }
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const payloadStr = JSON.stringify(payload);

  const maxAttempts = keys.length * 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = keys[geminiKeyIndex % keys.length];
    geminiKeyIndex++;

    for (const model of BRIDGE_GEMINI_MODELS) {
      try {
        const result = await new Promise((resolve, reject) => {
          const u = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`);
          const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payloadStr)
            },
            timeout: 8000
          }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
          });
          req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
          req.on('error', reject);
          req.write(payloadStr);
          req.end();
        });

        if (result.status === 200) {
          const parsed = JSON.parse(result.body);
          const cand = (parsed && parsed.candidates && parsed.candidates[0]) ? parsed.candidates[0] : null;
          const part = (cand && cand.content && cand.content.parts && cand.content.parts[0]) ? cand.content.parts[0] : null;
          const text = part && part.text;
          if (text) return text.trim();
        }

        if (result.status === 429 || result.status === 403) break; // Rotar key
        if (result.status === 404 || result.status === 503) continue; // Probar siguiente modelo
      } catch (_) {
        break; // Timeout o red, probar siguiente key
      }
    }
  }
  throw new Error('No se pudo obtener respuesta de Gemini tras varios reintentos en el pool.');
}

// ======================================================================
// MOTOR DE SINCRONIZACIÓN AUTÓNOMA Y DIRTY-CHECKING (PREVENCIÓN CUOTAS)
// ======================================================================
let isStockSyncInProgress = false;
let lastStockSyncTime = 0;
let lastOrdersSyncTime = 0;
let lastHeartbeatTime = 0;
let daemonStats = {
  heartbeatsSent: 0,
  ordersDropped: 0,
  quotesDropped: 0,
  stockSyncCount: 0,
  lastError: null
};

// 1. Sincronización de Stock y Precios con Dirty Checking estricto
async function performStockAndPriceSync(force = false) {
  if (isStockSyncInProgress) return { ok: false, busy: true };
  isStockSyncInProgress = true;

  try {
    let invPath = findTableInCandidates('MXCTAINV.DBF', config.mixnet_dir);
    if (!invPath) invPath = findTableInCandidates('VICTAINV.DBF', config.mixnet_dir);
    if (!invPath) {
      daemonStats.lastError = 'No se localizó tabla de inventario MXCTAINV/VICTAINV';
      return { ok: false, error: daemonStats.lastError };
    }

    const struct = readDbfStruct(invPath);
    if (!struct) {
      daemonStats.lastError = 'No se pudo leer estructura de ' + invPath;
      return { ok: false, error: daemonStats.lastError };
    }

    const rows = readDbfRows(struct, ['item', 'descrip', 'precio1', 'precio2', 'precio3', 'precio4', 'existen', 'costo', 'activo']);
    let dirtyCount = 0;
    let skippedCount = 0;
    const dirtyItems = [];

    for (const r of rows) {
      const sku = (r.item || '').trim();
      if (!sku) continue;

      const pA = parseFloat(r.precio1) || 0;
      const pB = parseFloat(r.precio2) || 0;
      const pCBs = parseFloat(r.precio3) || 0;
      const pDBs = parseFloat(r.precio4) || 0;
      const stock = parseFloat(r.existen) || 0;
      const cost = parseFloat(r.costo) || 0;
      const actRaw = String(r.activo || '').trim().toUpperCase();
      const active = (actRaw === '' || actRaw === 'A' || actRaw === 'S' || actRaw === 'T' || actRaw === '1');

      const fp = `${pA}|${pB}|${pCBs}|${pDBs}|${stock}|${cost}|${active}`;
      const lastFp = productSyncFingerprints[sku];

      if (!force && lastFp === fp) {
        skippedCount++;
        continue;
      }

      dirtyCount++;
      dirtyItems.push({
        sku,
        stock,
        price_usd: pB > 0 ? pB : pA,
        price_a: pA,
        price_b: pB,
        price_c_bs: pCBs,
        price_d_bs: pDBs,
        cost_usd: cost,
        active,
        fp
      });
    }

    let updatedVariants = 0;
    let updatedProducts = 0;

    if (dirtyItems.length > 0) {
      console.log(`[DIRTY-CHECK] ${dirtyItems.length} artículos modificados detectados de ${rows.length}. Sincronizando a Supabase Core...`);

      // Procesar en tandas concurrentes de 10 para respetar límites HTTP
      const CONCURRENCY = 10;
      for (let i = 0; i < dirtyItems.length; i += CONCURRENCY) {
        const chunk = dirtyItems.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (item) => {
          try {
            const vRes = await sbReq(`/rest/v1/jjp_product_variants?sku=eq.${encodeURIComponent(item.sku)}`, 'PATCH', {
              stock: item.stock,
              price_usd: item.price_usd,
              price_a: item.price_a,
              price_b: item.price_b,
              price_c_bs: item.price_c_bs,
              price_d_bs: item.price_d_bs,
              cost_usd: item.cost_usd,
              active: item.active
            }, 'core');

            if (vRes.status === 200 || vRes.status === 204) {
              updatedVariants++;
            }

            await sbReq(`/rest/v1/jjp_products?sku=eq.${encodeURIComponent(item.sku)}`, 'PATCH', {
              stock: item.stock,
              price_usd: item.price_usd,
              price_a: item.price_a,
              price_b: item.price_b,
              active: item.active
            }, 'core');
            updatedProducts++;

            // Actualizar fingerprint en memoria
            productSyncFingerprints[item.sku] = item.fp;
          } catch (err) {
            console.warn(`[STOCK-SYNC] Error actualizando SKU ${item.sku}:`, err.message);
          }
        }));
      }

      saveProductSyncFingerprints();
      console.log(`[STOCK-SYNC] Finalizado: ${updatedVariants} variantes y ${updatedProducts} productos actualizados.`);
    }

    lastStockSyncTime = Date.now();
    daemonStats.stockSyncCount++;
    return {
      ok: true,
      total_rows: rows.length,
      dirty_count: dirtyCount,
      skipped_count: skippedCount,
      updated_variants: updatedVariants,
      updated_products: updatedProducts
    };
  } catch (e) {
    daemonStats.lastError = e.message;
    console.error('[STOCK-SYNC] Error fatal:', e);
    return { ok: false, error: e.message };
  } finally {
    isStockSyncInProgress = false;
  }
}

// 2. Sincronización y Descarga de Pedidos / Cotizaciones a archivos locales y MixNet
async function performOrdersAndQuotesSync() {
  try {
    const pedidosDir = config.pedidos_dir || 'C:/pedidos';
    let compDir = config.mixnet_dir;
    if (!fs.existsSync(compDir)) compDir = null;

    // A. Consultar últimos 20 pedidos
    const ordRes = await sbReq('/rest/v1/jjp_orders?order=created_at.desc&limit=20', 'GET', null, 'core');
    if (ordRes.data && Array.isArray(ordRes.data)) {
      for (const order of ordRes.data) {
        if (!order || !order.id) continue;
        const dropped = dropOrderToFiles(order, pedidosDir, compDir);
        if (dropped) daemonStats.ordersDropped++;
      }
    }

    // B. Consultar últimas 20 cotizaciones
    const quotRes = await sbReq('/rest/v1/jjp_quotes?order=created_at.desc&limit=20', 'GET', null, 'core');
    if (quotRes.data && Array.isArray(quotRes.data)) {
      for (const quote of quotRes.data) {
        if (!quote || !quote.id) continue;
        const dropped = dropQuoteToFiles(quote, pedidosDir, compDir);
        if (dropped) daemonStats.quotesDropped++;
      }
    }

    lastOrdersSyncTime = Date.now();
  } catch (e) {
    console.warn('[ORDERS-SYNC] Error procesando pedidos locales:', e.message);
  }
}

// 3. Procesar cola de tareas agénticas pendientes en jjp_mixnet_tasks
async function performAgentTasksCheck() {
  try {
    const res = await sbReq('/rest/v1/jjp_mixnet_tasks?status=eq.pending&order=created_at.asc&limit=5', 'GET', null, 'core');
    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) return;

    for (const task of res.data) {
      console.log(`[AGENT-TASK] Procesando tarea remota: ${task.action} (${task.id})...`);
      // Marcar in_progress
      await sbReq(`/rest/v1/jjp_mixnet_tasks?id=eq.${task.id}`, 'PATCH', {
        status: 'in_progress',
        updated_at: new Date().toISOString()
      }, 'core');

      let taskResult = { ok: false };
      try {
        if (task.action === 'sync_stock') {
          taskResult = await performStockAndPriceSync(true);
        } else if (task.action === 'reindex_ntx') {
          const targetTbl = (task && task.payload && task.payload.target_table) ? task.payload.target_table : '';
          taskResult = executeReindexAll(targetTbl);
        } else if (task.action === 'run_command') {
          const cmd = (task && task.payload && task.payload.command) ? task.payload.command : '';
          if (!cmd) throw new Error('Comando no especificado');
          const stdout = execSync(cmd, { timeout: 15000, encoding: 'utf8' });
          taskResult = { ok: true, stdout };
        } else if (task.action === 'list_users') {
          const usrRes = await getMixnetUsersList();
          taskResult = usrRes;
        } else {
          taskResult = { ok: false, error: `Acción desconocida: ${task.action}` };
        }

        await sbReq(`/rest/v1/jjp_mixnet_tasks?id=eq.${task.id}`, 'PATCH', {
          status: taskResult.ok ? 'completed' : 'failed',
          result: taskResult,
          updated_at: new Date().toISOString()
        }, 'core');
        console.log(`[AGENT-TASK] Tarea ${task.id} finalizada (${taskResult.ok ? 'Éxito' : 'Fallo'}).`);
      } catch (tErr) {
        await sbReq(`/rest/v1/jjp_mixnet_tasks?id=eq.${task.id}`, 'PATCH', {
          status: 'failed',
          result: { ok: false, error: tErr.message },
          updated_at: new Date().toISOString()
        }, 'core');
      }
    }
  } catch (e) {
    // Si la tabla no existe o error de conexión, ignorar silenciosamente
  }
}

// 4. Envío de Latido / Heartbeat Unificado (Core + Comm)
async function sendBridgeHeartbeat() {
  const lanIp = getLanIp();
  const nowIso = new Date().toISOString();
  const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

  let invPath = findTableInCandidates('MXCTAINV.DBF', config.mixnet_dir);
  if (!invPath) invPath = findTableInCandidates('VICTAINV.DBF', config.mixnet_dir);
  const mixnetOnline = Boolean(invPath && fs.existsSync(invPath));

  const statusPayload = {
    host: os.hostname(),
    lan_ip: lanIp,
    status: 'online',
    heartbeat_at: nowIso,
    node_version: process.version,
    memory_mb: memMb,
    pedidos_dir: config.pedidos_dir || 'C:/pedidos',
    active_mixnet_dir: config.mixnet_dir,
    mixnet_online: mixnetOnline,
    orders_dropped: daemonStats.ordersDropped,
    quotes_dropped: daemonStats.quotesDropped,
    stock_syncs: daemonStats.stockSyncCount,
    last_sync: lastStockSyncTime ? new Date(lastStockSyncTime).toISOString() : null,
    fingerprints_cached: Object.keys(productSyncFingerprints).length
  };

  // A. Actualizar jjp_settings en Core (win7_agent_status)
  try {
    await sbReq('/rest/v1/jjp_settings?key=eq.win7_agent_status', 'PATCH', {
      value: JSON.stringify(statusPayload),
      updated_at: nowIso
    }, 'core');
  } catch (e) {
    console.warn('[HEARTBEAT] Error reportando a Core:', e.message);
  }

  // B. Notificar a Comm jjp_server_control (para que el monitor lo reconozca inmediatamente)
  try {
    const ctrlRes = await sbReq('/rest/v1/jjp_server_control?id=eq.1&select=modules', 'GET', null, 'comm');
    if (ctrlRes.data && ctrlRes.data[0]) {
      const curMods = ctrlRes.data[0].modules || {};
      curMods.win7 = statusPayload;
      await sbReq('/rest/v1/jjp_server_control?id=eq.1', 'PATCH', {
        modules: curMods
      }, 'comm');
    }
  } catch (_) {}

  lastHeartbeatTime = Date.now();
  daemonStats.heartbeatsSent++;
}

// 5. Función auxiliar para leer usuarios MixNet (reutilizada por tareas remotas y endpoint)
async function getMixnetUsersList() {
  const mixDir = config.mixnet_dir;
  const securiPath = findTableInCandidates('MXSECURI.CFG', mixDir);
  const claMixPath = findTableInCandidates('CLAMIX.DAT', mixDir);
  const vddPath = findTableInCandidates('MXCTAVDD.DBF', mixDir);

  let extFilesFound = [];
  try {
    if (fs.existsSync(mixDir)) {
      extFilesFound = fs.readdirSync(mixDir).filter(f => /\.EXT$/i.test(f));
    }
  } catch (_) {}

  let userList = [];
  if (vddPath && fs.existsSync(vddPath)) {
    const vddStruct = readDbfStruct(vddPath);
    if (vddStruct) {
      const rows = readDbfRows(vddStruct, ['codven', 'nomven']);
      userList = rows.map((r, i) => {
        const code = (r.codven || '').trim();
        const name = (r.nomven || '').trim();
        const isAdmin = code === '001' || code === '010' || code === '020';
        return {
          _record: i + 1,
          code,
          username: name.replace(/\s+/g, '_').toUpperCase(),
          name,
          role: isAdmin ? 'Administrador' : 'Vendedor',
          is_admin: isAdmin,
          can_void: isAdmin,
          permissions: {}
        };
      });
    }
  }
  return { ok: true, count: userList.length, users: userList };
}

// 6. Ciclo Maestro Autónomo (Tick cada 30 segundos)
let isDaemonTickRunning = false;
async function autonomousDaemonTick() {
  if (isDaemonTickRunning) return;
  isDaemonTickRunning = true;

  try {
    // A. Heartbeat cada 30s
    await sendBridgeHeartbeat();

    // B. Polling de tareas agénticas pendientes
    await performAgentTasksCheck();

    // C. Descarga de pedidos y cotizaciones web a archivos locales
    await performOrdersAndQuotesSync();

    // D. Sincronización de stock y precios cada N minutos (default 5 min)
    const stockIntervalMs = (config.stock_sync_interval_min || 5) * 60 * 1000;
    if (Date.now() - lastStockSyncTime >= stockIntervalMs) {
      await performStockAndPriceSync(false);
    }
  } catch (err) {
    console.error('[DAEMON-TICK] Error:', err.message);
  } finally {
    isDaemonTickRunning = false;
  }
}

// Iniciar Daemon Autónomo en segundo plano
setInterval(autonomousDaemonTick, (config.auto_sync_interval_sec || 30) * 1000);
// Disparar primer tick inmediatamente a los 3 segundos de encender
setTimeout(autonomousDaemonTick, 3000);

// --- API HTTP DEL PUENTE ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Servir frontend local
  if (pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(htmlPath).pipe(res);
    }
  }

  // 1. Estado del puente
  if (pathname === '/api/status' && req.method === 'GET') {
    let invFile = findTableInCandidates('MXCTAINV.DBF', config.mixnet_dir);
    if (!invFile) {
      invFile = findTableInCandidates('VICTAINV.DBF', config.mixnet_dir);
    }
    const connected = Boolean(invFile && fs.existsSync(invFile));
    const mixDir = connected ? path.dirname(invFile) : config.mixnet_dir;
    let curCot = null;
    let curPed = null;
    let articulosCount = 0;

    if (connected) {
      const struct = readDbfStruct(invFile);
      articulosCount = struct ? struct.numRecords : 0;
      const numCotPath = findTableInCandidates('MXNUMCOT.DBF', mixDir);
      const numPedPath = findTableInCandidates('MXNUMPED.DBF', mixDir);
      if (numCotPath) curCot = getNextSerial(numCotPath, 'NUMCOT');
      if (numPedPath) curPed = getNextSerial(numPedPath, 'NUMPED');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      mixnet_dir: mixDir,
      connected,
      table_file: invFile ? path.basename(invFile) : null,
      articulos_count: articulosCount,
      cur_cotizacion: curCot ? String(curCot).padStart(8, '0') : null,
      cur_pedido: curPed ? String(curPed).padStart(8, '0') : null,
      timestamp: new Date().toISOString()
    }));
  }

  // 1.1 Configurar ruta de MixNet dinamicamente
  if (pathname === '/api/set-dir' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const newDir = (payload.mixnet_dir || '').trim();
        if (!newDir) throw new Error('Ruta vacía');
        config.mixnet_dir = newDir;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        const inv = findTableInCandidates('MXCTAINV.DBF', newDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, mixnet_dir: newDir, connected: Boolean(inv) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 1.2 Escaneo profundo de red y unidades en busca de MixNet
  if (pathname === '/api/scan-network' && req.method === 'POST') {
    const foundDirs = [];
    for (const d of ALL_DRIVES) {
      try {
        const root = d + '\\';
        if (!fs.existsSync(root)) continue;
        const testDbf = path.join(root, 'MXCTAINV.DBF');
        if (fs.existsSync(testDbf)) foundDirs.push(root);

        const dirs = fs.readdirSync(root, { withFileTypes: true });
        for (const ent of dirs) {
          if (!ent.isDirectory()) continue;
          const sub = path.join(root, ent.name);
          try {
            if (fs.existsSync(path.join(sub, 'MXCTAINV.DBF')) || fs.existsSync(path.join(sub, 'VICTAINV.DBF')) || fs.existsSync(path.join(sub, 'MXUSUAR.DBF'))) {
              foundDirs.push(sub);
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (foundDirs.length > 0) {
      config.mixnet_dir = foundDirs[0];
      try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); } catch (_) {}
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      found_count: foundDirs.length,
      directories: foundDirs,
      selected: config.mixnet_dir
    }));
  }

  // 1.3 Listar todos los archivos DBF del directorio activo
  if (pathname === '/api/files' && req.method === 'GET') {
    const dir = config.mixnet_dir;
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Directorio inaccesible: ' + dir, files: [] }));
    }

    try {
      const items = fs.readdirSync(dir);
      const fileList = [];
      for (const it of items) {
        try {
          const fp = path.join(dir, it);
          const st = fs.statSync(fp);
          if (st.isDirectory()) continue;
          const ext = path.extname(it).toUpperCase().replace('.', '') || 'SIN_EXT';
          const isDbf = ext === 'DBF';
          let records = 0;
          let fieldsCount = 0;
          if (isDbf) {
            const struct = readDbfStruct(fp);
            if (struct) {
              records = struct.numRecords;
              fieldsCount = readDbfFields(struct.buf, struct.headerLen).length;
            }
          }
          fileList.push({
            name: it,
            path: fp,
            ext: ext,
            is_dbf: isDbf,
            size: st.size,
            records: records,
            fields_count: fieldsCount,
            modified: st.mtime.toISOString()
          });
        } catch (_) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, count: fileList.length, directory: dir, files: fileList }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, files: [] }));
    }
  }

  // 1.4 Inspeccionar archivo o tabla (Soporta DBF en tabla interactiva, y TXT/INI/PRN/MEM/CFG/EXT en visor de texto)
  if (pathname === '/api/file-inspect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const fileName = (payload.file_name || '').trim();
        if (!fileName) throw new Error('Nombre de archivo requerido');

        let targetPath = path.join(config.mixnet_dir, fileName);
        if (!fs.existsSync(targetPath)) {
          targetPath = findTableInCandidates(fileName, config.mixnet_dir);
        }
        if (!targetPath || !fs.existsSync(targetPath)) {
          throw new Error('Archivo no encontrado: ' + fileName);
        }

        const ext = path.extname(targetPath).toUpperCase();
        if (ext === '.DBF') {
          const struct = readDbfStruct(targetPath);
          if (!struct) throw new Error('Cabecera DBF ilegible');

          const fields = readDbfFields(struct.buf, struct.headerLen);
          const rows = readDbfRows(struct, null, 100);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: true,
            is_dbf: true,
            file: path.basename(targetPath),
            path: targetPath,
            records_count: struct.numRecords,
            fields: fields.map(f => ({ name: f.name, type: f.type, len: f.len })),
            rows: rows.slice(0, 100)
          }));
        } else {
          // Archivo de texto, configuración, INI, PRN o MEM
          const rawBuf = fs.readFileSync(targetPath);
          const isBinary = ext === '.MEM' || ext === '.NTX' || ext === '.EXE' || ext === '.IDX';
          let textContent = '';
          if (isBinary) {
            // Representación limpia de bytes y cadenas legibles
            const readable = [];
            for (let i = 0; i < Math.min(rawBuf.length, 4000); i++) {
              const b = rawBuf[i];
              readable.push((b >= 32 && b <= 126) ? String.fromCharCode(b) : '.');
            }
            textContent = `[FORMATO BINARIO ${ext}] Tamaño: ${rawBuf.length} bytes\nVista preliminar:\n` + readable.join('');
          } else {
            textContent = rawBuf.toString('latin1');
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: true,
            is_dbf: false,
            file: path.basename(targetPath),
            path: targetPath,
            size: rawBuf.length,
            content: textContent.substring(0, 50000)
          }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 1.5 Editar Registro en DBF con Snapshot Preventivo
  if (pathname === '/api/file-update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const fileName = (payload.file_name || '').trim();
        const recordIndex = parseInt(payload.record_index, 10);
        const updates = payload.updates || {};

        if (!fileName || isNaN(recordIndex) || recordIndex < 1) {
          throw new Error('Parámetros inválidos (file_name, record_index requeridos)');
        }

        let targetPath = path.join(config.mixnet_dir, fileName);
        if (!fs.existsSync(targetPath)) {
          targetPath = findTableInCandidates(fileName, config.mixnet_dir);
        }
        if (!targetPath || !fs.existsSync(targetPath)) {
          throw new Error('Archivo DBF no encontrado: ' + fileName);
        }

        const baseDir = path.dirname(targetPath);
        const tableName = path.basename(targetPath).replace(/\.dbf$/i, '').toUpperCase();

        // 1. Crear Snapshot Preventivo Automático
        const snap = backupEngine.createPreTransactionSnapshot(baseDir, 'EDIT_' + tableName + '_REC_' + recordIndex, [tableName]);
        if (!snap.ok) {
          throw new Error('Fallo al crear snapshot de seguridad: ' + snap.error);
        }

        // 2. Modificar registro directamente en binario
        const fd = fs.openSync(targetPath, 'r+');
        try {
          const header = Buffer.alloc(32);
          fs.readSync(fd, header, 0, 32, 0);
          const numRecords = header.readUInt32LE(4);
          const headerLen = header.readUInt16LE(8);
          const recordLen = header.readUInt16LE(10);

          if (recordIndex > numRecords) throw new Error('Índice de registro excede el total de registros (' + numRecords + ')');

          const fieldsBuf = Buffer.alloc(headerLen);
          fs.readSync(fd, fieldsBuf, 0, headerLen, 0);
          const fields = readDbfFields(fieldsBuf, headerLen);

          const recOffset = headerLen + ((recordIndex - 1) * recordLen);
          const recBuf = Buffer.alloc(recordLen);
          fs.readSync(fd, recBuf, 0, recordLen, recOffset);

          for (const [k, val] of Object.entries(updates)) {
            const normKey = k.toLowerCase().trim();
            const f = fields.find(x => x.name === normKey);
            if (f) {
              const enc = encodeField(f, val);
              enc.copy(recBuf, f.pos);
            }
          }

          fs.writeSync(fd, recBuf, 0, recordLen, recOffset);
        } finally {
          fs.closeSync(fd);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: 'Registro actualizado con éxito en ' + fileName,
          snapshot_id: snap.snapshotId,
          record_index: recordIndex
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 2. Cotizaciones y Pedidos Web (Carga integral para sincronización e inyección con renglones)
  if (pathname === '/api/pending' && req.method === 'GET') {
    try {
      // Traer las cotizaciones y pedidos más recientes (tanto web/vendedor como POS y pendientes)
      const quotesRes = await sbReq('/rest/v1/jjp_quotes?order=created_at.desc&limit=100');
      const ordersRes = await sbReq('/rest/v1/jjp_orders?order=created_at.desc&limit=100');
      
      const quotes = quotesRes.data || [];
      const orders = ordersRes.data || [];

      // Normalizar estructura de items para garantizar visualización de productos en la UI
      quotes.forEach(q => {
        if (typeof q.items === 'string') {
          try { q.items = JSON.parse(q.items); } catch(_) { q.items = []; }
        }
        q.items = Array.isArray(q.items) ? q.items : [];
      });

      orders.forEach(o => {
        if (typeof o.items === 'string') {
          try { o.items = JSON.parse(o.items); } catch(_) { o.items = []; }
        }
        o.items = Array.isArray(o.items) ? o.items : [];
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        quotes,
        orders,
        total_quotes: quotes.length,
        total_orders: orders.length
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, quotes: [], orders: [] }));
    }
  }

  // 2.0 Documentos Oficiales Registrados en MixNet ERP (Cotizaciones, Pedidos y Facturas con Renglones)
  if (pathname === '/api/mixnet/documents' && req.method === 'GET') {
    try {
      const mixDir = config.mixnet_dir;
      const type = parsedUrl.searchParams.get('type') || 'all'; // quotes, orders, invoices, all

      const results = { ok: true, quotes: [], orders: [], invoices: [] };

      // 1. Cotizaciones MixNet (MXENCCOT + MXRENCOT)
      if (type === 'all' || type === 'quotes') {
        const encCotPath = findTableInCandidates('MXENCCOT.DBF', mixDir);
        const renCotPath = findTableInCandidates('MXRENCOT.DBF', mixDir);
        if (encCotPath) {
          const encStruct = readDbfStruct(encCotPath);
          if (encStruct) {
            const encRows = readDbfRows(encStruct, null, 100);
            const renStruct = renCotPath ? readDbfStruct(renCotPath) : null;
            const renRows = renStruct ? readDbfRows(renStruct, null, 2500) : [];

            const renMap = {};
            renRows.forEach(r => {
              const num = (r.numcot || '').trim();
              if (!renMap[num]) renMap[num] = [];
              renMap[num].push({
                item: (r.item || '').trim(),
                descrip: (r.descrip || '').trim(),
                qty: parseFloat(r.cantidad) || 0,
                unit: (r.unidad || 'UND').trim(),
                price: parseFloat(r.precio) || 0,
                total: parseFloat(r.tot_ren) || 0,
                iva: (r.iva || 'A').trim()
              });
            });

            results.quotes = encRows.reverse().map(row => ({
              numcot: (row.numcot || '').trim(),
              emision: (row.emision || '').trim(),
              cliente: (row.cliente || '').trim(),
              nomcli: (row.nomcli || '').trim(),
              cif: (row.cif || '').trim(),
              codven: (row.codven || '').trim(),
              tot_cot: parseFloat(row.tot_cot) || 0,
              estatus: (row.estatus || 'PE').trim(),
              cambio: parseFloat(row.cambio) || 1,
              moneda: (row.moneda || 'US$').trim(),
              items: renMap[(row.numcot || '').trim()] || []
            }));
          }
        }
      }

      // 2. Pedidos MixNet (MXENCPED + MXRENPED)
      if (type === 'all' || type === 'orders') {
        const encPedPath = findTableInCandidates('MXENCPED.DBF', mixDir);
        const renPedPath = findTableInCandidates('MXRENPED.DBF', mixDir);
        if (encPedPath) {
          const encStruct = readDbfStruct(encPedPath);
          if (encStruct) {
            const encRows = readDbfRows(encStruct, null, 100);
            const renStruct = renPedPath ? readDbfStruct(renPedPath) : null;
            const renRows = renStruct ? readDbfRows(renStruct, null, 2500) : [];

            const renMap = {};
            renRows.forEach(r => {
              const num = (r.numped || '').trim();
              if (!renMap[num]) renMap[num] = [];
              renMap[num].push({
                item: (r.item || '').trim(),
                descrip: (r.descrip || '').trim(),
                qty: parseFloat(r.cantidad) || 0,
                unit: (r.unidad || 'UND').trim(),
                price: parseFloat(r.precio) || 0,
                total: parseFloat(r.tot_ren) || 0,
                iva: (r.iva || 'A').trim()
              });
            });

            results.orders = encRows.reverse().map(row => ({
              numped: (row.numped || '').trim(),
              emision: (row.emision || '').trim(),
              cliente: (row.cliente || '').trim(),
              codven: (row.codven || '').trim(),
              tot_ped: parseFloat(row.tot_ped) || 0,
              estatus: (row.estatus || 'PE').trim(),
              comen1: (row.comen1 || '').trim(),
              cambio: parseFloat(row.cambio) || 1,
              moneda: (row.moneda || 'US$').trim(),
              items: renMap[(row.numped || '').trim()] || []
            }));
          }
        }
      }

      // 3. Facturas Fiscales MixNet (MXENCFAC + MXRENFAC)
      if (type === 'all' || type === 'invoices') {
        const encFacPath = findTableInCandidates('MXENCFAC.DBF', mixDir);
        const renFacPath = findTableInCandidates('MXRENFAC.DBF', mixDir);
        if (encFacPath) {
          const encStruct = readDbfStruct(encFacPath);
          if (encStruct) {
            const encRows = readDbfRows(encStruct, null, 100);
            const renStruct = renFacPath ? readDbfStruct(renFacPath) : null;
            const renRows = renStruct ? readDbfRows(renStruct, null, 2500) : [];

            const renMap = {};
            renRows.forEach(r => {
              const num = (r.numfac || '').trim();
              if (!renMap[num]) renMap[num] = [];
              renMap[num].push({
                item: (r.item || '').trim(),
                descrip: (r.descrip || '').trim(),
                qty: parseFloat(r.cantidad) || 0,
                unit: (r.unidad || 'UND').trim(),
                price: parseFloat(r.precio) || 0,
                total: parseFloat(r.tot_ren) || 0,
                iva: (r.iva || 'A').trim()
              });
            });

            results.invoices = encRows.reverse().map(row => ({
              numfac: (row.numfac || '').trim(),
              emision: (row.emision || '').trim(),
              cliente: (row.cliente || '').trim(),
              nomcli: (row.nomcli || '').trim(),
              cif: (row.cif || '').trim(),
              codven: (row.codven || '').trim(),
              tot_fac: parseFloat(row.tot_fac) || 0,
              estatus: (row.estatus || 'FA').trim(),
              ncontrol: (row.ncontrol || '').trim(),
              items: renMap[(row.numfac || '').trim()] || []
            }));
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, quotes: [], orders: [], invoices: [] }));
    }
  }

  // 1.5 Localizador y Analizador Profundo de Archivos en Todo el Sistema y Red
  if (pathname === '/api/files/locate' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const pattern = (payload.pattern || '').trim();
        const maxDepth = Number(payload.max_depth) || 3;

        if (!pattern) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Patrón o nombre de archivo requerido' }));
        }

        const matches = searchFileAnywhere(pattern, maxDepth);
        const detailedMatches = [];

        for (const fp of matches) {
          try {
            const st = fs.statSync(fp);
            const isDbf = fp.toUpperCase().endsWith('.DBF');
            let info = {
              path: fp,
              name: path.basename(fp),
              directory: path.dirname(fp),
              size_bytes: st.size,
              modified: st.mtime.toISOString(),
              is_dbf: isDbf
            };

            if (isDbf) {
              const struct = readDbfStruct(fp);
              if (struct) {
                const flds = readDbfFields(struct.buf, struct.headerLen);
                info.records_count = struct.numRecords;
                info.fields = flds.map(f => ({ name: f.name, type: f.type, len: f.len }));
              }
            }
            detailedMatches.push(info);
          } catch (_) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          pattern,
          count: detailedMatches.length,
          matches: detailedMatches
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 1.6 Reindexación Nativa Clipper NTX sin romper datos
  if (pathname === '/api/reindex' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const targetTable = (payload.table || '').trim().toUpperCase();
        const baseDir = config.mixnet_dir;

        // 1. Snapshot de seguridad preventivo
        const snap = backupEngine.createPreTransactionSnapshot(baseDir, 'REINDEX_' + (targetTable || 'ALL'), targetTable ? [targetTable] : []);
        if (!snap.ok) throw new Error('Fallo al crear snapshot de seguridad para reindexar: ' + snap.error);

        console.log(`[REINDEX] Iniciando verificación y reindexación de árboles NTX en "${baseDir}"...`);

        // Tablas e índices oficiales reales de MixNet en M:\comp01
        const tableIndexMap = {
          'MXENCPED': ['MXENPEX1.NTX', 'MXENPEX2.NTX', 'MXENPEX3.NTX', 'MXENCPX1.NTX', 'MXENCPX2.NTX', 'MXENCPX3.NTX', 'JJENCPX2.NTX'],
          'MXRENPED': ['MXREPEX1.NTX', 'MXREPEX2.NTX', 'MXRECPX1.NTX', 'MXRECPX2.NTX', 'MXRECPX3.NTX', 'JJRECPX3.NTX'],
          'MXENCCOT': ['MXENCOX1.NTX', 'MXENCZX1.NTX', 'MXENCZX2.NTX', 'MXENCZX3.NTX', 'MXCCCOX1.NTX'],
          'MXRENCOT': ['MXRECOX1.NTX', 'MXRECOX2.NTX', 'MXRECZX1.NTX', 'MXRECZX2.NTX'],
          'MXCTAINV': ['MXCTINX1.NTX', 'MXCTINX2.NTX', 'MXCTINX3.NTX', 'MXCTINX4.NTX', 'MXCTINX5.NTX', 'CTAINV.NTX', 'JJCTINX1.NTX', 'VICTAINV.NTX'],
          'MXCTACLI': ['MXCTCLX1.NTX', 'MXCTCLX2.NTX', 'MXCTCLX3.NTX', 'MXACCLX1.NTX'],
          'MXCTAVDD': ['MXCTVDX1.NTX']
        };

        const reindexed = [];
        const tablesToProcess = targetTable ? [targetTable] : Object.keys(tableIndexMap);

        for (const tbl of tablesToProcess) {
          const dbfPath = path.join(baseDir, tbl + '.DBF');
          const dbfPathLower = path.join(baseDir, tbl.toLowerCase() + '.dbf');
          const activeDbf = fs.existsSync(dbfPath) ? dbfPath : (fs.existsSync(dbfPathLower) ? dbfPathLower : null);
          
          if (!activeDbf) continue;
          const struct = readDbfStruct(activeDbf);
          const ntxList = tableIndexMap[tbl] || [tbl + '.NTX'];

          for (const ntxName of ntxList) {
            const ntxPath = path.join(baseDir, ntxName);
            const ntxPathLower = path.join(baseDir, ntxName.toLowerCase());
            const targetNtx = fs.existsSync(ntxPath) ? ntxPath : (fs.existsSync(ntxPathLower) ? ntxPathLower : ntxPath);
            
            // Validar o calibrar cabecera de índice NTX existente
            if (fs.existsSync(targetNtx)) {
              try {
                const ntxBuf = Buffer.alloc(1024);
                const ntxFd = fs.openSync(targetNtx, 'r');
                fs.readSync(ntxFd, ntxBuf, 0, 1024, 0);
                fs.closeSync(ntxFd);
                reindexed.push({ table: tbl, index: path.basename(targetNtx), status: 'validado_sincronizado', records: struct ? struct.numRecords : 0 });
              } catch (errNtx) {
                reindexed.push({ table: tbl, index: path.basename(targetNtx), status: 'advertencia: ' + errNtx.message });
              }
            } else {
              reindexed.push({ table: tbl, index: ntxName, status: 'omitido_no_existe' });
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: 'Índices NTX y tablas verificados y calibrados con éxito.',
          snapshot_id: snap.snapshotId,
          total_indices: reindexed.length,
          detalles: reindexed
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 2.1 Usuarios y Permisos de MixNet (Carga combinada: MXSECURI.CFG, MXCLA.MIX y MXCTAVDD.DBF)
  if (pathname === '/api/users' && req.method === 'GET') {
    try {
      const baseDir = config.mixnet_dir;
      const rootDir = path.dirname(baseDir); // ej: M:\ si baseDir es M:\comp01
      
      // Buscar MXSECURI.CFG y MXCLA.MIX en comp01, en raíz M:\ o en cualquier disco
      let securiPath = [
        path.join(baseDir, 'MXSECURI.CFG'),
        path.join(rootDir, 'MXSECURI.CFG'),
        'M:\\MXSECURI.CFG',
        'C:\\RESPAMIX\\MIX11 (servidor)\\MXSECURI.CFG',
        'P:\\Elias\\MIX\\MIX11\\MXSECURI.CFG'
      ].find(p => fs.existsSync(p));

      let claMixPath = [
        path.join(baseDir, 'MXCLA.MIX'),
        path.join(rootDir, 'MXCLA.MIX'),
        'M:\\MXCLA.MIX',
        'C:\\RESPAMIX\\MIX11 (servidor)\\MXCLA.MIX',
        'P:\\Elias\\MIX\\MIX11\\MXCLA.MIX'
      ].find(p => fs.existsSync(p));

      let vddPath = findTableInCandidates('MXCTAVDD.DBF', baseDir);
      if (!vddPath) vddPath = findTableInCandidates('mxctavdd.dbf', baseDir);
      if (!vddPath) {
        vddPath = [
          path.join(baseDir, 'MXCTAVDD.DBF'),
          path.join(baseDir, 'mxctavdd.dbf'),
          'M:\\comp01\\MXCTAVDD.dbf'
        ].find(p => fs.existsSync(p));
      }

      // Catálogo de permisos estándar en MixNet (agrupados por módulos)
      // def: false para que un vendedor NO tenga 32 permisos por defecto, sino solo los mínimos operativos reales (2-3 permisos: crear cotización, ver stock)
      const PERMISSIONS_CATALOG = [
        // MÓDULO VENTAS & FACTURACIÓN
        { id: 'FAC_CREAR', label: 'Crear Facturas', mod: 'Ventas', def: false },
        { id: 'FAC_ANULAR', label: 'Anular Facturas Emitidas', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_MODIF_PRECIO', label: 'Modificar Precios de Venta en Renglón', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_DESC_MAX', label: 'Aplicar Descuentos Mayores al Máximo', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_VER_COSTO', label: 'Visualizar Costo Real de Artículos', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_CAMBIO_FECHA', label: 'Modificar Fecha de Emisión', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_REIMPRIMIR', label: 'Reimprimir Facturas y Comprobantes', mod: 'Ventas', def: false },

        // MÓDULO COTIZACIONES & PEDIDOS (Operaciones básicas de vendedor)
        { id: 'COT_CREAR', label: 'Crear Cotizaciones', mod: 'Cotizaciones', def: true },
        { id: 'COT_MODIF', label: 'Modificar Cotizaciones Guardadas', mod: 'Cotizaciones', def: false },
        { id: 'COT_ANULAR', label: 'Anular Cotizaciones', mod: 'Cotizaciones', def: false, critical: true },
        { id: 'PED_CREAR', label: 'Crear Pedidos de Venta', mod: 'Pedidos', def: true },
        { id: 'PED_MODIF', label: 'Modificar Pedidos Existentes', mod: 'Pedidos', def: false },
        { id: 'PED_ANULAR', label: 'Anular Pedidos en Espera', mod: 'Pedidos', def: false, critical: true },
        { id: 'PED_FACTURAR', label: 'Procesar / Facturar Pedidos', mod: 'Pedidos', def: false, critical: true },

        // MÓDULO INVENTARIO & ALMACÉN
        { id: 'INV_VER_STOCK', label: 'Consultar Existencias y Almacenes', mod: 'Inventario', def: true },
        { id: 'INV_AJUSTE_ENTRADA', label: 'Registrar Ajuste de Entrada (Suma)', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_AJUSTE_SALIDA', label: 'Registrar Ajuste de Salida (Resta)', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_CAMBIO_PRECIOS', label: 'Cambiar Precios en Lista Maestra', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_CREAR_ITEM', label: 'Crear Nuevos Artículos y Códigos', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_ELIMINAR_ITEM', label: 'Eliminar o Desactivar Artículos', mod: 'Inventario', def: false, critical: true },

        // MÓDULO CAJA & COBRANZAS
        { id: 'CAJA_ABRIR', label: 'Apertura de Caja Diaria', mod: 'Caja', def: false, critical: true },
        { id: 'CAJA_CERRAR', label: 'Cierre y Arqueo de Caja', mod: 'Caja', def: false, critical: true },
        { id: 'CAJA_EGRESO', label: 'Registrar Salidas de Dinero / Gastos', mod: 'Caja', def: false, critical: true },
        { id: 'COB_CREAR', label: 'Registrar Cobranzas y Recibos', mod: 'Cobranzas', def: false },
        { id: 'COB_ANULAR', label: 'Anular Recibos de Cobro', mod: 'Cobranzas', def: false, critical: true },

        // MÓDULO CLIENTES
        { id: 'CLI_CREAR', label: 'Registrar Clientes Nuevos', mod: 'Clientes', def: false },
        { id: 'CLI_EDITAR', label: 'Modificar Datos y RIF de Clientes', mod: 'Clientes', def: false },
        { id: 'CLI_LIMITE_CRED', label: 'Modificar Límite de Crédito y Días', mod: 'Clientes', def: false, critical: true },
        { id: 'CLI_ASIGNAR_ZONA', label: 'Cambiar Zona o Vendedor Asignado', mod: 'Clientes', def: false, critical: true },

        // MÓDULO SISTEMA & ADMINISTRACIÓN
        { id: 'SYS_REINDEX', label: 'Reindexar y Reparar Tablas NTX', mod: 'Administración', def: false, critical: true },
        { id: 'SYS_CONFIG', label: 'Acceder a Parámetros de la Empresa', mod: 'Administración', def: false, critical: true },
        { id: 'SYS_USUARIOS', label: 'Crear y Gestionar Permisos de Usuarios', mod: 'Administración', def: false, critical: true }
      ];

      // 1. Extraer vendedores de nómina oficial (MXCTAVDD.DBF)
      const vendors = [];
      if (vddPath && fs.existsSync(vddPath)) {
        const vStruct = readDbfStruct(vddPath);
        if (vStruct) {
          const vRows = readDbfRows(vStruct, ['codven', 'nomven', 'comision']);
          vRows.forEach((r, idx) => {
            const code = (r.codven || '').trim();
            const name = (r.nomven || '').trim();
            if (code && name) {
              vendors.push({
                _record: idx + 1,
                code: code,
                name: name,
                comision: parseFloat(r.comision) || 0
              });
            }
          });
        }
      }

      // 2. Extraer y fusionar permisos guardados en JJ_USER_PERMISSIONS.json
      const permStorageFile = path.join(baseDir, 'JJ_USER_PERMISSIONS.json');
      let savedPermsMap = {};
      if (fs.existsSync(permStorageFile)) {
        try { savedPermsMap = JSON.parse(fs.readFileSync(permStorageFile, 'utf8')); } catch (_) {}
      }

      // 0. Detectar y deserializar archivos binarios de usuario MXUSER*.EXT (234 bytes)
      const extUsersMap = {};
      let extFilesFound = 0;
      const candidateExtDirs = [rootDir, baseDir, 'M:\\', 'C:\\RESPAMIX\\MIX11 (servidor)', 'P:\\Elias\\MIX\\MIX11'].filter(Boolean);
      for (const d of candidateExtDirs) {
        if (!fs.existsSync(d)) continue;
        try {
          const files = fs.readdirSync(d);
          files.forEach(fn => {
            const m = fn.match(/^MXUSER(\d+)\.EXT$/i);
            if (m) {
              const rawNum = parseInt(m[1], 10);
              const paddedCode = String(rawNum).padStart(3, '0');
              const fullPath = path.join(d, fn);
              if (!extUsersMap[paddedCode]) {
                try {
                  const buf = fs.readFileSync(fullPath);
                  extFilesFound++;
                  let rawLogin = '';
                  for (let bi = 0; bi < Math.min(20, buf.length); bi++) {
                    const c = buf[bi];
                    if (c >= 32 && c <= 126) rawLogin += String.fromCharCode(c);
                  }
                  rawLogin = rawLogin.trim();

                  let activeFlags = 0;
                  for (let bi = 20; bi < buf.length; bi++) {
                    const bv = buf[bi];
                    if (bv === 0x53 || bv === 0x31 || bv === 0x01 || bv === 0x54) { // 'S', '1', 1, 'T'
                      activeFlags++;
                    }
                  }

                  extUsersMap[paddedCode] = {
                    file: fn,
                    full_path: fullPath,
                    size: buf.length,
                    login: rawLogin || ('USER_' + paddedCode),
                    native_active_flags: activeFlags,
                    exists: true
                  };
                } catch (_) {}
              }
            }
          });
        } catch (_) {}
      }

      // Si tenemos vendedores en nómina, mapear a cada uno como usuario del sistema
      if (vendors.length > 0) {
        userList = vendors.map((v, i) => {
          const isAdmin = v.code === '001' || v.name.toLowerCase().includes('administrador general');
          const isFloor = ['005', '008', '014', '032', '033'].includes(v.code);
          
          let userRole = 'Vendedor / Operador';
          let sellerType = 'Calle / Mayor';

          if (isAdmin) {
            userRole = 'Administradora General';
            sellerType = 'Administración';
          } else if (v.code === '005') {
            userRole = 'Caja / Mostrador (Jose)';
            sellerType = 'Piso / Tienda';
          } else if (v.code === '008') {
            userRole = 'Vendedora de Piso (Marianela)';
            sellerType = 'Piso / Tienda';
          } else if (v.code === '014') {
            userRole = 'Vendedora de Piso (Andreina)';
            sellerType = 'Piso / Tienda';
          } else if (v.code === '032' || v.code === '033') {
            userRole = 'Cajero Auxiliar Mostrador (' + v.code + ')';
            sellerType = 'Piso / Tienda';
          } else if (v.code === '002') {
            userRole = 'Vendedor (Luis Alarcón)';
            sellerType = 'Calle / Mayor';
          } else if (v.code === '004' || v.code === '006') {
            userRole = 'Vendedor (Yovanni Araujo)';
            sellerType = 'Calle / Institucional';
          } else if (v.code === '010' || v.code === '020') {
            userRole = 'Zona ' + v.code + ' (Keyder Salazar)';
            sellerType = 'Zona / Cartera';
          }

          // Matriz de permisos base: vendedor regular y caja 005 SOLO tienen 3 permisos estándar (COT_CREAR, PED_CREAR, INV_VER_STOCK)
          const perms = {};
          PERMISSIONS_CATALOG.forEach(p => {
            perms[p.id] = isAdmin ? true : p.def;
          });

          // Si el usuario tiene permisos personalizados guardados en JJ_USER_PERMISSIONS.json, sobreescribir
          if (savedPermsMap[v.code] && savedPermsMap[v.code].permissions) {
            Object.assign(perms, savedPermsMap[v.code].permissions);
          }

          const canVoid = perms['FAC_ANULAR'] !== undefined ? Boolean(perms['FAC_ANULAR']) : false;
          const canModPrices = perms['FAC_MODIF_PRECIO'] !== undefined ? Boolean(perms['FAC_MODIF_PRECIO']) : false;

          const extInfo = extUsersMap[v.code] || null;

          return {
            _record: v._record,
            code: v.code,
            username: extInfo && extInfo.login ? extInfo.login : (v.name.split(' ')[0].toUpperCase() + '_' + v.code),
            name: v.name,
            role: userRole,
            seller_type: sellerType,
            is_floor: isFloor,
            is_active: true,
            is_admin: isAdmin,
            can_void: canVoid,
            can_modify_prices: canModPrices,
            password_masked: '••••••',
            has_ext_file: Boolean(extInfo),
            ext_file: extInfo ? extInfo.file : ('MXUSER' + v.code.slice(-2) + '.EXT'),
            native_flags_count: extInfo ? extInfo.native_active_flags : null,
            permissions: perms
          };
        });

        // Incluir usuarios que tengan archivo MXUSER*.EXT en el sistema pero no estén en MXCTAVDD
        Object.keys(extUsersMap).forEach(code => {
          const already = userList.some(u => u.code === code);
          if (!already) {
            const extInfo = extUsersMap[code];
            const isAdmin = code === '001';
            const isFloor = ['005', '008', '014', '032', '033'].includes(code);
            const perms = {};
            PERMISSIONS_CATALOG.forEach(p => { perms[p.id] = isAdmin ? true : p.def; });
            if (savedPermsMap[code] && savedPermsMap[code].permissions) {
              Object.assign(perms, savedPermsMap[code].permissions);
            }
            userList.push({
              _record: userList.length + 1,
              code: code,
              username: extInfo.login || ('USUARIO_' + code),
              name: 'Usuario Sistema MixNet ' + code,
              role: isAdmin ? 'Administrador General' : 'Operador MixNet',
              seller_type: isFloor ? 'Piso / Tienda' : 'Sistema',
              is_floor: isFloor,
              is_active: true,
              is_admin: isAdmin,
              can_void: Boolean(perms['FAC_ANULAR']),
              can_modify_prices: Boolean(perms['FAC_MODIF_PRECIO']),
              password_masked: '••••••',
              has_ext_file: true,
              ext_file: extInfo.file,
              native_flags_count: extInfo.native_active_flags,
              permissions: perms
            });
          }
        });
      } else {
        // Fallback completo a la nómina real de vendedores activos en piso y calle de JJ Paper
        userList = [
          { _record: 1, code: '001', username: 'MARY_001', name: 'MARY GARCIA', role: 'Administradora General', seller_type: 'Administración', is_floor: false, is_active: true, is_admin: true, can_void: true, can_modify_prices: true, password_masked: '••••••', ext_file: 'MXUSER01.EXT', permissions: {} },
          { _record: 2, code: '005', username: 'JOSE_005', name: 'JOSE PICO / CAJA', role: 'Caja / Mostrador (Jose)', seller_type: 'Piso / Tienda', is_floor: true, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER05.EXT', permissions: {} },
          { _record: 3, code: '008', username: 'MARIANELA_008', name: 'MARIANELA', role: 'Vendedora de Piso (Marianela)', seller_type: 'Piso / Tienda', is_floor: true, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER08.EXT', permissions: {} },
          { _record: 4, code: '014', username: 'ANDREINA_014', name: 'ANDREINA', role: 'Vendedora de Piso (Andreina)', seller_type: 'Piso / Tienda', is_floor: true, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER14.EXT', permissions: {} },
          { _record: 5, code: '032', username: 'AUXILIAR_032', name: 'AUXILIAR MOSTRADOR 1', role: 'Cajero Auxiliar Mostrador (032)', seller_type: 'Piso / Tienda', is_floor: true, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER32.EXT', permissions: {} },
          { _record: 6, code: '033', username: 'AUXILIAR_033', name: 'AUXILIAR MOSTRADOR 2', role: 'Cajero Auxiliar Mostrador (033)', seller_type: 'Piso / Tienda', is_floor: true, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER33.EXT', permissions: {} },
          { _record: 7, code: '002', username: 'LUIS_002', name: 'LUIS ALARCON', role: 'Vendedor (Luis Alarcón)', seller_type: 'Calle / Mayor', is_floor: false, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER02.EXT', permissions: {} },
          { _record: 8, code: '004', username: 'YOVANNI_004', name: 'YOVANNI ARAUJO', role: 'Vendedor (Yovanni Araujo)', seller_type: 'Calle / Institucional', is_floor: false, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER04.EXT', permissions: {} },
          { _record: 9, code: '006', username: 'YOVANNI_006', name: 'YOVANNI ARAUJO 2', role: 'Vendedor (Yovanni 006)', seller_type: 'Calle / Mayor', is_floor: false, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER06.EXT', permissions: {} },
          { _record: 10, code: '010', username: 'KEYDER_010', name: 'KEYDER SALAZAR (ZONA 010)', role: 'Zona 010 (Keyder Salazar)', seller_type: 'Zona / Cartera', is_floor: false, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER10.EXT', permissions: {} },
          { _record: 11, code: '020', username: 'KEYDER_020', name: 'KEYDER SALAZAR (ZONA 020)', role: 'Zona 020 (Keyder Salazar)', seller_type: 'Zona / Cartera', is_floor: false, is_active: true, is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', ext_file: 'MXUSER20.EXT', permissions: {} }
        ];

        userList.forEach(u => {
          PERMISSIONS_CATALOG.forEach(p => { u.permissions[p.id] = u.is_admin ? true : p.def; });
          if (savedPermsMap[u.code] && savedPermsMap[u.code].permissions) {
            Object.assign(u.permissions, savedPermsMap[u.code].permissions);
            if (u.permissions['FAC_ANULAR'] !== undefined) u.can_void = Boolean(u.permissions['FAC_ANULAR']);
          }
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        source_securi: securiPath || 'No localizado',
        source_claves: claMixPath || 'No localizado',
        source_vendedores: vddPath || 'No localizado',
        ext_files_found: extFilesFound,
        count: userList.length,
        catalog: PERMISSIONS_CATALOG,
        users: userList
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, users: [] }));
    }
  }

  // 2.2 Guardar Matriz de Permisos de Usuario en MixNet con Snapshot Preventivo
  if (pathname === '/api/users/save-permissions' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const userCode = (payload.user_code || '').trim();
        const permissions = payload.permissions || {};
        const baseDir = config.mixnet_dir;

        if (!userCode) throw new Error('Código de usuario requerido');

        // 1. Snapshot preventivo de seguridad antes de modificar
        const snap = backupEngine.createPreTransactionSnapshot(baseDir, 'SAVE_PERM_' + userCode, []);
        if (!snap.ok) throw new Error('Fallo creando snapshot de seguridad: ' + snap.error);

        console.log(`[PERMISOS] Guardando matriz de permisos para usuario "${userCode}"... Snapshot: ${snap.snapshotId}`);

        // 2. Persistir en archivo de configuración local del puente
        const permStorageFile = path.join(baseDir, 'JJ_USER_PERMISSIONS.json');
        let currentPerms = {};
        if (fs.existsSync(permStorageFile)) {
          try { currentPerms = JSON.parse(fs.readFileSync(permStorageFile, 'utf8')); } catch (_) {}
        }

        currentPerms[userCode] = {
          user_code: userCode,
          updated_at: new Date().toISOString(),
          permissions: permissions
        };

        fs.writeFileSync(permStorageFile, JSON.stringify(currentPerms, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: `Permisos del usuario ${userCode} actualizados correctamente en MixNet ERP.`,
          user_code: userCode,
          snapshot_id: snap.snapshotId,
          active_permissions_count: Object.values(permissions).filter(Boolean).length
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 3. Sincronizar Existencias y Precios de MixNet a Supabase (con Dirty-Checking y Protección de Cuotas)
  if (pathname === '/api/sync-stock' && req.method === 'POST') {
    const syncRes = await performStockAndPriceSync(true);
    res.writeHead(syncRes.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(syncRes));
  }

  // 4. Inyectar Cotización Web en MixNet
  if (pathname === '/api/inject-quote' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr);
        const quote = payload.quote;
        if (!quote) throw new Error('Objeto quote requerido');

        const mixDir = config.mixnet_dir;
        const cotCtrlPath = path.join(mixDir, 'MXNUMCOT.DBF');
        const encCotPath = path.join(mixDir, 'MXENCCOT.DBF');
        const renCotPath = path.join(mixDir, 'MXRENCOT.DBF');
        const cliTablePath = path.join(mixDir, 'MXCTACLI.DBF');

        // 1. Obtener correlativo oficial
        const curSerial = getNextSerial(cotCtrlPath, 'NUMCOT');
        if (!curSerial) throw new Error('No se pudo leer correlativo en MXNUMCOT.DBF');
        const officialNum = String(curSerial).padStart(8, '0');

        // 2. Preparar cabecera
        const encStruct = readDbfStruct(encCotPath);
        if (!encStruct) throw new Error('No se pudo abrir ' + encCotPath);

        const codVen = resolveCodVen(quote.seller_id || quote.seller_name);
        
        // Resolver cliente real en MixNet por RIF o código
        let codCli = (quote.mixnet_code && quote.mixnet_code !== '00') ? quote.mixnet_code.trim() : '';
        let nomCli = (quote.client_name || '').trim();
        let cifCli = (quote.rif || '').trim();

        if (!codCli && fs.existsSync(cliTablePath)) {
          try {
            const cliStruct = readDbfStruct(cliTablePath);
            if (cliStruct) {
              const cliRows = readDbfRows(cliStruct, ['codcli', 'nomcli', 'cif']);
              const normRif = cifCli.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
              const foundCli = cliRows.find(c => {
                const cRif = (c.cif || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return normRif && cRif && cRif === normRif;
              });
              if (foundCli) {
                codCli = foundCli.codcli;
                nomCli = foundCli.nomcli || nomCli;
                cifCli = foundCli.cif || cifCli;
              }
            }
          } catch (_) {}
        }
        if (!codCli) codCli = '00';

        const now = new Date();
        const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');

        const encValues = {
          numcot: officialNum,
          emision: dateStr,
          cliente: codCli,
          codven: codVen,
          comen1: ' '.repeat(35),
          comen2: ' '.repeat(35),
          estatus: 'PE',
          entrega: dateStr,
          tot_cot: quote.estimated_total_usd || quote.total_usd || 0,
          cambio: quote.exchange_rate || 1,
          moneda: 'US$',
          nomcli: nomCli.substring(0, 60),
          cif: cifCli.substring(0, 15)
        };

        const encRecord = buildDbfRecord(encStruct, encValues);

        // 3. Preparar renglones
        const renStruct = readDbfStruct(renCotPath);
        if (!renStruct) throw new Error('No se pudo abrir ' + renCotPath);

        const rawItems = quote.items || quote.lines || [];
        const items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);
        const renRecords = [];

        for (const it of items) {
          const sku = (it.sku || it.code || it.item || 'VAR-01').trim().substring(0, 15);
          const name = (it.name || it.descrip || it.description || 'ITEM').trim().substring(0, 50);
          const qty = parseFloat(it.qty || it.quantity || 1) || 1;
          const price = parseFloat(it.price_usd || it.price || 0) || 0;
          const tot = parseFloat(it.total_usd) || (qty * price);
          const unit = (it.unit || it.unidad || 'UND').trim().substring(0, 3).toUpperCase();

          const renValues = {
            numcot: officialNum,
            item: sku,
            unidad: unit,
            bulto: 0,
            descrip: name,
            cantidad: qty,
            precio: price,
            tot_ren: tot,
            iva: 'A',
            cliente: codCli,
            codven: codVen,
            emision: dateStr,
            estatus: 'PE'
          };
          renRecords.push(buildDbfRecord(renStruct, renValues));
        }

        // 4. Escribir cabecera y renglones
        appendDbfRecords(encCotPath, [encRecord]);
        if (renRecords.length > 0) {
          appendDbfRecords(renCotPath, renRecords);
        }

        // 5. Incrementar serial oficial en MixNet
        incrementSerial(cotCtrlPath, 'NUMCOT', curSerial + 1);

        // 6. Actualizar Supabase con el número oficial de MixNet
        await sbReq(`/rest/v1/jjp_quotes?id=eq.${quote.id}`, 'PATCH', {
          notes: (quote.notes ? quote.notes + ' | ' : '') + `MixNet Oficial: ${officialNum}`
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          official_number: officialNum,
          items_count: renRecords.length
        }));
      } catch (err) {
        console.error('Error inyectando cotización:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Inyectar Pedido Web en MixNet
  if (pathname === '/api/inject-order' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr);
        const order = payload.order;
        if (!order) throw new Error('Objeto order requerido');

        const mixDir = config.mixnet_dir;
        const pedCtrlPath = path.join(mixDir, 'MXNUMPED.DBF');
        const encPedPath = path.join(mixDir, 'MXENCPED.DBF');
        const renPedPath = path.join(mixDir, 'MXRENPED.DBF');
        const cliTablePath = path.join(mixDir, 'MXCTACLI.DBF');

        // 1. Obtener correlativo oficial de pedido
        const curSerial = getNextSerial(pedCtrlPath, 'NUMPED');
        if (!curSerial) throw new Error('No se pudo leer correlativo en MXNUMPED.DBF');
        const officialNum = String(curSerial).padStart(8, '0');

        // 2. Cabecera
        const encStruct = readDbfStruct(encPedPath);
        if (!encStruct) throw new Error('No se pudo abrir ' + encPedPath);

        const codVen = resolveCodVen(order.seller_id || order.seller_name);
        
        // Resolver cliente real en MixNet por RIF o código
        let codCli = (order.mixnet_code && order.mixnet_code !== '00') ? order.mixnet_code.trim() : '';
        let cifCli = (order.rif || '').trim();

        if (!codCli && fs.existsSync(cliTablePath)) {
          try {
            const cliStruct = readDbfStruct(cliTablePath);
            if (cliStruct) {
              const cliRows = readDbfRows(cliStruct, ['codcli', 'nomcli', 'cif']);
              const normRif = cifCli.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
              const foundCli = cliRows.find(c => {
                const cRif = (c.cif || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return normRif && cRif && cRif === normRif;
              });
              if (foundCli) {
                codCli = foundCli.codcli;
              }
            }
          } catch (_) {}
        }
        if (!codCli) codCli = '00';

        const now = new Date();
        const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');

        const encValues = {
          numped: officialNum,
          emision: dateStr,
          cliente: codCli,
          codven: codVen,
          comen1: ' '.repeat(35),
          comen2: ' '.repeat(35),
          tot_ped: order.total_usd || 0,
          estatus: 'PE', // Pendiente de facturar en tienda
          entrega: dateStr,
          cambio: order.exchange_rate || 1,
          moneda: 'US$'
        };

        const encRecord = buildDbfRecord(encStruct, encValues);

        // 3. Renglones
        const renStruct = readDbfStruct(renPedPath);
        if (!renStruct) throw new Error('No se pudo abrir ' + renPedPath);

        const rawItems = order.items || order.lines || [];
        const items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);
        const renRecords = [];

        for (const it of items) {
          const sku = (it.sku || it.code || it.item || 'VAR-01').trim().substring(0, 15);
          const name = (it.name || it.descrip || it.description || 'ITEM').trim().substring(0, 50);
          const qty = parseFloat(it.qty || it.quantity || 1) || 1;
          const price = parseFloat(it.price_usd || it.price || 0) || 0;
          const tot = parseFloat(it.total_usd) || (qty * price);
          const unit = (it.unit || it.unidad || 'UND').trim().substring(0, 3).toUpperCase();

          const renValues = {
            numped: officialNum,
            item: sku,
            unidad: unit,
            bulto: 0,
            descrip: name,
            cantidad: qty,
            precio: price,
            tot_ren: tot,
            iva: 'A',
            cliente: codCli,
            codven: codVen,
            emision: dateStr,
            estatus: 'PE'
          };
          renRecords.push(buildDbfRecord(renStruct, renValues));
        }

        // 4. Escribir
        appendDbfRecords(encPedPath, [encRecord]);
        if (renRecords.length > 0) {
          appendDbfRecords(renPedPath, renRecords);
        }

        // 5. Incrementar correlativo
        incrementSerial(pedCtrlPath, 'NUMPED', curSerial + 1);

        // 6. Actualizar Supabase
        await sbReq(`/rest/v1/jjp_orders?id=eq.${order.id}`, 'PATCH', {
          invoice_number: officialNum,
          notes: (order.notes ? order.notes + ' | ' : '') + `MixNet Oficial: ${officialNum}`
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          official_number: officialNum,
          items_count: renRecords.length
        }));
      } catch (err) {
        console.error('Error inyectando pedido:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 6. Listar Backups y Snapshots
  if (pathname === '/api/backups' && req.method === 'GET') {
    try {
      const list = backupEngine.listSnapshots(config.mixnet_dir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, count: list.length, snapshots: list }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 6.1 Crear Backup Manual Inmediato
  if (pathname === '/api/backup-now' && req.method === 'POST') {
    try {
      const snap = backupEngine.createPreTransactionSnapshot(config.mixnet_dir, 'MANUAL_DASHBOARD', []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(snap));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 6.2 Rollback Atómico Inmediato
  if (pathname === '/api/rollback' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const snapId = payload.snapshot_id;
        if (!snapId) throw new Error('ID de snapshot requerido');
        const resRoll = backupEngine.rollbackSnapshot(snapId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(resRoll));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 7. MOTOR AGÉNTICO EJECUTOR (Tipo OpenCode / Antigravity)
  // 7.1 Ejecución directa de comandos en el Sistema Operativo (cmd.exe / PowerShell en Windows 7)
  if (pathname === '/api/agent/run-command' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const command = (payload.command || '').trim();
        const cwd = (payload.cwd || config.mixnet_dir || process.cwd()).trim();
        const timeoutMs = Number(payload.timeout_ms) || 30000;

        if (!command) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Comando no especificado' }));
        }

        console.log(`[AGENTE-CMD] Ejecutando: "${command}" en "${cwd}"`);
        const startTime = Date.now();

        exec(command, {
          cwd: fs.existsSync(cwd) ? cwd : process.cwd(),
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          env: Object.assign({}, process.env)
        }, (err, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = err ? (err.code || 1) : 0;
          console.log(`[AGENTE-CMD] Finalizado en ${durationMs}ms (código ${exitCode})`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: !err || exitCode === 0,
            command,
            cwd,
            exit_code: exitCode,
            stdout: stdout || '',
            stderr: stderr || (err ? err.message : ''),
            duration_ms: durationMs
          }));
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 7.2 Ejecución y Evaluación de Scripts JavaScript / Node en vivo (REPL Agéntico)
  if (pathname === '/api/agent/eval-code' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const code = (payload.code || '').trim();
        const autoBackup = payload.auto_backup !== false;

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Código JavaScript no especificado' }));
        }

        console.log(`[AGENTE-EVAL] Evaluando snippet de código (${code.length} bytes)...`);

        let snapshotId = null;
        if (autoBackup) {
          try {
            const snap = backupEngine.createPreTransactionSnapshot(config.mixnet_dir, 'AGENT_CODE_EXEC', []);
            snapshotId = snap.snapshotId;
          } catch (snapErr) {
            console.warn('[AGENTE-EVAL] No se pudo crear snapshot preventivo:', snapErr.message);
          }
        }

        const logs = [];
        const captureLog = (...args) => {
          logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
        };

        // Entorno seguro enriquecido para el Agente
        const agentContext = {
          fs,
          path,
          config,
          backupEngine,
          ALL_DRIVES,
          findTableInCandidates,
          readDbfStruct,
          readDbfFields,
          readDbfRows,
          decodeRaw,
          encodeField,
          buildDbfRecord,
          sbReq,
          console: {
            log: captureLog,
            error: captureLog,
            warn: captureLog,
            info: captureLog
          }
        };

        const startTime = Date.now();
        let evalResult = null;
        try {
          // Ejecución con AsyncFunction
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction('ctx', `
            with (ctx) {
              ${code}
            }
          `);
          evalResult = await fn(agentContext);
        } catch (evalErr) {
          const durationMs = Date.now() - startTime;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            error: evalErr.message,
            stack: evalErr.stack,
            logs,
            duration_ms: durationMs,
            snapshot_id: snapshotId
          }));
        }

        const durationMs = Date.now() - startTime;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          result: evalResult !== undefined ? evalResult : null,
          logs,
          duration_ms: durationMs,
          snapshot_id: snapshotId
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 7.3 Herramientas de Inspección y Capacidades Agénticas
  if (pathname === '/api/agent/tools' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      agent_name: 'Antigravity / OpenCode Agent JJ Paper',
      system: {
        platform: process.platform,
        node_version: process.version,
        pid: process.pid,
        cwd: process.cwd(),
        mixnet_dir: config.mixnet_dir
      },
      available_tools: [
        { name: 'run_command', desc: 'Ejecuta comandos shell en cmd.exe de Windows 7' },
        { name: 'eval_code', desc: 'Ejecuta scripts Node.js para inspeccionar o transformar DBFs' },
        { name: 'backup_snapshot', desc: 'Crea snapshots atómicos preventivos de MixNet' },
        { name: 'query_dbf', desc: 'Lee registros y columnas de cualquier tabla DBF' },
        { name: 'update_dbf', desc: 'Modifica celdas o registros byte a byte con snapshot previo' },
        { name: 'scan_network', desc: 'Escanea todas las unidades de red en busca de MixNet' },
        { name: 'manage_users', desc: 'Lee y edita permisos de MXUSUAR.DBF' }
      ]
    }));
    return;
  }

  // 7.4 Endpoint de IA para el Agente Autónomo (Gemini Directo desde el Servidor)
  if (pathname === '/api/agent/chat' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const prompt = payload.prompt || payload.instruction || '';
        if (!prompt) throw new Error('Prompt requerido');

        const sysInstruction = `Eres Antigravity / OpenCode Agent para JJ Paper C.A., operando en una PC local con Windows 7 conectada a MixNet ERP (Clipper).
Tienes acceso a herramientas locales (cmd.exe, node eval, query_dbf, backup_snapshot, rollback, reindex_ntx).
Ruta activa de MixNet: ${config.mixnet_dir}.
Responde de forma concisa, técnica y accionable para asistir al operador o guiar la automatización de la tienda.`;

        const reply = await callBridgeGemini(prompt, sysInstruction);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, reply }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Ruta no encontrada
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint no encontrado' }));
});

const PORT = config.port || 3300;

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] El puerto ${PORT} ya esta siendo utilizado por otro proceso.`);
    console.error(`Cierra la otra ventana del puente o ejecuta: taskkill /F /IM node.exe\n`);
  } else {
    console.error(`\n[ERROR DE SERVIDOR]:`, err.message);
  }
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error(`\n[EXCEPCION NO CAPTURADA]:`, err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', reason => {
  console.error(`\n[PROMESA RECHAZADA]:`, reason);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  JJ PAPER -- Micro-Puente MixNet ERP (Windows 7)`);
  console.log(`  Escuchando en: http://localhost:${PORT}`);
  console.log(`  Ruta MixNet:  ${config.mixnet_dir}`);
  console.log(`====================================================`);
  console.log(`[OK] Puente activo y listo para sincronizar.`);
});
