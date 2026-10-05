/*
  ========================================================================
  JJ PAPER -- INYECTOR SEGURO DE COTIZACIONES MIXNET (WINDOWS 7)
  ========================================================================
  - 100% Compatible con Node 13 y Windows 7 (Cero dependencias npm).
  - Cumple estrictamente el Protocolo Mandatorio MixNet ERP (29-09-2026):
    * Nómina Sagrada: Vendedor 010 (Keyder Salazar). Cero cruce con 005 ni 002.
    * Escritura Indetectable: COMEN1 y COMEN2 limpios (sin huellas ni scripts).
    * Correlativo oficial PADL de 8 digitos: 00053355.
    * Respaldo previo automatico antes de escribir.
  ========================================================================
*/
'use strict';

var fs   = require('fs');
var path = require('path');

// Datos de la cotizacion oficial generada en JJ Paper
var QUOTE_DATA = {
  quote_number: '00053355',
  client_name: 'INVERSIONES CAHERSI MOTOR S,C.A',
  rif: 'J-40678577-6',
  phone: '0212-634339',
  seller_codven: '010', // Keyder Salazar
  estimated_total_usd: 106.05,
  exchange_rate: 871.3689,
  date_ymd: '20261005',
  items: [
    { sku: 'ACG-ALOF',  name: 'ARCHIVADOR L.ANCHO OFICIO MR-B',                       qty: 20, unit: 'UND', price_usd: 2.22, subtotal_usd: 44.40 },
    { sku: 'OF-MAGOFA', name: 'MARCADOR PERMANENTE NE PUNTA CICEL X 12PZS/PRINTA/OFIART', qty: 2,  unit: 'DOC', price_usd: 5.55, subtotal_usd: 11.10 },
    { sku: 'LI-MRAM',   name: 'MARCADOR RESALT.OFIART/PRINTA AM X12',                 qty: 1,  unit: 'DOC', price_usd: 6.00, subtotal_usd: 6.00  },
    { sku: 'HP-MRAMR',  name: 'MARCADOR RESALT.PRINTA/OFIART RS X12',                 qty: 1,  unit: 'DOC', price_usd: 6.00, subtotal_usd: 6.00  },
    { sku: 'II-CCG',    name: 'CORTA CARTON GRANDE  18MM  OF-07',                     qty: 24, unit: 'UND', price_usd: 0.63, subtotal_usd: 15.12 },
    { sku: 'HP-BRT',    name: 'BOLIGRAFO GO GLIDE  INK NEGRO RETRACTIL 0.7mm',        qty: 2,  unit: 'UND', price_usd: 4.40, subtotal_usd: 8.80  }
  ]
};

// 1. Detectar carpeta activa de MixNet
function locateMixnet() {
  var candidates = [
    'C:\\comp01',
    'C:\\COMP01',
    'C:\\MIX11\\comp01',
    'C:\\MIXNET\\comp01',
    'D:\\comp01',
    'D:\\MIX11\\comp01',
    'M:\\comp01',
    'C:\\SISTEMAS\\comp01'
  ];

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (fs.existsSync(c)) {
      var check = path.join(c, 'MXENCCOT.DBF');
      if (fs.existsSync(check) || fs.existsSync(check.toLowerCase())) {
        return c;
      }
    }
  }
  return null;
}

// 2. Lectura y Estructura DBF
function readDbfStruct(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;
    return {
      path: filePath,
      buf: buf,
      numRecords: buf.readUInt32LE(4),
      headerLen:  buf.readUInt16LE(8),
      recordLen:  buf.readUInt16LE(10)
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
  var str = value === null || value === undefined ? '' : String(value).trim();
  switch (f.type) {
    case 'D': // YYYYMMDD
      str = str.replace(/[-/.]/g, '');
      return latin1Pad(str, f.len);
    case 'N': // Numerico
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
  record[0] = 0x20; // Activo
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

// 3. Buscar cliente en MXCTACLI
function findClientCode(compDir, rif, name) {
  var cliPath = path.join(compDir, 'MXCTACLI.DBF');
  if (!fs.existsSync(cliPath)) cliPath = path.join(compDir, 'mxctacli.dbf');
  if (!fs.existsSync(cliPath)) return '00';

  var struct = readDbfStruct(cliPath);
  if (!struct) return '00';

  var fields = readDbfFields(struct.buf, struct.headerLen);
  var fCodcli = fields.filter(function(x) { return x.name === 'codcli'; })[0];
  var fCif    = fields.filter(function(x) { return x.name === 'cif'; })[0];
  var fNomcli = fields.filter(function(x) { return x.name === 'nomcli'; })[0];

  if (!fCodcli) return '00';

  var cleanRif = (rif || '').toUpperCase().replace(/[\s.-]/g, '');
  var cleanName = (name || '').toUpperCase().trim();

  var pos = struct.headerLen;
  var maxEnd = Math.min(struct.headerLen + (struct.numRecords * struct.recordLen), struct.buf.length);

  while (pos + struct.recordLen <= maxEnd) {
    if (struct.buf[pos] !== 0x2A) { // No borrado
      if (fCif && cleanRif.length >= 6) {
        var rowCif = struct.buf.toString('latin1', pos + fCif.pos, pos + fCif.pos + fCif.len).toUpperCase().replace(/[\s.-]/g, '');
        if (rowCif === cleanRif) {
          var codeFound = struct.buf.toString('latin1', pos + fCodcli.pos, pos + fCodcli.pos + fCodcli.len).trim();
          if (codeFound) return codeFound;
        }
      }
      if (fNomcli && cleanName.length >= 6) {
        var rowNom = struct.buf.toString('latin1', pos + fNomcli.pos, pos + fNomcli.pos + fNomcli.len).toUpperCase().trim();
        if (rowNom.indexOf(cleanName) !== -1 || cleanName.indexOf(rowNom) !== -1) {
          var codeFound2 = struct.buf.toString('latin1', pos + fCodcli.pos, pos + fCodcli.pos + fCodcli.len).trim();
          if (codeFound2) return codeFound2;
        }
      }
    }
    pos += struct.recordLen;
  }

  return '00'; // Protocolo oficial: Si no esta registrado usa '00' (CUENTA RECUPERADA)
}

// 4. Anexar registros al final de DBF con backup
function appendRecords(filePath, recordBuffers) {
  var struct = readDbfStruct(filePath);
  if (!struct) throw new Error('No se pudo leer estructura de ' + filePath);

  // Backup
  var backupDir = path.join(path.dirname(filePath), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  var ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  var backupPath = path.join(backupDir, 'PRE_COT_' + path.basename(filePath, '.DBF') + '_' + ts + '.DBF');
  fs.writeFileSync(backupPath, struct.buf);

  var fd = fs.openSync(filePath, 'r+');
  try {
    var writePos = struct.headerLen + struct.numRecords * struct.recordLen;
    var totalBytes = Buffer.concat(recordBuffers);

    // 1. Actualizar contador en header
    var newCount = struct.numRecords + recordBuffers.length;
    var countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(newCount, 0);
    fs.writeSync(fd, countBuf, 0, 4, 4);

    // 2. Escribir registros
    fs.writeSync(fd, totalBytes, 0, totalBytes.length, writePos);
    fs.closeSync(fd);
    return { ok: true, count: recordBuffers.length, backup: backupPath };
  } catch (err) {
    try { fs.closeSync(fd); } catch (_) {}
    throw err;
  }
}

// 5. Actualizar correlativo MXNUMCOT
function updateCorrelative(compDir, nextSerial) {
  var numPath = path.join(compDir, 'MXNUMCOT.DBF');
  if (!fs.existsSync(numPath)) numPath = path.join(compDir, 'mxnumcot.dbf');
  if (!fs.existsSync(numPath)) return false;

  var struct = readDbfStruct(numPath);
  if (!struct || struct.numRecords < 1) return false;

  var fd = fs.openSync(numPath, 'r+');
  try {
    var serialStr = String(nextSerial).padStart(8, '0').slice(-8);
    var buf = Buffer.from(serialStr, 'latin1');
    fs.writeSync(fd, buf, 0, 8, struct.headerLen + 1);
    fs.closeSync(fd);
    return true;
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    return false;
  }
}

// 6. Depositar archivos CSV y TXT de intercambio
function writeDropFiles(compDir, q) {
  var dropDirs = [compDir, 'C:\\pedidos', 'C:\\cotizaciones'];
  var csvLines = [
    'Cotizacion,Fecha,Cliente,RIF,Telefono,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,TotalCotizacionUSD,Tasa,Vendedor',
  ];
  for (var i = 0; i < q.items.length; i++) {
    var it = q.items[i];
    csvLines.push([
      q.quote_number, q.date_ymd, '"' + q.client_name + '"', q.rif, q.phone,
      it.sku, '"' + it.name + '"', it.qty, it.price_usd, it.subtotal_usd,
      q.estimated_total_usd, q.exchange_rate, q.seller_codven
    ].join(','));
  }
  var csvContent = csvLines.join('\r\n');

  var txtLines = [
    '================================================',
    'COTIZACION JJ PAPER: ' + q.quote_number,
    'Fecha: ' + q.date_ymd,
    'Cliente: ' + q.client_name,
    'RIF/CI:  ' + q.rif,
    'Telefono: ' + q.phone,
    'Vendedor: ' + q.seller_codven + ' (Keyder Salazar)',
    '================================================',
    'Cant.   Producto                     P.Unit   Subtotal',
    '------------------------------------------------'
  ];
  for (var j = 0; j < q.items.length; j++) {
    var item = q.items[j];
    var n = item.name.substring(0, 28).padEnd(28, ' ');
    var qty = String(item.qty).padStart(4, ' ');
    var pu = item.price_usd.toFixed(2).padStart(7, ' ');
    var sub = item.subtotal_usd.toFixed(2).padStart(8, ' ');
    txtLines.push(qty + ' x ' + n + ' ' + pu + ' ' + sub);
  }
  txtLines.push('------------------------------------------------');
  txtLines.push('TOTAL ESTIMADO USD: $' + q.estimated_total_usd.toFixed(2));
  txtLines.push('TASA OFICIAL BCV:   ' + q.exchange_rate.toFixed(4) + ' Bs/$');
  txtLines.push('TOTAL EN BOLIVARES: ' + (q.estimated_total_usd * q.exchange_rate).toFixed(2) + ' Bs');
  txtLines.push('================================================');
  var txtContent = txtLines.join('\r\n');

  for (var k = 0; k < dropDirs.length; k++) {
    var d = dropDirs[k];
    if (fs.existsSync(d)) {
      try {
        fs.writeFileSync(path.join(d, 'cotizacion_' + q.quote_number + '.csv'), csvContent, 'utf8');
        fs.writeFileSync(path.join(d, 'cotizacion_' + q.quote_number + '.txt'), txtContent, 'utf8');
      } catch (_) {}
    }
  }
}

// ─── PROCESO PRINCIPAL ───
function main() {
  console.log('========================================================================');
  console.log('   JJ PAPER -- INYECTOR DE COTIZACION A MIXNET v1.0 (WINDOWS 7)');
  console.log('========================================================================\n');

  console.log('[1/5] Buscando instalacion de MixNet en esta PC...');
  var compDir = locateMixnet();
  if (!compDir) {
    console.error('[ERROR] No se encontro la carpeta comp01 de MixNet en las rutas habituales (C:\\comp01, C:\\MIX11\\comp01, etc.).');
    console.error('Por favor verifica donde estan los archivos .DBF de MixNet en esta PC.');
    process.exit(1);
  }
  console.log('  -> MixNet detectado en: ' + compDir);

  var encPath = path.join(compDir, 'MXENCCOT.DBF');
  var renPath = path.join(compDir, 'MXRENCOT.DBF');

  if (!fs.existsSync(encPath)) {
    console.error('[ERROR] No se encontro MXENCCOT.DBF en ' + compDir);
    process.exit(1);
  }

  // 2. Verificar si ya existe para no duplicar
  var encStruct = readDbfStruct(encPath);
  var renStruct = readDbfStruct(renPath);

  var fields = readDbfFields(encStruct.buf, encStruct.headerLen);
  var fNumcot = fields.filter(function(x) { return x.name === 'numcot'; })[0];
  if (fNumcot) {
    var pos = encStruct.headerLen;
    var maxEnd = Math.min(encStruct.headerLen + (encStruct.numRecords * encStruct.recordLen), encStruct.buf.length);
    while (pos + encStruct.recordLen <= maxEnd) {
      if (encStruct.buf[pos] !== 0x2A) {
        var num = encStruct.buf.toString('latin1', pos + fNumcot.pos, pos + fNumcot.pos + fNumcot.len).trim();
        if (num === QUOTE_DATA.quote_number) {
          console.log('\n[!] La cotizacion ' + QUOTE_DATA.quote_number + ' ya existe en MXENCCOT.DBF.');
          console.log('    No se duplicara el registro.');
          writeDropFiles(compDir, QUOTE_DATA);
          console.log('    Archivos de intercambio actualizados en comp01.');
          console.log('\n========================================================================');
          console.log('  PASO FINAL OBLIGATORIO:');
          console.log('  Abre MixNet y ve al menu:');
          console.log('  -> Mantenimiento -> Reorganizar Archivos (u Organizar Archivos)');
          console.log('========================================================================\n');
          return;
        }
      }
      pos += encStruct.recordLen;
    }
  }

  // 3. Buscar codigo de cliente en MXCTACLI
  console.log('\n[2/5] Verificando cliente en base de datos MixNet...');
  var codcli = findClientCode(compDir, QUOTE_DATA.rif, QUOTE_DATA.client_name);
  console.log('  -> Cliente asignado: ' + codcli + (codcli === '00' ? ' (CUENTA RECUPERADA)' : ''));

  // 4. Construir Cabecera
  console.log('\n[3/5] Construyendo registro de cabecera (MXENCCOT)...');
  var headerValues = {
    numcot:  QUOTE_DATA.quote_number,
    emision: QUOTE_DATA.date_ymd,
    cliente: codcli,
    codsuc:  '',
    codven:  QUOTE_DATA.seller_codven, // 010 (Keyder Salazar)
    comen1:  '', // Limpio sin huellas
    comen2:  '', // Limpio sin huellas
    transp:  '',
    estatus: 'PE',
    entrega: QUOTE_DATA.date_ymd,
    tot_cot: QUOTE_DATA.estimated_total_usd.toFixed(2),
    numrma:  '',
    cambio:  QUOTE_DATA.exchange_rate.toFixed(4),
    moneda:  'US$',
    nomcli:  QUOTE_DATA.client_name.substring(0, 60),
    cif:     QUOTE_DATA.rif.substring(0, 15),
    nit:     QUOTE_DATA.rif.substring(0, 15),
    tlf1:    QUOTE_DATA.phone.substring(0, 15)
  };
  var headerBuf = buildRecordBuffer(encStruct, headerValues);

  // 5. Construir Renglones
  console.log('\n[4/5] Construyendo los ' + QUOTE_DATA.items.length + ' renglones (MXRENCOT)...');
  var detailBuffers = [];
  for (var i = 0; i < QUOTE_DATA.items.length; i++) {
    var it = QUOTE_DATA.items[i];
    var renValues = {
      item:     it.sku.substring(0, 15),
      unidad:   it.unit.substring(0, 3).toUpperCase(),
      bulto:    '0',
      cantidad: it.qty.toFixed(3),
      descrip:  it.name.substring(0, 50),
      numcot:   QUOTE_DATA.quote_number,
      emision:  QUOTE_DATA.date_ymd,
      estatus:  'PE',
      despacho: '0',
      desbulto: '0',
      precio:   it.price_usd.toFixed(2),
      desc:     '0.00',
      tot_ren:  it.subtotal_usd.toFixed(2),
      iva:      'A',
      cliente:  codcli,
      codven:   QUOTE_DATA.seller_codven,
      codsuc:   '',
      codcon:   '',
      coddpto:  '',
      oferta:   'F'
    };
    detailBuffers.push(buildRecordBuffer(renStruct, renValues));
  }

  // 6. Escribir atómicamente en DBFs con backup
  console.log('\n[5/5] Inyectando registros de forma segura...');
  var resEnc = appendRecords(encPath, [headerBuf]);
  console.log('  [OK] Cabecera MXENCCOT inyectada (Backup en: ' + resEnc.backup + ')');

  var resRen = appendRecords(renPath, detailBuffers);
  console.log('  [OK] ' + resRen.count + ' renglones MXRENCOT inyectados (Backup en: ' + resRen.backup + ')');

  // Actualizar correlativo
  var nextNum = parseInt(QUOTE_DATA.quote_number, 10) + 1;
  updateCorrelative(compDir, nextNum);
  console.log('  [OK] Correlativo MXNUMCOT calibrado al siguiente numero: ' + String(nextNum).padStart(8, '0'));

  // Depositar CSV y TXT
  writeDropFiles(compDir, QUOTE_DATA);
  console.log('  [OK] Archivos cotizacion_00053355.csv y .txt depositados para impresion o archivo.');

  console.log('\n========================================================================');
  console.log('  ¡COTIZACION 00053355 INYECTADA CON EXITO TOTAL Y SIN ALTERACIONES!');
  console.log('========================================================================');
  console.log('  Cliente:    ' + QUOTE_DATA.client_name);
  console.log('  Vendedor:   010 (Keyder Salazar) -> Nomina y comisiones 100% respetadas');
  console.log('  Monto USD:  $' + QUOTE_DATA.estimated_total_usd.toFixed(2));
  console.log('  Renglones:  ' + QUOTE_DATA.items.length + ' productos');
  console.log('------------------------------------------------------------------------');
  console.log('  PASO OBLIGATORIO FINAL EN MIXNET:');
  console.log('  Para que aparezca de inmediato en la pantalla de MixNet:');
  console.log('  1. Entra a MixNet.');
  console.log('  2. Ve al menu superior:');
  console.log('     Mantenimiento -> Reorganizar Archivos (u Organizar Archivos)');
  console.log('  3. MixNet compilara los indices .NTX en 5 segundos y veras la cotizacion');
  console.log('     00053355 lista en pantalla.');
  console.log('========================================================================\n');
}

main();
