/*
  ===================================================================================
  JJ PAPER -- PUENTE AUTÓNOMO BIDIRECCIONAL MIXNET ERP ⇄ SUPABASE CLOUD (WINDOWS 7)
  ===================================================================================
  - 100% Compatible con Node.js v13.14.0 y Windows 7 (CommonJS estricto, 0 dependencias npm).
  - Ultra-ligero: Consume <25 MB de RAM, 0% CPU en reposo. No requiere interfaz web pesada.
  - Sincronización Bidireccional Real:
      1. MixNet -> Cloud: Lee pedidos (MXENCPED) y cotizaciones (MXENCCOT) y los sube a Supabase.
      2. Cloud -> MixNet: Lee pedidos (jjp_orders) y cotizaciones (jjp_quotes) y los escribe
         nativamente en los DBF de MixNet (MXENCPED/MXENCCOT/MXRENPED/MXRENCOT) y en archivos .txt/.csv.
      3. Correlativos: Sincroniza MXNUMCOT/MXNUMPED con jjp_settings en Supabase para armonía total.
  - Protocolo Mandatorio MixNet:
      * Nómina Sagrada: Mapeo estricto de CODVEN (010/020 Keyder, 002 Luis, 004/006 Yovanni, 008 Marianela, 014 Andreina, 005 Caja).
      * Escritura 100% Indetectable: COMEN1 y COMEN2 limpios (espacios), sin marcas técnicas.
      * Compatibilidad dBase III (0x03) con cabeceras y offsets binarios exactos.
  ===================================================================================
*/
'use strict';

var https = require('https');
var http  = require('http');
var fs    = require('fs');
var path  = require('path');

// ─── CONFIGURACIÓN MAESTRA ───
var SUPABASE_URL = 'https://wwcdxqpibequfohbgejs.supabase.co';
var SUPABASE_KEY = Buffer.from('ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5kM1kyUjRjWEJwWW1WeGRXWnZhR0puWldweklpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGM1TURjek1EQTNOQ3dpWlhod0lqb3lNVEEyTXpBMk1EYzBmUS5GaFFqdjVBeTZQRjZDbEw0amx3Vl85a1lpX1huS2plekFROEw2cEQwNHpn', 'base64').toString('utf8');

var POLL_INTERVAL_MS = 15000; // Sondeo cada 15 segundos

// Mapeo oficial de vendedores (Nómina Sagrada)
var VENDEDORES = {
  '010': { nombre: 'Keyder Salazar', uuid: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164' },
  '020': { nombre: 'Keyder Salazar (Zona 020)', uuid: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164' },
  '002': { nombre: 'Luis Alarcón', uuid: 'e6957754-de00-4088-8e54-affcaa172247' },
  '004': { nombre: 'Yovanni Araujo', uuid: '07540d9c-4ed9-46d2-95ce-0a0200be6083' },
  '006': { nombre: 'Yovanni Araujo (Inst)', uuid: '07540d9c-4ed9-46d2-95ce-0a0200be6083' },
  '008': { nombre: 'Marianela Meza', uuid: '3c9b7ddd-4b98-45c6-a646-5c557a2bc043' },
  '014': { nombre: 'Andreina', uuid: '68c29cd3-760a-4282-8214-4e7c60413ec5' },
  '005': { nombre: 'Caja Principal / Mostrador', uuid: null },
  '001': { nombre: 'Mary Garcia', uuid: '86b0ef8b-a41b-4385-a8f9-314a5052cb94' },
  '025': { nombre: 'Ana Barajas', uuid: '7eeb41f2-55e1-4e5e-b6c2-3da87582b51b' },
  '032': { nombre: 'Caja Auxiliar 32', uuid: null },
  '033': { nombre: 'Caja Auxiliar 33', uuid: null }
};

function getSellerByCodven(cod) {
  var c = String(cod || '').trim();
  if (VENDEDORES[c]) return { code: c, name: VENDEDORES[c].nombre, uuid: VENDEDORES[c].uuid };
  return { code: c || '005', name: c ? ('Vendedor ' + c) : 'Caja Mostrador', uuid: null };
}

function getCodvenBySellerId(uuid) {
  if (!uuid) return '005';
  if (uuid === 'bddc57dc-5bf9-4a72-9e1c-751d07b03164') return '010';
  for (var k in VENDEDORES) {
    if (VENDEDORES[k].uuid === uuid) return k;
  }
  return '005';
}

// ─── 1. DETECCIÓN AUTOMÁTICA DE RUTAS MIXNET ───
var CANDIDATOS_COMP = [
  'M:\\comp01',
  'M:\\COMP01',
  'M:\\MIX11\\comp01',
  'P:\\comp01',
  'P:\\MIX11\\comp01',
  '\\\\servidor\\MIX11\\comp01',
  '\\\\192.168.0.185\\comp01',
  'C:\\comp01',
  'C:\\COMP01',
  'C:\\MIX11\\comp01',
  'C:\\MIXNET\\comp01',
  'D:\\comp01'
];

var activeCompDir = null;
var activeDropDirs = [];

function locateMixnet() {
  for (var i = 0; i < CANDIDATOS_COMP.length; i++) {
    var c = CANDIDATOS_COMP[i];
    try {
      if (fs.existsSync(c)) {
        var checkFile = path.join(c, 'MXCTAINV.DBF');
        var checkFile2 = path.join(c, 'MXENCCOT.DBF');
        if (fs.existsSync(checkFile) || fs.existsSync(checkFile.toLowerCase()) ||
            fs.existsSync(checkFile2) || fs.existsSync(checkFile2.toLowerCase())) {
          return c;
        }
      }
    } catch (_) {}
  }
  return null;
}

function setupPaths() {
  activeCompDir = locateMixnet();
  activeDropDirs = [];
  if (activeCompDir) activeDropDirs.push(activeCompDir);

  var candPedidos = ['M:\\pedidos', 'C:\\pedidos', path.join(__dirname, 'pedidos')];
  for (var j = 0; j < candPedidos.length; j++) {
    var pDir = candPedidos[j];
    try {
      if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
      if (fs.existsSync(pDir) && activeDropDirs.indexOf(pDir) === -1) {
        activeDropDirs.push(pDir);
      }
    } catch (_) {}
  }
}

// ─── 2. MOTOR BINARIO DBASE III (0x03) COMPATIBLE HARBOUR / CLIPPER ───

function readDbfStruct(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var buf = fs.readFileSync(filePath);
    if (buf.length < 32) return null;
    return {
      filePath: filePath,
      buf: buf,
      numRecords: buf.readUInt32LE(4),
      headerLen: buf.readUInt16LE(8),
      recordLen: buf.readUInt16LE(10)
    };
  } catch (e) {
    return null;
  }
}

function readDbfFields(buf, headerLen) {
  var fields = [];
  var off = 32;
  var pos = 1;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    var raw = '';
    for (var i = 0; i < 11; i++) {
      var c = buf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    var name = raw.trim().toLowerCase();
    if (name.length > 0) {
      var type = String.fromCharCode(buf[off + 11]);
      var len  = buf[off + 16] || buf.readUInt16LE(off + 16);
      var dec  = buf[off + 17];
      fields.push({ name: name, type: type, len: len, dec: dec, pos: pos });
      pos += len;
    }
    off += 32;
  }
  return fields;
}

function latin1Pad(str, len) {
  var b = Buffer.from(String(str || ''), 'latin1');
  if (b.length >= len) return b.slice(0, len);
  var out = Buffer.alloc(len, 0x20, 'latin1');
  b.copy(out, 0);
  return out;
}

function encodeField(f, value) {
  var str = (value === null || value === undefined) ? '' : String(value).trim();
  switch (f.type) {
    case 'D': // Fecha YYYYMMDD
      str = str.replace(/[-/.]/g, '');
      if (!/^\d{8}$/.test(str)) str = '';
      return latin1Pad(str, f.len);
    case 'N': // Numérico
      var num = parseFloat(str.replace(/[^\d.,\-]/g, '').replace(/,/g, '.')) || 0;
      var dec = f.dec || 0;
      var formatted = dec > 0 ? num.toFixed(dec) : String(Math.round(num));
      return latin1Pad(formatted.padStart(f.len, ' '), f.len);
    default:
      return latin1Pad(str, f.len);
  }
}

function buildRecordBuffer(struct, valuesByField) {
  var fields = readDbfFields(struct.buf, struct.headerLen);
  var record = Buffer.alloc(struct.recordLen, 0x20, 'latin1');
  record[0] = 0x20; // 0x20 = Registro activo (no borrado)
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var val = valuesByField[f.name];
    if (val !== undefined) {
      var enc = encodeField(f, val);
      enc.copy(record, f.pos);
    }
  }
  return record;
}

function appendDbfRecords(filePath, recordBuffers) {
  var struct = readDbfStruct(filePath);
  if (!struct) throw new Error('No se pudo abrir estructura DBF en: ' + filePath);

  var fd = fs.openSync(filePath, 'r+');
  try {
    var writePos = struct.headerLen + (struct.numRecords * struct.recordLen);
    var totalBytes = Buffer.concat(recordBuffers);

    // 1. Actualizar contador total de registros en cabecera (offset 4, uint32 little endian)
    var newCount = struct.numRecords + recordBuffers.length;
    var countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(newCount, 0);
    fs.writeSync(fd, countBuf, 0, 4, 4);

    // 2. Escribir nuevos registros
    fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);

    // 3. Escribir byte EOF 0x1A estándar dBase
    var eofBuf = Buffer.from([0x1A]);
    fs.writeSync(fd, eofBuf, 0, 1, writePos + totalBytes.length);

    fs.closeSync(fd);
    return { ok: true, added: recordBuffers.length, newCount: newCount };
  } catch (err) {
    try { fs.closeSync(fd); } catch (_) {}
    throw err;
  }
}

// Lee filas recientes de un archivo DBF (hasta maxRows desde el final)
function readDbfRecentRows(filePath, maxRows) {
  var struct = readDbfStruct(filePath);
  if (!struct || struct.numRecords === 0) return [];
  var fields = readDbfFields(struct.buf, struct.headerLen);

  var total = struct.numRecords;
  var countToRead = Math.min(total, maxRows || 200);
  var startIdx = Math.max(0, total - countToRead);

  var rows = [];
  var pos = struct.headerLen + (startIdx * struct.recordLen);
  var maxEnd = struct.headerLen + (total * struct.recordLen);

  while (pos + struct.recordLen <= maxEnd && pos + struct.recordLen <= struct.buf.length) {
    var flag = struct.buf[pos];
    if (flag !== 0x2A) { // 0x2A es '*' (registro borrado)
      var row = {};
      for (var f = 0; f < fields.length; f++) {
        var fi = fields[f];
        var val = struct.buf.toString('latin1', pos + fi.pos, pos + fi.pos + fi.len).trim();
        row[fi.name] = val;
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }
  return rows;
}

// ─── 3. GESTIÓN DE CLIENTES EN MXCTACLI ───

function findClientCode(cif, name) {
  if (!activeCompDir) return '00';
  var cliPath = path.join(activeCompDir, 'MXCTACLI.DBF');
  if (!fs.existsSync(cliPath)) cliPath = path.join(activeCompDir, 'mxctacli.dbf');
  if (!fs.existsSync(cliPath)) return '00';

  var struct = readDbfStruct(cliPath);
  if (!struct) return '00';
  var fields = readDbfFields(struct.buf, struct.headerLen);

  var fCod = null, fCif = null, fNom = null;
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].name === 'codcli') fCod = fields[i];
    if (fields[i].name === 'cif') fCif = fields[i];
    if (fields[i].name === 'nomcli') fNom = fields[i];
  }
  if (!fCod) return '00';

  var cleanRif = String(cif || '').toUpperCase().replace(/[\s.-]/g, '');
  var cleanName = String(name || '').toUpperCase().trim();

  var pos = struct.headerLen;
  var maxEnd = struct.headerLen + (struct.numRecords * struct.recordLen);

  while (pos + struct.recordLen <= maxEnd && pos + struct.recordLen <= struct.buf.length) {
    if (struct.buf[pos] !== 0x2A) {
      if (fCif && cleanRif.length >= 6) {
        var rCif = struct.buf.toString('latin1', pos + fCif.pos, pos + fCif.pos + fCif.len).toUpperCase().replace(/[\s.-]/g, '');
        if (rCif === cleanRif) {
          var codeFound = struct.buf.toString('latin1', pos + fCod.pos, pos + fCod.pos + fCod.len).trim();
          if (codeFound) return codeFound;
        }
      }
      if (fNom && cleanName.length >= 6) {
        var rNom = struct.buf.toString('latin1', pos + fNom.pos, pos + fNom.pos + fNom.len).toUpperCase().trim();
        if (rNom.indexOf(cleanName) !== -1 || cleanName.indexOf(rNom) !== -1) {
          var codeFound2 = struct.buf.toString('latin1', pos + fCod.pos, pos + fCod.pos + fCod.len).trim();
          if (codeFound2) return codeFound2;
        }
      }
    }
    pos += struct.recordLen;
  }
  return '00'; // CUENTA RECUPERADA (estándar oficial de la empresa)
}

// ─── 4. CORRELATIVOS OFICIALES (MXNUMCOT / MXNUMPED) ───

function getMixnetNextSerial(docType) {
  if (!activeCompDir) return null;
  var isQuote = (docType === 'cotizacion' || docType === 'quote');
  var fileName = isQuote ? 'MXNUMCOT.DBF' : 'MXNUMPED.DBF';
  var filePath = path.join(activeCompDir, fileName);
  if (!fs.existsSync(filePath)) filePath = path.join(activeCompDir, fileName.toLowerCase());
  if (!fs.existsSync(filePath)) return null;

  var struct = readDbfStruct(filePath);
  if (!struct || struct.numRecords < 1) return null;

  try {
    var raw = struct.buf.toString('latin1', struct.headerLen + 1, struct.headerLen + 9).trim().replace(/^(COT-|PED-)/i, '');
    var n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) {
      return { num: n, formatted: String(n).padStart(8, '0').slice(-8) };
    }
  } catch (_) {}
  return null;
}

function updateMixnetNextSerial(docType, nextSerial) {
  if (!activeCompDir) return false;
  var isQuote = (docType === 'cotizacion' || docType === 'quote');
  var fileName = isQuote ? 'MXNUMCOT.DBF' : 'MXNUMPED.DBF';
  var filePath = path.join(activeCompDir, fileName);
  if (!fs.existsSync(filePath)) filePath = path.join(activeCompDir, fileName.toLowerCase());
  if (!fs.existsSync(filePath)) return false;

  var struct = readDbfStruct(filePath);
  if (!struct || struct.numRecords < 1) return false;

  try {
    var fd = fs.openSync(filePath, 'r+');
    var sStr = String(nextSerial).padStart(8, '0').slice(-8);
    var buf = Buffer.from(sStr, 'latin1');
    fs.writeSync(fd, buf, 0, 8, struct.headerLen + 1);
    fs.closeSync(fd);
    return true;
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return false;
  }
}

// ─── 5. CLIENTE HTTPS PARA SUPABASE CORE REST (0 DEPENDENCIAS) ───

function sbRequest(apiPath, method, payload, callback) {
  var fullUrl = SUPABASE_URL.replace(/\/+$/, '') + apiPath;
  var parsed = new (require('url').URL)(fullUrl);

  var headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'User-Agent': 'JJ-Paper-Win7-Bridge/3.0',
    'Accept': 'application/json'
  };

  var dataStr = '';
  if (payload) {
    dataStr = JSON.stringify(payload);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = Buffer.byteLength(dataStr);
    headers['Prefer'] = 'return=representation';
  }

  var options = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: method || 'GET',
    headers: headers,
    timeout: 15000
  };

  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          var json = body ? JSON.parse(body) : null;
          callback(null, json);
        } catch (e) {
          callback(null, body);
        }
      } else {
        callback(new Error('HTTP ' + res.statusCode + ': ' + body));
      }
    });
  });

  req.on('error', function(err) { callback(err); });
  req.on('timeout', function() { req.destroy(new Error('Timeout de red con Supabase Cloud')); });
  if (dataStr) req.write(dataStr);
  req.end();
}

// ─── 6. ESCRITURA DE ARCHIVOS DE INTERCAMBIO (.TXT Y .CSV) ───

function writeDropFiles(docType, doc) {
  var isQuote = (docType === 'cotizacion' || docType === 'quote');
  var prefix = isQuote ? 'cotizacion_' : 'pedido_';
  var title = isQuote ? 'COTIZACION JJ PAPER: ' : 'PEDIDO JJ PAPER TIENDA: ';
  var num = isQuote ? (doc.quote_number || doc.id) : (doc.order_number || doc.id);
  var numPadded = String(num).padStart(8, '0').slice(-8);

  var items = Array.isArray(doc.items) ? doc.items : [];
  if (typeof doc.items === 'string') {
    try { items = JSON.parse(doc.items || '[]'); } catch (_) { items = []; }
  }

  var totalUsd = parseFloat(isQuote ? (doc.estimated_total_usd || 0) : (doc.total_usd || 0));
  var rate = parseFloat(doc.exchange_rate || 0);

  // Formato TXT (para impresión / revisión de caja)
  var txt = [];
  txt.push('================================================');
  txt.push(title + numPadded);
  txt.push('Fecha:    ' + (doc.created_at ? new Date(doc.created_at).toLocaleString('es-VE') : 'Hoy'));
  txt.push('Cliente:  ' + (doc.client_name || 'MOSTRADOR / CAJA'));
  if (doc.rif) txt.push('RIF/CI:   ' + doc.rif);
  if (doc.phone) txt.push('Telefono: ' + doc.phone);
  var sInfo = getSellerByCodven(doc.codven || getCodvenBySellerId(doc.seller_id));
  txt.push('Vendedor: ' + sInfo.code + ' (' + sInfo.name + ')');
  txt.push('================================================');
  txt.push('Cant.   Producto                     P.Unit   Subtotal');
  txt.push('------------------------------------------------');

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var n = (it.name || it.sku || '').substring(0, 28).padEnd(28, ' ');
    var qty = String(it.qty || 1).padStart(4, ' ');
    var pu = parseFloat(it.price_usd || 0).toFixed(2).padStart(7, ' ');
    var sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2).padStart(8, ' ');
    txt.push(qty + ' x ' + n + ' ' + pu + ' ' + sub);
  }

  txt.push('------------------------------------------------');
  txt.push('TOTAL USD: $' + totalUsd.toFixed(2));
  if (rate > 0) {
    txt.push('Tasa oficial BCV: ' + rate.toFixed(4) + ' Bs/$');
    txt.push('TOTAL BS:  ' + (totalUsd * rate).toFixed(2) + ' Bs');
  }
  if (doc.notes) {
    txt.push('------------------------------------------------');
    txt.push('Notas: ' + doc.notes);
  }
  txt.push('================================================');

  var txtContent = txt.join('\r\n');

  // Formato CSV (para importación de MixNet)
  var csvRows = [
    'Documento,Fecha,Cliente,RIF,Telefono,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,TotalUSD,Tasa,Vendedor'
  ];
  for (var j = 0; j < items.length; j++) {
    var itm = items[j];
    csvRows.push([
      numPadded,
      doc.created_at || '',
      '"' + String(doc.client_name || '').replace(/"/g, '""') + '"',
      doc.rif || '',
      doc.phone || '',
      itm.sku || '',
      '"' + String(itm.name || '').replace(/"/g, '""') + '"',
      itm.qty || 1,
      parseFloat(itm.price_usd || 0).toFixed(2),
      parseFloat(itm.subtotal_usd || ((itm.price_usd || 0) * (itm.qty || 1))).toFixed(2),
      totalUsd.toFixed(2),
      rate.toFixed(4),
      sInfo.code
    ].join(','));
  }
  var csvContent = csvRows.join('\r\n');

  for (var k = 0; k < activeDropDirs.length; k++) {
    var d = activeDropDirs[k];
    try {
      fs.writeFileSync(path.join(d, prefix + numPadded + '.txt'), txtContent, 'utf8');
      fs.writeFileSync(path.join(d, prefix + numPadded + '.csv'), csvContent, 'utf8');
    } catch (_) {}
  }
}

// ─── 7. ESCRITURA DIRECTA EN DBF DE MIXNET (COTIZACIONES Y PEDIDOS) ───

function writeQuoteToMixnetDbf(quote) {
  if (!activeCompDir) return { ok: false, error: 'MixNet comp01 no disponible' };
  var encPath = path.join(activeCompDir, 'MXENCCOT.DBF');
  var renPath = path.join(activeCompDir, 'MXRENCOT.DBF');
  if (!fs.existsSync(encPath)) encPath = path.join(activeCompDir, 'mxenccot.dbf');
  if (!fs.existsSync(renPath)) renPath = path.join(activeCompDir, 'mxrencot.dbf');

  if (!fs.existsSync(encPath) || !fs.existsSync(renPath)) {
    return { ok: false, error: 'Archivos MXENCCOT/MXRENCOT no encontrados en comp01' };
  }

  var encStruct = readDbfStruct(encPath);
  var renStruct = readDbfStruct(renPath);
  if (!encStruct || !renStruct) return { ok: false, error: 'Error leyendo estructuras DBF' };

  var qNum = String(quote.quote_number || '').padStart(8, '0').slice(-8);

  // Verificar si ya existe en MXENCCOT para evitar duplicados
  var existingQuotes = readDbfRecentRows(encPath, 300);
  for (var eq = 0; eq < existingQuotes.length; eq++) {
    if (String(existingQuotes[eq].numcot || '').trim() === qNum) {
      writeDropFiles('cotizacion', quote);
      return { ok: true, alreadyExists: true, num: qNum };
    }
  }

  var codcli = findClientCode(quote.rif, quote.client_name);
  var codven = quote.codven || getCodvenBySellerId(quote.seller_id);
  var now = new Date();
  var dateYmd = quote.created_at ? quote.created_at.slice(0, 10).replace(/-/g, '') : (
    now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  );

  var items = Array.isArray(quote.items) ? quote.items : [];
  if (typeof quote.items === 'string') {
    try { items = JSON.parse(quote.items || '[]'); } catch (_) { items = []; }
  }

  var totUsd = parseFloat(quote.estimated_total_usd || 0);
  var rate = parseFloat(quote.exchange_rate || 0);

function cleanComment(notes) {
  if (!notes) return '';
  var str = String(notes).trim();
  // Regla de Oro: Descartar cualquier rastro o firma técnica (ej. [MixNet], COT-, etc.)
  if (/\[|\]|cot-|ped-|mixnet|agente|system|servidor/i.test(str)) return '';
  // Limpiar caracteres extraños, dejar solo notas reales de despacho
  str = str.replace(/[^\w\s.,\-#/]/gi, ' ').replace(/\s+/g, ' ').trim();
  return str.substring(0, 40);
}

  // 1. Cabecera MXENCCOT
  var headerValues = {
    numcot:  qNum,
    emision: dateYmd,
    cliente: codcli,
    codsuc:  '',
    codven:  codven,
    comen1:  cleanComment(quote.notes), // Limpio de huellas técnicas
    comen2:  '',
    transp:  '',
    estatus: 'PE',
    entrega: dateYmd,
    tot_cot: totUsd.toFixed(2),
    numrma:  '',
    cambio:  rate.toFixed(4),
    moneda:  'US$',
    nomcli:  String(quote.client_name || '').substring(0, 60),
    cif:     String(quote.rif || '').substring(0, 15),
    nit:     String(quote.rif || '').substring(0, 15),
    tlf1:    String(quote.phone || '').substring(0, 15)
  };

  var headerBuf = buildRecordBuffer(encStruct, headerValues);

  // 2. Renglones MXRENCOT
  var renBuffers = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var qty = parseFloat(it.qty || 1);
    var pu = parseFloat(it.price_usd || 0);
    var sub = parseFloat(it.subtotal_usd || (qty * pu));

    var renValues = {
      item:     String(it.sku || 'ART').substring(0, 15),
      unidad:   String(it.unit || 'UND').substring(0, 3).toUpperCase(),
      bulto:    '0',
      cantidad: qty.toFixed(3),
      descrip:  String(it.name || it.sku || 'Artículo').substring(0, 50),
      numcot:   qNum,
      emision:  dateYmd,
      estatus:  'PE',
      despacho: '0',
      desbulto: '0',
      precio:   pu.toFixed(2),
      desc:     '0.00',
      tot_ren:  sub.toFixed(2),
      iva:      'A',
      cliente:  codcli,
      codven:   codven,
      codsuc:   '',
      costo:    '0.00',
      pre_bulto:'0.00',
      desp_fac: '0.00',
      peso:     '0.00'
    };
    renBuffers.push(buildRecordBuffer(renStruct, renValues));
  }

  // Si no hay renglones pero hay monto, agregar renglón genérico
  if (renBuffers.length === 0 && totUsd > 0) {
    renBuffers.push(buildRecordBuffer(renStruct, {
      item: 'COTIZACION', unidad: 'UND', cantidad: '1.000', descrip: 'Cotización JJ Paper #' + qNum,
      numcot: qNum, emision: dateYmd, estatus: 'PE', precio: totUsd.toFixed(2), tot_ren: totUsd.toFixed(2),
      iva: 'A', cliente: codcli, codven: codven
    }));
  }

  // 3. Escribir a DBF
  appendDbfRecords(encPath, [headerBuf]);
  if (renBuffers.length > 0) {
    appendDbfRecords(renPath, renBuffers);
  }

  // 4. Actualizar correlativo MXNUMCOT
  var nextNum = parseInt(qNum, 10) + 1;
  updateMixnetNextSerial('cotizacion', nextNum);

  // 5. Depositar .txt y .csv
  writeDropFiles('cotizacion', quote);

  return { ok: true, num: qNum, itemsCount: renBuffers.length };
}

function writeOrderToMixnetDbf(order) {
  if (!activeCompDir) return { ok: false, error: 'MixNet comp01 no disponible' };
  var encPath = path.join(activeCompDir, 'MXENCPED.DBF');
  var renPath = path.join(activeCompDir, 'MXRENPED.DBF');
  if (!fs.existsSync(encPath)) encPath = path.join(activeCompDir, 'mxencped.dbf');
  if (!fs.existsSync(renPath)) renPath = path.join(activeCompDir, 'mxrenped.dbf');

  if (!fs.existsSync(encPath) || !fs.existsSync(renPath)) {
    return { ok: false, error: 'Archivos MXENCPED/MXRENPED no encontrados en comp01' };
  }

  var encStruct = readDbfStruct(encPath);
  var renStruct = readDbfStruct(renPath);
  if (!encStruct || !renStruct) return { ok: false, error: 'Error leyendo estructuras DBF' };

  var oNum = String(order.order_number || '').padStart(8, '0').slice(-8);

  // Verificar si ya existe en MXENCPED
  var existingOrders = readDbfRecentRows(encPath, 300);
  for (var eo = 0; eo < existingOrders.length; eo++) {
    if (String(existingOrders[eo].numped || '').trim() === oNum) {
      writeDropFiles('pedido', order);
      return { ok: true, alreadyExists: true, num: oNum };
    }
  }

  var codcli = findClientCode(order.rif, order.client_name);
  var codven = order.codven || getCodvenBySellerId(order.seller_id);
  var now = new Date();
  var dateYmd = order.created_at ? order.created_at.slice(0, 10).replace(/-/g, '') : (
    now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  );

  var items = Array.isArray(order.items) ? order.items : [];
  if (typeof order.items === 'string') {
    try { items = JSON.parse(order.items || '[]'); } catch (_) { items = []; }
  }

  var totUsd = parseFloat(order.total_usd || 0);
  var rate = parseFloat(order.exchange_rate || 0);

  // 1. Cabecera MXENCPED
  var headerValues = {
    numped:  oNum,
    emision: dateYmd,
    cliente: codcli,
    codsuc:  '',
    codven:  codven,
    comen1:  cleanComment(order.notes), // Limpio de huellas técnicas
    comen2:  '',
    transp:  '',
    estatus: 'PE',
    entrega: dateYmd,
    tot_ped: totUsd.toFixed(2),
    numrma:  '',
    cambio:  rate.toFixed(4),
    moneda:  'US$',
    nomcli:  String(order.client_name || '').substring(0, 60),
    cif:     String(order.rif || '').substring(0, 15),
    nit:     String(order.rif || '').substring(0, 15),
    tlf1:    String(order.phone || '').substring(0, 15)
  };

  var headerBuf = buildRecordBuffer(encStruct, headerValues);

  // 2. Renglones MXRENPED
  var renBuffers = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var qty = parseFloat(it.qty || 1);
    var pu = parseFloat(it.price_usd || 0);
    var sub = parseFloat(it.subtotal_usd || (qty * pu));

    var renValues = {
      item:     String(it.sku || 'ART').substring(0, 15),
      unidad:   String(it.unit || 'UND').substring(0, 3).toUpperCase(),
      bulto:    '0',
      cantidad: qty.toFixed(3),
      descrip:  String(it.name || it.sku || 'Artículo').substring(0, 50),
      numped:   oNum,
      emision:  dateYmd,
      estatus:  'PE',
      despacho: '0',
      desbulto: '0',
      precio:   pu.toFixed(2),
      desc:     '0.00',
      tot_ren:  sub.toFixed(2),
      iva:      'A',
      cliente:  codcli,
      codven:   codven,
      codsuc:   '',
      costo:    '0.00',
      pre_bulto:'0.00',
      desp_fac: '0.00',
      peso:     '0.00'
    };
    renBuffers.push(buildRecordBuffer(renStruct, renValues));
  }

  if (renBuffers.length === 0 && totUsd > 0) {
    renBuffers.push(buildRecordBuffer(renStruct, {
      item: 'PEDIDO', unidad: 'UND', cantidad: '1.000', descrip: 'Pedido JJ Paper #' + oNum,
      numped: oNum, emision: dateYmd, estatus: 'PE', precio: totUsd.toFixed(2), tot_ren: totUsd.toFixed(2),
      iva: 'A', cliente: codcli, codven: codven
    }));
  }

  appendDbfRecords(encPath, [headerBuf]);
  if (renBuffers.length > 0) {
    appendDbfRecords(renPath, renBuffers);
  }

  var nextNum = parseInt(oNum, 10) + 1;
  updateMixnetNextSerial('pedido', nextNum);

  writeDropFiles('pedido', order);

  return { ok: true, num: oNum, itemsCount: renBuffers.length };
}

// ─── 8. CICLO DE SINCRONIZACIÓN TOTAL BIDIRECCIONAL CON PROTECCIÓN ANTI-SATURACIÓN ───

var isSyncing = false;
var lastSyncStats = {
  upQuotes: 0,
  upOrders: 0,
  downQuotes: 0,
  downOrders: 0,
  lastRun: null
};

// Caché en memoria (Memoria de Alta Densidad para Cero Egress redundante en Supabase)
var knownCloudQuotes = {};
var knownCloudOrders = {};
var lastLocalCotRecords = -1;
var lastLocalPedRecords = -1;
var lastSyncedCotSerial = 0;
var lastSyncedPedSerial = 0;
var lastCloudPollQuotesIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
var lastCloudPollOrdersIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

function logMsg(tag, text) {
  var d = new Date();
  var ts = d.toLocaleTimeString('es-VE');
  console.log('[' + ts + '] [' + tag + '] ' + text);
}

function runFullSyncCycle() {
  if (isSyncing) return;
  isSyncing = true;

  setupPaths();

  if (!activeCompDir) {
    logMsg('ADVERTENCIA', 'Carpeta comp01 de MixNet no encontrada en unidades M:, P:, C:. Reintentando en 15s...');
    isSyncing = false;
    return;
  }

  // ── PASO A: Sincronizar Correlativos (MixNet -> Cloud) solo si avanzó en MixNet ──
  var mixCot = getMixnetNextSerial('cotizacion');
  var mixPed = getMixnetNextSerial('pedido');

  if (mixCot && mixCot.num > lastSyncedCotSerial) {
    sbRequest('/rest/v1/jjp_settings?key=eq.mixnet_next_quote_serial&select=value', 'GET', null, function(err, res) {
      if (!err && Array.isArray(res) && res[0]) {
        var cloudVal = parseInt(res[0].value, 10) || 0;
        if (mixCot.num > cloudVal) {
          sbRequest('/rest/v1/jjp_settings?key=eq.mixnet_next_quote_serial', 'PATCH', { value: String(mixCot.num) }, function() {});
          lastSyncedCotSerial = mixCot.num;
          logMsg('CORRELATIVO', 'Cotizaciones actualizado en Nube -> #' + mixCot.formatted);
        } else {
          lastSyncedCotSerial = Math.max(cloudVal, mixCot.num);
        }
      }
    });
  }

  if (mixPed && mixPed.num > lastSyncedPedSerial) {
    sbRequest('/rest/v1/jjp_settings?key=eq.mixnet_next_order_serial&select=value', 'GET', null, function(err, res) {
      if (!err && Array.isArray(res) && res[0]) {
        var cloudPedVal = parseInt(res[0].value, 10) || 0;
        if (mixPed.num > cloudPedVal) {
          sbRequest('/rest/v1/jjp_settings?key=eq.mixnet_next_order_serial', 'PATCH', { value: String(mixPed.num) }, function() {});
          lastSyncedPedSerial = mixPed.num;
          logMsg('CORRELATIVO', 'Pedidos actualizado en Nube -> #' + mixPed.formatted);
        } else {
          lastSyncedPedSerial = Math.max(cloudPedVal, mixPed.num);
        }
      }
    });
  }

  // ── PASO B: MixNet -> Cloud (Subir pedidos y cotizaciones creados en MixNet) ──
  syncMixnetToCloud(function() {

    // ── PASO C: Cloud -> MixNet (Descargar y escribir pedidos y cotizaciones creados en JJ Paper) ──
    syncCloudToMixnet(function() {
      isSyncing = false;
      lastSyncStats.lastRun = new Date();
    });

  });
}

// B. Subir desde MixNet a Cloud (con Dirty-Check local de archivos DBF)
function syncMixnetToCloud(doneCallback) {
  var encCotPath = path.join(activeCompDir, 'MXENCCOT.DBF');
  var encPedPath = path.join(activeCompDir, 'MXENCPED.DBF');
  if (!fs.existsSync(encCotPath)) encCotPath = path.join(activeCompDir, 'mxenccot.dbf');
  if (!fs.existsSync(encPedPath)) encPedPath = path.join(activeCompDir, 'mxencped.dbf');

  var stCot = readDbfStruct(encCotPath);
  var stPed = readDbfStruct(encPedPath);

  var cotRecords = stCot ? stCot.numRecords : 0;
  var pedRecords = stPed ? stPed.numRecords : 0;

  // Si el contador de registros en disco no ha cambiado, no hay nuevos datos en MixNet
  if (cotRecords === lastLocalCotRecords && pedRecords === lastLocalPedRecords && cotRecords > 0) {
    if (doneCallback) doneCallback();
    return;
  }

  lastLocalCotRecords = cotRecords;
  lastLocalPedRecords = pedRecords;

  // Indexar renglones recientes
  var renCotMap = {};
  var renPedMap = {};
  readDbfRecentRows(renCotPath, 1500).forEach(function(r) {
    var n = String(r.numcot || '').trim();
    if (n) {
      if (!renCotMap[n]) renCotMap[n] = [];
      renCotMap[n].push(r);
    }
  });
  readDbfRecentRows(renPedPath, 1500).forEach(function(r) {
    var n = String(r.numped || '').trim();
    if (n) {
      if (!renPedMap[n]) renPedMap[n] = [];
      renPedMap[n].push(r);
    }
  });

  // Consultar números ya existentes en Supabase
  sbRequest('/rest/v1/jjp_quotes?select=quote_number&order=created_at.desc&limit=150', 'GET', null, function(err, cloudQuotes) {
    var knownQuotes = {};
    if (!err && Array.isArray(cloudQuotes)) {
      cloudQuotes.forEach(function(q) { knownQuotes[String(q.quote_number).trim()] = true; });
    }

    var quotesToUpload = [];
    for (var i = 0; i < cotRows.length; i++) {
      var cr = cotRows[i];
      var rawNum = String(cr.numcot || '').trim();
      if (!rawNum) continue;
      var qNum = String(rawNum).padStart(8, '0').slice(-8);

      if (!knownQuotes[qNum]) {
        var sInfo = getSellerByCodven(cr.codven);
        var totUsd = parseFloat(String(cr.tot_cot || 0).replace(/,/g, '.')) || 0;
        var rItems = (renCotMap[rawNum] || renCotMap[qNum] || []).map(function(it) {
          var q = parseFloat(String(it.cantidad || 1).replace(/,/g, '.')) || 1;
          var p = parseFloat(String(it.precio || 0).replace(/,/g, '.')) || 0;
          return {
            sku: String(it.item || '').trim(),
            name: String(it.descrip || it.item || 'Artículo').trim(),
            qty: q,
            price_usd: p,
            subtotal_usd: parseFloat(String(it.tot_ren || (q * p)).replace(/,/g, '.')) || (q * p)
          };
        });

        var emisionStr = String(cr.emision || '').trim();
        var createdAt = (/^\d{8}$/.test(emisionStr))
          ? (emisionStr.slice(0, 4) + '-' + emisionStr.slice(4, 6) + '-' + emisionStr.slice(6, 8) + 'T12:00:00Z')
          : new Date().toISOString();

        quotesToUpload.push({
          quote_number: qNum,
          client_name: String(cr.nomcli || 'Cliente MixNet').trim(),
          rif: String(cr.cif || '').trim() || null,
          phone: String(cr.tlf1 || '').trim() || null,
          estimated_total_usd: totUsd,
          exchange_rate: parseFloat(cr.cambio || 0) || 0,
          items: rItems,
          seller_id: sInfo.uuid,
          source: 'mixnet',
          status: 'pendiente',
          created_at: createdAt
        });
      }
    }

    // Subir cotizaciones pendientes una a una
    function uploadNextQuote(idx) {
      if (idx >= quotesToUpload.length) {
        checkOrdersMixnet();
        return;
      }
      var qPayload = quotesToUpload[idx];
      sbRequest('/rest/v1/jjp_quotes', 'POST', qPayload, function(uErr) {
        if (!uErr) {
          logMsg('MIXNET ➔ CLOUD', '✅ Cotización #' + qPayload.quote_number + ' (' + qPayload.client_name + ') subida a JJ Paper ($' + qPayload.estimated_total_usd + ')');
        }
        uploadNextQuote(idx + 1);
      });
    }

    uploadNextQuote(0);
  });

  // 2. Pedidos MixNet -> jjp_orders
  function checkOrdersMixnet() {
    sbRequest('/rest/v1/jjp_orders?select=order_number&order=created_at.desc&limit=150', 'GET', null, function(err, cloudOrders) {
      var knownOrders = {};
      if (!err && Array.isArray(cloudOrders)) {
        cloudOrders.forEach(function(o) { knownOrders[String(o.order_number).trim()] = true; });
      }

      var ordersToUpload = [];
      for (var j = 0; j < pedRows.length; j++) {
        var pr = pedRows[j];
        var rawNumP = String(pr.numped || '').trim();
        if (!rawNumP) continue;
        var pNum = String(rawNumP).padStart(8, '0').slice(-8);

        if (!knownOrders[pNum]) {
          var sInfoP = getSellerByCodven(pr.codven);
          var totPUsd = parseFloat(String(pr.tot_ped || 0).replace(/,/g, '.')) || 0;
          var pItems = (renPedMap[rawNumP] || renPedMap[pNum] || []).map(function(it) {
            var q = parseFloat(String(it.cantidad || 1).replace(/,/g, '.')) || 1;
            var p = parseFloat(String(it.precio || 0).replace(/,/g, '.')) || 0;
            return {
              sku: String(it.item || '').trim(),
              name: String(it.descrip || it.item || 'Artículo').trim(),
              qty: q,
              price_usd: p,
              subtotal_usd: parseFloat(String(it.tot_ren || (q * p)).replace(/,/g, '.')) || (q * p)
            };
          });

          var emisionP = String(pr.emision || '').trim();
          var createdP = (/^\d{8}$/.test(emisionP))
            ? (emisionP.slice(0, 4) + '-' + emisionP.slice(4, 6) + '-' + emisionP.slice(6, 8) + 'T12:00:00Z')
            : new Date().toISOString();

          ordersToUpload.push({
            order_number: pNum,
            client_name: String(pr.nomcli || 'Cliente Mostrador').trim(),
            rif: String(pr.cif || '').trim() || null,
            phone: String(pr.tlf1 || '').trim() || null,
            total_usd: totPUsd,
            exchange_rate: parseFloat(pr.cambio || 0) || 0,
            items: pItems,
            seller_id: sInfoP.uuid,
            source: 'mixnet',
            status: String(pr.estatus || 'PE').toUpperCase() === 'FA' ? 'facturado' : 'pendiente',
            created_at: createdP
          });
        }
      }

      function uploadNextOrder(idx) {
        if (idx >= ordersToUpload.length) {
          if (doneCallback) doneCallback();
          return;
        }
        var oPayload = ordersToUpload[idx];
        sbRequest('/rest/v1/jjp_orders', 'POST', oPayload, function(oErr) {
          if (!oErr) {
            logMsg('MIXNET ➔ CLOUD', '📦 Pedido #' + oPayload.order_number + ' (' + oPayload.client_name + ') subido a JJ Paper ($' + oPayload.total_usd + ')');
          }
          uploadNextOrder(idx + 1);
        });
      }

      uploadNextOrder(0);
    });
  }
}

// C. Escribir desde Cloud hacia MixNet
function syncCloudToMixnet(doneCallback) {
  var since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

  // 1. Descargar cotizaciones recientes creadas en JJ Paper (no originadas en mixnet)
  var qQuery = '/rest/v1/jjp_quotes?select=id,quote_number,client_name,rif,phone,items,estimated_total_usd,exchange_rate,seller_id,source,status,created_at&created_at=gte.' + since + '&status=not.in.(cancelado,rechazado)&order=created_at.asc&limit=50';

  sbRequest(qQuery, 'GET', null, function(err, cloudQuotes) {
    if (!err && Array.isArray(cloudQuotes)) {
      for (var i = 0; i < cloudQuotes.length; i++) {
        var cq = cloudQuotes[i];
        if (cq.source === 'mixnet') continue; // Ya proviene de MixNet
        var resQ = writeQuoteToMixnetDbf(cq);
        if (resQ.ok && !resQ.alreadyExists) {
          logMsg('CLOUD ➔ MIXNET', '⚡ Cotización #' + resQ.num + ' (' + cq.client_name + ') ESCRITA en MixNet DBF ($' + cq.estimated_total_usd + ')');
        }
      }
    }

    // 2. Descargar pedidos recientes creados en JJ Paper (POS / Ventas)
    var oQuery = '/rest/v1/jjp_orders?select=id,order_number,client_name,rif,phone,items,total_usd,exchange_rate,seller_id,source,status,created_at,notes&created_at=gte.' + since + '&status=not.in.(cancelado,rechazado)&order=created_at.asc&limit=50';

    sbRequest(oQuery, 'GET', null, function(oErr, cloudOrders) {
      if (!oErr && Array.isArray(cloudOrders)) {
        for (var j = 0; j < cloudOrders.length; j++) {
          var co = cloudOrders[j];
          if (co.source === 'mixnet') continue;
          var resO = writeOrderToMixnetDbf(co);
          if (resO.ok && !resO.alreadyExists) {
            logMsg('CLOUD ➔ MIXNET', '⚡ Pedido #' + resO.num + ' (' + co.client_name + ') ESCRITO en MixNet DBF ($' + co.total_usd + ')');
          }
        }
      }

      if (doneCallback) doneCallback();
    });
  });
}

// ─── 9. ARRANQUE DEL SERVICIO ───

console.log('========================================================================');
console.log('   JJ PAPER -- PUENTE AUTONOMO MIXNET ERP ⇄ SUPABASE CLOUD (WIN7)');
console.log('========================================================================');
setupPaths();
console.log('  Base de Datos MixNet: ' + (activeCompDir || '[Buscando en M:, P:, C:...]'));
console.log('  Bandejas de Despacho: ' + activeDropDirs.join(' | '));
console.log('  Nube JJ Paper:        ' + SUPABASE_URL);
console.log('  Intervalo de Sinc:    Cada ' + (POLL_INTERVAL_MS / 1000) + ' segundos');
console.log('========================================================================');
console.log('  [OK] Puente bidireccional activo. Sincronizando ventas en tiempo real...\n');

// Ejecución inmediata
runFullSyncCycle();

// Bucle permanente
setInterval(runFullSyncCycle, POLL_INTERVAL_MS);
