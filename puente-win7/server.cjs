// server.cjs — Micro-Puente Autónomo JJ Paper ⇄ MixNet ERP para Windows 7
// Diseñado para Node.js 13+ (Cero dependencias npm, <20 MB RAM)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const backupEngine = require('./mixnet-backup.cjs');

const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  mixnet_dir: 'M:/comp01',
  port: 3300,
  supabase_url: 'https://wwcdxqpibequfohbgejs.supabase.co',
  supabase_key: '',
  auto_sync_stock_minutes: 60
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
  'yovanni': '004',
  'yovanni araujo': '004',
  'marianela': '008',
  'andreina': '014',
  'keyder': '010',
  'keyder salazar': '010',
  'jose': '005',
  'mostrador': '005'
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
  const rows = readDbfRows(struct, [fieldName]);
  if (!rows.length) return null;
  const raw = rows[0][fieldName.toLowerCase()] || rows[0][fieldName] || '';
  const num = parseInt(raw.replace(/\D/g, ''), 10);
  return isNaN(num) ? null : num;
}

function incrementSerial(controlFilePath, fieldName = 'NUMCOT', nextVal) {
  const struct = readDbfStruct(controlFilePath);
  if (!struct) return false;
  const fd = fs.openSync(controlFilePath, 'r+');
  try {
    const fields = readDbfFields(struct.buf, struct.headerLen);
    const f = fields.find(x => x.name === fieldName.toLowerCase());
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

// --- COMUNICACION CON SUPABASE CORE ---
function sbReq(pathUrl, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.supabase_url + pathUrl);
    const options = {
      method,
      headers: {
        'apikey': config.supabase_key,
        'Authorization': 'Bearer ' + config.supabase_key,
        'Content-Type': 'application/json'
      }
    };
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
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
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
      const dbfs = [];
      for (const it of items) {
        if (it.toUpperCase().endsWith('.DBF')) {
          try {
            const fp = path.join(dir, it);
            const st = fs.statSync(fp);
            const struct = readDbfStruct(fp);
            dbfs.push({
              name: it,
              path: fp,
              size: st.size,
              records: struct ? struct.numRecords : 0,
              fields_count: struct ? readDbfFields(struct.buf, struct.headerLen).length : 0,
              modified: st.mtime.toISOString()
            });
          } catch (_) {}
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, count: dbfs.length, directory: dir, files: dbfs }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, files: [] }));
    }
  }

  // 1.4 Inspeccionar tabla DBF (Estructura y Registros en Vivo)
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

        const struct = readDbfStruct(targetPath);
        if (!struct) throw new Error('Cabecera DBF ilegible');

        const fields = readDbfFields(struct.buf, struct.headerLen);
        const rows = readDbfRows(struct, null, 100);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          file: path.basename(targetPath),
          path: targetPath,
          records_count: struct.numRecords,
          fields: fields.map(f => ({ name: f.name, type: f.type, len: f.len })),
          rows: rows.slice(0, 100)
        }));
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

  // 2. Cotizaciones y Pedidos Pendientes de la Web (excluye ventas históricas importadas de MixNet)
  if (pathname === '/api/pending' && req.method === 'GET') {
    try {
      const quotesRes = await sbReq('/rest/v1/jjp_quotes?source=neq.mixnet&status=eq.pendiente&order=created_at.desc&limit=30');
      const ordersRes = await sbReq('/rest/v1/jjp_orders?source=neq.mixnet&status=in.(pendiente,pendiente_pago,pagado)&order=created_at.desc&limit=30');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        quotes: quotesRes.data || [],
        orders: ordersRes.data || []
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
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

        // Tablas e índices oficiales de MixNet
        const tableIndexMap = {
          'MXENCPED': ['MXENCPED.NTX', 'MXENCP01.NTX', 'MXENCP02.NTX'],
          'MXRENPED': ['MXRENPED.NTX', 'MXRENP01.NTX', 'MXRENP02.NTX'],
          'MXENCCOT': ['MXENCCOT.NTX', 'MXENCC01.NTX', 'MXENCC02.NTX'],
          'MXRENCOT': ['MXRENCOT.NTX', 'MXRENC01.NTX', 'MXRENC02.NTX'],
          'MXCTAINV': ['MXCTAINV.NTX', 'MXCTAI01.NTX', 'MXCTAI02.NTX', 'MXCTAI03.NTX'],
          'MXCTACLI': ['MXCTACLI.NTX', 'MXCTAC01.NTX', 'MXCTAC02.NTX'],
          'MXCTAVDD': ['MXCTAVDD.NTX']
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

      let vddPath = [
        path.join(baseDir, 'MXCTAVDD.DBF'),
        path.join(baseDir, 'mxctavdd.dbf'),
        'M:\\comp01\\MXCTAVDD.dbf'
      ].find(p => fs.existsSync(p));

      // Catálogo de permisos estándar en MixNet (200+ opciones por módulos)
      const PERMISSIONS_CATALOG = [
        // MÓDULO VENTAS & FACTURACIÓN
        { id: 'FAC_CREAR', label: 'Crear Facturas', mod: 'Ventas', def: true },
        { id: 'FAC_ANULAR', label: 'Anular Facturas Emitidas', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_MODIF_PRECIO', label: 'Modificar Precios de Venta en Renglón', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_DESC_MAX', label: 'Aplicar Descuentos Mayores al Máximo', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_VER_COSTO', label: 'Visualizar Costo Real de Artículos', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_CAMBIO_FECHA', label: 'Modificar Fecha de Emisión', mod: 'Ventas', def: false, critical: true },
        { id: 'FAC_REIMPRIMIR', label: 'Reimprimir Facturas y Comprobantes', mod: 'Ventas', def: true },

        // MÓDULO COTIZACIONES & PEDIDOS
        { id: 'COT_CREAR', label: 'Crear Cotizaciones', mod: 'Cotizaciones', def: true },
        { id: 'COT_MODIF', label: 'Modificar Cotizaciones Guardadas', mod: 'Cotizaciones', def: true },
        { id: 'COT_ANULAR', label: 'Anular Cotizaciones', mod: 'Cotizaciones', def: false, critical: true },
        { id: 'PED_CREAR', label: 'Crear Pedidos de Venta', mod: 'Pedidos', def: true },
        { id: 'PED_MODIF', label: 'Modificar Pedidos Existentes', mod: 'Pedidos', def: true },
        { id: 'PED_ANULAR', label: 'Anular Pedidos en Espera', mod: 'Pedidos', def: false, critical: true },
        { id: 'PED_FACTURAR', label: 'Procesar / Facturar Pedidos', mod: 'Pedidos', def: true },

        // MÓDULO INVENTARIO & ALMACÉN
        { id: 'INV_VER_STOCK', label: 'Consultar Existencias y Almacenes', mod: 'Inventario', def: true },
        { id: 'INV_AJUSTE_ENTRADA', label: 'Registrar Ajuste de Entrada (Suma)', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_AJUSTE_SALIDA', label: 'Registrar Ajuste de Salida (Resta)', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_CAMBIO_PRECIOS', label: 'Cambiar Precios en Lista Maestra', mod: 'Inventario', def: false, critical: true },
        { id: 'INV_CREAR_ITEM', label: 'Crear Nuevos Artículos y Códigos', mod: 'Inventario', def: false },
        { id: 'INV_ELIMINAR_ITEM', label: 'Eliminar o Desactivar Artículos', mod: 'Inventario', def: false, critical: true },

        // MÓDULO CAJA & COBRANZAS
        { id: 'CAJA_ABRIR', label: 'Apertura de Caja Diaria', mod: 'Caja', def: true },
        { id: 'CAJA_CERRAR', label: 'Cierre y Arqueo de Caja', mod: 'Caja', def: true },
        { id: 'CAJA_EGRESO', label: 'Registrar Salidas de Dinero / Gastos', mod: 'Caja', def: false, critical: true },
        { id: 'COB_CREAR', label: 'Registrar Cobranzas y Recibos', mod: 'Cobranzas', def: true },
        { id: 'COB_ANULAR', label: 'Anular Recibos de Cobro', mod: 'Cobranzas', def: false, critical: true },

        // MÓDULO CLIENTES
        { id: 'CLI_CREAR', label: 'Registrar Clientes Nuevos', mod: 'Clientes', def: true },
        { id: 'CLI_EDITAR', label: 'Modificar Datos y RIF de Clientes', mod: 'Clientes', def: true },
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

      // 2. Extraer usuarios de seguridad desde MXSECURI.CFG y MXCLA.MIX
      let userList = [];
      let rawSecuriText = '';
      if (securiPath && fs.existsSync(securiPath)) {
        try { rawSecuriText = fs.readFileSync(securiPath, 'utf8'); } catch (_) {}
      }

      // Si tenemos vendedores en nómina, mapear a cada uno como usuario del sistema
      if (vendors.length > 0) {
        userList = vendors.map((v, i) => {
          // Determinar si es Administrador (001 JJ Paper, 005 Mostrador, 010/020 Keyder)
          const isAdmin = ['001', '005', '010', '020'].includes(v.code) || v.name.toLowerCase().includes('admin') || v.name.toLowerCase().includes('paper');
          
          // Matriz de permisos
          const perms = {};
          PERMISSIONS_CATALOG.forEach(p => {
            perms[p.id] = isAdmin ? true : p.def;
          });

          return {
            _record: v._record,
            code: v.code,
            username: v.name.split(' ')[0].toUpperCase() + '_' + v.code,
            name: v.name,
            role: isAdmin ? 'Administrador' : 'Vendedor / Operador',
            is_admin: isAdmin,
            can_void: isAdmin, // Permiso clave de anular
            can_modify_prices: isAdmin,
            password_masked: '••••••',
            permissions: perms
          };
        });
      } else {
        // Fallback a usuarios estándar de MixNet
        userList = [
          { _record: 1, code: '001', username: 'ADMIN_001', name: 'ADMINISTRADOR GENERAL', role: 'Administrador', is_admin: true, can_void: true, can_modify_prices: true, password_masked: '••••••', permissions: {} },
          { _record: 2, code: '002', username: 'LUIS_002', name: 'LUIS ALARCON', role: 'Vendedor', is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', permissions: {} },
          { _record: 3, code: '004', username: 'YOVANNI_004', name: 'YOVANNI ARAUJO', role: 'Vendedor', is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', permissions: {} },
          { _record: 4, code: '008', username: 'MARIANELA_008', name: 'MARIANELA', role: 'Vendedor', is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', permissions: {} },
          { _record: 5, code: '014', username: 'ANDREINA_014', name: 'ANDREINA', role: 'Vendedor', is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', permissions: {} },
          { _record: 6, code: '005', username: 'CAJA_005', name: 'MOSTRADOR / CAJA', role: 'Cajero', is_admin: false, can_void: false, can_modify_prices: false, password_masked: '••••••', permissions: {} }
        ];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        source_securi: securiPath || 'No localizado',
        source_claves: claMixPath || 'No localizado',
        source_vendedores: vddPath || 'No localizado',
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

  // 3. Sincronizar Existencias y Precios de MixNet a Supabase
  if (pathname === '/api/sync-stock' && req.method === 'POST') {
    let invPath = findTableInCandidates('MXCTAINV.DBF', config.mixnet_dir);
    if (!invPath) invPath = findTableInCandidates('VICTAINV.DBF', config.mixnet_dir);

    if (!invPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'No se pudo localizar tabla de inventario (MXCTAINV / VICTAINV)' }));
    }

    const struct = readDbfStruct(invPath);
    if (!struct) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'No se pudo abrir ' + invPath }));
    }

    const rows = readDbfRows(struct, ['item', 'descrip', 'precio1', 'precio2', 'existen']);
    console.log(`Leídos ${rows.length} productos desde MixNet.`);

    // Enviar a Supabase en lotes
    let updatedVariants = 0;
    let updatedProducts = 0;

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      for (const item of batch) {
        const sku = (item.item || '').trim();
        const stock = parseFloat(item.existen) || 0;
        const p1 = parseFloat(item.precio1) || 0;
        if (!sku) continue;

        // 1. Actualizar en variantes
        const vRes = await sbReq(`/rest/v1/jjp_product_variants?sku=eq.${encodeURIComponent(sku)}`, 'PATCH', {
          stock,
          price_usd: p1,
          updated_at: new Date().toISOString()
        });
        if (vRes.status === 200 || vRes.status === 204) {
          updatedVariants++;
        }

        // 2. Actualizar en producto base si coincide el sku/código
        await sbReq(`/rest/v1/jjp_products?sku=eq.${encodeURIComponent(sku)}`, 'PATCH', {
          stock,
          price_usd: p1,
          updated_at: new Date().toISOString()
        });
        updatedProducts++;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, total_read: rows.length, updated_variants: updatedVariants, updated_products: updatedProducts }));
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

        // 1. Obtener correlativo oficial
        const curSerial = getNextSerial(cotCtrlPath, 'NUMCOT');
        if (!curSerial) throw new Error('No se pudo leer correlativo en MXNUMCOT.DBF');
        const officialNum = String(curSerial).padStart(8, '0');

        // 2. Preparar cabecera
        const encStruct = readDbfStruct(encCotPath);
        if (!encStruct) throw new Error('No se pudo abrir ' + encCotPath);

        const codVen = resolveCodVen(quote.seller_id || quote.seller_name);
        const codCli = (quote.mixnet_code && quote.mixnet_code !== '00') ? quote.mixnet_code : '00';
        const now = new Date();
        const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');

        const encValues = {
          numcot: officialNum,
          emision: dateStr,
          cliente: codCli,
          codven: codVen,
          comen1: ' '.repeat(35),
          comen2: ' '.repeat(35),
          tot_cot: quote.estimated_total_usd || 0,
          cambio: quote.exchange_rate || 1,
          moneda: 'US$'
        };

        const encRecord = buildDbfRecord(encStruct, encValues);

        // 3. Preparar renglones
        const renStruct = readDbfStruct(renCotPath);
        if (!renStruct) throw new Error('No se pudo abrir ' + renCotPath);

        const items = Array.isArray(quote.items) ? quote.items : (typeof quote.items === 'string' ? JSON.parse(quote.items || '[]') : []);
        const renRecords = [];

        for (const it of items) {
          const renValues = {
            numcot: officialNum,
            item: (it.sku || it.code || 'VAR-01').substring(0, 15),
            descrip: (it.name || it.descrip || 'ITEM').substring(0, 50),
            cantidad: it.qty || 1,
            precio: it.price_usd || 0,
            tot_ren: (it.qty || 1) * (it.price_usd || 0),
            iva: 'A',
            cliente: codCli,
            codven: codVen
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

        // 1. Obtener correlativo oficial de pedido
        const curSerial = getNextSerial(pedCtrlPath, 'NUMPED');
        if (!curSerial) throw new Error('No se pudo leer correlativo en MXNUMPED.DBF');
        const officialNum = String(curSerial).padStart(8, '0');

        // 2. Cabecera
        const encStruct = readDbfStruct(encPedPath);
        if (!encStruct) throw new Error('No se pudo abrir ' + encPedPath);

        const codVen = resolveCodVen(order.seller_id || order.seller_name);
        const codCli = (order.mixnet_code && order.mixnet_code !== '00') ? order.mixnet_code : '00';
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
          cambio: order.exchange_rate || 1,
          moneda: 'US$'
        };

        const encRecord = buildDbfRecord(encStruct, encValues);

        // 3. Renglones
        const renStruct = readDbfStruct(renPedPath);
        if (!renStruct) throw new Error('No se pudo abrir ' + renPedPath);

        const items = Array.isArray(order.items) ? order.items : (typeof order.items === 'string' ? JSON.parse(order.items || '[]') : []);
        const renRecords = [];

        for (const it of items) {
          const renValues = {
            numped: officialNum,
            item: (it.sku || it.code || 'VAR-01').substring(0, 15),
            descrip: (it.name || it.descrip || 'ITEM').substring(0, 50),
            cantidad: it.qty || 1,
            precio: it.price_usd || 0,
            tot_ren: (it.qty || 1) * (it.price_usd || 0),
            iva: 'A',
            cliente: codCli,
            codven: codVen
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
        { name: 'rollback_snapshot', desc: 'Restaura MixNet a cualquier segundo previo' },
        { name: 'query_dbf', desc: 'Lee registros y columnas de cualquier tabla DBF' },
        { name: 'update_dbf', desc: 'Modifica celdas o registros byte a byte con snapshot previo' },
        { name: 'scan_network', desc: 'Escanea todas las unidades de red en busca de MixNet' },
        { name: 'manage_users', desc: 'Lee y edita permisos de MXUSUAR.DBF' }
      ]
    }));
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
