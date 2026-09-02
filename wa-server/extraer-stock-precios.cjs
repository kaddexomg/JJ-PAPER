/*
  ============================================================
  JJ Paper — Extractor de Stock y Precios Reales MixNet
  ============================================================
  Este script escanea TODAS las tablas DBF buscando cualquier
  rastro de precios y existencias reales (incluso en tablas
  temporales j*.DBF o reportes de inventario fisico).
  Combina los valores maximos encontrados para cada producto.
*/
'use strict';

var fs = require('fs');
var path = require('path');

function say(s) { try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); } }
function log(m) { say(m); }

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s.trim();
}

function readDbfStructure(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;
    var numRecords = buf.readUInt32LE(4);
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);
    var fields = [];
    var off = 32;
    while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = buf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (clean.length > 0) {
        fields.push({ name: clean, type: String.fromCharCode(buf[off + 11]), len: buf[off + 16] || buf.readUInt16LE(off + 16) });
      }
      off += 32;
    }
    return { path: filePath, numRecords: numRecords, headerLen: headerLen, recordLen: recordLen, fields: fields };
  } catch (_) { return null; }
}

function readDbfData(struct) {
  try {
    var buf = fs.readFileSync(struct.path);
    var rows = [];
    var pos = struct.headerLen;
    var maxEnd = Math.min(struct.headerLen + struct.numRecords * struct.recordLen, buf.length);
    while (pos + struct.recordLen <= maxEnd && rows.length < 500000) {
      var rec = buf.slice(pos, pos + struct.recordLen);
      if (rec[0] !== 0x2A) {
        var obj = {};
        var fpos = 1;
        for (var fi = 0; fi < struct.fields.length; fi++) {
          var f = struct.fields[fi];
          if (fpos + f.len > rec.length) break;
          var val = decodeStr(rec, fpos, f.len);
          if (f.type === 'N' || f.type === 'F') {
            var num = parseFloat(val);
            obj[f.name] = isNaN(num) ? 0 : num;
          } else {
            obj[f.name] = val;
          }
          fpos += f.len;
        }
        rows.push(obj);
      }
      pos += struct.recordLen;
    }
    return rows;
  } catch (_) { return []; }
}

function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[",]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function findField(fields, candidates) {
  for (var c=0; c<candidates.length; c++) {
    for (var f=0; f<fields.length; f++) {
      if (fields[f].name === candidates[c]) return fields[f].name;
    }
  }
  for (var c=0; c<candidates.length; c++) {
    for (var f=0; f<fields.length; f++) {
      if (fields[f].name.indexOf(candidates[c]) === 0) return fields[f].name;
    }
  }
  return null;
}

function main() {
  log('============================================================');
  log('  JJ PAPER — BUSCADOR PROFUNDO DE STOCK Y PRECIOS');
  log('============================================================');
  
  var dirs = [
    'M:\\comp01', 'M:\\COMP02', 'M:\\COMP03',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\RESPAMIX\\COMP01-10012023',
    'C:\\RESPAMIX\\comp0125042022',
    'C:\\MIXNET\\comp01', 'D:\\MIXNET\\comp01'
  ];

  var allDbfs = [];
  
  function scanDir(d, depth) {
    if (depth < 0) return;
    try {
      var entries = fs.readdirSync(d, { withFileTypes: true });
      for (var i=0; i<entries.length; i++) {
        var e = entries[i];
        if (e.isFile() && /\.dbf$/i.test(e.name)) {
          allDbfs.push(path.join(d, e.name));
        } else if (e.isDirectory() && !/^(windows|program)/i.test(e.name)) {
          scanDir(path.join(d, e.name), depth - 1);
        }
      }
    } catch (_) {}
  }
  
  // Si encontramos reporte_mixnet.json, usamos esas rutas como prioridad
  try {
    var report = JSON.parse(fs.readFileSync(path.join(__dirname, 'reporte_mixnet.json')));
    if (report && report.grandes) {
      report.grandes.forEach(function(r) { if (/\.dbf$/i.test(r.path)) allDbfs.push(r.path); });
      report.relevantes.forEach(function(r) { if (/\.dbf$/i.test(r.path)) allDbfs.push(r.path); });
    }
  } catch(e) {}

  if (allDbfs.length === 0) {
    for (var i=0; i<dirs.length; i++) scanDir(dirs[i], 2);
  }

  // Deduplicar
  var uniquePaths = {};
  var finalDbfs = [];
  for (var i=0; i<allDbfs.length; i++) {
    var p = allDbfs[i].toUpperCase();
    if (!uniquePaths[p]) { uniquePaths[p] = true; finalDbfs.push(allDbfs[i]); }
  }

  log('Analizando ' + finalDbfs.length + ' archivos DBF en busca de stock/precios...');

  var catalog = {}; // codart -> { descrip, exist, p1, p2, p3, p4, costo }

  for (var i=0; i<finalDbfs.length; i++) {
    var filePath = finalDbfs[i];
    var struct = readDbfStructure(filePath);
    if (!struct || struct.numRecords === 0) continue;
    
    var fCode = findField(struct.fields, ['codart', 'codmovart', 'codigo', 'codarti']);
    if (!fCode) continue;
    
    var fDesc = findField(struct.fields, ['nomart', 'descrip', 'articulo', 'nombre']);
    var fExist = findField(struct.fields, ['existe_act', 'con_fis', 'existencia', 'stock']);
    var fP1 = findField(struct.fields, ['precio_a', 'precio1']);
    var fP2 = findField(struct.fields, ['precio_b', 'precio2']);
    var fP3 = findField(struct.fields, ['precio_c', 'precio3']);
    var fP4 = findField(struct.fields, ['precio_d', 'precio4']);
    var fCosto = findField(struct.fields, ['costo_act', 'nvo_costo', 'ult_costo']);
    
    if (!fExist && !fP1 && !fP3 && !fCosto) continue; // No tiene info util
    
    // Penalizar archivos temporales pero usarlos para stock maximo
    var isTemp = /\\EJ\d\d|\\comp\d+[a-z]\\|j\d+\.dbf/i.test(filePath);

    var rows = readDbfData(struct);
    for (var r=0; r<rows.length; r++) {
      var row = rows[r];
      var code = String(row[fCode] || '').trim();
      if (!code) continue;
      
      if (!catalog[code]) catalog[code] = { descrip:'', exist:0, p1:0, p2:0, p3:0, p4:0, costo:0 };
      var cat = catalog[code];
      
      if (fDesc && !cat.descrip) cat.descrip = String(row[fDesc] || '').trim();
      
      var e = row[fExist]; if (typeof e === 'number' && e > cat.exist) cat.exist = e;
      var p1 = row[fP1]; if (typeof p1 === 'number' && p1 > cat.p1) cat.p1 = p1;
      var p2 = row[fP2]; if (typeof p2 === 'number' && p2 > cat.p2) cat.p2 = p2;
      var p3 = row[fP3]; if (typeof p3 === 'number' && p3 > cat.p3) cat.p3 = p3;
      var p4 = row[fP4]; if (typeof p4 === 'number' && p4 > cat.p4) cat.p4 = p4;
      var c = row[fCosto]; if (typeof c === 'number' && c > cat.costo) cat.costo = c;
    }
  }

  var keys = Object.keys(catalog);
  log('Se consolidaron ' + keys.length + ' codigos distintos!');
  
  var lines = ['codigo,descripcion,precio_a,precio_b,precio_c,precio_d,costo_maximo,existencia_maxima'];
  for (var i=0; i<keys.length; i++) {
    var k = keys[i];
    var c = catalog[k];
    if (c.exist === 0 && c.p1 === 0 && c.p3 === 0 && c.costo === 0) continue;
    lines.push([
      escCSV(k), escCSV(c.descrip), c.p1, c.p2, c.p3, c.p4, c.costo, c.exist
    ].join(','));
  }
  
  var outPath = 'existencias_y_precios_consolidados.csv';
  fs.writeFileSync(outPath, '\uFEFF' + lines.join('\r\n'), 'utf8');
  
  // Guardar en escritorio si es posible
  var u = process.env.USERPROFILE || '';
  if (u) {
    try { fs.writeFileSync(path.join(u, 'Desktop', outPath), '\uFEFF' + lines.join('\r\n'), 'utf8'); } catch(e){}
    try { fs.writeFileSync(path.join(u, 'Escritorio', outPath), '\uFEFF' + lines.join('\r\n'), 'utf8'); } catch(e){}
  }

  log('Exportado a: ' + outPath);
  log('============================================================');
}

main();