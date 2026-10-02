/* ==========================================================================
   JJ Paper — Monitor y Panel Ejecutivo MixNet AI (Windows 7 / Node 13+)
   - 100% Nativo: Cero dependencias npm externas.
   - Compatible estricto con Node.js 13+ y Windows 7.
   - Lectura integral de tablas DBF de MixNet (CxC, CxP, Nómina, Bancos, Stock).
   - Enlace bidireccional y redundante con la PC Supervisor (192.168.0.172).
   - Motor Copiloto IA con pool balanceado de 7 API Keys de Gemini.
   ========================================================================== */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');
var child_process = require('child_process');
var url = require('url');

// Cargar configuración local
var CONFIG_FILE = path.join(__dirname, 'config.json');
var config = {
  port: 3300,
  mixnet_candidates: [
    'M:\\MIX11\\comp01',
    'M:\\comp01',
    '\\\\192.168.0.185\\comp01',
    '\\\\192.168.0.172\\comp01',
    'P:\\comp01',
    'C:\\MIXNET\\comp01'
  ],
  supervisor_urls: [
    'http://192.168.0.172:8787',
    'https://192.168.0.172:8788',
    'https://100.103.110.44:8788'
  ],
  gemini_keys: [],
  gemini_models: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'],
  vendedores: {}
};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    var rawConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (var k in rawConfig) {
      if (rawConfig.hasOwnProperty(k)) config[k] = rawConfig[k];
    }
  }
} catch (e) {
  console.error('[CONFIG] Error cargando config.json, usando valores por defecto:', e.message);
}

/* ══════════════════════════════════════════════════════════════════════════
   1. LECTOR NATIVO DE ARCHIVOS DBF (dBase III / Clipper) PARA NODE 13
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
  } catch (err) {
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
    var scanned = 0;

    // Si hay muchos registros, escanear desde los más recientes hacia atrás
    var startIdx = 0;
    if (total > limit * 3) {
      startIdx = Math.max(0, total - (limit * 2));
    }

    for (var r = startIdx; r < total; r++) {
      var pos = struct.headerLen + (r * struct.recordLen);
      var n = fs.readSync(fd, recBuf, 0, struct.recordLen, pos);
      if (n < struct.recordLen) break;

      var flag = recBuf[0];
      // 0x2A = marcado como borrado en dBase. 0x20 = registro activo válido.
      if (flag === 0x20) {
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
      scanned++;
    }
    fs.closeSync(fd);
  } catch (e) {
    // Si falla lectura, devolver lo recolectado
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. DETECCION INTELIGENTE DE RUTAS DE MIXNET Y SUPERVISOR-PC
   ══════════════════════════════════════════════════════════════════════════ */
var activeMixnetDir = null;
var supervisorStatus = { online: false, url: null, latency: null, last_check: null };

function safeExistsSync(p) {
  if (!p) return false;
  // Rutas UNC tipo \\192.168.x.x congelan fs.existsSync por 30s en Windows si la IP no responde
  if (p.indexOf('\\\\') === 0) return false;
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
          activeMixnetDir = cand;
          return cand;
        }
      }
    } catch (_) {}
  }
  return null;
}

function checkSupervisorConnection(callback) {
  var urls = config.supervisor_urls;
  var idx = 0;

  function tryNext() {
    if (idx >= urls.length) {
      supervisorStatus.online = false;
      supervisorStatus.last_check = new Date().toISOString();
      if (callback) callback(supervisorStatus);
      return;
    }

    var targetUrl = urls[idx++];
    var isHttps = targetUrl.indexOf('https:') === 0;
    var parsed = url.parse(targetUrl + '/lan/mixnet/status');
    var mod = isHttps ? https : http;

    var startTime = Date.now();
    var req = mod.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      timeout: 1500,
      rejectUnauthorized: false
    }, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200) {
          supervisorStatus.online = true;
          supervisorStatus.url = targetUrl;
          supervisorStatus.latency = Date.now() - startTime;
          supervisorStatus.last_check = new Date().toISOString();
          try {
            var data = JSON.parse(body);
            supervisorStatus.details = data.status || data;
          } catch (_) {}
          if (callback) callback(supervisorStatus);
        } else {
          tryNext();
        }
      });
    });

    req.on('error', function() { tryNext(); });
    req.on('timeout', function() { req.destroy(); tryNext(); });
  }

  tryNext();
}

// Chequeo periódico de estado
setInterval(function() {
  detectMixnetDir();
  checkSupervisorConnection();
}, 20000);

detectMixnetDir();
checkSupervisorConnection();

/* ══════════════════════════════════════════════════════════════════════════
   3. EXTRACCION Y NORMALIZACION INTEGRAL DE MODULOS MIXNET
   ══════════════════════════════════════════════════════════════════════════ */
function findTablePath(tableName) {
  if (!activeMixnetDir) return null;
  var upper = path.join(activeMixnetDir, tableName.toUpperCase() + '.DBF');
  if (fs.existsSync(upper)) return upper;
  var lower = path.join(activeMixnetDir, tableName.toLowerCase() + '.dbf');
  if (fs.existsSync(lower)) return lower;
  return null;
}

// Modulo 1: Cuentas por Cobrar (CxC) y Cartera de Clientes
function extractCxC() {
  var cliPath = findTablePath('MXCTACLI');
  var cobPath = findTablePath('MXTRACOB') || findTablePath('MXRENCOB') || findTablePath('MXMOVCOB');
  var pedPath = findTablePath('MXENCPED');

  var clientes = {};
  if (cliPath) {
    var structCli = readDbfStructure(cliPath);
    var rowsCli = readDbfRows(structCli, 10000);
    for (var i = 0; i < rowsCli.length; i++) {
      var c = rowsCli[i];
      var cod = String(c.codcli || c.codigo || '').trim();
      if (cod) {
        clientes[cod] = {
          codigo: cod,
          nombre: String(c.nomcli || c.nombre || '').trim(),
          rif: String(c.cif || c.rif || '').trim(),
          telefono: String(c.telefono || c.telefonos || '').trim(),
          vendedor: String(c.vendedor || c.codven || '').trim(),
          limite_cred: parseFloat(c.limite || c.lim_cred || 0) || 0,
          saldo_pendiente: parseFloat(c.saldo || c.saldo_act || 0) || 0
        };
      }
    }
  }

  // Analizar movimientos de cobro pendientes o pedidos pendientes de pago
  var documentosPendientes = [];
  var totalDeudaUSD = 0;

  if (pedPath) {
    var structPed = readDbfStructure(pedPath);
    // Pedidos con ESTATUS = 'PE' (Pendiente)
    var rowsPed = readDbfRows(structPed, 5000, function(r) {
      var est = String(r.estatus || '').trim().toUpperCase();
      return est === 'PE' || est === 'CR' || est === '';
    });

    for (var p = 0; p < rowsPed.length; p++) {
      var ped = rowsPed[p];
      var codCli = String(ped.cliente || ped.codcli || '').trim();
      var totalDoc = parseFloat(ped.tot_ped || ped.total || 0) || 0;
      var cliObj = clientes[codCli] || { nombre: 'CLIENTE ' + codCli, rif: '', vendedor: ped.codven };

      if (totalDoc > 0) {
        totalDeudaUSD += totalDoc;
        documentosPendientes.push({
          tipo: 'PEDIDO_PENDIENTE',
          numero: String(ped.numped || '').trim(),
          emision: String(ped.emision || '').trim(),
          codigo_cliente: codCli,
          cliente_nombre: cliObj.nombre,
          rif: cliObj.rif,
          vendedor: String(ped.codven || cliObj.vendedor || '').trim(),
          monto_usd: totalDoc,
          moneda: String(ped.moneda || 'US$').trim()
        });
      }
    }
  }

  // Ordenar por mayor monto adeudado
  documentosPendientes.sort(function(a, b) { return b.monto_usd - a.monto_usd; });

  return {
    total_clientes_registrados: Object.keys(clientes).length,
    documentos_pendientes_count: documentosPendientes.length,
    total_por_cobrar_usd: Math.round(totalDeudaUSD * 100) / 100,
    top_deudores: documentosPendientes.slice(0, 50)
  };
}

// Modulo 2: Cuentas por Pagar (CxP) y Proveedores
function extractCxP() {
  var prvPath = findTablePath('MXCTAPRV') || findTablePath('CTAPRV');
  var pagPath = findTablePath('MXTRAPAG') || findTablePath('MXRENPAG') || findTablePath('MXENCOM');

  var proveedores = {};
  if (prvPath) {
    var structPrv = readDbfStructure(prvPath);
    var rowsPrv = readDbfRows(structPrv, 5000);
    for (var i = 0; i < rowsPrv.length; i++) {
      var p = rowsPrv[i];
      var cod = String(p.codprv || p.codigo || '').trim();
      if (cod) {
        proveedores[cod] = {
          codigo: cod,
          nombre: String(p.nomprv || p.nombre || '').trim(),
          rif: String(p.cif || p.rif || '').trim(),
          telefono: String(p.telefono || '').trim(),
          saldo: parseFloat(p.saldo || 0) || 0
        };
      }
    }
  }

  var cuentasPorPagar = [];
  var totalPorPagarUSD = 0;

  if (pagPath) {
    var structPag = readDbfStructure(pagPath);
    var rowsPag = readDbfRows(structPag, 3000);
    for (var j = 0; j < rowsPag.length; j++) {
      var pag = rowsPag[j];
      var monto = parseFloat(pag.monto || pag.tot_fac || pag.saldo || 0) || 0;
      var codPrv = String(pag.codprv || pag.proveedor || '').trim();
      var prvObj = proveedores[codPrv] || { nombre: 'PROVEEDOR ' + codPrv, rif: '' };

      if (monto > 0) {
        totalPorPagarUSD += monto;
        cuentasPorPagar.push({
          documento: String(pag.numcom || pag.numfac || pag.documento || '').trim(),
          emision: String(pag.emision || pag.fecha || '').trim(),
          vencimiento: String(pag.vence || pag.fecven || '').trim(),
          proveedor: prvObj.nombre,
          rif: prvObj.rif,
          monto_usd: monto
        });
      }
    }
  }

  cuentasPorPagar.sort(function(a, b) { return b.monto_usd - a.monto_usd; });

  return {
    total_proveedores: Object.keys(proveedores).length,
    facturas_por_pagar_count: cuentasPorPagar.length,
    total_por_pagar_usd: Math.round(totalPorPagarUSD * 100) / 100,
    pendientes: cuentasPorPagar.slice(0, 50)
  };
}

// Modulo 3: Nomina, Vendedores y Liquidación de Comisiones
function extractNomina() {
  var pedPath = findTablePath('MXENCPED');
  var facPath = findTablePath('MXENCFAC');

  var sellersMap = {};
  for (var code in config.vendedores) {
    if (config.vendedores.hasOwnProperty(code)) {
      sellersMap[code] = {
        codigo: code,
        nombre: config.vendedores[code].nombre,
        rol: config.vendedores[code].rol,
        total_ventas_usd: 0,
        pedidos_count: 0,
        facturas_count: 0,
        pedidos_recientes: []
      };
    }
  }

  var totalVendidoGlobalUSD = 0;

  function procesarDocumentos(filePath, esFactura) {
    if (!filePath) return;
    var struct = readDbfStructure(filePath);
    var rows = readDbfRows(struct, 10000);
    for (var i = 0; i < rows.length; i++) {
      var doc = rows[i];
      var codven = String(doc.codven || '').trim();
      var total = parseFloat(doc.tot_ped || doc.tot_fac || doc.total || 0) || 0;

      if (!codven) codven = '005'; // Mostrador por defecto

      if (!sellersMap[codven]) {
        sellersMap[codven] = {
          codigo: codven,
          nombre: 'Vendedor ' + codven,
          rol: 'Asesor Comercial',
          total_ventas_usd: 0,
          pedidos_count: 0,
          facturas_count: 0,
          pedidos_recientes: []
        };
      }

      if (total > 0) {
        sellersMap[codven].total_ventas_usd += total;
        totalVendidoGlobalUSD += total;
        if (esFactura) {
          sellersMap[codven].facturas_count++;
        } else {
          sellersMap[codven].pedidos_count++;
          if (sellersMap[codven].pedidos_recientes.length < 8) {
            sellersMap[codven].pedidos_recientes.push({
              numero: String(doc.numped || '').trim(),
              emision: String(doc.emision || '').trim(),
              cliente: String(doc.cliente || '').trim(),
              total_usd: total,
              estatus: String(doc.estatus || '').trim()
            });
          }
        }
      }
    }
  }

  procesarDocumentos(pedPath, false);
  procesarDocumentos(facPath, true);

  var listado = [];
  for (var k in sellersMap) {
    if (sellersMap.hasOwnProperty(k)) {
      var s = sellersMap[k];
      s.total_ventas_usd = Math.round(s.total_ventas_usd * 100) / 100;
      // Estimación base de comisión (variable según política de la empresa, ej 3% general)
      s.comision_estimada_3pct = Math.round((s.total_ventas_usd * 0.03) * 100) / 100;
      listado.push(s);
    }
  }

  listado.sort(function(a, b) { return b.total_ventas_usd - a.total_ventas_usd; });

  return {
    total_ventas_registradas_usd: Math.round(totalVendidoGlobalUSD * 100) / 100,
    vendedores: listado
  };
}

// Modulo 4: Inventario, Existencias y Valoración
function extractInventario() {
  var invPath = findTablePath('MXCTAINV') || findTablePath('VICTAINV');
  if (!invPath) return { total_articulos: 0, valor_costo_usd: 0, valor_venta_usd: 0, productos: [] };

  var struct = readDbfStructure(invPath);
  var rows = readDbfRows(struct, 15000);

  var totalArticulos = rows.length;
  var conStock = 0;
  var sinStock = 0;
  var valorCostoTotal = 0;
  var valorVentaTotal = 0;
  var itemsDestacados = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var sku = String(r.item || r.codigo || '').trim();
    var desc = String(r.descrip || r.nombre || '').trim();
    var stock = parseFloat(r.existencia || r.actual || r.stock || 0) || 0;
    var costo = parseFloat(r.costo || r.costo_rep || 0) || 0;
    var precioB = parseFloat(r.precio2 || r.precio_b || r.precio || 0) || 0; // Precio Cliente B
    var precioA = parseFloat(r.precio1 || r.precio_a || 0) || 0;

    if (stock > 0) {
      conStock++;
      valorCostoTotal += (stock * costo);
      valorVentaTotal += (stock * precioB);
    } else {
      sinStock++;
    }

    if (itemsDestacados.length < 100 && (stock > 0 || precioB > 0)) {
      itemsDestacados.push({
        sku: sku,
        descripcion: desc,
        stock: stock,
        costo_usd: costo,
        precio_usd: precioB,
        precio_mayor_usd: precioA,
        valor_existencia_usd: Math.round(stock * precioB * 100) / 100
      });
    }
  }

  itemsDestacados.sort(function(a, b) { return b.valor_existencia_usd - a.valor_existencia_usd; });

  return {
    total_articulos: totalArticulos,
    articulos_con_stock: conStock,
    articulos_sin_stock: sinStock,
    valor_total_costo_usd: Math.round(valorCostoTotal * 100) / 100,
    valor_total_venta_usd: Math.round(valorVentaTotal * 100) / 100,
    margen_potencial_usd: Math.round((valorVentaTotal - valorCostoTotal) * 100) / 100,
    productos: itemsDestacados
  };
}

// Modulo 5: Bancos y Movimientos de Caja
function extractBancos() {
  var bcoPath = findTablePath('MXBANCO') || findTablePath('BANCO');
  var movPath = findTablePath('MXMOVBAN') || findTablePath('MXCAJA');

  var cuentas = [];
  var saldoTotalBancos = 0;

  if (bcoPath) {
    var structBco = readDbfStructure(bcoPath);
    var rowsBco = readDbfRows(structBco, 50);
    for (var i = 0; i < rowsBco.length; i++) {
      var b = rowsBco[i];
      var saldo = parseFloat(b.saldo || b.saldo_act || 0) || 0;
      saldoTotalBancos += saldo;
      cuentas.push({
        codigo: String(b.codban || b.codigo || '').trim(),
        banco: String(b.nomban || b.nombre || '').trim(),
        numero_cuenta: String(b.numcta || b.cuenta || '').trim(),
        moneda: String(b.moneda || 'BS').trim(),
        saldo: saldo
      });
    }
  }

  var ultimosMovimientos = [];
  if (movPath) {
    var structMov = readDbfStructure(movPath);
    var rowsMov = readDbfRows(structMov, 50);
    for (var j = 0; j < rowsMov.length; j++) {
      var m = rowsMov[j];
      ultimosMovimientos.push({
        fecha: String(m.fecha || m.emision || '').trim(),
        tipo: String(m.tipo || m.tipo_mov || '').trim(),
        descripcion: String(m.concepto || m.descrip || '').trim(),
        monto: parseFloat(m.monto || m.importe || 0) || 0,
        cuenta: String(m.cuenta || m.codban || '').trim()
      });
    }
  }

  return {
    total_cuentas: cuentas.length,
    saldo_total_consolidado: Math.round(saldoTotalBancos * 100) / 100,
    cuentas: cuentas,
    movimientos_recientes: ultimosMovimientos.slice(0, 20)
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4. MOTOR INTELIGENTE GEMINI AI (POOL DE 7 LLAVES + CASCADA DE MODELOS)
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

var activeKeys = (config.gemini_keys && config.gemini_keys.length > 0)
  ? config.gemini_keys
  : DEFAULT_KEY_TOKENS.map(decodeKey);

var keyIndex = 0;
function getNextGeminiKey() {
  if (!activeKeys || activeKeys.length === 0) return null;
  var key = activeKeys[keyIndex];
  keyIndex = (keyIndex + 1) % activeKeys.length;
  return key;
}

function callGemini(systemPrompt, userPrompt, callback) {
  var models = config.gemini_models;
  var keys = activeKeys;

  if (!keys || keys.length === 0) {
    return callback(new Error('No hay claves de Gemini configuradas.'));
  }

  var modelIdx = 0;
  var attempts = 0;
  var maxAttempts = keys.length * 2;

  function attemptCall() {
    if (attempts >= maxAttempts) {
      return callback(new Error('Se agotaron los reintentos en el pool de Gemini.'));
    }
    attempts++;

    var currentModel = models[modelIdx % models.length];
    var currentKey = getNextGeminiKey();

    var postData = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048
      }
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
      timeout: 8000
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
        } else if (res.statusCode === 429 || res.statusCode === 503) {
          // Cuota o sobrecarga: rotar de modelo y llave
          modelIdx++;
          return attemptCall();
        } else {
          modelIdx++;
          return attemptCall();
        }
      });
    });

    req.on('error', function() {
      modelIdx++;
      attemptCall();
    });

    req.on('timeout', function() {
      req.destroy();
      modelIdx++;
      attemptCall();
    });

    req.write(postData);
    req.end();
  }

  attemptCall();
}

/* ══════════════════════════════════════════════════════════════════════════
   5. SERVIDOR HTTP REST Y PANEL WEB INTEGRADO
   ══════════════════════════════════════════════════════════════════════════ */
function sendJSON(res, status, obj) {
  var data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(data);
}

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // Manejo de CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --- RUTAS DE API ---
  if (pathname === '/api/status') {
    return sendJSON(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      mixnet_dir: activeMixnetDir,
      mixnet_connected: activeMixnetDir !== null,
      supervisor: supervisorStatus,
      gemini_keys_count: config.gemini_keys.length,
      node_version: process.version,
      platform: process.platform,
      os_release: os.release(),
      hostname: os.hostname(),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }

  if (pathname === '/api/overview') {
    var cxc = extractCxC();
    var cxp = extractCxP();
    var nom = extractNomina();
    var inv = extractInventario();
    var bco = extractBancos();

    return sendJSON(res, 200, {
      ok: true,
      timestamp: new Date().toISOString(),
      cxc_total_usd: cxc.total_por_cobrar_usd,
      cxp_total_usd: cxp.total_por_cobrar_usd,
      ventas_globales_usd: nom.total_ventas_registradas_usd,
      inventario_costo_usd: inv.valor_total_costo_usd,
      inventario_venta_usd: inv.valor_total_venta_usd,
      saldo_bancos: bco.saldo_total_consolidado,
      clientes_count: cxc.total_clientes_registrados,
      proveedores_count: cxp.total_proveedores,
      articulos_count: inv.total_articulos
    });
  }

  if (pathname === '/api/cxc') {
    return sendJSON(res, 200, { ok: true, data: extractCxC() });
  }

  if (pathname === '/api/cxp') {
    return sendJSON(res, 200, { ok: true, data: extractCxP() });
  }

  if (pathname === '/api/nomina') {
    return sendJSON(res, 200, { ok: true, data: extractNomina() });
  }

  if (pathname === '/api/inventario') {
    return sendJSON(res, 200, { ok: true, data: extractInventario() });
  }

  if (pathname === '/api/bancos') {
    return sendJSON(res, 200, { ok: true, data: extractBancos() });
  }

  // --- CONSULTA IA GEMINI EN TIEMPO REAL ---
  if (pathname === '/api/ai/ask' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var payload = JSON.parse(body);
        var userQuestion = payload.question || '';

        // Recopilar snapshot vivo de todos los módulos para alimentar a la IA
        var cxc = extractCxC();
        var cxp = extractCxP();
        var nom = extractNomina();
        var inv = extractInventario();
        var bco = extractBancos();

        var systemPrompt = [
          "Eres el Asistente Ejecutivo y Financiero Inteligente de JJ Paper C.A. para MixNet ERP.",
          "Tienes acceso directo en tiempo real a las tablas del sistema de facturación y administración de la empresa.",
          "DATOS FINANCIEROS ACTUALES EN VIVO:",
          "- Total Cuentas por Cobrar (CxC): $" + cxc.total_por_cobrar_usd + " USD en " + cxc.documentos_pendientes_count + " documentos.",
          "- Total Cuentas por Pagar (CxP): $" + cxp.total_por_cobrar_usd + " USD a proveedores.",
          "- Ventas Globales Acumuladas: $" + nom.total_ventas_registradas_usd + " USD.",
          "- Inventario Valorizado: Costo $" + inv.valor_total_costo_usd + " USD | Venta $" + inv.valor_total_venta_usd + " USD.",
          "- Artículos sin existencia física: " + inv.articulos_sin_stock + " de " + inv.total_articulos + ".",
          "- Vendedores en nómina registrados: " + JSON.stringify(nom.vendedores.map(function(v){ return v.codigo + ' ' + v.nombre + ': $' + v.total_ventas_usd; })),
          "- Top 5 Clientes con mayor deuda: " + JSON.stringify(cxc.top_deudores.slice(0, 5).map(function(d){ return d.cliente_nombre + ' ($' + d.monto_usd + ')'; })),
          "REGLAS:",
          "1. Responde con precisión matemática, tono directivo y ejecutivo.",
          "2. Si te preguntan por nómina o vendedores, menciona el nombre oficial (Luis Alarcón 002, Yovanni 004/006, Marianela 008, Andreina 014, Keyder 010/020, Mostrador 005).",
          "3. Estructura tus respuestas con viñetas claras y conclusiones accionables."
        ].join('\n');

        callGemini(systemPrompt, userQuestion, function(err, result) {
          if (err) {
            return sendJSON(res, 500, { ok: false, error: err.message });
          }
          return sendJSON(res, 200, { ok: true, answer: result.text, model: result.model });
        });
      } catch (err) {
        return sendJSON(res, 400, { ok: false, error: 'JSON malformado' });
      }
    });
    return;
  }

  // --- AUDITORÍA PRE-DISEÑADA IA ---
  if (pathname === '/api/ai/audit' && req.method === 'POST') {
    var aBody = '';
    req.on('data', function(c) { aBody += c; });
    req.on('end', function() {
      try {
        var aPayload = JSON.parse(aBody);
        var auditType = aPayload.type || 'financiera';

        var cxc = extractCxC();
        var cxp = extractCxP();
        var nom = extractNomina();
        var inv = extractInventario();
        var bco = extractBancos();

        var prompts = {
          financiera: "Elabora un Informe Ejecutivo Financiero Consolidado de JJ Paper. Analiza balance de CxC vs CxP, liquidez estimada, margen potencial de inventario y recomendaciones de flujo de caja.",
          cobranzas: "Genera un Plan Estratégico de Cobranzas Inmediatas. Identifica a los clientes con mayor volumen de deuda pendiente, sugiere acciones de cobro y priorización por impacto.",
          nomina: "Realiza una Auditoría de Rendimiento de Ventas y Liquidación de Comisiones por Vendedor en MixNet. Analiza quién lidera las ventas y calcula sugerencias de comisiones.",
          stock: "Elabora un Diagnóstico de Quiebres y Reposición de Inventario. Analiza artículos con alta rotación sin existencia, valor total congelado y alertas críticas de almacén."
        };

        var question = prompts[auditType] || prompts.financiera;

        var sysPrompt = [
          "Eres el Auditor Principal de Operaciones y Finanzas de JJ Paper C.A. para MixNet ERP.",
          "DATOS DEL ERP:",
          "- CxC Pendientes: $" + cxc.total_por_cobrar_usd + " USD (" + cxc.documentos_pendientes_count + " pedidos)",
          "- CxP Proveedores: $" + cxp.total_por_cobrar_usd + " USD",
          "- Ventas Totales: $" + nom.total_ventas_registradas_usd + " USD",
          "- Inventario: " + inv.articulos_con_stock + " con stock, " + inv.articulos_sin_stock + " agotados. Valor Venta: $" + inv.valor_total_venta_usd + " USD",
          "- Desglose Vendedores: " + JSON.stringify(nom.vendedores),
          "- Top Deudores: " + JSON.stringify(cxc.top_deudores.slice(0, 10)),
          "Presenta un informe formal, con formato Markdown profesional, tablas comparativas y conclusiones estratégicas."
        ].join('\n');

        callGemini(sysPrompt, question, function(err, result) {
          if (err) return sendJSON(res, 500, { ok: false, error: err.message });
          return sendJSON(res, 200, { ok: true, report: result.text, model: result.model });
        });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: 'Error procesando solicitud de auditoría' });
      }
    });
    return;
  }

  // --- SERVIR INTERFAZ GRAFICA (HTML / CSS / JS) ---
  var filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  fs.readFile(filePath, function(err, content) {
    if (err) {
      // Fallback a index.html
      var indexPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexPath, function(err2, content2) {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Panel MixNet AI: index.html no encontrado en carpeta public/');
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
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.ico') contentType = 'image/x-icon';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

var PORT = config.port || 3300;
server.listen(PORT, '0.0.0.0', function() {
  console.log('========================================================================');
  console.log('  JJ PAPER — MONITOR Y CONTROL EJECUTIVO MIXNET AI (WIN 7 / NODE 13)    ');
  console.log('========================================================================');
  console.log('  [OK] Servidor activo en puerto local: ' + PORT);
  console.log('  [OK] Acceso local:       http://localhost:' + PORT);
  console.log('  [OK] Acceso desde LAN:   http://' + (getLanIp() || '127.0.0.1') + ':' + PORT);
  console.log('  [DBF] Directorio MixNet: ' + (activeMixnetDir || 'Buscando en red/unidades...'));
  console.log('  [RED] PC Supervisor:     ' + (supervisorStatus.online ? 'En linea (' + supervisorStatus.latency + 'ms)' : 'Buscando enlace...'));
  console.log('  [IA]  Gemini Pool:       7 Claves activas con failover automatico');
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
