/* ==========================================================================
   JJ PAPER — ANTIGRAVITY WIN-7 STORE NODE & COPILOTO MIXNET ERP
   ==========================================================================
   - 100% Nativo: Compatible estricto con Node.js 13+ y Windows 7 / 10 / 11.
   - Sincronización DBF Nítida: Lectura y Escritura Directa en M:\comp01.
   - Sincronización Cloud: PostgREST Supabase Core en tiempo real.
   - Nómina Sagrada: Códigos 002, 004/006, 008, 014, 010/020, 005.
   - Copiloto Gemini AI con balanceo en 7 llaves seguras.
   ========================================================================== */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');
var url = require('url');
var exec = require('child_process').exec;

// Llave de Servicio Maestra para Supabase Core (wwcdxqpibequfohbgejs)
var DEFAULT_SB_CORE_KEY = Buffer.from('ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5kM1kyUjRjWEJwWW1WeGRXWnZhR0puWldweklpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGM1TURjek1EQTNOQ3dpWlhod0lqb3lNVEEyTXpBMk1EYzBmUS5GaFFqdjVBeTZQRjZDbEw0amx3Vl85a1lpX1huS2plekFROEw2cEQwNHpn', 'base64').toString('utf8');

// Configuración general
var config = {
  port: 3300,
  mixnet_candidates: [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\MIX11\\comp01',
    'P:\\comp01',
    'P:\\MIX11\\comp01',
    'Z:\\comp01',
    'C:\\MIXNET\\comp01',
    'C:\\comp01',
    'C:\\pedidos'
  ],
  laptop_urls: ['http://192.168.1.11:8080', 'http://192.168.1.11:8787'],
  supabase: {
    core_url: 'https://wwcdxqpibequfohbgejs.supabase.co',
    core_key: DEFAULT_SB_CORE_KEY,
    comm_url: 'https://klcibjwleiqppedefpxw.supabase.co',
    comm_key: ''
  },
  gemini_models: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'],
  vendedores: {
    '002': { nombre: 'Luis Alarcón', rol: 'Ventas Mayor / Calle', uuid: 'e6957754-de00-4088-8e54-affcaa172247' },
    '004': { nombre: 'Yovanni Araujo', rol: 'Ventas Institucionales', uuid: '07540d9c-4ed9-46d2-95ce-0a0200be6083' },
    '006': { nombre: 'Yovanni Araujo', rol: 'Ventas Institucionales', uuid: '07540d9c-4ed9-46d2-95ce-0a0200be6083' },
    '008': { nombre: 'Marianela', rol: 'Ventas / Cartera', uuid: '3c9b7ddd-4b98-45c6-a646-5c557a2bc043' },
    '014': { nombre: 'Andreina', rol: 'Ventas / Cartera', uuid: '68c29cd3-760a-4282-8214-4e7c60413ec5' },
    '010': { nombre: 'Keyder Salazar', rol: 'Zona 010 (Admin / Cartera)', uuid: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164' },
    '020': { nombre: 'Keyder Salazar', rol: 'Zona 020 (MixNet Admin)', uuid: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164' },
    '005': { nombre: 'Caja Mostrador', rol: 'Mostrador Físico / Tienda', uuid: null },
    '001': { nombre: 'Mary Garcia', rol: 'Ventas Mostrador', uuid: '86b0ef8b-a41b-4385-a8f9-314a5052cb94' },
    '025': { nombre: 'Ana Barajas', rol: 'Ventas', uuid: '7eeb41f2-55e1-4e5e-b6c2-3da87582b51b' },
    '032': { nombre: 'Caja 32', rol: 'Caja Auxiliar', uuid: '9201071b-ab77-4de3-90a4-a79c93c4213c' },
    '033': { nombre: 'Caja 33', rol: 'Caja Auxiliar', uuid: '485e3fde-f95d-4857-9175-147051a54748' }
  },
  accesos_sistema: {}
};

// Cargar configuración local si existe
var configCandidatePaths = [
  path.join(__dirname, 'config-puente.json'),
  path.join(__dirname, 'config.json'),
  path.join(__dirname, '..', 'config-puente.json')
];

for (var ci = 0; ci < configCandidatePaths.length; ci++) {
  var cPath = configCandidatePaths[ci];
  try {
    if (fs.existsSync(cPath)) {
      var rawCfg = JSON.parse(fs.readFileSync(cPath, 'utf8'));
      if (rawCfg.supabase_key) config.supabase.core_key = rawCfg.supabase_key;
      if (rawCfg.supabase_url) config.supabase.core_url = rawCfg.supabase_url;
      for (var ck in rawCfg) {
        if (rawCfg.hasOwnProperty(ck)) config[ck] = rawCfg[ck];
      }
      console.log('[CONFIG] Cargada configuración desde: ' + cPath);
      break;
    }
  } catch (e) {
    console.error('[CONFIG] Error leyendo ' + cPath + ':', e.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   1. GEMINI AI: POOL BALANCEADO (7 LLAVES BASE64 SEGURAS)
   ══════════════════════════════════════════════════════════════════════════ */
function decodeKey(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

var DEFAULT_KEY_TOKENS = [
  'QUl6YVN5QU1uYl9TdGpGR3ltSnR2eXRid1JJNEVXWmsxWkw2LUt3',
  'QVEuQWI4Uk42TE9GdDRnYS1HUElrZFZjRHlhX0wyRFNTcmZxV1R5UEszUVN6TTFlNXBWZlE=',
  'QUl6YVN5QUJLNGVhblhpb0Uxa0ptUk1oSjE0QXFvc1NOSjVjel9F',
  'QVEuQWI4Uk42STNuaFd4MWY1NG41cmNMYTFuSnYyMzhOLUlxSm9JUldsalVqWm1nM25sLVE=',
  'QVEuQWI4Uk42SXNTV2pFOW1ISzlJUmpOeWF1cWdNTEhMV0xDSm53aUVIVTdVbzZzQzBjTkE=',
  'QVEuQWI4Uk42SzdEQjItWXFrWm1hM2pzVjhFZkNxSGVsMFVuUjA3b1ktcjhxcXV4Z0tUc0E=',
  'QVEuQWI4Uk42TDBQUzRYb2ZFTzhYOWxic0U4UDFzWUQ2anFJdHpDUnZiMFFiWDFLdmRFT3c='
];

var activeKeys = DEFAULT_KEY_TOKENS.map(decodeKey);
var keyIndex = 0;

function getNextGeminiKey() {
  var k = activeKeys[keyIndex];
  keyIndex = (keyIndex + 1) % activeKeys.length;
  return k;
}

function callGemini(systemPrompt, userPrompt, callback) {
  var models = config.gemini_models;
  var modelIdx = 0;
  var attempts = 0;
  var maxAttempts = activeKeys.length * 2;

  function attemptCall() {
    if (attempts >= maxAttempts) {
      return callback(new Error('Se agotaron los reintentos en el pool de Gemini.'));
    }
    attempts++;

    var currentModel = models[modelIdx % models.length];
    var currentKey = getNextGeminiKey();

    var postData = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.25, maxOutputTokens: 2500 }
    });

    var options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: '/v1beta/models/' + currentModel + ':generateContent?key=' + currentKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 9000
    };

    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        if (res.statusCode === 200) {
          try {
            var parsed = JSON.parse(body);
            var reply = parsed.candidates[0].content.parts[0].text;
            return callback(null, { text: reply, model: currentModel });
          } catch (e) {
            modelIdx++;
            return attemptCall();
          }
        } else {
          modelIdx++;
          return attemptCall();
        }
      });
    });

    req.on('error', function() { modelIdx++; attemptCall(); });
    req.on('timeout', function() { req.destroy(); modelIdx++; attemptCall(); });
    req.write(postData);
    req.end();
  }

  attemptCall();
}

/* ══════════════════════════════════════════════════════════════════════════
   2. MOTOR UNIVERSAL DBF (dBase III / Clipper) - LECTURA Y ESCRITURA NATIVA
   ══════════════════════════════════════════════════════════════════════════ */
var CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178', 0xA0:' ',     0xA7:'\u00A7'
};

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128) s += String.fromCharCode(b);
    else if (b >= 0xA0) s += String.fromCharCode(b);
    else s += (CP1252[b] || '');
  }
  return s.trim();
}

function latin1Pad(str, len) {
  var b = Buffer.from(String(str || ''), 'latin1');
  if (b.length >= len) return b.slice(0, len);
  var out = Buffer.alloc(len, 0x20);
  b.copy(out, 0);
  return out;
}

function encodeField(f, value) {
  var str = (value === null || value === undefined) ? '' : String(value).trim();
  switch (f.type) {
    case 'D': // YYYYMMDD
      str = str.replace(/[-/.]/g, '');
      if (!/^\d{8}$/.test(str)) str = '';
      return latin1Pad(str, f.len);
    case 'L':
      str = /^(t|y|true|1)$/i.test(str) ? 'T' : (/^(f|n|false|0)$/i.test(str) ? 'F' : '?');
      return latin1Pad(str, f.len);
    case 'N': {
      var num = parseFloat(str.replace(/[^\d.,\-]/g, '').replace(/,/g, '.')) || 0;
      var dec = f.dec || 0;
      var formatted = dec > 0 ? num.toFixed(dec) : String(Math.round(num));
      if (formatted.length > f.len) return latin1Pad('*', f.len);
      var padded = formatted;
      while (padded.length < f.len) padded = ' ' + padded;
      return latin1Pad(padded, f.len);
    }
    default:
      str = str.replace(/\s+/g, ' ').trim();
      return latin1Pad(str, f.len);
  }
}

function readDbfStructure(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var fd = fs.openSync(filePath, 'r');
    var headerBuf = Buffer.alloc(32);
    fs.readSync(fd, headerBuf, 0, 32, 0);

    var numRecords = headerBuf.readUInt32LE(4);
    var headerLen  = headerBuf.readUInt16LE(8);
    var recordLen  = headerBuf.readUInt16LE(10);

    if (headerLen < 33 || recordLen < 1) {
      fs.closeSync(fd);
      return null;
    }

    var fullHeader = Buffer.alloc(headerLen);
    fs.readSync(fd, fullHeader, 0, headerLen, 0);
    fs.closeSync(fd);

    var fields = [];
    var off = 32;
    var posInRec = 1;
    while (off + 32 <= headerLen - 1 && fullHeader[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = fullHeader[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (clean.length > 0) {
        var fLen = fullHeader[off + 16] || fullHeader.readUInt16LE(off + 16);
        fields.push({
          name: clean,
          rawName: rawName.trim(),
          type: String.fromCharCode(fullHeader[off + 11]),
          len:  fLen,
          dec:  fullHeader[off + 17] || 0,
          pos:  posInRec
        });
        posInRec += fLen;
      }
      off += 32;
    }

    var st = fs.statSync(filePath);
    return {
      path: filePath,
      fileName: path.basename(filePath).toUpperCase(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      size: st.size,
      mtime: st.mtime,
      fields: fields,
      fieldNames: fields.map(function(f) { return f.name; })
    };
  } catch (e) {
    return null;
  }
}

function readDbfRows(struct, maxLimit, filterFn) {
  if (!struct || !struct.path) return [];
  var limit = maxLimit || 50000;
  var rows = [];
  try {
    var fd = fs.openSync(struct.path, 'r');
    var recBuf = Buffer.alloc(struct.recordLen);
    var total = struct.numRecords;

    var startIdx = 0;
    if (total > limit) {
      startIdx = Math.max(0, total - limit);
    }

    for (var r = startIdx; r < total; r++) {
      var pos = struct.headerLen + (r * struct.recordLen);
      var n = fs.readSync(fd, recBuf, 0, struct.recordLen, pos);
      if (n < struct.recordLen) break;

      var flag = recBuf[0];
      if (flag === 0x20) { // Registro válido activo
        var row = {};
        for (var fi = 0; fi < struct.fields.length; fi++) {
          var f = struct.fields[fi];
          row[f.name] = decodeStr(recBuf, f.pos, f.len);
        }

        if (!filterFn || filterFn(row)) {
          rows.push(row);
        }
      }
    }
    fs.closeSync(fd);
  } catch (e) {}
  return rows;
}

function buildDbfRecord(struct, valuesByField) {
  var record = Buffer.alloc(struct.recordLen, 0x20);
  record[0] = 0x20; // 0x20 = registro activo
  for (var i = 0; i < struct.fields.length; i++) {
    var f = struct.fields[i];
    var v = valuesByField[f.name];
    if (v !== undefined) {
      var enc = encodeField(f, v);
      enc.copy(record, f.pos);
    }
  }
  return record;
}

function appendDbfRecords(filePath, recordBuffers) {
  if (!recordBuffers || recordBuffers.length === 0) return { ok: true, added: 0 };
  var struct = readDbfStructure(filePath);
  if (!struct) return { ok: false, error: 'Estructura DBF inválida: ' + filePath };

  try {
    var fd = fs.openSync(filePath, 'r+');
    var writePos = struct.headerLen + (struct.numRecords * struct.recordLen);
    var totalBytes = Buffer.concat(recordBuffers);

    // 1. Actualizar total de registros en la cabecera (offset 4)
    var newTotal = struct.numRecords + recordBuffers.length;
    var countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(newTotal, 0);
    fs.writeSync(fd, countBuf, 0, 4, 4);

    // 2. Escribir nuevos registros al final del archivo
    fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);

    // 3. Escribir byte EOF 0x1A estándar de dBase III
    var eofBuf = Buffer.from([0x1A]);
    fs.writeSync(fd, eofBuf, 0, 1, writePos + totalBytes.length);

    fs.closeSync(fd);
    return { ok: true, added: recordBuffers.length, newTotal: newTotal };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getNextDbfSerial(filePath, fieldName) {
  var struct = readDbfStructure(filePath);
  if (!struct) return '00000001';
  var max = 0;
  var rows = readDbfRows(struct, 5000);
  for (var i = 0; i < rows.length; i++) {
    var raw = String(rows[i][fieldName] || '0').replace(/\D/g, '');
    var v = parseInt(raw, 10);
    if (!isNaN(v) && v > max) max = v;
  }
  var next = max + 1;
  var s = String(next);
  while (s.length < 8) s = '0' + s;
  return s.slice(-8);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ESTADO GLOBAL EN MEMORIA Y SINCRONIZADOR
   ══════════════════════════════════════════════════════════════════════════ */
var store = {
  orders: [],
  quotes: [],
  customers: [],
  products: [],
  fx_rate: 0,
  cxc: { total: 0, count: 0, items: [] },
  cxp: { total: 0, count: 0, items: [] },
  proveedores: [],
  nomina: { total: 0, vendedores: [] },
  bancos: {
    total_bancos_bs: 0,
    total_bancos_usd: 0,
    total_cajas_bs: 0,
    total_cajas_usd: 0,
    cuentas: [],
    movimientos: [],
    cajas: [],
    movimientos_caja: [],
    cheques: []
  },
  last_sync: null,
  active_mixnet_dir: null,
  pedidos_dir: 'M:\\comp01',
  today_orders_count: 0,
  today_quotes_count: 0,
  cloud_status: { online: false, latency: null, last_beat: null },
  dropped_orders_count: 0,
  dropped_quotes_count: 0
};

var agentLogs = [];
function addAgentLog(tag, msg) {
  var tStr = new Date().toLocaleTimeString('es-VE', { hour12: false });
  var entry = { time: tStr, tag: tag, message: msg };
  agentLogs.push(entry);
  if (agentLogs.length > 300) agentLogs.shift();
  console.log('[' + tStr + '] [' + tag + '] ' + msg);
}

function safeExistsSync(p) {
  if (!p || p.indexOf('\\\\') === 0) return false;
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function detectMixnetDir() {
  for (var i = 0; i < config.mixnet_candidates.length; i++) {
    var cand = config.mixnet_candidates[i];
    try {
      if (safeExistsSync(cand)) {
        var testDbf = path.join(cand, 'MXCTAINV.DBF');
        var testDbf2 = path.join(cand, 'mxctainv.dbf');
        if (safeExistsSync(testDbf) || safeExistsSync(testDbf2)) {
          store.active_mixnet_dir = cand;
          store.pedidos_dir = cand;
          return cand;
        }
      }
    } catch (_) {}
  }
  return null;
}

function getActivePedidosDir() {
  var d = detectMixnetDir();
  if (d && safeExistsSync(d)) return d;
  if (safeExistsSync('M:\\comp01')) return 'M:\\comp01';
  if (safeExistsSync('C:\\comp01')) return 'C:\\comp01';
  var p = 'C:\\pedidos';
  if (!fs.existsSync(p)) {
    try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
  }
  return p;
}

// Mapeo Canónico de Vendedor MixNet (Nómina Sagrada JJ Paper)
function mapSeller(codven, sellerId) {
  var code = String(codven || '').trim();
  var sid = String(sellerId || '').toLowerCase();

  if (code === '002' || sid.indexOf('002') !== -1 || sid.indexOf('e6957754') !== -1) {
    return { code: '002', name: 'Luis Alarcón', uuid: 'e6957754-de00-4088-8e54-affcaa172247' };
  }
  if (code === '004' || code === '006' || sid.indexOf('004') !== -1 || sid.indexOf('006') !== -1 || sid.indexOf('07540d9c') !== -1) {
    return { code: '004', name: 'Yovanni Araujo', uuid: '07540d9c-4ed9-46d2-95ce-0a0200be6083' };
  }
  if (code === '008' || sid.indexOf('008') !== -1 || sid.indexOf('3c9b7ddd') !== -1) {
    return { code: '008', name: 'Marianela', uuid: '3c9b7ddd-4b98-45c6-a646-5c557a2bc043' };
  }
  if (code === '014' || sid.indexOf('014') !== -1 || sid.indexOf('68c29cd3') !== -1) {
    return { code: '014', name: 'Andreina', uuid: '68c29cd3-760a-4282-8214-4e7c60413ec5' };
  }
  if (code === '010' || code === '020' || sid.indexOf('010') !== -1 || sid.indexOf('020') !== -1 || sid.indexOf('bddc57dc') !== -1) {
    return { code: '010', name: 'Keyder Salazar', uuid: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164' };
  }
  if (code === '001' || sid.indexOf('001') !== -1 || sid.indexOf('86b0ef8b') !== -1) {
    return { code: '001', name: 'Mary Garcia', uuid: '86b0ef8b-a41b-4385-a8f9-314a5052cb94' };
  }
  if (code === '025' || sid.indexOf('025') !== -1 || sid.indexOf('7eeb41f2') !== -1) {
    return { code: '025', name: 'Ana Barajas', uuid: '7eeb41f2-55e1-4e5e-b6c2-3da87582b51b' };
  }
  return { code: '005', name: 'Caja Mostrador', uuid: null };
}

// Petición genérica HTTP/HTTPS compatible estricto con Node 13 y Windows 7
function fetchJSON(targetUrl, headers, timeoutMs, callback) {
  var isHttps = targetUrl.indexOf('https:') === 0;
  var parsed = url.parse(targetUrl);
  var mod = isHttps ? https : http;

  var opts = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    headers: headers || {},
    timeout: timeoutMs || 12000,
    rejectUnauthorized: false
  };
  if (isHttps) opts.servername = parsed.hostname;
  if (!opts.headers['User-Agent']) opts.headers['User-Agent'] = 'JJ-Paper-Win7-Agent/2.0';
  if (!opts.headers['Accept']) opts.headers['Accept'] = 'application/json';

  var called = false;
  function done(err, data) {
    if (called) return;
    called = true;
    callback(err, data);
  }

  var req = mod.get(opts, function(res) {
    var data = '';
    res.on('data', function(c) { data += c; });
    res.on('end', function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          return done(null, JSON.parse(data));
        } catch (e) {
          return done(e);
        }
      } else {
        return done(new Error('HTTP ' + res.statusCode));
      }
    });
  });

  req.on('error', function(err) { done(err); });
  req.on('timeout', function() { req.destroy(); done(new Error('Timeout (' + (timeoutMs || 12000) + 'ms)')); });
}

/* ══════════════════════════════════════════════════════════════════════════
   4. ESCRITURA EN DBF Y GENERACIÓN DE DESPACHO EN M:\comp01
   ══════════════════════════════════════════════════════════════════════════ */
function dropOrderFilesToMixnet(ord) {
  var targetDir = getActivePedidosDir();
  var num = ord.order_number || String(ord.id).slice(0, 8);
  var txtPath = path.join(targetDir, 'pedido_' + num + '.txt');
  var csvPath = path.join(targetDir, 'pedido_' + num + '.csv');

  if (ord.status === 'cancelado' || ord.status === 'rechazado') {
    if (fs.existsSync(txtPath)) try { fs.unlinkSync(txtPath); } catch (_) {}
    if (fs.existsSync(csvPath)) try { fs.unlinkSync(csvPath); } catch (_) {}
    return;
  }

  var items = Array.isArray(ord.items) ? ord.items : [];
  if (typeof ord.items === 'string') {
    try { items = JSON.parse(ord.items || '[]'); } catch (_) { items = []; }
  }

  var sellerInfo = mapSeller(ord.codven, ord.seller_id);

  var lines = [
    '================================================',
    'PEDIDO JJ PAPER TIENDA: #' + num,
    'Fecha: ' + (ord.created_at ? new Date(ord.created_at).toLocaleString('es-VE') : 'Hoy'),
    'Cliente: ' + (ord.client_name || 'MOSTRADOR / CAJA'),
    ord.rif ? 'RIF/CI:  ' + ord.rif : '',
    ord.phone ? 'Telefono: ' + ord.phone : '',
    'VENDEDOR MIXNET: ' + sellerInfo.code + ' (' + sellerInfo.name + ')',
    'Estado: ' + String(ord.status || 'PENDIENTE').toUpperCase(),
    '================================================',
    'Cant.   Producto                     P.Unit   Subtotal',
    '------------------------------------------------'
  ].filter(Boolean);

  var csvLines = ['Cant,Codigo,Descripcion,Precio_USD,Subtotal_USD'];

  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    var n = (it.name || it.sku || '').substring(0, 28);
    while (n.length < 28) n += ' ';
    var qty = String(it.qty || 1);
    while (qty.length < 4) qty = ' ' + qty;
    var pu = parseFloat(it.price_usd || 0).toFixed(2);
    while (pu.length < 7) pu = ' ' + pu;
    var sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2);
    while (sub.length < 8) sub = ' ' + sub;
    lines.push(qty + ' x ' + n + ' ' + pu + ' ' + sub);
    csvLines.push((it.qty || 1) + ',"' + (it.sku || '') + '","' + (it.name || '').replace(/"/g, '""') + '",' + (it.price_usd || 0) + ',' + (it.subtotal_usd || 0));
  }
  lines.push('------------------------------------------------');
  lines.push('TOTAL USD: $' + parseFloat(ord.total_usd || 0).toFixed(2));
  if (ord.exchange_rate) {
    lines.push('Tasa oficial: ' + parseFloat(ord.exchange_rate).toFixed(2) + ' Bs/$');
    lines.push('TOTAL BS:  ' + (parseFloat(ord.total_usd || 0) * parseFloat(ord.exchange_rate)).toFixed(2) + ' Bs');
  }
  lines.push('================================================');

  try {
    fs.writeFileSync(txtPath, lines.join('\r\n'), 'utf8');
    fs.writeFileSync(csvPath, csvLines.join('\r\n'), 'utf8');
    store.dropped_orders_count = (store.dropped_orders_count || 0) + 1;
  } catch (_) {}
}

function dropQuoteFilesToMixnet(q) {
  var targetDir = getActivePedidosDir();
  var num = q.quote_number || String(q.id).slice(0, 8);
  var txtPath = path.join(targetDir, 'cotizacion_' + num + '.txt');
  var csvPath = path.join(targetDir, 'cotizacion_' + num + '.csv');

  if (q.status === 'cancelado' || q.status === 'facturado') {
    if (fs.existsSync(txtPath)) try { fs.unlinkSync(txtPath); } catch (_) {}
    if (fs.existsSync(csvPath)) try { fs.unlinkSync(csvPath); } catch (_) {}
    return;
  }

  var items = Array.isArray(q.items) ? q.items : [];
  if (typeof q.items === 'string') {
    try { items = JSON.parse(q.items || '[]'); } catch (_) { items = []; }
  }

  var sellerInfo = mapSeller(q.codven, q.seller_id);

  var lines = [
    '================================================',
    'COTIZACION JJ PAPER: #' + num,
    'Fecha: ' + (q.created_at ? new Date(q.created_at).toLocaleString('es-VE') : 'Hoy'),
    'Cliente: ' + (q.client_name || 'MOSTRADOR / CAJA'),
    q.rif ? 'RIF/CI:  ' + q.rif : '',
    q.phone ? 'Telefono: ' + q.phone : '',
    'VENDEDOR MIXNET: ' + sellerInfo.code + ' (' + sellerInfo.name + ')',
    'Estado: ' + String(q.status || 'PENDIENTE').toUpperCase(),
    '================================================',
    'Cant.   Producto                     P.Unit   Subtotal',
    '------------------------------------------------'
  ].filter(Boolean);

  var csvLines = ['Cant,Codigo,Descripcion,Precio_USD,Subtotal_USD'];

  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    var n = (it.name || it.sku || '').substring(0, 28);
    while (n.length < 28) n += ' ';
    var qty = String(it.qty || 1);
    while (qty.length < 4) qty = ' ' + qty;
    var pu = parseFloat(it.price_usd || 0).toFixed(2);
    while (pu.length < 7) pu = ' ' + pu;
    var sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2);
    while (sub.length < 8) sub = ' ' + sub;
    lines.push(qty + ' x ' + n + ' ' + pu + ' ' + sub);
    csvLines.push((it.qty || 1) + ',"' + (it.sku || '') + '","' + (it.name || '').replace(/"/g, '""') + '",' + (it.price_usd || 0) + ',' + (it.subtotal_usd || 0));
  }
  lines.push('------------------------------------------------');
  lines.push('TOTAL ESTIMADO USD: $' + parseFloat(q.estimated_total_usd || q.total_usd || 0).toFixed(2));
  lines.push('================================================');

  try {
    fs.writeFileSync(txtPath, lines.join('\r\n'), 'utf8');
    fs.writeFileSync(csvPath, csvLines.join('\r\n'), 'utf8');
    store.dropped_quotes_count = (store.dropped_quotes_count || 0) + 1;
  } catch (_) {}
}

// Inyección nativa en tablas DBF de MixNet (MXENCPED / MXRENPED)
function writeOrderDirectToMixnetDbf(ord, callback) {
  var dir = store.active_mixnet_dir || detectMixnetDir();
  if (!dir) return callback(new Error('Directorio de MixNet no detectado en esta PC.'));

  var encPath = path.join(dir, 'MXENCPED.DBF');
  var detPath = path.join(dir, 'MXRENPED.DBF');

  if (!fs.existsSync(encPath) || !fs.existsSync(detPath)) {
    return callback(new Error('Tablas MXENCPED.DBF o MXRENPED.DBF no encontradas en ' + dir));
  }

  var encStruct = readDbfStructure(encPath);
  var detStruct = readDbfStructure(detPath);
  if (!encStruct || !detStruct) {
    return callback(new Error('Estructura DBF corrupta en ' + dir));
  }

  // Generar o usar número de pedido
  var numPed = ord.order_number ? String(ord.order_number).replace(/\D/g, '') : '';
  if (!numPed || numPed.length < 4) {
    numPed = getNextDbfSerial(encPath, 'numped');
  }
  while (numPed.length < 8) numPed = '0' + numPed;
  numPed = numPed.slice(-8);

  var now = new Date();
  var ymd = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  var sellerInfo = mapSeller(ord.codven, ord.seller_id);
  var totUsd = parseFloat(ord.total_usd || 0).toFixed(2);
  var rate = parseFloat(ord.exchange_rate || store.fx_rate || 0).toFixed(2);

  // Registro Encabezado
  var encRec = buildDbfRecord(encStruct, {
    numped: numPed,
    emision: ymd,
    cliente: String(ord.client_code || ord.cliente || '00-000').slice(0, 10),
    codven: sellerInfo.code,
    comen1: String(ord.notes || '').slice(0, 40),
    comen2: '',
    transp: '',
    estatus: 'PE',
    entrega: ymd,
    tot_ped: totUsd,
    moneda: 'US$',
    cambio: rate
  });

  // Registros de Detalle
  var items = Array.isArray(ord.items) ? ord.items : [];
  var detRecs = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var pu = parseFloat(it.price_usd || 0).toFixed(2);
    var qty = parseFloat(it.qty || 1);
    var totRen = parseFloat(it.subtotal_usd || (qty * parseFloat(pu))).toFixed(2);
    detRecs.push(buildDbfRecord(detStruct, {
      item: String(it.sku || it.name || '').slice(0, 15),
      unidad: String(it.unit || 'UND').slice(0, 3).toUpperCase(),
      cantidad: qty.toFixed(3),
      descrip: String(it.name || '').slice(0, 50),
      numped: numPed,
      emision: ymd,
      estatus: 'PE',
      precio: pu,
      tot_ren: totRen,
      iva: 'A',
      cliente: String(ord.client_code || ord.cliente || '00-000').slice(0, 10),
      codven: sellerInfo.code
    }));
  }

  // Escribir registros
  var encRes = appendDbfRecords(encPath, [encRec]);
  if (!encRes.ok) return callback(new Error('Error en MXENCPED: ' + encRes.error));

  if (detRecs.length > 0) {
    var detRes = appendDbfRecords(detPath, detRecs);
    if (!detRes.ok) console.warn('[DBF WARN] Error en MXRENPED:', detRes.error);
  }

  // Generar archivos TXT y CSV en MixNet
  ord.order_number = numPed;
  dropOrderFilesToMixnet(ord);

  addAgentLog('MIXNET', '✅ Pedido #' + numPed + ' escrito nativamente en ' + encPath + ' (' + sellerInfo.name + ')');
  callback(null, { ok: true, order_number: numPed, items_count: detRecs.length });
}

/* ══════════════════════════════════════════════════════════════════════════
   5. LECTURA Y SINCRONIZACIÓN DE PEDIDOS Y COTIZACIONES MIXNET ➔ NUBE
   ══════════════════════════════════════════════════════════════════════════ */
function syncMixnetOrdersAndQuotesFromDbf() {
  var dir = store.active_mixnet_dir || detectMixnetDir();
  if (!dir) return;

  var encPedPath = path.join(dir, 'MXENCPED.DBF');
  var detPedPath = path.join(dir, 'MXRENPED.DBF');
  var encCotPath = path.join(dir, 'MXENCCOT.DBF');
  var detCotPath = path.join(dir, 'MXRENCOT.DBF');
  var cliPath = path.join(dir, 'MXCTACLI.DBF');

  // Mapa de Clientes desde MXCTACLI
  var cliMap = {};
  if (fs.existsSync(cliPath)) {
    var stCli = readDbfStructure(cliPath);
    if (stCli) {
      readDbfRows(stCli, 10000).forEach(function(c) {
        var cod = (c.codcli || c.codigo || '').trim();
        if (cod) cliMap[cod] = c;
      });
    }
  }

  var now = new Date();
  var todayYmd = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  var todayOrders = 0;
  var todayQuotes = 0;

  // 1. LECTURA DE PEDIDOS (MXENCPED.DBF)
  if (fs.existsSync(encPedPath)) {
    var stEnc = readDbfStructure(encPedPath);
    if (stEnc && stEnc.numRecords > 0) {
      // Leer los últimos 300 pedidos
      var pedRows = readDbfRows(stEnc, 300);

      // Mapa de detalles MXRENPED indexado por numped
      var detPedMap = {};
      if (fs.existsSync(detPedPath)) {
        var stDet = readDbfStructure(detPedPath);
        if (stDet) {
          readDbfRows(stDet, 4000).forEach(function(dr) {
            var np = String(dr.numped || '').trim();
            if (np) {
              if (!detPedMap[np]) detPedMap[np] = [];
              detPedMap[np].push(dr);
            }
          });
        }
      }

      var parsedOrders = [];
      var existingOrderNums = {};
      store.orders.forEach(function(o) {
        if (o.order_number) existingOrderNums[String(o.order_number).trim()] = true;
      });

      for (var pi = 0; pi < pedRows.length; pi++) {
        var pr = pedRows[pi];
        var rawNum = String(pr.numped || pr.numero || pr.pedido || '').trim();
        if (!rawNum) continue;
        while (rawNum.length < 8) rawNum = '0' + rawNum;
        var numDoc = rawNum.slice(-8);

        var emisionStr = String(pr.emision || '').trim();
        if (emisionStr === todayYmd) todayOrders++;

        var cCode = String(pr.cliente || '').trim();
        var cliData = cliMap[cCode] || {};
        var cName = String(cliData.nomcli || pr.nomcli || pr.nombre || cCode || 'Cliente Mostrador').trim();
        var cRif = String(cliData.cif || cliData.rif || pr.cif || '').trim();
        var cPhone = String(cliData.telefono || cliData.tlf1 || pr.telefono || '').trim();

        var totUsd = parseFloat(String(pr.tot_ped || pr.total || 0).replace(/,/g, '.')) || 0;
        var sInfo = mapSeller(pr.codven, null);

        var rawItems = detPedMap[numDoc] || [];
        var items = rawItems.map(function(it) {
          var qty = parseFloat(String(it.cantidad || '1').replace(/,/g, '.')) || 1;
          var pu = parseFloat(String(it.precio || '0').replace(/,/g, '.')) || 0;
          return {
            sku: String(it.item || '').trim(),
            name: String(it.descrip || it.item || 'Artículo').trim(),
            qty: qty,
            price_usd: pu,
            subtotal_usd: parseFloat(String(it.tot_ren || (qty * pu)).replace(/,/g, '.')) || (qty * pu)
          };
        });

        if (items.length === 0 && totUsd > 0) {
          items.push({ sku: 'MIXNET', name: 'Consumo MixNet #' + numDoc, qty: 1, price_usd: totUsd, subtotal_usd: totUsd });
        }

        var orderObj = {
          order_number: numDoc,
          client_name: cName,
          client_code: cCode,
          rif: cRif || null,
          phone: cPhone || null,
          items: items,
          total_usd: totUsd,
          exchange_rate: parseFloat(pr.cambio || store.fx_rate || 0) || store.fx_rate,
          total_bs: store.fx_rate > 0 ? (totUsd * store.fx_rate) : 0,
          status: String(pr.estatus || 'PE').toUpperCase() === 'FA' ? 'facturado' : 'pendiente',
          seller_id: sInfo.uuid,
          seller_name: sInfo.name,
          codven: sInfo.code,
          source: 'mixnet',
          notes: String(pr.comen1 || '').trim() || null,
          created_at: (/^\d{8}$/.test(emisionStr))
            ? (emisionStr.slice(0, 4) + '-' + emisionStr.slice(4, 6) + '-' + emisionStr.slice(6, 8) + 'T12:00:00Z')
            : new Date().toISOString()
        };

        parsedOrders.push(orderObj);

        // Si es un pedido de MixNet no reportado a la nube, enviarlo por HTTPS
        if (!existingOrderNums[numDoc] && (emisionStr >= '20261001')) {
          uploadOrderToSupabase(orderObj);
          dropOrderFilesToMixnet(orderObj);
        }
      }

      if (parsedOrders.length > 0) {
        // Ordenar del más reciente al más antiguo
        parsedOrders.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
        store.orders = parsedOrders;
        store.today_orders_count = todayOrders;
        addAgentLog('MIXNET', '📦 ' + parsedOrders.length + ' pedidos sincronizados de MixNet (' + todayOrders + ' de hoy ' + todayYmd + ')');
      }
    }
  }

  // 2. LECTURA DE COTIZACIONES (MXENCCOT.DBF)
  if (fs.existsSync(encCotPath)) {
    var stCot = readDbfStructure(encCotPath);
    if (stCot && stCot.numRecords > 0) {
      var cotRows = readDbfRows(stCot, 200);

      var parsedQuotes = [];
      for (var qi = 0; qi < cotRows.length; qi++) {
        var qr = cotRows[qi];
        var rawCotNum = String(qr.numcot || qr.numero || '').trim();
        if (!rawCotNum) continue;
        while (rawCotNum.length < 8) rawCotNum = '0' + rawCotNum;
        var numCotDoc = rawCotNum.slice(-8);

        var qEmision = String(qr.emision || '').trim();
        if (qEmision === todayYmd) todayQuotes++;

        var qcCode = String(qr.cliente || '').trim();
        var qcliData = cliMap[qcCode] || {};
        var qName = String(qcliData.nomcli || qr.nomcli || qcCode || 'Cliente Mostrador').trim();
        var qTotUsd = parseFloat(String(qr.tot_cot || qr.total || 0).replace(/,/g, '.')) || 0;
        var qSeller = mapSeller(qr.codven, null);

        var quoteObj = {
          quote_number: numCotDoc,
          client_name: qName,
          client_code: qcCode,
          rif: qcliData.cif || null,
          phone: qcliData.telefono || null,
          items: [],
          estimated_total_usd: qTotUsd,
          exchange_rate: parseFloat(qr.cambio || store.fx_rate || 0) || store.fx_rate,
          status: 'pendiente',
          seller_id: qSeller.uuid,
          seller_name: qSeller.name,
          codven: qSeller.code,
          source: 'mixnet',
          notes: String(qr.comen1 || '').trim() || null,
          created_at: (/^\d{8}$/.test(qEmision))
            ? (qEmision.slice(0, 4) + '-' + qEmision.slice(4, 6) + '-' + qEmision.slice(6, 8) + 'T12:00:00Z')
            : new Date().toISOString()
        };

        parsedQuotes.push(quoteObj);
        dropQuoteFilesToMixnet(quoteObj);
      }

      if (parsedQuotes.length > 0) {
        parsedQuotes.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
        store.quotes = parsedQuotes;
        store.today_quotes_count = todayQuotes;
        addAgentLog('MIXNET', '📑 ' + parsedQuotes.length + ' cotizaciones sincronizadas de MixNet (' + todayQuotes + ' de hoy)');
      }
    }
  }
}

// Sube pedidos creados en tienda a Supabase Core
function uploadOrderToSupabase(o) {
  var baseUrl = (config.supabase && config.supabase.core_url) || 'https://wwcdxqpibequfohbgejs.supabase.co';
  var key = DEFAULT_SB_CORE_KEY;
  var parsed = url.parse(baseUrl);

  var payload = JSON.stringify([{
    order_number: o.order_number,
    client_name: o.client_name || 'CLIENTE MIXNET',
    rif: o.rif || null,
    phone: o.phone || null,
    items: o.items || [],
    subtotal_usd: o.total_usd || 0,
    total_usd: o.total_usd || 0,
    exchange_rate: o.exchange_rate || store.fx_rate || 0,
    total_bs: (o.total_usd && store.fx_rate) ? (o.total_usd * store.fx_rate).toFixed(2) : 0,
    payment_method: 'efectivo',
    notes: o.notes || null,
    status: o.status || 'pagado',
    seller_id: o.seller_id || null,
    source: 'mixnet',
    created_at: o.created_at,
    updated_at: o.created_at
  }]);

  var opts = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: '/rest/v1/jjp_orders?on_conflict=order_number',
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'JJ-Paper-Win7-Agent/2.0'
    },
    timeout: 8000,
    rejectUnauthorized: false
  };
  if (parsed.protocol === 'https:') opts.servername = parsed.hostname;

  var req = https.request(opts, function(res) {
    res.resume();
    if (res.statusCode >= 200 && res.statusCode < 300) {
      addAgentLog('CLOUD', '☁️ Pedido MixNet #' + o.order_number + ' respaldado en la nube exitosamente');
    }
  });
  req.on('error', function() {});
  req.write(payload);
  req.end();
}

/* ══════════════════════════════════════════════════════════════════════════
   6. SINCRONIZACIÓN CON SUPABASE CORE CLOUD (POSTGREST)
   ══════════════════════════════════════════════════════════════════════════ */
function syncFromSupabase(callback) {
  var baseUrl = (config.supabase && config.supabase.core_url) || 'https://wwcdxqpibequfohbgejs.supabase.co';
  var apiKey = (config.supabase && config.supabase.core_key && config.supabase.core_key.length > 50)
    ? config.supabase.core_key
    : DEFAULT_SB_CORE_KEY;

  var headers = {
    'apikey': apiKey,
    'Authorization': 'Bearer ' + apiKey,
    'User-Agent': 'JJ-Paper-Win7-Agent/2.0',
    'Accept': 'application/json'
  };

  var pending = 4;
  var successCount = 0;

  function onDatasetDone(name, ok, count) {
    if (ok) successCount++;
    pending--;
    if (pending <= 0) {
      if (successCount > 0) {
        store.cloud_status.online = true;
        store.cloud_status.last_sync = new Date().toISOString();
        store.last_sync = new Date().toISOString();
        addAgentLog('CLOUD', '🟢 Sincronización Supabase completada (' + successCount + '/4 datasets ok)');
      } else {
        store.cloud_status.online = false;
        addAgentLog('WARN', '🔴 Sin respuesta de Supabase Core');
      }
      if (callback) callback();
    }
  }

  // 1. Clientes (Hasta 1500)
  fetchJSON(baseUrl + '/rest/v1/jjp_customers?select=id,name,rif,phone,seller_id,city,address,total_orders,total_usd,zone&order=name.asc&limit=1500', headers, 12000, function(err, custs) {
    if (!err && Array.isArray(custs)) {
      store.customers = custs;
      onDatasetDone('customers', true, custs.length);
    } else {
      onDatasetDone('customers', false, 0);
    }
  });

  // 2. Catálogo y Productos (Hasta 1500)
  fetchJSON(baseUrl + '/rest/v1/jjp_products?select=id,name,sku,price_usd,price_b,cost_usd,stock,active&order=name.asc&limit=1500', headers, 12000, function(err2, prods) {
    if (!err2 && Array.isArray(prods)) {
      store.products = prods;
      onDatasetDone('products', true, prods.length);
    } else {
      onDatasetDone('products', false, 0);
    }
  });

  // 3. Tasa Oficial BCV
  fetchJSON(baseUrl + '/rest/v1/jjp_fx_rates?select=bcv&order=created_at.desc&limit=1', headers, 8000, function(err3, rates) {
    if (!err3 && Array.isArray(rates) && rates[0]) {
      store.fx_rate = parseFloat(rates[0].bcv) || 0;
      onDatasetDone('rates', true, 1);
    } else {
      onDatasetDone('rates', false, 0);
    }
  });

  // 4. Pedidos Cloud (select optimizado sin items gigantescos si timeout)
  fetchJSON(baseUrl + '/rest/v1/jjp_orders?select=id,order_number,client_name,rif,phone,total_usd,exchange_rate,total_bs,status,created_at,seller_id,source,notes&order=created_at.desc&limit=60', headers, 15000, function(err4, cloudOrders) {
    if (!err4 && Array.isArray(cloudOrders)) {
      // Combinar pedidos de la nube con pedidos locales de MixNet
      var orderMap = {};
      store.orders.forEach(function(o) { orderMap[o.order_number] = o; });
      cloudOrders.forEach(function(co) {
        if (!orderMap[co.order_number]) {
          var sInfo = mapSeller(null, co.seller_id);
          co.seller_name = sInfo.name;
          co.codven = sInfo.code;
          store.orders.push(co);
          dropOrderFilesToMixnet(co);
        }
      });
      store.orders.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      onDatasetDone('orders', true, cloudOrders.length);
    } else {
      onDatasetDone('orders', false, 0);
    }
  });
}

// Latido del Agente y Tareas Remotas
function sendHeartbeatAndCheckTasks(callback) {
  var baseUrl = (config.supabase && config.supabase.core_url) || 'https://wwcdxqpibequfohbgejs.supabase.co';
  var key = DEFAULT_SB_CORE_KEY;
  var parsed = url.parse(baseUrl);

  var payload = JSON.stringify({
    key: 'win7_agent_status',
    value: JSON.stringify({
      host: os.hostname(),
      lan_ip: getLanIp(),
      status: 'online',
      heartbeat_at: new Date().toISOString(),
      node_version: process.version,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      pedidos_dir: getActivePedidosDir(),
      active_mixnet_dir: store.active_mixnet_dir || 'M:\\comp01',
      orders_count: store.orders.length,
      today_orders_count: store.today_orders_count || 0,
      quotes_count: store.quotes.length,
      products_count: store.products.length,
      customers_count: store.customers.length,
      dropped_orders_count: store.dropped_orders_count || 0,
      last_sync: store.last_sync
    })
  });

  var opts = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: '/rest/v1/jjp_settings?on_conflict=key',
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'JJ-Paper-Win7-Agent/2.0'
    },
    timeout: 8000,
    rejectUnauthorized: false
  };
  if (parsed.protocol === 'https:') opts.servername = parsed.hostname;

  var req = https.request(opts, function(res) {
    res.resume();
    if (res.statusCode >= 200 && res.statusCode < 300) {
      store.cloud_status.online = true;
      store.cloud_status.last_beat = new Date().toISOString();
    }

    // Comprobar tareas remotas
    fetchJSON(baseUrl + '/rest/v1/jjp_settings?key=eq.win7_agent_task&select=*', {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    }, 4000, function(errTask, taskRows) {
      if (!errTask && Array.isArray(taskRows) && taskRows.length > 0) {
        try {
          var tObj = JSON.parse(taskRows[0].value || '{}');
          if (tObj && tObj.status === 'pending') {
            addAgentLog('TASK', '⚡ Tarea remota recibida: ' + (tObj.action || tObj.command));
            handleAgentAction(tObj.action || 'run_command', tObj.params || tObj, function(actErr, actRes) {
              var updatePayload = JSON.stringify({
                key: 'win7_agent_task',
                value: JSON.stringify({
                  task_id: tObj.task_id || Date.now(),
                  action: tObj.action || 'run_command',
                  status: actErr ? 'error' : 'completed',
                  result: actErr ? actErr.message : actRes,
                  completed_at: new Date().toISOString()
                })
              });
              var uOpts = {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: '/rest/v1/jjp_settings?on_conflict=key',
                method: 'POST',
                headers: {
                  'apikey': key,
                  'Authorization': 'Bearer ' + key,
                  'Content-Type': 'application/json',
                  'Prefer': 'resolution=merge-duplicates,return=minimal',
                  'Content-Length': Buffer.byteLength(updatePayload),
                  'User-Agent': 'JJ-Paper-Win7-Agent/2.0'
                },
                timeout: 5000,
                rejectUnauthorized: false
              };
              if (parsed.protocol === 'https:') uOpts.servername = parsed.hostname;
              var uReq = https.request(uOpts, function(uRes) { uRes.resume(); });
              uReq.on('error', function() {});
              uReq.write(updatePayload);
              uReq.end();
            });
          }
        } catch (_) {}
      }
      if (callback) callback();
    });
  });

  req.on('error', function() { if (callback) callback(); });
  req.on('timeout', function() { req.destroy(); if (callback) callback(); });
  req.write(payload);
  req.end();
}

// Barrido de Cuentas, Finanzas y Tablas de MixNet
function syncOtherLocalDbf() {
  var dir = store.active_mixnet_dir || detectMixnetDir();
  if (!dir) return;

  function findTable(name) {
    var up = path.join(dir, name.toUpperCase() + '.DBF');
    if (fs.existsSync(up)) return up;
    var low = path.join(dir, name.toLowerCase() + '.dbf');
    if (fs.existsSync(low)) return low;
    return null;
  }

  // Inventario DBF (si no se cargó de la nube)
  var invPath = findTable('MXCTAINV') || findTable('VICTAINV');
  if (invPath && store.products.length === 0) {
    var stInv = readDbfStructure(invPath);
    var rowsInv = readDbfRows(stInv, 4000);
    store.products = rowsInv.map(function(p) {
      return {
        id: p.item || p.codigo,
        sku: p.item || p.codigo,
        name: p.descrip || p.nombre,
        stock: parseFloat(p.existencia || p.actual || 0) || 0,
        cost_usd: parseFloat(p.costo || 0) || 0,
        price_usd: parseFloat(p.precio2 || p.precio_b || p.precio || 0) || 0,
        price_b: parseFloat(p.precio2 || p.precio_b || 0) || 0
      };
    });
  }

  // Bancos (MXCTABAN)
  var bcoPath = findTable('MXCTABAN');
  if (bcoPath && store.bancos.cuentas.length === 0) {
    var stBco = readDbfStructure(bcoPath);
    var bList = [];
    readDbfRows(stBco, 100).forEach(function(b) {
      bList.push({
        codigo: (b.codban || '').trim(),
        banco: (b.nomban || b.nombre || 'Banco ' + b.codban).trim(),
        cuenta: (b.numcta || '').trim(),
        titular: (b.titular || 'JJ PAPER, C.A.').trim(),
        saldo: parseFloat(b.saldo || 0) || 0,
        moneda: String(b.moneda || 'BS').toUpperCase().indexOf('US') !== -1 ? 'USD' : 'BS'
      });
    });
    store.bancos.cuentas = bList;
  }

  // Cajas (MXCTACAJ)
  var cajPath = findTable('MXCTACAJ');
  if (cajPath && store.bancos.cajas.length === 0) {
    var stCaj = readDbfStructure(cajPath);
    var cList = [];
    readDbfRows(stCaj, 50).forEach(function(c) {
      cList.push({
        codigo: (c.codcaj || '').trim(),
        nombre: (c.nomcaj || 'Caja ' + c.codcaj).trim(),
        saldo: parseFloat(c.saldo || 0) || 0,
        responsable: (c.respon || 'Caja').trim(),
        moneda: String(c.moneda || 'BS').toUpperCase().indexOf('US') !== -1 ? 'USD' : 'BS'
      });
    });
    store.bancos.cajas = cList;
  }
}

function fullSync(callback) {
  detectMixnetDir();
  syncMixnetOrdersAndQuotesFromDbf();
  syncOtherLocalDbf();
  syncFromSupabase(function() {
    sendHeartbeatAndCheckTasks(function() {
      if (callback) callback();
    });
  });
}

function testNetworkStability(callback) {
  var tStart = Date.now();
  var sbUrl = (config.supabase && config.supabase.core_url) || 'https://wwcdxqpibequfohbgejs.supabase.co';
  var parsed = url.parse(sbUrl);
  var req = https.request({
    hostname: parsed.hostname,
    servername: parsed.hostname,
    port: parsed.port || 443,
    path: '/rest/v1/',
    method: 'GET',
    headers: {
      'apikey': DEFAULT_SB_CORE_KEY,
      'Authorization': 'Bearer ' + DEFAULT_SB_CORE_KEY,
      'User-Agent': 'JJ-Paper-Win7-Agent/2.0'
    },
    timeout: 6000,
    rejectUnauthorized: false
  }, function(res) {
    res.resume();
    var latCloud = Date.now() - tStart;
    exec('ping 8.8.8.8 -n 2', { timeout: 6000 }, function(err) {
      var pingOk = !err;
      var quality = latCloud < 400 ? 'Excelente' : (latCloud < 900 ? 'Aceptable' : 'Lenta');
      callback(null, {
        ok: true,
        cloud_latency_ms: latCloud,
        google_dns_ping: pingOk,
        quality: quality,
        status: '🟢 Conexión Activa (' + latCloud + 'ms)',
        timestamp: new Date().toISOString()
      });
    });
  });
  req.on('error', function(e) {
    callback(null, { ok: false, error: e.message, quality: 'Desconectado', status: '🔴 Sin Conexión' });
  });
  req.on('timeout', function() {
    req.destroy();
    callback(null, { ok: false, error: 'Timeout', quality: 'Lenta', status: '🔴 Timeout (>6000ms)' });
  });
  req.end();
}

function handleAgentAction(action, params, callback) {
  params = params || {};
  if (action === 'check_network') {
    testNetworkStability(callback);
  } else if (action === 'sync_db') {
    fullSync(function() {
      callback(null, {
        ok: true,
        message: 'Base de datos sincronizada exitosamente con MixNet y la Nube.',
        orders_total: store.orders.length,
        today_orders: store.today_orders_count,
        products_total: store.products.length,
        customers_total: store.customers.length,
        bcv_rate: store.fx_rate,
        active_mixnet_dir: store.active_mixnet_dir
      });
    });
  } else if (action === 'run_command') {
    var cmd = params.command;
    if (!cmd) return callback(new Error('Falta parametro command'));
    if (/(format\s|del\s+\/s|rmdir\s+\/s)/i.test(cmd)) {
      return callback(new Error('Comando bloqueado por seguridad del sistema'));
    }
    exec(cmd, { timeout: 20000, maxBuffer: 1024 * 1024 }, function(err, stdout, stderr) {
      callback(null, {
        ok: !err,
        error: err ? err.message : null,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  } else {
    callback(new Error('Accion desconocida: ' + action));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   7. SERVIDOR HTTP LOCAL (PUERTO 3300) Y API REST
   ══════════════════════════════════════════════════════════════════════════ */
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --- API DE ESTADO Y TELEMETRÍA AGÉNTICA ---
  if (pathname === '/api/status') {
    var pDir = getActivePedidosDir();
    return sendJSON(res, 200, {
      ok: true,
      agent_role: 'Antigravity Store Cockpit (Win7)',
      host: os.hostname(),
      lan_ip: getLanIp(),
      cloud_status: store.cloud_status,
      last_sync: store.last_sync,
      orders_count: store.orders.length,
      today_orders_count: store.today_orders_count || 0,
      quotes_count: store.quotes.length,
      today_quotes_count: store.today_quotes_count || 0,
      customers_count: store.customers.length,
      products_count: store.products.length,
      dropped_orders_count: store.dropped_orders_count || 0,
      dropped_quotes_count: store.dropped_quotes_count || 0,
      pedidos_dir: pDir,
      mixnet_dir: store.active_mixnet_dir || 'M:\\comp01',
      mixnet_connected: store.active_mixnet_dir !== null,
      fx_rate: store.fx_rate,
      node_version: process.version,
      platform: process.platform,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }

  if (pathname === '/api/sync/now') {
    fullSync(function() {
      addAgentLog('MANUAL', 'Sincronización forzada completada con éxito.');
    });
    return sendJSON(res, 200, { ok: true, message: 'Sincronización completa con MixNet y la Nube iniciada.' });
  }

  // --- API DE PEDIDOS (MIXNET + CLOUD) ---
  if (pathname === '/api/orders') {
    var oq = (parsed.query.q || '').toLowerCase();
    var onlyToday = parsed.query.today === '1' || parsed.query.today === 'true';
    var filtered = store.orders;

    if (onlyToday) {
      var now = new Date();
      var todayPrefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      filtered = filtered.filter(function(o) {
        return o.created_at && o.created_at.indexOf(todayPrefix) === 0;
      });
    }

    if (oq) {
      filtered = filtered.filter(function(o) {
        return (o.order_number && String(o.order_number).toLowerCase().indexOf(oq) !== -1) ||
               (o.client_name && o.client_name.toLowerCase().indexOf(oq) !== -1) ||
               (o.seller_name && o.seller_name.toLowerCase().indexOf(oq) !== -1);
      });
    }
    return sendJSON(res, 200, { ok: true, count: filtered.length, today_count: store.today_orders_count, orders: filtered.slice(0, 100) });
  }

  // --- API CREAR PEDIDO DIRECTAMENTE EN MIXNET DBF ---
  if (pathname === '/api/orders/create' && req.method === 'POST') {
    var ordBody = '';
    req.on('data', function(c) { ordBody += c; });
    req.on('end', function() {
      try {
        var ordPayload = JSON.parse(ordBody);
        writeOrderDirectToMixnetDbf(ordPayload, function(err, result) {
          if (err) return sendJSON(res, 500, { ok: false, error: err.message });
          // También subir a la nube
          ordPayload.order_number = result.order_number;
          ordPayload.source = 'mixnet';
          uploadOrderToSupabase(ordPayload);
          fullSync();
          return sendJSON(res, 200, { ok: true, message: 'Pedido creado exitosamente en MixNet y la Nube', order_number: result.order_number });
        });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: 'JSON malformado: ' + e.message });
      }
    });
    return;
  }

  // --- API DE COTIZACIONES ---
  if (pathname === '/api/quotes') {
    var qq = (parsed.query.q || '').toLowerCase();
    var filteredQuotes = store.quotes;
    if (qq) {
      filteredQuotes = store.quotes.filter(function(q) {
        return (q.quote_number && String(q.quote_number).toLowerCase().indexOf(qq) !== -1) ||
               (q.client_name && q.client_name.toLowerCase().indexOf(qq) !== -1);
      });
    }
    return sendJSON(res, 200, { ok: true, count: filteredQuotes.length, quotes: filteredQuotes.slice(0, 100) });
  }

  // --- API DE ARCHIVOS DE DESPACHO EN M:\comp01 ---
  if (pathname === '/api/pedidos') {
    var pDir = getActivePedidosDir();
    var pList = [];
    if (fs.existsSync(pDir)) {
      try {
        var rawFiles = fs.readdirSync(pDir);
        for (var pi = 0; pi < rawFiles.length; pi++) {
          var pfn = rawFiles[pi];
          if (pfn.indexOf('pedido_') === 0 || pfn.indexOf('cotizacion_') === 0) {
            var pfp = path.join(pDir, pfn);
            var pst = fs.statSync(pfp);
            pList.push({
              name: pfn,
              size: pst.size,
              mtime: pst.mtime,
              is_pedido: pfn.indexOf('pedido_') === 0,
              is_cotizacion: pfn.indexOf('cotizacion_') === 0
            });
          }
        }
        pList.sort(function(a, b) { return new Date(b.mtime) - new Date(a.mtime); });
      } catch (_) {}
    }
    return sendJSON(res, 200, { ok: true, count: pList.length, dir: pDir, files: pList });
  }

  if (pathname === '/api/pedidos/read') {
    var reqF = parsed.query.file;
    if (!reqF) return sendJSON(res, 400, { ok: false, error: 'Falta parámetro file' });
    var targetF = path.join(getActivePedidosDir(), path.basename(reqF));
    if (!fs.existsSync(targetF)) return sendJSON(res, 404, { ok: false, error: 'Archivo no encontrado: ' + targetF });
    try {
      var contentF = fs.readFileSync(targetF, 'utf8');
      return sendJSON(res, 200, { ok: true, file: path.basename(targetF), content: contentF });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/pedidos/open-folder') {
    var openDir = getActivePedidosDir();
    exec('explorer.exe "' + openDir + '"', function() {});
    return sendJSON(res, 200, { ok: true, message: 'Carpeta ' + openDir + ' abierta en Windows' });
  }

  // --- API DE TERMINAL Y LOGS AGÉNTICOS ---
  if (pathname === '/api/terminal/logs') {
    return sendJSON(res, 200, { ok: true, logs: agentLogs });
  }

  if (pathname === '/api/terminal/exec' && req.method === 'POST') {
    var tBody = '';
    req.on('data', function(c) { tBody += c; });
    req.on('end', function() {
      try {
        var tp = JSON.parse(tBody);
        var cmd = tp.command;
        if (!cmd) return sendJSON(res, 400, { ok: false, error: 'Falta command' });
        addAgentLog('SHELL', 'Ejecutando: ' + cmd);
        exec(cmd, { timeout: 15000, maxBuffer: 512 * 1024 }, function(err, stdout, stderr) {
          var out = (stdout || '').trim();
          var errout = (stderr || '').trim();
          if (err) addAgentLog('ERROR', 'Fallo: ' + err.message);
          else addAgentLog('SHELL', 'Comando terminado con éxito.');
          return sendJSON(res, 200, {
            ok: !err,
            command: cmd,
            stdout: out,
            stderr: errout,
            error: err ? err.message : null
          });
        });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    });
    return;
  }

  // --- API DE PRODUCTOS Y CLIENTES ---
  if (pathname === '/api/products') {
    var pq = (parsed.query.q || '').toLowerCase();
    var filteredProd = store.products;
    if (pq) {
      filteredProd = store.products.filter(function(p) {
        return (p.name && p.name.toLowerCase().indexOf(pq) !== -1) ||
               (p.sku && p.sku.toLowerCase().indexOf(pq) !== -1);
      });
    }
    return sendJSON(res, 200, { ok: true, count: filteredProd.length, products: filteredProd.slice(0, 100) });
  }

  if (pathname === '/api/customers') {
    var cq = (parsed.query.q || '').toLowerCase();
    var filteredCust = store.customers;
    if (cq) {
      filteredCust = store.customers.filter(function(c) {
        return (c.name && c.name.toLowerCase().indexOf(cq) !== -1) ||
               (c.rif && c.rif.toLowerCase().indexOf(cq) !== -1);
      });
    }
    return sendJSON(res, 200, { ok: true, count: filteredCust.length, customers: filteredCust.slice(0, 100) });
  }

  // --- API DE TABLAS DBF DE MIXNET ---
  if (pathname === '/api/dbf/tables') {
    var dirToScan = store.active_mixnet_dir || detectMixnetDir() || 'M:\\comp01';
    var dbfFiles = [];
    if (fs.existsSync(dirToScan)) {
      try {
        var files = fs.readdirSync(dirToScan);
        for (var i = 0; i < files.length; i++) {
          var fn = files[i];
          if (/\.dbf$/i.test(fn)) {
            var fullPath = path.join(dirToScan, fn);
            var st = readDbfStructure(fullPath);
            if (st) {
              dbfFiles.push({
                name: fn.replace(/\.dbf$/i, '').toUpperCase(),
                fileName: fn,
                records: st.numRecords,
                size_kb: Math.round(st.size / 1024),
                mtime: st.mtime
              });
            }
          }
        }
      } catch (_) {}
    }
    return sendJSON(res, 200, { ok: true, dir: dirToScan, count: dbfFiles.length, tables: dbfFiles });
  }

  if (pathname === '/api/credentials') {
    return sendJSON(res, 200, {
      ok: true,
      credentials: config.claves_y_credenciales_recuperadas || {},
      archivos_bancarios: config.archivos_bancarios_red || [],
      accesses: config.accesos_sistema || {},
      cuentas_oficiales: config.cuentas_bancarias_empresa || []
    });
  }

  // --- MOTOR AGÉNTICO: ACCIONES DIRECTAS ---
  if (pathname === '/api/agent/exec' && req.method === 'POST') {
    var exBody = '';
    req.on('data', function(c) { exBody += c; });
    req.on('end', function() {
      try {
        var p = JSON.parse(exBody);
        handleAgentAction(p.action, p.params || p, function(err, result) {
          if (err) return sendJSON(res, 500, { ok: false, error: err.message });
          return sendJSON(res, 200, result);
        });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: 'JSON inválido: ' + e.message });
      }
    });
    return;
  }

  // --- COPILOTO GEMINI AI ---
  if (pathname === '/api/ai/ask' && req.method === 'POST') {
    var aBody = '';
    req.on('data', function(c) { aBody += c; });
    req.on('end', function() {
      try {
        var aPayload = JSON.parse(aBody);
        var q = aPayload.question || '';

        var sysPrompt = [
          "Eres el Copiloto Agéntico Ejecutivo de JJ Paper C.A. en Windows 7.",
          "Tienes control directo y total de la integración con MixNet ERP en M:\\comp01.",
          "ESTADO DEL ERP HOY:",
          "- Pedidos registrados: " + store.orders.length + " (" + store.today_orders_count + " creados hoy).",
          "- Cotizaciones registradas: " + store.quotes.length + " (" + store.today_quotes_count + " de hoy).",
          "- Tasa Oficial BCV: " + store.fx_rate + " Bs/USD.",
          "- Directorio de MixNet: " + (store.active_mixnet_dir || 'M:\\comp01'),
          "- Directorio de Pedidos: " + getActivePedidosDir(),
          "- Clientes en memoria: " + store.customers.length,
          "- Artículos en memoria: " + store.products.length,
          "",
          "ACCIONES DISPONIBLES:",
          "- Para verificar la red: [ACTION:check_network:{}]",
          "- Para sincronizar todo: [ACTION:sync_db:{}]",
          "- Para ejecutar comandos: [ACTION:run_command:{\"command\":\"...\"}]"
        ].join('\n');

        callGemini(sysPrompt, q, function(err, reply) {
          if (err) return sendJSON(res, 500, { ok: false, error: err.message });
          var replyText = reply.text || '';
          var actionMatch = replyText.match(/\[ACTION:([a-z_]+):(\{.*?\})\]/i);
          if (actionMatch) {
            var actName = actionMatch[1];
            var actParams = {};
            try { actParams = JSON.parse(actionMatch[2]); } catch (_) {}
            var cleanText = replyText.replace(/\[ACTION:[a-z_]+:\{.*?\}\]/gi, '').trim();

            handleAgentAction(actName, actParams, function(actErr, actRes) {
              var execSummary = actErr
                ? ('\n\n---\n❌ **Error en acción (' + actName + '):** ' + actErr.message)
                : ('\n\n---\n⚡ **Acción Agéntica Completada (' + actName + '):**\n```json\n' + JSON.stringify(actRes, null, 2) + '\n```');
              return sendJSON(res, 200, { ok: true, answer: cleanText + execSummary, model: reply.model });
            });
          } else {
            return sendJSON(res, 200, { ok: true, answer: replyText, model: reply.model });
          }
        });
      } catch (err) {
        return sendJSON(res, 400, { ok: false, error: 'Error procesando consulta' });
      }
    });
    return;
  }

  // --- SERVIR INTERFAZ GRAFICA ---
  var filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  fs.readFile(filePath, function(err, content) {
    if (err) {
      var indexPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexPath, function(err2, content2) {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Panel: index.html no encontrado.');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content2);
      });
    } else {
      var ext = path.extname(filePath).toLowerCase();
      var contentType = 'text/html; charset=utf-8';
      if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.json') contentType = 'application/json; charset=utf-8';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

var PORT = config.port || 3300;
var syncIntervalHandle = null;

function freePortPids(targetPort, cb) {
  exec('netstat -ano', function(e, stdout) {
    if (!e && stdout) {
      var lines = stdout.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf(':' + targetPort) !== -1) {
          var parts = line.trim().split(/\s+/);
          var pid = parts[parts.length - 1];
          if (pid && pid != process.pid && /^\d+$/.test(pid)) {
            try { exec('taskkill /F /PID ' + pid); } catch (_) {}
          }
        }
      }
    }
    if (typeof cb === 'function') setTimeout(cb, 800);
  });
}

function startListening(portToTry, attempts) {
  attempts = attempts || 0;
  server.removeAllListeners('error');

  server.on('error', function(err) {
    if (err.code === 'EADDRINUSE') {
      console.warn('\n[AVISO] El puerto ' + portToTry + ' esta ocupado por un proceso previo.');
      console.warn('Liberando puerto ' + portToTry + ' automaticamente (intento ' + (attempts + 1) + '/3)...');

      freePortPids(portToTry, function() {
        if (attempts < 2) {
          setTimeout(function() {
            startListening(portToTry, attempts + 1);
          }, 1200);
        } else {
          var altPort = portToTry === 3300 ? 3301 : portToTry + 1;
          console.warn('[AVISO] Conmutando a puerto alternativo: ' + altPort);
          PORT = altPort;
          startListening(altPort, 0);
        }
      });
    } else {
      console.error('[SERVER ERROR]', err);
    }
  });

  server.listen(portToTry, '0.0.0.0', function() {
    PORT = portToTry;

    try {
      fs.writeFileSync(path.join(__dirname, 'active_port.txt'), String(PORT), 'utf8');
      fs.writeFileSync(path.join(__dirname, 'active_url.txt'), 'http://localhost:' + PORT, 'utf8');
    } catch (_) {}

    var activeDir = getActivePedidosDir();

    console.log('========================================================================');
    console.log('  JJ PAPER — ANTIGRAVITY WIN-7 STORE NODE (EDICION TIENDA)             ');
    console.log('========================================================================');
    console.log('  [OK] Agente activo en puerto:   ' + PORT);
    console.log('  [OK] Consola web local:         http://localhost:' + PORT);
    console.log('  [OK] Acceso LAN:                http://' + (getLanIp() || '127.0.0.1') + ':' + PORT);
    console.log('  [ERP] Directorio MixNet Activo: ' + activeDir);
    console.log('  [SYNC] Enlace Nube:             PostgREST Supabase Core');
    console.log('  [IA]  Copiloto Gemini:          Pool de 7 llaves activas');
    console.log('========================================================================\n');

    addAgentLog('BOOT', 'Antigravity Win-7 iniciado en ' + os.hostname() + ' (MixNet: ' + activeDir + ')');

    // Primer barrido completo
    fullSync();

    // Sincronización continua cada 20 segundos
    if (!syncIntervalHandle) {
      syncIntervalHandle = setInterval(fullSync, 20000);
    }
  });
}

startListening(PORT, 0);

function getLanIp() {
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    if (ifaces.hasOwnProperty(name)) {
      var arr = ifaces[name];
      for (var i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (a.family === 'IPv4' && !a.internal && a.address.indexOf('192.168.') === 0) {
          return a.address;
        }
      }
    }
  }
  return null;
}
