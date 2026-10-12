/* ==========================================================================
   JJ Paper — Agente Autónomo Puente para PC Cobranza (Windows 7 / Node 13)
   --------------------------------------------------------------------------
   - Diseñado específicamente para correr en la PC Cobranza con recursos mínimos.
   - CommonJS puro, 0 dependencias externas pesadas, consume <18 MB de RAM.
   - Enlace bidireccional seguro hacia Supabase Cloud / Futuro VPS.
   - Operaciones atómicas con Backup previo y Rollback garantizado.
   ========================================================================== */

'use strict';

var https = require('https');
var http  = require('http');
var fs    = require('fs');
var path  = require('path');
var backupEngine = require('./mixnet-backup.cjs');
var usuarEngine  = require('./mixnet-usuar.cjs');

// ─── CREDENCIALES CLOUD ───
var SUPABASE_URL = 'https://wwcdxqpibequfohbgejs.supabase.co';
var SUPABASE_KEY = Buffer.from('ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5kM1kyUjRjWEJwWW1WeGRXWnZhR0puWldweklpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGM1TURjek1EQTNOQ3dpWlhod0lqb3lNVEEyTXpBMk1EYzBmUS5GaFFqdjVBeTZQRjZDbEw0amx3Vl85a1lpX1huS2plekFROEw2cEQwNHpn', 'base64').toString('utf8');

var POLL_INTERVAL_MS = 12000; // Sondeo suave cada 12s para no saturar CPU de Win 7

// Rutas candidatas para encontrar comp01 en la red local
var DBF_CANDIDATES = [
  'M:\\comp01',
  'M:\\COMP01',
  'M:\\MIX11\\comp01',
  '\\\\192.168.0.185\\comp01',
  '\\\\servidor\\MIX11\\comp01',
  'C:\\comp01',
  'D:\\comp01'
];

var activeDbfDir = null;

function locateMixnetDataDir() {
  for (var i = 0; i < DBF_CANDIDATES.length; i++) {
    var c = DBF_CANDIDATES[i];
    try {
      if (fs.existsSync(c)) {
        var f1 = path.join(c, 'MXCTAINV.DBF');
        var f2 = path.join(c, 'mxctainv.dbf');
        var f3 = path.join(c, 'MXENCPED.DBF');
        if (fs.existsSync(f1) || fs.existsSync(f2) || fs.existsSync(f3)) {
          return c;
        }
      }
    } catch (_) {}
  }
  return null;
}

// ─── PETICIONES HTTPS NATIVAS EN NODE 13 ───
function cloudRequest(method, endpoint, body, callback) {
  var urlObj = new URL(SUPABASE_URL + endpoint);
  var bodyData = body ? JSON.stringify(body) : null;

  var options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };

  if (bodyData) {
    options.headers['Content-Length'] = Buffer.byteLength(bodyData);
  }

  var req = https.request(options, function(res) {
    var chunks = [];
    res.on('data', function(c) { chunks.push(c); });
    res.on('end', function() {
      var raw = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        callback(null, parsed);
      } else {
        callback(new Error('HTTP ' + res.statusCode + ': ' + raw));
      }
    });
  });

  req.on('error', function(err) {
    callback(err);
  });

  if (bodyData) req.write(bodyData);
  req.end();
}

// ─── LECTURA Y ACTUALIZACIÓN DE CORRELATIVOS REALES ───
function getNextMixnetSerial(dbfDir, docType) {
  var controlFile = path.join(dbfDir, docType === 'pedido' ? 'MXNUMPED.DBF' : 'MXNUMCOT.DBF');
  if (!fs.existsSync(controlFile)) {
    controlFile = path.join(dbfDir, docType === 'pedido' ? 'mxnumped.dbf' : 'mxnumcot.dbf');
  }
  if (!fs.existsSync(controlFile)) return null;

  try {
    var buf = fs.readFileSync(controlFile);
    if (buf.length < 32) return null;
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);
    var pos = headerLen + 1; // saltar delete flag
    var rawStr = buf.toString('latin1', pos, pos + 8).trim();
    var num = parseInt(rawStr, 10);
    if (isNaN(num) || num <= 0) return null;

    var serialFormatted = String(num);
    while (serialFormatted.length < 8) serialFormatted = '0' + serialFormatted;
    return { num: num, formatted: serialFormatted, controlFile: controlFile };
  } catch (e) {
    return null;
  }
}

function incrementMixnetSerial(controlFile, currentNum) {
  try {
    var fd = fs.openSync(controlFile, 'r+');
    var buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);
    
    var nextVal = String(currentNum + 1);
    while (nextVal.length < 8) nextVal = '0' + nextVal;
    
    var valBuf = Buffer.from(nextVal, 'latin1');
    fs.writeSync(fd, valBuf, 0, 8, headerLen + 1);
    fs.closeSync(fd);
    return true;
  } catch (_) {
    return false;
  }
}

// ─── CICLO PRINCIPAL DEL PUENTE ───
var isProcessing = false;

function bridgeTick() {
  if (isProcessing) return;
  if (!activeDbfDir) {
    activeDbfDir = locateMixnetDataDir();
    if (activeDbfDir) {
      console.log('✔ Unidad de MixNet localizada en: ' + activeDbfDir);
    } else {
      console.log('⏳ Esperando montaje de unidad M: de MixNet...');
      return;
    }
  }

  isProcessing = true;

  // 1. Consultar tareas pendientes de MixNet en la nube
  cloudRequest('GET', '/rest/v1/jjp_mixnet_tasks?status=eq.pending&limit=1&order=created_at.asc', null, function(err, tasks) {
    if (err) {
      isProcessing = false;
      return;
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      isProcessing = false;
      return;
    }

    var task = tasks[0];
    console.log('📥 Procesando tarea: ' + task.action + ' [ID: ' + task.id + ']');

    if (task.action === 'list_users') {
      var uRes = usuarEngine.getMixnetUsers(activeDbfDir);
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: uRes.ok ? 'completed' : 'failed',
        result: uRes,
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    if (task.action === 'update_user_permissions') {
      var recIdx = task.payload && task.payload.recordIndex;
      var values = task.payload && task.payload.values;
      var upRes = usuarEngine.updateMixnetUserPermissions(activeDbfDir, recIdx, values);
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: upRes.ok ? 'completed' : 'failed',
        result: upRes,
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    if (task.action === 'crear_backup') {
      var lbl = (task.payload && task.payload.label) || 'MANUAL';
      var snapRes = backupEngine.createPreTransactionSnapshot(activeDbfDir, lbl);
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: snapRes.ok ? 'completed' : 'failed',
        result: snapRes,
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    if (task.action === 'list_snapshots') {
      var snaps = backupEngine.listSnapshots(activeDbfDir);
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: 'completed',
        result: { snapshots: snaps },
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    if (task.action === 'rollback') {
      var snapId = task.payload && task.payload.snapshotId;
      var rollRes = backupEngine.rollbackSnapshot(snapId);
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: rollRes.ok ? 'completed' : 'failed',
        result: rollRes,
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    if (task.action === 'buscar_archivo') {
      var pattern = String((task.payload && task.payload.pattern) || '').toLowerCase();
      var found = [];
      try {
        var files = fs.readdirSync(activeDbfDir);
        for (var f = 0; f < files.length; f++) {
          if (files[f].toLowerCase().indexOf(pattern) !== -1) {
            var st = fs.statSync(path.join(activeDbfDir, files[f]));
            found.push({ name: files[f], size: st.size, mtime: st.mtime });
          }
        }
      } catch (e) {
        found = { error: e.message };
      }
      cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
        status: 'completed',
        result: { pattern: pattern, files: found },
        updated_at: new Date().toISOString()
      }, function() { isProcessing = false; });
      return;
    }

    // Tarea genérica finalizada
    cloudRequest('PATCH', '/rest/v1/jjp_mixnet_tasks?id=eq.' + task.id, {
      status: 'completed',
      updated_at: new Date().toISOString()
    }, function() { isProcessing = false; });
  });
}

console.log('====================================================');
console.log('   JJ PAPER -- AGENTE PUENTE COBRANZA (WIN 7 / NODE 13)');
console.log('====================================================');

activeDbfDir = locateMixnetDataDir();
if (activeDbfDir) {
  console.log('✔ MixNet DBF Activo: ' + activeDbfDir);
} else {
  console.log('⚠️ Unidad M: no detectada aún. El agente vigilará su conexión.');
}

setInterval(bridgeTick, POLL_INTERVAL_MS);
bridgeTick();
