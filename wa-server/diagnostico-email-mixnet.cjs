/*
  ============================================================
  JJ Paper — DIAGNOSTICO de campos de Email en MixNet
  ============================================================
  Este script busca EXACTAMENTE donde estan los emails en
  MixNet. Revisa TODAS las tablas DBF, busca campos tipo
  Memo (.DBT), y reporta donde hay emails con @.

  Ejecutar en la PC de la tienda:
    node diagnostico-email-mixnet.cjs

  2026-09-02
  ============================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

function say(s) { try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); } }
function log(m) { say('[' + new Date().toLocaleTimeString() + '] ' + m); }

/* ───── CP1252 ───── */
var CP1252 = {0x80:'\u20AC',0x82:'\u201A',0x83:'\u0192',0x84:'\u201E',0x85:'\u2026',0x86:'\u2020',0x87:'\u2021',0x88:'\u02C6',0x89:'\u2030',0x8A:'\u0160',0x8B:'\u2039',0x8C:'\u0152',0x8E:'\u017D',0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',0x95:'\u2022',0x96:'\u2013',0x97:'\u2014',0x98:'\u02DC',0x99:'\u2122',0x9A:'\u0161',0x9B:'\u203A',0x9C:'\u0153',0x9E:'\u017E',0x9F:'\u0178'};
function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128) s += String.fromCharCode(b);
    else if (b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

/* ───── Lector DBF con soporte de campos Memo (.DBT) ───── */
function readDbfHeaderAndFields(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;
    var numRecords = buf.readUInt32LE(4);
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);
    if (headerLen < 33 || recordLen < 1 || headerLen > buf.length) return null;
    var fields = [];
    var off = 32;
    while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) { var c = buf[off + i]; if (c === 0) break; rawName += String.fromCharCode(c); }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      var type = String.fromCharCode(buf[off + 11]);
      var flen = buf[off + 16] || 10;
      if (clean.length > 0) fields.push({ name: clean, rawName: rawName.trim(), type: type, len: flen });
      off += 32;
    }
    return { path: filePath, numRecords: numRecords, headerLen: headerLen, recordLen: recordLen, fields: fields, buf: buf };
  } catch (_) { return null; }
}

function readDbtBlock(dbtPath, blockNum) {
  try {
    var fd = fs.openSync(dbtPath, 'r');
    // DBT header: primeros 512 bytes, luego bloques de 512 bytes
    var blockSize = 512;
    var startPos = blockNum * blockSize;
    // Leer hasta 4KB (email no deberia ser mas largo)
    var readLen = Math.min(4096, fs.statSync(dbtPath).size - startPos);
    if (readLen <= 0) { fs.closeSync(fd); return ''; }
    var buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, startPos);
    fs.closeSync(fd);
    // El texto del memo termina con 0x1A (EOF) o 0x00
    var text = '';
    for (var i = 0; i < readLen; i++) {
      var b = buf[i];
      if (b === 0x1A || b === 0x00) break;
      if (b < 128) text += String.fromCharCode(b);
      else if (b >= 0xA0) text += String.fromCharCode(b);
      else text += CP1252[b] || '';
    }
    return text.trim();
  } catch (_) { return ''; }
}

function readFptBlock(fptPath, blockNum) {
  try {
    var fd = fs.openSync(fptPath, 'r');
    // FPT header: primeros 8 bytes tienen el proximo bloque libre y tamano de bloque
    var headerBuf = Buffer.alloc(8);
    fs.readSync(fd, headerBuf, 0, 8, 0);
    var blockSize = headerBuf.readUInt16BE(6); // FPT usa big-endian!
    if (blockSize < 64) blockSize = 512; // default
    var startPos = blockNum * blockSize;
    // Bloque FPT: 4 bytes tipo + 4 bytes longitud + datos
    var headBuf = Buffer.alloc(8);
    fs.readSync(fd, headBuf, 0, 8, startPos);
    var dataLen = headBuf.readUInt32BE(4); // big-endian
    if (dataLen <= 0 || dataLen > 65536) { fs.closeSync(fd); return ''; }
    var dataBuf = Buffer.alloc(dataLen);
    fs.readSync(fd, dataBuf, 0, dataLen, startPos + 8);
    fs.closeSync(fd);
    var text = '';
    for (var i = 0; i < dataLen; i++) {
      var b = dataBuf[i];
      if (b === 0) break;
      if (b < 128) text += String.fromCharCode(b);
      else if (b >= 0xA0) text += String.fromCharCode(b);
      else text += CP1252[b] || '';
    }
    return text.trim();
  } catch (_) { return ''; }
}

/* ───── MAIN ───── */
function main() {
  say('');
  log('============================================================');
  log('  DIAGNOSTICO DE EMAILS EN MIXNET');
  log('============================================================');
  say('');

  // Buscar en rutas conocidas
  var searchDirs = [
    'M:\\comp01', 'M:\\COMP02', 'M:\\COMP03', 'M:\\COMP01d',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\RESPAMIX\\COMP01-10012023',
    'P:\\Elias\\MIX\\MIX11\\comp01'
  ];

  for (var di = 0; di < searchDirs.length; di++) {
    var dir = searchDirs[di];
    if (!fs.existsSync(dir)) continue;

    log('=== Escaneando: ' + dir + ' ===');
    say('');

    var files;
    try { files = fs.readdirSync(dir); } catch (_) { continue; }

    // Buscar TODOS los DBF
    var dbfFiles = files.filter(function (f) { return /\.dbf$/i.test(f); });

    for (var fi = 0; fi < dbfFiles.length; fi++) {
      var dbfPath = path.join(dir, dbfFiles[fi]);
      var info = readDbfHeaderAndFields(dbfPath);
      if (!info) continue;

      // Buscar campos que contengan 'email', 'correo', 'mail', 'e_mail'
      var emailFields = info.fields.filter(function (f) {
        return /email|correo|mail|e_mai/i.test(f.name);
      });

      // Buscar CUALQUIER campo tipo Memo
      var memoFields = info.fields.filter(function (f) {
        return f.type === 'M';
      });

      if (emailFields.length === 0 && memoFields.length === 0) continue;

      log('  ' + dbfFiles[fi] + ' (' + info.numRecords + ' registros)');

      // Reportar campos de email
      for (var ei = 0; ei < emailFields.length; ei++) {
        var ef = emailFields[ei];
        log('    CAMPO EMAIL: "' + ef.rawName + '" (limpio: ' + ef.name + ') tipo=' + ef.type + ' len=' + ef.len);

        if (ef.type === 'M') {
          log('    >>> TIPO MEMO! El email esta en archivo .DBT/.FPT, no en el DBF');
          // Buscar archivo memo asociado
          var baseName = path.basename(dbfPath, '.DBF').toUpperCase();
          baseName = path.basename(dbfPath).replace(/\.dbf$/i, '');
          var dbtPath = path.join(dir, baseName + '.DBT');
          var fptPath = path.join(dir, baseName + '.FPT');

          if (fs.existsSync(dbtPath)) {
            log('    >>> Encontrado: ' + dbtPath + ' (' + (fs.statSync(dbtPath).size / 1024).toFixed(0) + 'KB)');
            // Intentar leer los primeros emails
            var emailCount = 0;
            var maxEnd = Math.min(info.headerLen + info.numRecords * info.recordLen, info.buf.length);
            var pos = info.headerLen;
            var fieldIdx = info.fields.indexOf(ef);
            var fieldOffset = 1;
            for (var x = 0; x < fieldIdx; x++) fieldOffset += info.fields[x].len;

            for (var r = 0; r < Math.min(info.numRecords, 200) && emailCount < 10; r++) {
              if (pos + info.recordLen > maxEnd) break;
              if (info.buf[pos] === 0x2A) { pos += info.recordLen; continue; }
              var blockStr = decodeStr(info.buf, pos + fieldOffset, ef.len).trim();
              var blockNum = parseInt(blockStr, 10);
              if (blockNum > 0) {
                var memoText = readDbtBlock(dbtPath, blockNum);
                if (memoText && memoText.indexOf('@') !== -1) {
                  log('    >>> EMAIL ENCONTRADO (memo bloque ' + blockNum + '): ' + memoText);
                  emailCount++;
                }
              }
              pos += info.recordLen;
            }
            if (emailCount > 0) {
              log('    >>> TOTAL EMAILS ENCONTRADOS EN PRIMEROS 200 REGISTROS: ' + emailCount);
            } else {
              log('    >>> No se encontraron emails con @ en los primeros 200 registros del memo');
            }
          } else if (fs.existsSync(fptPath)) {
            log('    >>> Encontrado: ' + fptPath + ' (' + (fs.statSync(fptPath).size / 1024).toFixed(0) + 'KB)');
            // Similar pero con FPT
            var emailCount = 0;
            var maxEnd = Math.min(info.headerLen + info.numRecords * info.recordLen, info.buf.length);
            var pos = info.headerLen;
            var fieldIdx = info.fields.indexOf(ef);
            var fieldOffset = 1;
            for (var x = 0; x < fieldIdx; x++) fieldOffset += info.fields[x].len;

            for (var r = 0; r < Math.min(info.numRecords, 200) && emailCount < 10; r++) {
              if (pos + info.recordLen > maxEnd) break;
              if (info.buf[pos] === 0x2A) { pos += info.recordLen; continue; }
              var blockStr = decodeStr(info.buf, pos + fieldOffset, ef.len).trim();
              var blockNum = parseInt(blockStr, 10);
              if (blockNum > 0) {
                var memoText = readFptBlock(fptPath, blockNum);
                if (memoText && memoText.indexOf('@') !== -1) {
                  log('    >>> EMAIL ENCONTRADO (FPT bloque ' + blockNum + '): ' + memoText);
                  emailCount++;
                }
              }
              pos += info.recordLen;
            }
            if (emailCount > 0) {
              log('    >>> TOTAL EMAILS ENCONTRADOS EN PRIMEROS 200 REGISTROS: ' + emailCount);
            }
          } else {
            log('    >>> NO se encontro archivo .DBT ni .FPT asociado');
          }
        } else {
          // Campo tipo C (character) - leer directamente
          var emailCount = 0;
          var sampleEmails = [];
          var maxEnd = Math.min(info.headerLen + info.numRecords * info.recordLen, info.buf.length);
          var pos = info.headerLen;
          var fieldIdx = info.fields.indexOf(ef);
          var fieldOffset = 1;
          for (var x = 0; x < fieldIdx; x++) fieldOffset += info.fields[x].len;

          for (var r = 0; r < info.numRecords; r++) {
            if (pos + info.recordLen > maxEnd) break;
            if (info.buf[pos] === 0x2A) { pos += info.recordLen; continue; }
            var val = decodeStr(info.buf, pos + fieldOffset, ef.len);
            if (val && val.indexOf('@') !== -1) {
              emailCount++;
              if (sampleEmails.length < 5) sampleEmails.push(val);
            } else if (val && val.length > 0) {
              // Tiene dato pero no tiene @
              if (emailCount === 0 && sampleEmails.length < 3) sampleEmails.push('[sin @] ' + val);
            }
            pos += info.recordLen;
          }
          log('    Con @ encontrados: ' + emailCount + ' de ' + info.numRecords);
          if (sampleEmails.length > 0) {
            log('    Muestras: ' + sampleEmails.join(' | '));
          }
        }
      }

      // Reportar campos memo (aunque no se llamen email)
      for (var mi = 0; mi < memoFields.length; mi++) {
        var mf = memoFields[mi];
        if (emailFields.indexOf(mf) !== -1) continue; // ya reportado arriba
        log('    CAMPO MEMO: "' + mf.rawName + '" (limpio: ' + mf.name + ') tipo=M len=' + mf.len);
      }

      say('');
    }

    // Tambien listar archivos .DBT y .FPT en el directorio
    var memoFiles = files.filter(function (f) { return /\.(dbt|fpt)$/i.test(f); });
    if (memoFiles.length > 0) {
      log('  Archivos MEMO en ' + dir + ':');
      for (var mi = 0; mi < memoFiles.length; mi++) {
        var mPath = path.join(dir, memoFiles[mi]);
        var mSize = 0;
        try { mSize = fs.statSync(mPath).size; } catch (_) {}
        log('    ' + memoFiles[mi] + ' (' + (mSize / 1024).toFixed(0) + 'KB)');
      }
      say('');
    }
  }

  // Diagnostico adicional: buscar TODAS las tablas con campo que contenga 'email' en CUALQUIER ruta
  log('=== Busqueda amplia de tablas con campo EMAIL ===');
  var drives = ['M:', 'C:', 'P:'];
  var found = 0;
  for (var dri = 0; dri < drives.length; dri++) {
    var root = drives[dri] + '\\';
    if (!fs.existsSync(root)) continue;
    try {
      var rootItems = fs.readdirSync(root);
      for (var ri = 0; ri < rootItems.length; ri++) {
        var rItem = rootItems[ri];
        if (/^(windows|program|appdata|perflogs|\$|users|node_modules)/i.test(rItem)) continue;
        var subDir = path.join(root, rItem);
        try {
          var st = fs.statSync(subDir);
          if (!st.isDirectory()) continue;
          var subFiles = fs.readdirSync(subDir).filter(function (f) { return /\.dbf$/i.test(f); });
          for (var sf = 0; sf < subFiles.length; sf++) {
            var info = readDbfHeaderAndFields(path.join(subDir, subFiles[sf]));
            if (!info) continue;
            var emailF = info.fields.filter(function (f) { return /email|correo|mail/i.test(f.name); });
            if (emailF.length > 0) {
              found++;
              log('  ENCONTRADO: ' + subDir + '\\' + subFiles[sf] + ' (' + info.numRecords + ' regs)');
              emailF.forEach(function (f) {
                log('    Campo: "' + f.rawName + '" tipo=' + f.type + ' len=' + f.len);
              });
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  if (found === 0) log('  No se encontraron tablas adicionales con campos de email');

  say('');
  log('============================================================');
  log('  DIAGNOSTICO COMPLETADO');
  log('  Si encontro emails tipo MEMO, el extractor necesita');
  log('  leer los archivos .DBT/.FPT para obtenerlos.');
  log('============================================================');
}

try { main(); } catch (e) {
  log('[ERROR] ' + (e.stack || e));
}
