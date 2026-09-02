/*
  ============================================================
  JJ Paper — Diagnostico de PRODUCTOS E INVENTARIO
  ============================================================
  Busca las tablas clave del catalogo y existencias y
  muestra su estructura real para poder afinar el extractor.
*/
'use strict';

var fs = require('fs');
var path = require('path');

function say(s) { try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); } }
function log(m) { say(m); }

var CP1252 = {0x80:'\u20AC',0x82:'\u201A',0x83:'\u0192',0x84:'\u201E',0x85:'\u2026',0x86:'\u2020',0x87:'\u2021',0x88:'\u02C6',0x89:'\u2030',0x8A:'\u0160',0x8B:'\u2039',0x8C:'\u0152',0x8E:'\u017D',0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',0x95:'\u2022',0x96:'\u2013',0x97:'\u2014',0x98:'\u02DC',0x99:'\u2122',0x9A:'\u0161',0x9B:'\u203A',0x9C:'\u0153',0x9E:'\u017E',0x9F:'\u0178'};
function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128 || b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

function readDbfInfo(filePath) {
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
      for (var i = 0; i < 11; i++) { var c = buf[off + i]; if (c === 0) break; rawName += String.fromCharCode(c); }
      var type = String.fromCharCode(buf[off + 11]);
      var flen = buf[off + 16] || buf.readUInt16LE(off + 16);
      fields.push({ raw: rawName, clean: rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase(), type: type, len: flen });
      off += 32;
    }
    
    // Leer primeras 3 filas
    var rows = [];
    var pos = headerLen;
    for (var r = 0; r < 5 && pos + recordLen <= buf.length; r++) {
      if (buf[pos] !== 0x2A) {
        var obj = {};
        var fpos = 1;
        for (var fi = 0; fi < fields.length; fi++) {
          if (fpos + fields[fi].len > recordLen) break;
          obj[fields[fi].clean] = decodeStr(buf.slice(pos, pos + recordLen), fpos, fields[fi].len);
          fpos += fields[fi].len;
        }
        rows.push(obj);
      } else {
        r--; // era borrado
      }
      pos += recordLen;
    }

    return { path: filePath, numRecords: numRecords, fields: fields, rows: rows };
  } catch (_) { return null; }
}

function main() {
  log('============================================================');
  log('  Buscando Tablas Reales de Productos e Inventario...');
  log('============================================================\n');

  var dirs = ['M:\\comp01', 'M:\\COMP02', 'C:\\RESPAMIX\\MIX11 (servidor)\\comp01'];
  var targetFiles = ['MXARTIC.DBF', 'VICTAINV.DBF', 'MXCTAINV.DBF', 'MXTRAINV.DBF', 'MXLISPRE.DBF'];
  var foundAny = false;

  for (var di = 0; di < dirs.length; di++) {
    var dir = dirs[di];
    if (!fs.existsSync(dir)) continue;

    var files = fs.readdirSync(dir);
    for (var fi = 0; fi < files.length; fi++) {
      var fUp = files[fi].toUpperCase();
      if (targetFiles.indexOf(fUp) !== -1 || fUp.indexOf('ARTIC') !== -1 || fUp.indexOf('PRODUC') !== -1) {
        var info = readDbfInfo(path.join(dir, files[fi]));
        if (info && info.numRecords > 0) {
          foundAny = true;
          log('=== TABLA ENCONTRADA: ' + fUp + ' ===');
          log('Ruta: ' + info.path);
          log('Cantidad de registros (productos/items): ' + info.numRecords);
          
          var fNames = [];
          for(var i=0; i<info.fields.length; i++) {
            fNames.push(info.fields[i].clean + '[' + info.fields[i].type + ']');
          }
          log('Columnas: ' + fNames.join(', '));
          log('\nMuestra de los 2 primeros registros:');
          for(var i=0; i<Math.min(2, info.rows.length); i++) {
            log(JSON.stringify(info.rows[i]));
          }
          log('\n------------------------------------------------------------\n');
        }
      }
    }
  }
  
  if (!foundAny) {
    log('ATENCION: No se encontraron las tablas estandar en las rutas habituales.');
    log('Buscando cualquier tabla grande con campo "codigo" y "precio"...');
    
    // Busqueda fallback
    var dir = dirs[0];
    if (fs.existsSync(dir)) {
      var files = fs.readdirSync(dir).filter(function(x){ return /\.dbf$/i.test(x); });
      for (var fi = 0; fi < files.length; fi++) {
        var info = readDbfInfo(path.join(dir, files[fi]));
        if (info && info.numRecords > 100) {
          var hasCod = false, hasDesc = false, hasPrecio = false;
          for(var j=0; j<info.fields.length; j++) {
            var c = info.fields[j].clean;
            if (c.indexOf('cod')===0) hasCod = true;
            if (c.indexOf('desc')===0 || c.indexOf('nomb')===0) hasDesc = true;
            if (c.indexOf('prec')===0 || c.indexOf('pvp')===0) hasPrecio = true;
          }
          if (hasCod && (hasDesc || hasPrecio)) {
            log('--> Posible tabla: ' + files[fi] + ' (' + info.numRecords + ' regs)');
            var fNames = [];
            for(var k=0; k<info.fields.length; k++) fNames.push(info.fields[k].clean);
            log('    Campos: ' + fNames.slice(0, 15).join(', '));
          }
        }
      }
    }
  }

  log('============================================================');
  log('COPIA ESTE TEXTO Y ENVIAMELO PARA ARREGLAR LOS PRODUCTOS');
  log('============================================================');
}

try { main(); } catch(e) { log(e.toString()); }
