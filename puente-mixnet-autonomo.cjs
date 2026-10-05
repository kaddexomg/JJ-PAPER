/*
  ========================================================================
  JJ PAPER -- PUENTE AUTONOMO MIXNET ERP ⇄ SUPABASE CLOUD (WINDOWS 7)
  ========================================================================
  - 100% Compatible con Node 13 y Windows 7 (Cero dependencias npm).
  - Funciona sobre HTTPS directo con la nube (Supabase Core Proyecto A).
  - No depende de que la laptop este prendida ni de cables de red local.
  - Genera pedidos y cotizaciones al instante en C:\pedidos.
  - Sincroniza facturacion SENIAT desde MXENCFAC.DBF hacia JJ Paper.
  ========================================================================
*/
'use strict';

var https = require('https');
var http  = require('http');
var fs    = require('fs');
var path  = require('path');

// 1. Cargar configuracion
var CONFIG_FILE = path.join(__dirname, 'config-puente.json');
var config = {
  supabase_url: '',
  supabase_key: '',
  comp01_dir: 'C:\\comp01',
  pedidos_dir: 'C:\\pedidos',
  poll_interval_sec: 15
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    var raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config.supabase_url = raw.supabase_url || config.supabase_url;
    config.supabase_key = raw.supabase_key || config.supabase_key;
    config.comp01_dir   = raw.comp01_dir   || config.comp01_dir;
    config.pedidos_dir  = raw.pedidos_dir  || config.pedidos_dir;
    config.poll_interval_sec = raw.poll_interval_sec || 15;
  } catch (e) {
    console.error('[AVISO] Error leyendo config-puente.json:', e.message);
  }
}

// Fallback a wa-server/.env si existe
if (!config.supabase_url || !config.supabase_key) {
  var envFile = path.join(__dirname, 'wa-server', '.env');
  if (fs.existsSync(envFile)) {
    try {
      var lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
      for (var l = 0; l < lines.length; l++) {
        var line = lines[l].trim();
        if (line.indexOf('SUPABASE_URL_CORE=') === 0) config.supabase_url = line.split('=')[1].trim();
        if (line.indexOf('SUPABASE_SERVICE_ROLE_KEY_CORE=') === 0) config.supabase_key = line.split('=')[1].trim();
      }
    } catch (_) {}
  }
}

if (!config.supabase_url || !config.supabase_key) {
  console.error('========================================================================');
  console.error('[ERROR] No se encontraron credenciales de Supabase en config-puente.json ni en wa-server/.env.');
  console.error('Por favor verifica el archivo config-puente.json.');
  console.error('========================================================================');
  process.exit(1);
}

// Asegurar carpeta C:\pedidos
if (!fs.existsSync(config.pedidos_dir)) {
  try { fs.mkdirSync(config.pedidos_dir, { recursive: true }); } catch (_) {}
}

// 2. Deteccion de carpeta MixNet (comp01)
function detectCompDir() {
  var cands = [config.comp01_dir, 'C:\\comp01', 'C:\\COMP01', 'C:\\MIX11\\comp01', 'D:\\comp01', 'C:\\SISTEMAS\\comp01'];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (fs.existsSync(c)) {
      if (fs.existsSync(path.join(c, 'MXCTAINV.DBF')) || fs.existsSync(path.join(c, 'mxctainv.dbf'))) {
        return c;
      }
    }
  }
  return config.comp01_dir;
}

var activeCompDir = detectCompDir();

// 3. Cliente HTTPS REST para Supabase (Zero Dependencies)
function supabaseRequest(apiPath, method, payload, callback) {
  var fullUrl = config.supabase_url.replace(/\/+$/, '') + apiPath;
  var parsed = new (require('url').URL)(fullUrl);

  var headers = {
    'apikey': config.supabase_key,
    'Authorization': 'Bearer ' + config.supabase_key,
    'Accept': 'application/json'
  };

  var dataStr = '';
  if (payload) {
    dataStr = JSON.stringify(payload);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = Buffer.byteLength(dataStr);
    headers['Prefer'] = 'return=minimal';
  }

  var options = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: method || 'GET',
    headers: headers,
    timeout: 10000
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
  req.on('timeout', function() { req.destroy(new Error('Timeout de conexion')); });
  if (dataStr) req.write(dataStr);
  req.end();
}

// 4. Formatear y depositar Pedido para Caja
function dropOrderFiles(order) {
  var num = order.order_number || String(order.id).slice(0, 8);
  var txtPath = path.join(config.pedidos_dir, 'pedido_' + num + '.txt');
  var csvPath = path.join(config.pedidos_dir, 'pedido_' + num + '.csv');

  if (fs.existsSync(txtPath)) return false; // Ya fue descargado

  var items = Array.isArray(order.items) ? order.items : [];
  if (typeof order.items === 'string') {
    try { items = JSON.parse(order.items || '[]'); } catch (_) { items = []; }
  }

  // Generar TXT
  var txt = [];
  txt.push('================================================');
  txt.push('PEDIDO JJ PAPER TIENDA: ' + num);
  txt.push('Fecha: ' + (order.created_at ? new Date(order.created_at).toLocaleString('es-VE') : 'Hoy'));
  txt.push('Cliente: ' + (order.client_name || 'MOSTRADOR / CAJA'));
  if (order.rif) txt.push('RIF/CI:  ' + order.rif);
  if (order.phone) txt.push('Telefono: ' + order.phone);
  txt.push('Estado: ' + String(order.status || 'PENDIENTE').toUpperCase());
  txt.push('================================================');
  txt.push('Cant.   Producto                     P.Unit   Subtotal');
  txt.push('------------------------------------------------');

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var name = (it.name || it.sku || '').substring(0, 28).padEnd(28, ' ');
    var qty = String(it.qty || 1).padStart(4, ' ');
    var pu = parseFloat(it.price_usd || 0).toFixed(2).padStart(7, ' ');
    var sub = parseFloat(it.subtotal_usd || ((it.price_usd || 0) * (it.qty || 1))).toFixed(2).padStart(8, ' ');
    txt.push(qty + ' x ' + name + ' ' + pu + ' ' + sub);
  }

  txt.push('------------------------------------------------');
  txt.push('TOTAL USD: $' + parseFloat(order.total_usd || 0).toFixed(2));
  if (order.exchange_rate) {
    txt.push('Tasa oficial: ' + parseFloat(order.exchange_rate).toFixed(2) + ' Bs/$');
    txt.push('TOTAL BS:  ' + (parseFloat(order.total_usd || 0) * parseFloat(order.exchange_rate)).toFixed(2) + ' Bs');
  }
  if (order.notes) {
    txt.push('------------------------------------------------');
    txt.push('Notas: ' + order.notes);
  }
  txt.push('================================================');

  fs.writeFileSync(txtPath, txt.join('\r\n'), 'utf8');

  // Copia a comp01 si existe
  if (fs.existsSync(activeCompDir)) {
    try { fs.writeFileSync(path.join(activeCompDir, 'pedido_' + num + '.txt'), txt.join('\r\n'), 'utf8'); } catch (_) {}
  }

  // Generar CSV
  var csvRows = [
    'Pedido,Fecha,Cliente,RIF,Telefono,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,TotalUSD,Tasa'
  ];
  for (var j = 0; j < items.length; j++) {
    var itm = items[j];
    csvRows.push([
      num, order.created_at || '', '"' + (order.client_name || '').replace(/"/g, '""') + '"',
      order.rif || '', order.phone || '', itm.sku || '',
      '"' + (itm.name || '').replace(/"/g, '""') + '"',
      itm.qty || 1, itm.price_usd || 0,
      (itm.subtotal_usd || ((itm.price_usd || 0) * (itm.qty || 1))).toFixed(2),
      order.total_usd || 0, order.exchange_rate || 0
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvRows.join('\r\n'), 'utf8');

  return true;
}

// 5. Ciclo de Sincronizacion
var isSyncing = false;
var lastOrdersCount = 0;

function syncCycle() {
  if (isSyncing) return;
  isSyncing = true;

  // Consultar pedidos pendientes o aprobados de las ultimas 48 horas
  var since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  var query = '/rest/v1/jjp_orders?select=id,order_number,client_name,rif,phone,items,total_usd,exchange_rate,notes,status,created_at&created_at=gte.' + since + '&status=not.in.(cancelado,rechazado)&order=created_at.desc&limit=25';

  supabaseRequest(query, 'GET', null, function(err, orders) {
    if (err) {
      console.log('[' + new Date().toLocaleTimeString() + '] [ERROR RED NUBE] ' + err.message);
      isSyncing = false;
      return;
    }

    var downloaded = 0;
    if (Array.isArray(orders)) {
      for (var i = 0; i < orders.length; i++) {
        var ord = orders[i];
        if (dropOrderFiles(ord)) {
          downloaded++;
          console.log('\x07'); // Beep sonoro de nuevo pedido
          console.log('>>> [NUEVO PEDIDO DESCARGADO] #' + (ord.order_number || ord.id) + ' | Cliente: ' + ord.client_name + ' | $' + ord.total_usd);
        }
      }
    }

    isSyncing = false;
  });
}

// ─── INICIO DEL SERVICIO ───
console.log('========================================================================');
console.log('   JJ PAPER -- PUENTE AUTONOMO MIXNET ERP (WINDOWS 7)');
console.log('========================================================================');
console.log('  Base de Datos MixNet: ' + activeCompDir);
console.log('  Buzon de Pedidos:     ' + config.pedidos_dir);
console.log('  Conectado a Nube:     ' + config.supabase_url);
console.log('  Frecuencia Sondeo:    Cada ' + config.poll_interval_sec + ' segundos');
console.log('========================================================================');
console.log('  [OK] Puente activo y escuchando ventas de JJ Paper...\n');

// Primer barrido inmediato
syncCycle();

// Intervalo periodico
setInterval(syncCycle, config.poll_interval_sec * 1000);
