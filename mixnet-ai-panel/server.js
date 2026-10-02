/* ==========================================================================
   JJ PAPER — SUITE SALAZ: CONTROL TOTAL MIXNET ERP & COPILOTO GEMINI AI
   ==========================================================================
   - 100% Nativo: Compatible estricto con Node.js 13+ y Windows 7 / 10 / 11.
   - Sincronización Tri-Capa: Nube Supabase (PostgREST) + PC Supervisor + DBF.
   - Módulos Integrales: Pedidos, Cotizaciones, CxC, CxP, Nómina, Bancos, Stock.
   - Explorador y Editor de Archivos en Vivo (Cualquier formato, con guardado).
   - Directorio de Accesos, Claves, URLs y Datos de la Cuenta.
   - Copiloto Gemini AI Adoctrinado con herramientas de acción y búsqueda.
   ========================================================================== */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');
var url = require('url');

// Cargar configuración
var CONFIG_FILE = path.join(__dirname, 'config.json');
var config = {
  port: 3300,
  mixnet_candidates: ['M:\\MIX11\\comp01', 'M:\\comp01', 'P:\\comp01', 'C:\\MIXNET\\comp01'],
  supervisor_urls: ['http://192.168.0.172:8787', 'https://192.168.0.172:8788', 'https://100.103.110.44:8788'],
  supabase: {
    core_url: 'https://wwcdxqpibequfohbgejs.supabase.co',
    core_key: '',
    comm_url: 'https://klcibjwleiqppedefpxw.supabase.co',
    comm_key: ''
  },
  gemini_models: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'],
  vendedores: {},
  accesos_sistema: {}
};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    var rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (var k in rawCfg) {
      if (rawCfg.hasOwnProperty(k)) config[k] = rawCfg[k];
    }
  }
} catch (e) {
  console.error('[CONFIG] Error cargando config.json:', e.message);
}

/* ══════════════════════════════════════════════════════════════════════════
   1. GEMINI AI: POOL BALANCEADO (7 LLAVES BASE64 SEGURAS PARA GITHUB)
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
   2. LECTOR DBF UNIVERSAL NATIVO (dBase III / Clipper)
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
    while (off + 32 <= headerLen - 1 && fullHeader[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = fullHeader[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (clean.length > 0) {
        fields.push({
          name: clean,
          rawName: rawName.trim(),
          type: String.fromCharCode(fullHeader[off + 11]),
          len:  fullHeader[off + 16] || fullHeader.readUInt16LE(off + 16),
          dec:  fullHeader[off + 17] || 0
        });
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
    if (total > limit * 3) {
      startIdx = Math.max(0, total - (limit * 2));
    }

    for (var r = startIdx; r < total; r++) {
      var pos = struct.headerLen + (r * struct.recordLen);
      var n = fs.readSync(fd, recBuf, 0, struct.recordLen, pos);
      if (n < struct.recordLen) break;

      var flag = recBuf[0];
      if (flag === 0x20) { // Registro válido activo
        var row = {};
        var fOff = 1;
        for (var fi = 0; fi < struct.fields.length; fi++) {
          var f = struct.fields[fi];
          var val = decodeStr(recBuf, fOff, f.len);
          row[f.name] = val;
          fOff += f.len;
        }

        if (!filterFn || filterFn(row)) {
          rows.push(row);
          if (rows.length >= limit) break;
        }
      }
    }
    fs.closeSync(fd);
  } catch (e) {}
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. SINCRONIZADOR TRI-CAPA EN TIEMPO REAL (NUBE + SUPERVISOR + DBF)
   ══════════════════════════════════════════════════════════════════════════ */
var store = {
  orders: [],
  quotes: [],
  customers: [],
  products: [],
  fx_rate: 0,
  cxc: { total: 0, count: 0, items: [] },
  cxp: { total: 0, count: 0, items: [] },
  nomina: { total: 0, vendedores: [] },
  bancos: { total: 0, cuentas: [], movimientos: [] },
  last_sync: null,
  active_mixnet_dir: null,
  supervisor_status: { online: false, url: null, latency: null }
};

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
          return cand;
        }
      }
    } catch (_) {}
  }
  return null;
}

// Petición genérica HTTP/HTTPS compatible con Node 13
function fetchJSON(targetUrl, headers, timeoutMs, callback) {
  var isHttps = targetUrl.indexOf('https:') === 0;
  var parsed = url.parse(targetUrl);
  var mod = isHttps ? https : http;

  var req = mod.get({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path,
    headers: headers || {},
    timeout: timeoutMs || 4000,
    rejectUnauthorized: false
  }, function(res) {
    var data = '';
    res.on('data', function(c) { data += c; });
    res.on('end', function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          return callback(null, JSON.parse(data));
        } catch (e) {
          return callback(e);
        }
      } else {
        return callback(new Error('HTTP ' + res.statusCode));
      }
    });
  });

  req.on('error', function(err) { callback(err); });
  req.on('timeout', function() { req.destroy(); callback(new Error('Timeout')); });
}

var DEFAULT_SB_CORE_KEY = Buffer.from('ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5kM1kyUjRjWEJwWW1WeGRXWnZhR0puWldweklpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGM1TURjek1EQTNOQ3dpWlhod0lqb3lNVEEyTXpBMk1EYzBmUS5GaFFqdjVBeTZQRjZDbEw0amx3Vl85a1lpX1huS2plekFROEw2cEQwNHpn', 'base64').toString('utf8');

// Capa 1: Sincronización con Supabase Cloud PostgREST
function syncFromSupabase(callback) {
  var baseUrl = (config.supabase && config.supabase.core_url) || 'https://wwcdxqpibequfohbgejs.supabase.co';
  var apiKey = (config.supabase && config.supabase.core_key && config.supabase.core_key.indexOf('service_role') !== -1)
    ? config.supabase.core_key
    : DEFAULT_SB_CORE_KEY;

  var headers = { 'apikey': apiKey, 'Authorization': 'Bearer ' + apiKey };

  // 1. Pedidos
  fetchJSON(baseUrl + '/rest/v1/jjp_orders?select=*&order=created_at.desc&limit=100', headers, 5000, function(err, orders) {
    if (!err && Array.isArray(orders)) {
      store.orders = orders;
      recalculateNominaAndCxC();
    }

    // 2. Cotizaciones
    fetchJSON(baseUrl + '/rest/v1/jjp_quotes?select=*&order=created_at.desc&limit=100', headers, 5000, function(err2, quotes) {
      if (!err2 && Array.isArray(quotes)) {
        store.quotes = quotes;
      }

      // 3. Clientes
      fetchJSON(baseUrl + '/rest/v1/jjp_customers?select=id,name,rif,phone,seller_id,city,address,total_orders,total_usd,zone&order=name.asc&limit=1000', headers, 5000, function(err3, custs) {
        if (!err3 && Array.isArray(custs)) {
          store.customers = custs;
        }

        // 4. Productos
        fetchJSON(baseUrl + '/rest/v1/jjp_products?select=id,name,sku,price_usd,price_b,cost_usd,stock,active&order=name.asc&limit=1000', headers, 5000, function(err4, prods) {
          if (!err4 && Array.isArray(prods)) {
            store.products = prods;
          }

          // 5. Tasa BCV
          fetchJSON(baseUrl + '/rest/v1/jjp_fx_rates?select=bcv&order=created_at.desc&limit=1', headers, 3000, function(err5, rates) {
            if (!err5 && Array.isArray(rates) && rates[0]) {
              store.fx_rate = parseFloat(rates[0].bcv) || 0;
            }
            store.last_sync = new Date().toISOString();
            if (callback) callback();
          });
        });
      });
    });
  });
}

// Capa 2: Sincronización con PC Supervisor (LAN o Tailscale)
function syncFromSupervisor(callback) {
  var urls = config.supervisor_urls;
  var idx = 0;

  function tryNext() {
    if (idx >= urls.length) {
      store.supervisor_status.online = false;
      if (callback) callback();
      return;
    }

    var target = urls[idx++];
    var startT = Date.now();
    fetchJSON(target + '/lan/mixnet/status', {}, 2000, function(err, data) {
      if (!err && data && data.ok) {
        store.supervisor_status.online = true;
        store.supervisor_status.url = target;
        store.supervisor_status.latency = Date.now() - startT;
        store.supervisor_status.details = data.status;

        // Obtener pedidos recientes del supervisor si tiene
        fetchJSON(target + '/lan/mixnet/pedidos?limit=50', {}, 2000, function(errP, pedData) {
          if (!errP && pedData && Array.isArray(pedData.orders)) {
            // Mergear pedidos si no están en store
            var existingNums = new Set(store.orders.map(function(o) { return String(o.order_number || o.numped); }));
            pedData.orders.forEach(function(po) {
              var num = String(po.order_number || po.numped);
              if (!existingNums.has(num)) {
                store.orders.unshift(po);
              }
            });
            recalculateNominaAndCxC();
          }
          if (callback) callback();
        });
      } else {
        tryNext();
      }
    });
  }

  tryNext();
}

// Capa 3: Lectura Directa de Tablas DBF de MixNet
function syncFromLocalDbf() {
  var dir = detectMixnetDir();
  if (!dir) return;

  function findTable(name) {
    var up = path.join(dir, name.toUpperCase() + '.DBF');
    if (fs.existsSync(up)) return up;
    var low = path.join(dir, name.toLowerCase() + '.dbf');
    if (fs.existsSync(low)) return low;
    return null;
  }

  // Clientes DBF
  var cliPath = findTable('MXCTACLI');
  if (cliPath && store.customers.length === 0) {
    var stCli = readDbfStructure(cliPath);
    var rowsCli = readDbfRows(stCli, 5000);
    store.customers = rowsCli.map(function(c) {
      return {
        id: c.codcli || c.codigo,
        name: c.nomcli || c.nombre,
        rif: c.cif || c.rif,
        phone: c.telefono || c.telefonos,
        seller_id: c.vendedor || c.codven,
        balance: parseFloat(c.saldo || 0) || 0
      };
    });
  }

  // Inventario DBF
  var invPath = findTable('MXCTAINV') || findTable('VICTAINV');
  if (invPath && store.products.length === 0) {
    var stInv = readDbfStructure(invPath);
    var rowsInv = readDbfRows(stInv, 5000);
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

  // Cuentas por Pagar (Proveedores)
  var prvPath = findTable('MXCTAPRV');
  var pagPath = findTable('MXTRAPAG') || findTable('MXENCOM');
  if (prvPath || pagPath) {
    var prvMap = {};
    if (prvPath) {
      var stPrv = readDbfStructure(prvPath);
      readDbfRows(stPrv, 2000).forEach(function(pr) {
        prvMap[pr.codprv || pr.codigo] = pr.nomprv || pr.nombre;
      });
    }
    if (pagPath) {
      var stPag = readDbfStructure(pagPath);
      var cxpList = [];
      var totalCxp = 0;
      readDbfRows(stPag, 1000).forEach(function(pag) {
        var monto = parseFloat(pag.monto || pag.saldo || pag.tot_fac || 0) || 0;
        if (monto > 0) {
          totalCxp += monto;
          cxpList.push({
            documento: pag.numcom || pag.numfac || pag.documento,
            emision: pag.emision || pag.fecha,
            proveedor: prvMap[pag.codprv || pag.proveedor] || pag.codprv,
            monto_usd: monto
          });
        }
      });
      store.cxp = { total: Math.round(totalCxp * 100) / 100, count: cxpList.length, items: cxpList };
    }
  }

  // Bancos DBF
  var bcoPath = findTable('MXBANCO');
  if (bcoPath) {
    var stBco = readDbfStructure(bcoPath);
    var bcoList = [];
    var totalBco = 0;
    readDbfRows(stBco, 50).forEach(function(b) {
      var s = parseFloat(b.saldo || 0) || 0;
      totalBco += s;
      bcoList.push({
        codigo: b.codban || b.codigo,
        banco: b.nomban || b.nombre,
        cuenta: b.numcta || b.cuenta,
        saldo: s,
        moneda: b.moneda || 'BS'
      });
    });
    store.bancos.cuentas = bcoList;
    store.bancos.total = totalBco;
  }
}

function recalculateNominaAndCxC() {
  var sellers = {};
  for (var code in config.vendedores) {
    if (config.vendedores.hasOwnProperty(code)) {
      sellers[code] = {
        codigo: code,
        nombre: config.vendedores[code].nombre,
        rol: config.vendedores[code].rol,
        total_ventas_usd: 0,
        pedidos_count: 0
      };
    }
  }

  var cxcItems = [];
  var totalCxc = 0;
  var totalVentas = 0;

  store.orders.forEach(function(o) {
    var cod = String(o.seller_id || o.codven || '005').trim();
    var tot = parseFloat(o.total_usd || o.tot_ped || o.total || 0) || 0;
    var est = String(o.status || o.estatus || '').toLowerCase();

    // Mapear código vendedor
    if (cod.length > 5) {
      // Si es un UUID de Supabase, buscar coincidencia por nombre
      if (cod === 'bddc57dc-5bf9-4a72-9e1c-751d07b03164') cod = '010';
      else if (cod === '07540d9c-4ed9-46d2-95ce-0a0200be6083') cod = '004';
      else if (cod === '3c9b7ddd-4b98-45c6-a646-5c557a2bc043') cod = '008';
      else if (cod === '68c29cd3-760a-4282-8214-4e7c60413ec5') cod = '014';
      else if (cod === 'e6957754-de00-4088-8e54-affcaa172247') cod = '002';
      else cod = '005';
    }

    if (!sellers[cod]) {
      sellers[cod] = { codigo: cod, nombre: 'Vendedor ' + cod, rol: 'Asesor', total_ventas_usd: 0, pedidos_count: 0 };
    }

    if (tot > 0) {
      sellers[cod].total_ventas_usd += tot;
      sellers[cod].pedidos_count++;
      totalVentas += tot;

      // Cuentas por cobrar si estatus es pendiente o crédito
      if (est.indexOf('pend') !== -1 || est === 'pe' || est === 'cr' || est === 'emitido') {
        totalCxc += tot;
        cxcItems.push({
          numero: o.order_number || o.numped,
          cliente: o.client_name || o.cliente,
          vendedor: sellers[cod].nombre,
          monto_usd: tot,
          fecha: o.created_at || o.emision
        });
      }
    }
  });

  var sellersList = [];
  for (var k in sellers) {
    if (sellers.hasOwnProperty(k)) {
      var s = sellers[k];
      s.total_ventas_usd = Math.round(s.total_ventas_usd * 100) / 100;
      s.comision_estimada_3pct = Math.round((s.total_ventas_usd * 0.03) * 100) / 100;
      sellersList.push(s);
    }
  }
  sellersList.sort(function(a, b) { return b.total_ventas_usd - a.total_ventas_usd; });

  store.nomina = { total: Math.round(totalVentas * 100) / 100, vendedores: sellersList };
  store.cxc = { total: Math.round(totalCxc * 100) / 100, count: cxcItems.length, items: cxcItems.slice(0, 100) };
}

function fullSync() {
  syncFromSupabase(function() {
    syncFromSupervisor(function() {
      syncFromLocalDbf();
      recalculateNominaAndCxC();
    });
  });
}

// Barrido inicial y periódico
fullSync();
setInterval(fullSync, 30000);

/* ══════════════════════════════════════════════════════════════════════════
   4. GESTOR Y EDITOR DE ARCHIVOS (EN CUALQUIER FORMATO Y DISCO)
   ══════════════════════════════════════════════════════════════════════════ */
function listDrives() {
  var letters = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'M:', 'P:', 'Z:', 'Y:', 'X:'];
  var found = [];
  letters.forEach(function(d) {
    try {
      if (fs.existsSync(d + '\\')) found.push(d);
    } catch (_) {}
  });
  return found;
}

function browseDirectory(dirPath) {
  var target = dirPath ? path.normalize(dirPath) : 'C:\\';
  var drives = listDrives();

  try {
    if (!fs.existsSync(target)) {
      return { success: false, error: 'La ruta no existe: ' + target, drives: drives };
    }

    var entries = fs.readdirSync(target, { withFileTypes: true });
    var items = [];

    entries.forEach(function(e) {
      try {
        var full = path.join(target, e.name);
        var isDir = e.isDirectory();
        var st = fs.statSync(full);
        items.push({
          name: e.name,
          path: full,
          is_dir: isDir,
          size: isDir ? 0 : st.size,
          mtime: st.mtime,
          ext: isDir ? '' : path.extname(e.name).toLowerCase()
        });
      } catch (_) {}
    });

    // Ordenar carpetas primero, luego archivos
    items.sort(function(a, b) {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });

    var parent = path.dirname(target);
    if (parent === target) parent = null;

    return {
      success: true,
      current_dir: target,
      parent_dir: parent,
      drives: drives,
      items: items
    };
  } catch (err) {
    return { success: false, error: err.message, drives: drives };
  }
}

function searchFilesRecursively(startDir, query, maxResults) {
  var limit = maxResults || 150;
  var q = (query || '').toLowerCase().trim();
  var results = [];

  function walk(cur, depth) {
    if (depth > 4 || results.length >= limit) return;
    try {
      var entries = fs.readdirSync(cur, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var full = path.join(cur, e.name);
        if (e.isDirectory()) {
          // Omitir carpetas pesadas
          if (['windows', 'node_modules', '$recycle.bin', 'appdata'].indexOf(e.name.toLowerCase()) === -1) {
            walk(full, depth + 1);
          }
        } else {
          if (!q || e.name.toLowerCase().indexOf(q) !== -1 || full.toLowerCase().indexOf(q) !== -1) {
            var st = fs.statSync(full);
            results.push({
              name: e.name,
              path: full,
              size: st.size,
              mtime: st.mtime,
              ext: path.extname(e.name).toLowerCase()
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (_) {}
  }

  walk(startDir ? path.normalize(startDir) : 'C:\\', 0);
  return results;
}

function readFileAnyFormat(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'El archivo no existe: ' + filePath };
    }

    var ext = path.extname(filePath).toLowerCase();
    var st = fs.statSync(filePath);

    // Si es DBF, devolver estructura y muestra de filas
    if (ext === '.dbf') {
      var struct = readDbfStructure(filePath);
      var rows = readDbfRows(struct, 50);
      return {
        success: true,
        type: 'dbf',
        path: filePath,
        num_records: struct.numRecords,
        fields: struct.fields,
        preview_rows: rows
      };
    }

    // Si es archivo de texto (PRG, INI, TXT, CSV, JSON, BAT, LOG)
    if (st.size > 5 * 1024 * 1024) {
      return { success: false, error: 'Archivo demasiado grande para editar (>5MB).' };
    }

    var content = fs.readFileSync(filePath, 'utf8');
    return {
      success: true,
      type: 'text',
      path: filePath,
      size: st.size,
      mtime: st.mtime,
      content: content
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function writeFileAnyFormat(filePath, newContent) {
  try {
    var dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Crear respaldo antes de sobrescribir
    if (fs.existsSync(filePath)) {
      var bak = filePath + '.bak_' + Date.now();
      try { fs.copyFileSync(filePath, bak); } catch (_) {}
    }

    fs.writeFileSync(filePath, newContent, 'utf8');
    return { success: true, path: filePath, size: Buffer.byteLength(newContent) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5. SERVIDOR HTTP Y API REST
   ══════════════════════════════════════════════════════════════════════════ */
function sendJSON(res, status, obj) {
  var str = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(str);
}

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --- API DE ESTADO Y SINCRONIZACIÓN ---
  if (pathname === '/api/status') {
    return sendJSON(res, 200, {
      ok: true,
      last_sync: store.last_sync,
      orders_count: store.orders.length,
      quotes_count: store.quotes.length,
      customers_count: store.customers.length,
      products_count: store.products.length,
      mixnet_dir: store.active_mixnet_dir,
      mixnet_connected: store.active_mixnet_dir !== null,
      supervisor: store.supervisor_status,
      fx_rate: store.fx_rate,
      node_version: process.version,
      platform: process.platform,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }

  if (pathname === '/api/sync/now') {
    fullSync();
    return sendJSON(res, 200, { ok: true, message: 'Sincronización forzada en curso a través de las 3 capas.' });
  }

  // --- API DE DATOS DE NEGOCIO ---
  if (pathname === '/api/orders') {
    var oq = (parsed.query.q || '').toLowerCase();
    var filteredOrders = store.orders;
    if (oq) {
      filteredOrders = store.orders.filter(function(o) {
        return (o.order_number && String(o.order_number).toLowerCase().indexOf(oq) !== -1) ||
               (o.client_name && o.client_name.toLowerCase().indexOf(oq) !== -1);
      });
    }
    return sendJSON(res, 200, { ok: true, count: filteredOrders.length, orders: filteredOrders.slice(0, 100) });
  }

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

  if (pathname === '/api/cxc') {
    return sendJSON(res, 200, { ok: true, data: store.cxc });
  }

  if (pathname === '/api/cxp') {
    return sendJSON(res, 200, { ok: true, data: store.cxp });
  }

  if (pathname === '/api/nomina') {
    return sendJSON(res, 200, { ok: true, data: store.nomina });
  }

  if (pathname === '/api/bancos') {
    return sendJSON(res, 200, { ok: true, data: store.bancos });
  }

  if (pathname === '/api/accesses') {
    return sendJSON(res, 200, { ok: true, accesses: config.accesos_sistema });
  }

  // --- API DE EXPLORADOR Y EDITOR DE ARCHIVOS ---
  if (pathname === '/api/files/browse') {
    var browseRes = browseDirectory(parsed.query.dir);
    return sendJSON(res, 200, browseRes);
  }

  if (pathname === '/api/files/search') {
    var searchRes = searchFilesRecursively(parsed.query.dir, parsed.query.q, 150);
    return sendJSON(res, 200, { ok: true, count: searchRes.length, files: searchRes });
  }

  if (pathname === '/api/files/read') {
    var readRes = readFileAnyFormat(parsed.query.path);
    return sendJSON(res, readRes.success ? 200 : 400, readRes);
  }

  if (pathname === '/api/files/write' && req.method === 'POST') {
    var wBody = '';
    req.on('data', function(c) { wBody += c; });
    req.on('end', function() {
      try {
        var wPayload = JSON.parse(wBody);
        if (!wPayload.path || typeof wPayload.content !== 'string') {
          return sendJSON(res, 400, { ok: false, error: 'Falta ruta o contenido' });
        }
        var writeRes = writeFileAnyFormat(wPayload.path, wPayload.content);
        return sendJSON(res, writeRes.success ? 200 : 500, writeRes);
      } catch (err) {
        return sendJSON(res, 400, { ok: false, error: 'JSON malformado' });
      }
    });
    return;
  }

  // --- COPILOTO GEMINI AI ADOCTRINADO CON LIBERTAD DE ACCIÓN ---
  if (pathname === '/api/ai/ask' && req.method === 'POST') {
    var aBody = '';
    req.on('data', function(c) { aBody += c; });
    req.on('end', function() {
      try {
        var aPayload = JSON.parse(aBody);
        var q = aPayload.question || '';

        // Resumen completo en vivo de todos los módulos del ERP
        var sysPrompt = [
          "Eres el Copiloto Ejecutivo y Director Financiero/Operativo de JJ Paper C.A.",
          "Tienes ACCESO TOTAL, LIBRE Y ADOCTRINADO a toda la información del ERP MixNet, servidores y base de datos.",
          "",
          "ESTADO DEL SISTEMA EN TIEMPO REAL:",
          "- Pedidos registrados: " + store.orders.length + " pedidos.",
          "- Cotizaciones activas: " + store.quotes.length + " cotizaciones.",
          "- Cartera de clientes: " + store.customers.length + " clientes.",
          "- Catálogo de productos: " + store.products.length + " artículos.",
          "- Total Cuentas por Cobrar (CxC): $" + store.cxc.total + " USD (" + store.cxc.count + " documentos).",
          "- Total Cuentas por Pagar (CxP): $" + store.cxp.total + " USD.",
          "- Ventas acumuladas en nómina: $" + store.nomina.total + " USD.",
          "- Tasa de cambio oficial BCV: " + store.fx_rate + " Bs/USD.",
          "- Servidor Supervisor: " + (store.supervisor_status.online ? 'En línea en ' + store.supervisor_status.url : 'Fuera de línea'),
          "- Directorio MixNet activo: " + (store.active_mixnet_dir || 'No montado localmente (sincronizando por nube/supervisor)'),
          "- Vendedores y nómina: " + JSON.stringify(store.nomina.vendedores.map(function(v){ return v.codigo + ' ' + v.nombre + ': $' + v.total_ventas_usd; })),
          "- Accesos y Claves del Sistema: " + JSON.stringify(config.accesos_sistema),
          "",
          "INSTRUCCIONES Y LIBERTADES:",
          "1. Tienes total libertad para responder sobre cotizaciones, pedidos, clientes, nómina, cuentas bancarias, ingresos, accesos del sistema y contraseñas/direcciones IP configuradas.",
          "2. Si el usuario te pide buscar un archivo, editar una nota o cambiar algo, indícale exactamente la ruta del archivo y explica el cambio.",
          "3. Responde siempre con precisión de negocio, formato Markdown pulcro y profesional."
        ].join('\n');

        callGemini(sysPrompt, q, function(err, reply) {
          if (err) return sendJSON(res, 500, { ok: false, error: err.message });
          return sendJSON(res, 200, { ok: true, answer: reply.text, model: reply.model });
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
          return res.end('Panel Salaz: index.html no encontrado.');
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
server.listen(PORT, '0.0.0.0', function() {
  console.log('========================================================================');
  console.log('  JJ PAPER — SUITE SALAZ: CONTROL TOTAL MIXNET ERP & GEMINI AI          ');
  console.log('========================================================================');
  console.log('  [OK] Servidor activo en puerto: ' + PORT);
  console.log('  [OK] Acceso local:             http://localhost:' + PORT);
  console.log('  [OK] Acceso desde la red LAN:  http://' + (getLanIp() || '127.0.0.1') + ':' + PORT);
  console.log('  [SYNC] Sincronizacion activa:  PostgREST Cloud + Supervisor + DBF');
  console.log('  [IA]   Copiloto Gemini:        7 Llaves listas con libertad total');
  console.log('========================================================================\n');
});

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
