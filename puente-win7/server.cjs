// server.cjs — Micro-Puente Autónomo JJ Paper ⇄ MixNet ERP para Windows 7
// Diseñado para Node.js 13+ (Cero dependencias npm, <20 MB RAM)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

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
  if (b.length >= len) return b.subarray(0, len);
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
    const mixDir = config.mixnet_dir;
    const connected = fs.existsSync(path.join(mixDir, 'MXCTAINV.DBF'));
    let curCot = null;
    let curPed = null;

    if (connected) {
      curCot = getNextSerial(path.join(mixDir, 'MXNUMCOT.DBF'), 'NUMCOT');
      curPed = getNextSerial(path.join(mixDir, 'MXNUMPED.DBF'), 'NUMPED');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      mixnet_dir: mixDir,
      connected,
      cur_cotizacion: curCot ? String(curCot).padStart(8, '0') : null,
      cur_pedido: curPed ? String(curPed).padStart(8, '0') : null,
      timestamp: new Date().toISOString()
    }));
  }

  // 2. Cotizaciones y Pedidos Pendientes de la Web
  if (pathname === '/api/pending' && req.method === 'GET') {
    try {
      const quotesRes = await sbReq('/rest/v1/jjp_quotes?status=neq.convertido&status=neq.cancelado&order=id.desc&limit=25');
      const ordersRes = await sbReq('/rest/v1/jjp_orders?status=neq.anulado&order=id.desc&limit=25');
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

  // 3. Sincronizar Existencias y Precios de MixNet a Supabase
  if (pathname === '/api/sync-stock' && req.method === 'POST') {
    const invPath = path.join(config.mixnet_dir, 'MXCTAINV.DBF');
    const struct = readDbfStruct(invPath);
    if (!struct) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'No se pudo abrir MXCTAINV.DBF en ' + invPath }));
    }

    const rows = readDbfRows(struct, ['item', 'descrip', 'precio1', 'precio2', 'existen']);
    console.log(`Leídos ${rows.length} productos desde MixNet.`);

    // Enviar a Supabase en lotes de 100
    let updated = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      for (const item of batch) {
        const sku = (item.item || '').trim();
        const stock = parseFloat(item.existen) || 0;
        const p1 = parseFloat(item.precio1) || 0;
        if (!sku) continue;

        // Actualizar stock en variantes de Supabase
        await sbReq(`/rest/v1/jjp_product_variants?sku=eq.${encodeURIComponent(sku)}`, 'PATCH', {
          stock,
          price_usd: p1,
          updated_at: new Date().toISOString()
        });
        updated++;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, total_read: rows.length, updated }));
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

  // Ruta no encontrada
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint no encontrado' }));
});

const PORT = config.port || 3300;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  JJ PAPER — Micro-Puente MixNet ERP (Windows 7)`);
  console.log(`  Escuchando en: http://localhost:${PORT}`);
  console.log(`  Ruta MixNet:  ${config.mixnet_dir}`);
  console.log(`====================================================`);
});
