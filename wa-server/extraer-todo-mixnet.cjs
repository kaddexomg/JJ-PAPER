/*
  ========================================================================
  JJ Paper — Motor Inteligente de Extraccion MixNet v5.1 (2026)
  ========================================================================
  CERO PREGUNTAS — CERO DUDAS — 100% DATOS REALES DE LA TIENDA

  Criterios y Lógica de Negocio Aplicados:
    1. Localiza la empresa viva (M:\comp01) por fecha de transacciones reales.
    2. Logica de precios de MixNet:
       - PRECIO_CLIENTE_USD = Precio B (el precio real de venta al cliente).
       - PRECIO_MAYOR_USD   = Precio A (precio base / distribuidor).
       - PRECIO_BS          = Precio C (precio calculado en bolivares).
       - COSTO_USD          = Costo actual / reposicion.
       - STOCK_ACTUAL       = Existencia fisica en inventario.
    3. Filtro riguroso de PRODUCTOS ACTIVOS:
       - Descarta articulos inactivos (estatus = '1' en FoxPro).
       - Descarta registros historicos obsoletos sin precio y sin stock.
       - Extrae el catalogo real de la tienda (articulos vigentes hoy).
    4. Cartera de clientes con RIF limpio, direccion, celulares y correos:
       - Clasifica celulares para WhatsApp (0414, 0424, 0412, etc.) y telefonos fijos.
       - Rastrea correos en campos, notas MEMO (.DBT/.FPT) y agenda (MXAGENDA).
    5. Guarda archivos ultra-claros y legibles directamente en el ESCRITORIO.

  Compatible con Node 13+ (Windows 7 / 10 / 11).
  Cero dependencias npm — 100% nativo.
  ========================================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ═══════════════ SALIDA DIRECTA A CONSOLA (SIN BUFFER) ═══════════════ */
function say(s) {
  try {
    fs.writeSync(1, s + '\r\n');
  } catch (_) {
    console.log(s);
  }
}

function ts() {
  var d = new Date();
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
}

function log(m)     { say(ts() + ' ' + m); }
function logOK(m)   { say(ts() + '  [OK] ' + m); }
function logWarn(m) { say(ts() + '  [!] ' + m); }
function logErr(m)  { say(ts() + '  [ERROR] ' + m); }

function banner(msg) {
  say('');
  say('========================================================================');
  say('  ' + msg);
  say('========================================================================');
  say('');
}

/* ═══════════════ DECODIFICACION CP1252 ═══════════════ */
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
    else s += CP1252[b] || '';
  }
  return s.trim();
}

/* ═══════════════ LECTOR DBF Y MEMO (.DBT / .FPT) ═══════════════ */
function readDbfStructure(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;

    var numRecords = buf.readUInt32LE(4);
    var headerLen  = buf.readUInt16LE(8);
    var recordLen  = buf.readUInt16LE(10);
    var lastUpd    = { y: buf[1] + 1900, m: buf[2], d: buf[3] };

    if (headerLen < 33 || recordLen < 1 || headerLen > buf.length) return null;

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
        fields.push({
          name: clean,
          rawName: rawName.trim(),
          type: String.fromCharCode(buf[off + 11]),
          len:  buf[off + 16] || buf.readUInt16LE(off + 16),
          dec:  buf[off + 17] || 0
        });
      }
      off += 32;
    }

    var st = fs.statSync(filePath);

    var memoPath = null;
    var baseNoExt = filePath.replace(/\.dbf$/i, '');
    var memoExts = ['.dbt', '.DBT', '.fpt', '.FPT'];
    for (var mi = 0; mi < memoExts.length; mi++) {
      var mp = baseNoExt + memoExts[mi];
      if (fs.existsSync(mp)) { memoPath = mp; break; }
    }

    return {
      path: filePath,
      fileName: path.basename(filePath).toUpperCase(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      lastUpd: lastUpd,
      mtime: st.mtime,
      size: st.size,
      fields: fields,
      fieldNames: fields.map(function(f) { return f.name; }),
      memoPath: memoPath
    };
  } catch (_) {
    return null;
  }
}

function openMemo(struct) {
  if (!struct.memoPath) return null;
  try {
    var fd = fs.openSync(struct.memoPath, 'r');
    var hBuf = Buffer.alloc(512);
    fs.readSync(fd, hBuf, 0, 512, 0);
    var blockSize = 512;
    if (/\.fpt$/i.test(struct.memoPath)) {
      var bs = hBuf.readUInt16BE(6);
      if (bs >= 32 && bs <= 16384) blockSize = bs;
    }
    return { fd: fd, blockSize: blockSize };
  } catch (_) {
    return null;
  }
}

function readMemoBlock(memoInfo, blockNum) {
  if (!memoInfo || !blockNum || blockNum <= 0) return '';
  try {
    var off = blockNum * memoInfo.blockSize;
    var buf = Buffer.alloc(1024);
    var n = fs.readSync(memoInfo.fd, buf, 0, 1024, off);
    if (n <= 0) return '';
    var txt = '';
    for (var i = 0; i < n; i++) {
      if (buf[i] === 0x1A || buf[i] === 0) break;
      txt += decodeStr(buf, i, 1);
    }
    return txt.trim();
  } catch (_) {
    return '';
  }
}

function closeMemo(memoInfo) {
  if (memoInfo && memoInfo.fd) {
    try { fs.closeSync(memoInfo.fd); } catch (_) {}
  }
}

function readDbfRows(struct, maxLimit) {
  var limit = maxLimit || 500000;
  var buf;
  try { buf = fs.readFileSync(struct.path); } catch (_) { return []; }

  var memo = openMemo(struct);
  var rows = [];
  var pos = struct.headerLen;
  var maxDataEnd = Math.min(
    struct.headerLen + (struct.numRecords * struct.recordLen),
    buf.length
  );

  while (pos + struct.recordLen <= maxDataEnd && rows.length < limit) {
    var flag = buf[pos];
    // 0x2A = borrado en FoxPro. Omitir.
    if (flag !== 0x2A && flag === 0x20) {
      var row = {};
      var fOff = 1;
      for (var fi = 0; fi < struct.fields.length; fi++) {
        var f = struct.fields[fi];
        var val = decodeStr(buf, pos + fOff, f.len);
        if (f.type === 'M') {
          var blk = parseInt(val, 10);
          if (!isNaN(blk) && blk > 0) {
            row[f.name] = readMemoBlock(memo, blk);
          } else {
            row[f.name] = '';
          }
        } else {
          row[f.name] = val;
        }
        fOff += f.len;
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }

  closeMemo(memo);
  return rows;
}

function findField(fieldNames, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi] === c || fieldNames[fi].indexOf(c) === 0) return fieldNames[fi];
    }
  }
  for (var ci2 = 0; ci2 < candidates.length; ci2++) {
    var c2 = candidates[ci2].toLowerCase();
    if (c2.length < 3) continue;
    for (var fi2 = 0; fi2 < fieldNames.length; fi2++) {
      if (fieldNames[fi2].indexOf(c2) !== -1) return fieldNames[fi2];
    }
  }
  return null;
}

/* ═══════════════ DETECCION DE LA EMPRESA ACTIVA ("BASE VIVA") ═══════════════ */
function locateLiveStoreCompany() {
  // Rutas candidatas
  var candidateDirs = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\MIXNET\\comp01',
    'D:\\MIXNET\\comp01'
  ];

  var bestDir = null;
  var latestTxDate = null;
  var txFiles = ['MXTRAINV.DBF', 'MXTRACOB.DBF', 'MXRENFAC.DBF', 'YPENCFAC.DBF', 'VICTAINV.DBF', 'MXCTACLI.DBF'];

  for (var i = 0; i < candidateDirs.length; i++) {
    var d = candidateDirs[i];
    try {
      if (fs.existsSync(d)) {
        // Verificar fecha mas reciente de transacciones
        for (var ti = 0; ti < txFiles.length; ti++) {
          var fp = path.join(d, txFiles[ti]);
          if (fs.existsSync(fp)) {
            var st = fs.statSync(fp);
            if (!latestTxDate || st.mtime > latestTxDate) {
              latestTxDate = st.mtime;
              bestDir = d;
            }
          }
        }
      }
    } catch (_) {}
  }

  return { dir: bestDir, lastTx: latestTxDate };
}

/* ═══════════════ EXTRACCION Y FILTRADO INTELIGENTE DE PRODUCTOS ═══════════════ */
function extractActiveProducts(liveDir) {
  log('Auditando y extrayendo catalogo de productos en ' + liveDir + '...');

  // Tablas que contienen definiciones de articulos en la empresa
  var tableNames = [
    'VICTAINV.DBF',
    'MXCTAINV.DBF',
    'CTAEVA.DBF',
    'JJCTAINV.DBF'
  ];

  var productsMap = new Map();
  var totalRawFound = 0;
  var inactiveCount = 0;
  var obsoleteCount = 0;

  for (var ti = 0; ti < tableNames.length; ti++) {
    var tPath = path.join(liveDir, tableNames[ti]);
    if (fs.existsSync(tPath)) {
      var struct = readDbfStructure(tPath);
      if (struct && struct.numRecords > 0) {
        log('  -> Analizando tabla: ' + struct.fileName + ' (' + struct.numRecords + ' registros)');
        var rows = readDbfRows(struct, 500000);
        var fn = struct.fieldNames;

        var fCode   = findField(fn, ['codart', 'codigo', 'cod_art', 'id']);
        var fName   = findField(fn, ['nomart', 'nombre', 'descrip', 'articulo']);
        var fPA     = findField(fn, ['precio_a', 'p1', 'precio1']);
        var fPB     = findField(fn, ['precio_b', 'p2', 'precio2']);
        var fPC     = findField(fn, ['precio_c', 'p3', 'precio3']);
        var fCost   = findField(fn, ['costo_act', 'costo', 'ult_costo', 'cost_u']);
        var fStock  = findField(fn, ['existe_act', 'exist', 'stock', 'cantidad']);
        var fGroup  = findField(fn, ['grupo', 'familia', 'fam', 'cat']);
        var fBrand  = findField(fn, ['marca', 'mar']);
        var fUnit   = findField(fn, ['unidad', 'uni', 'medida']);
        var fProv   = findField(fn, ['ult_prove', 'proveedor', 'prov_asig']);
        var fStatus = findField(fn, ['estatus', 'status', 'inactivo']);
        var fFMod   = findField(fn, ['fecha_mod', 'fec_mod', 'fechamod']);

        for (var ri = 0; ri < rows.length; ri++) {
          totalRawFound++;
          var r = rows[ri];

          var cod = String(r[fCode] || '').trim().toUpperCase();
          if (!cod) continue;

          var nom = String(r[fName] || '').trim();
          if (!nom) nom = '(SIN NOMBRE)';

          // CRITERIO 1: Estatus de FoxPro (estatus == '1' es DESACTIVADO / INACTIVO)
          var stVal = String(r[fStatus] || '').trim();
          if (stVal === '1') {
            inactiveCount++;
            continue;
          }

          // Precios de MixNet
          // PRECIO B: Precio venta cliente (USD)
          // PRECIO A: Precio mayorista / distribuidor (USD)
          // PRECIO C: Precio en Bolivares (Bs)
          var pB = parseFloat(String(r[fPB] || '0').replace(/,/g, '.')) || 0;
          var pA = parseFloat(String(r[fPA] || '0').replace(/,/g, '.')) || 0;
          var pC = parseFloat(String(r[fPC] || '0').replace(/,/g, '.')) || 0;
          var cost = parseFloat(String(r[fCost] || '0').replace(/,/g, '.')) || 0;
          var stock = parseFloat(String(r[fStock] || '0').replace(/,/g, '.')) || 0;

          // Si el precio B esta en cero pero A tiene valor, usar A como respaldo para cliente
          var precioCliente = pB > 0 ? pB : pA;
          var precioMayor   = pA > 0 ? pA : pB;

          var fMod = String(r[fFMod] || '').trim();

          // CRITERIO 2: Filtro de activos reales:
          // Un producto activo hoy en dia DEBE tener precio de venta > 0, o existencia > 0 en tienda.
          // Si tiene precio 0 Y stock 0, es un articulo obsoleto/eliminado que no se vende.
          if (precioCliente <= 0 && stock <= 0) {
            obsoleteCount++;
            continue;
          }

          // Descartar articulos con marcas de borrado en el nombre
          if (/^(\*{3,}|NO USAR|ELIMINADO|ANULADO)/i.test(nom)) {
            inactiveCount++;
            continue;
          }

          var prodObj = {
            codigo: cod,
            descripcion: nom,
            precio_cliente_usd: precioCliente,
            precio_mayor_usd: precioMayor,
            precio_bs: pC,
            stock_actual: stock > 0 ? stock : 0,
            costo_usd: cost,
            estatus: 'ACTIVO',
            categoria: String(r[fGroup] || '').trim(),
            marca: String(r[fBrand] || '').trim(),
            empaque: String(r[fUnit] || '').trim(),
            proveedor: String(r[fProv] || '').trim(),
            fecha_mod: fMod,
            tabla_fuente: struct.fileName
          };

          // Fusion inteligente por SKU si ya fue leido en otra tabla
          if (!productsMap.has(cod)) {
            productsMap.set(cod, prodObj);
          } else {
            var cur = productsMap.get(cod);

            // Si el nuevo registro viene con fecha_mod mas reciente, actualiza los precios
            if (prodObj.fecha_mod && prodObj.fecha_mod > (cur.fecha_mod || '')) {
              if (prodObj.precio_cliente_usd > 0) {
                cur.precio_cliente_usd = prodObj.precio_cliente_usd;
                cur.precio_mayor_usd   = prodObj.precio_mayor_usd;
                cur.precio_bs          = prodObj.precio_bs;
                cur.fecha_mod          = prodObj.fecha_mod;
                cur.tabla_fuente       = prodObj.tabla_fuente;
              }
            }

            // Si el anterior tenia stock 0 y este tiene stock real, actualizar
            if (prodObj.stock_actual > cur.stock_actual) {
              cur.stock_actual = prodObj.stock_actual;
            }

            // Completar datos vacios
            if (!cur.marca && prodObj.marca) cur.marca = prodObj.marca;
            if (!cur.categoria && prodObj.categoria) cur.categoria = prodObj.categoria;
            if (!cur.empaque && prodObj.empaque) cur.empaque = prodObj.empaque;
            if (!cur.proveedor && prodObj.proveedor) cur.proveedor = prodObj.proveedor;
            if (cur.costo_usd <= 0 && prodObj.costo_usd > 0) cur.costo_usd = prodObj.costo_usd;
          }
        }
      }
    }
  }

  var activeProducts = Array.from(productsMap.values());

  // Ordenar alfabeticamente por descripcion
  activeProducts.sort(function(a, b) {
    return a.descripcion.localeCompare(b.descripcion);
  });

  return {
    products: activeProducts,
    totalRaw: totalRawFound,
    inactive: inactiveCount,
    obsolete: obsoleteCount
  };
}

/* ═══════════════ EXTRACCION Y NORMALIZACION DE CLIENTES ═══════════════ */
function extractActiveClients(liveDir) {
  log('Auditando y extrayendo cartera de clientes con emails y telefonos...');

  var EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  var emailIndexByRif  = {};
  var emailIndexByCod  = {};

  function indexEmail(em, rif, cod) {
    if (!em) return;
    var clean = em.trim().toLowerCase();
    if (rif) {
      var rClean = rif.toUpperCase().replace(/[\s.-]/g, '');
      if (rClean && !emailIndexByRif[rClean]) emailIndexByRif[rClean] = clean;
    }
    if (cod) {
      var cClean = cod.trim().toUpperCase();
      if (cClean && !emailIndexByCod[cClean]) emailIndexByCod[cClean] = clean;
    }
  }

  // 1. Matriz de emails en tablas complementarias (MXAGENDA.DBF)
  var agendaPaths = [
    path.join(liveDir, 'MXAGENDA.DBF'),
    path.join(path.dirname(liveDir), 'MXAGENDA.DBF'),
    'M:\\MXAGENDA.DBF'
  ];

  for (var ai = 0; ai < agendaPaths.length; ai++) {
    var ap = agendaPaths[ai];
    if (fs.existsSync(ap)) {
      var agStruct = readDbfStructure(ap);
      if (agStruct) {
        log('  -> Escaneando agenda de contactos: ' + agStruct.path);
        var agRows = readDbfRows(agStruct, 20000);
        agRows.forEach(function(ar) {
          var m = String(ar.email || '').match(EMAIL_REGEX);
          if (m) {
            indexEmail(m[0], ar.rif || ar.cif || '', ar.codcli || ar.codigo || '');
          }
        });
        break;
      }
    }
  }

  // 2. Cartera maestra de clientes (MXCTACLI.DBF)
  var cPath = path.join(liveDir, 'MXCTACLI.DBF');
  if (!fs.existsSync(cPath)) cPath = path.join(liveDir, 'mxctacli.dbf');

  var clientsMap = new Map();

  if (fs.existsSync(cPath)) {
    var cStruct = readDbfStructure(cPath);
    if (cStruct) {
      log('  -> Extrayendo clientes desde: ' + cStruct.path + ' (' + cStruct.numRecords + ' registros)');
      var cRows = readDbfRows(cStruct, 500000);
      var cfn = cStruct.fieldNames;

      var fCod   = findField(cfn, ['codcli', 'codigo', 'cod_cli', 'id']);
      var fNom   = findField(cfn, ['nomcli', 'razonsocial', 'razon', 'nombre']);
      var fRif   = findField(cfn, ['cifoih', 'cifoi', 'cif', 'rif', 'cedula']);
      var fDir1  = findField(cfn, ['direc1h', 'direc1', 'dir1', 'direccion1']);
      var fDir2  = findField(cfn, ['direc2h', 'direc2', 'dir2']);
      var fDir3  = findField(cfn, ['direc3h', 'direc3', 'dir3']);
      var fDir4  = findField(cfn, ['direc4h', 'direc4', 'dir4']);
      var fTlf1  = findField(cfn, ['tlf1h', 'tlf1', 'telefono1', 'tel1']);
      var fTlf2  = findField(cfn, ['tlf2h', 'tlf2', 'telefono2', 'tel2']);
      var fFax   = findField(cfn, ['fax4h', 'fax', 'tlf3']);
      var fEmail = findField(cfn, ['emailngq', 'email', 'correo', 'mail']);
      var fVen   = findField(cfn, ['vendedor', 'codven', 'vended']);
      var fZona  = findField(cfn, ['zonacto', 'zona']);
      var fSaldo = findField(cfn, ['saldoor', 'saldo']);

      for (var ci = 0; ci < cRows.length; ci++) {
        var rc = cRows[ci];
        var cCod = String(rc[fCod] || '').trim();
        var cNom = String(rc[fNom] || '').trim();
        if (!cCod && !cNom) continue;

        // Limpiar y estructurar RIF
        var rawRif = String(rc[fRif] || '').trim().toUpperCase().replace(/[\s.-]/g, '');
        var rifClean = rawRif;
        if (/^\d+$/.test(rawRif)) rifClean = 'V-' + rawRif;
        else if (/^[JVEGP]\d+$/.test(rawRif)) rifClean = rawRif.charAt(0) + '-' + rawRif.substring(1);

        // Concatenar direccion fiscal completa
        var dirParts = [rc[fDir1], rc[fDir2], rc[fDir3], rc[fDir4]].filter(function(x) {
          return x && String(x).trim();
        }).map(function(x) { return String(x).trim(); });
        var direccion = dirParts.join(' ').trim();

        // Clasificar telefonos: Movil (WhatsApp) vs Fijo
        var rawPhones = [rc[fTlf1], rc[fTlf2], rc[fFax]].filter(function(x) {
          return x && String(x).trim();
        }).map(function(x) { return String(x).trim(); });

        var movilPhone = '';
        var fijoPhone  = '';

        for (var pi = 0; pi < rawPhones.length; pi++) {
          var pRaw = rawPhones[pi];
          var digits = pRaw.replace(/\D/g, '');
          // Si tiene 10 u 11 digitos y empieza por 0414, 0424, 0412, 0416, 0426
          if (/^0?(414|424|412|416|426)\d{7}$/.test(digits)) {
            if (!movilPhone) movilPhone = pRaw;
          } else if (digits.length >= 7) {
            if (!fijoPhone) fijoPhone = pRaw;
          }
        }
        if (!movilPhone && rawPhones.length > 0) movilPhone = rawPhones[0];

        // Resolucion de Email:
        var email = '';
        var mDirect = String(rc[fEmail] || '').match(EMAIL_REGEX);
        if (mDirect) email = mDirect[0].toLowerCase();

        // 2) Memo .DBT / .FPT
        if (!email && rc.memo) {
          var mMemo = String(rc.memo).match(EMAIL_REGEX);
          if (mMemo) email = mMemo[0].toLowerCase();
        }

        // 3) En la direccion
        if (!email && direccion) {
          var mDir = direccion.match(EMAIL_REGEX);
          if (mDir) email = mDir[0].toLowerCase();
        }

        // 4) En matriz de agenda
        var rNorm = rawRif.toUpperCase().replace(/[\s.-]/g, '');
        if (!email && rNorm && emailIndexByRif[rNorm]) {
          email = emailIndexByRif[rNorm];
        }
        if (!email && cCod && emailIndexByCod[cCod.toUpperCase()]) {
          email = emailIndexByCod[cCod.toUpperCase()];
        }

        var cliObj = {
          codigo: cCod,
          razon_social: cNom,
          rif: rifClean,
          telefono_movil_whatsapp: movilPhone,
          telefono_fijo: fijoPhone,
          email: email,
          direccion_fiscal: direccion,
          vendedor: String(rc[fVen] || '').trim(),
          zona: String(rc[fZona] || '').trim(),
          saldo: parseFloat(String(rc[fSaldo] || '0').replace(/,/g, '.')) || 0
        };

        var key = cCod || rifClean || cNom;
        if (!clientsMap.has(key)) {
          clientsMap.set(key, cliObj);
        } else {
          var prev = clientsMap.get(key);
          if (!prev.email && cliObj.email) prev.email = cliObj.email;
          if (!prev.telefono_movil_whatsapp && cliObj.telefono_movil_whatsapp) prev.telefono_movil_whatsapp = cliObj.telefono_movil_whatsapp;
        }
      }
    }
  }

  var activeClients = Array.from(clientsMap.values());
  activeClients.sort(function(a, b) {
    return a.razon_social.localeCompare(b.razon_social);
  });

  return activeClients;
}

/* ═══════════════ HELPERS PARA EXCEL Y GUARDADO ═══════════════ */
function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[",;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function fmtDate(s) {
  if (!s || s.length < 8) return '';
  return s.substring(0, 4) + '-' + s.substring(4, 6) + '-' + s.substring(6, 8);
}

function saveOutputs(prefix, csvContent, jsonPayload) {
  var d = new Date();
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var stamp = '' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  var BOM = '\uFEFF';

  var savedFiles = [];
  var targetDirs = [__dirname];

  var u = process.env.USERPROFILE || '';
  if (u) {
    var desk = path.join(u, 'Desktop');
    var escr = path.join(u, 'Escritorio');
    if (fs.existsSync(desk) && targetDirs.indexOf(desk) === -1) targetDirs.push(desk);
    if (fs.existsSync(escr) && targetDirs.indexOf(escr) === -1) targetDirs.push(escr);
  }

  for (var i = 0; i < targetDirs.length; i++) {
    var tDir = targetDirs[i];
    try {
      if (csvContent) {
        var csvPath = path.join(tDir, prefix + '_' + stamp + '.csv');
        fs.writeFileSync(csvPath, BOM + csvContent, 'utf8');
        savedFiles.push(csvPath);
      }
      if (jsonPayload) {
        var jsonPath = path.join(tDir, prefix + '_' + stamp + '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');
        savedFiles.push(jsonPath);
      }
    } catch (e) {
      logWarn('No se pudo guardar en ' + tDir + ': ' + e.message);
    }
  }

  return savedFiles;
}

/* ═══════════════ MOTOR PRINCIPAL ═══════════════ */
function run() {
  banner('JJ PAPER -- EXTRACTOR CONSCIENTE Y PRECISO MIXNET v5.1');

  // 1. Localizar Servidor Activo
  log('Paso 1: Localizando servidor activo de MixNet...');
  var live = locateLiveStoreCompany();

  if (!live.dir) {
    logErr('No se encontro la unidad de red M:\\comp01.');
    say('  Por favor verifica que la unidad M: este conectada al servidor 192.168.0.185.');
    return;
  }

  logOK('Servidor en vivo conectado: ' + live.dir);
  if (live.lastTx) {
    logOK('Ultima transaccion registrada en tienda: ' + live.lastTx.toLocaleDateString() + ' ' + live.lastTx.toLocaleTimeString());
  }

  // 2. Extraer y filtrar Productos Activos
  log('Paso 2: Extrayendo catalogo con logica estricta de precios (Precio B = Cliente)...');
  var prodResult = extractActiveProducts(live.dir);
  var productos = prodResult.products;

  say('');
  say('  ----------------------------------------------------------------------');
  say('  AUDITORIA DE PRODUCTOS EN TIENDA:');
  say('    * Total registros evaluados en base de datos: ' + prodResult.totalRaw);
  say('    * Registros inactivos / dados de baja:        ' + prodResult.inactive);
  say('    * Registros obsoletos (sin precio ni stock):  ' + prodResult.obsolete);
  say('    * PRODUCTOS ACTIVOS Y VIGENTES HOY:           ' + productos.length);
  say('  ----------------------------------------------------------------------');

  // Muestra de validacion visual de 4 productos
  say('');
  say('  MUESTRA DE PRECIOS EXACTOS (PRECIO B = CLIENTE):');
  productos.slice(0, 4).forEach(function(p) {
    say('  * [' + p.codigo + '] ' + p.descripcion);
    say('    -> PRECIO CLIENTE (USD): $' + p.precio_cliente_usd.toFixed(2) + ' (Precio B)');
    say('    -> PRECIO MAYOR (USD):   $' + p.precio_mayor_usd.toFixed(2) + ' (Precio A)');
    say('    -> PRECIO EN BS:         ' + p.precio_bs.toFixed(2) + ' Bs (Precio C)');
    say('    -> STOCK FISICO ACTUAL:  ' + p.stock_actual + ' unidades');
    say('    -> TABLA FUENTE:         ' + p.tabla_fuente + (p.fecha_mod ? ' | ' + fmtDate(p.fecha_mod) : ''));
    say('');
  });

  // 3. Extraer Clientes y Correos
  log('Paso 3: Extrayendo cartera de clientes con emails y celulares...');
  var clientes = extractActiveClients(live.dir);
  var clientesConEmail = clientes.filter(function(c) { return c.email; }).length;

  say('');
  say('  ----------------------------------------------------------------------');
  say('  AUDITORIA DE CARTERA DE CLIENTES:');
  say('    * Total clientes activos:          ' + clientes.length);
  say('    * Clientes con correo certificado: ' + clientesConEmail);
  say('  ----------------------------------------------------------------------');

  // 4. Estructurar CSVs Ultra-Clares para Excel
  log('Paso 4: Construyendo archivos limpios para Excel y Supabase...');

  var pHeaders = 'CODIGO,DESCRIPCION,PRECIO_CLIENTE_USD,PRECIO_MAYOR_USD,PRECIO_BS,STOCK_ACTUAL,COSTO_USD,ESTATUS,CATEGORIA,MARCA,EMPAQUE,PROVEEDOR,FECHA_ACTUALIZACION';
  var pRows = [pHeaders];
  productos.forEach(function(p) {
    pRows.push([
      escCSV(p.codigo),
      escCSV(p.descripcion),
      p.precio_cliente_usd.toFixed(2),
      p.precio_mayor_usd.toFixed(2),
      p.precio_bs.toFixed(2),
      p.stock_actual.toString(),
      p.costo_usd.toFixed(2),
      escCSV(p.estatus),
      escCSV(p.categoria),
      escCSV(p.marca),
      escCSV(p.empaque),
      escCSV(p.proveedor),
      escCSV(fmtDate(p.fecha_mod))
    ].join(','));
  });

  var cHeaders = 'CODIGO_CLIENTE,NOMBRE_O_RAZON_SOCIAL,RIF,TELEFONO_MOVIL_WHATSAPP,TELEFONO_FIJO,EMAIL,DIRECCION_FISCAL,VENDEDOR_ASIGNADO,ZONA,SALDO_PENDIENTE';
  var cRows = [cHeaders];
  clientes.forEach(function(c) {
    cRows.push([
      escCSV(c.codigo),
      escCSV(c.razon_social),
      escCSV(c.rif),
      escCSV(c.telefono_movil_whatsapp),
      escCSV(c.telefono_fijo),
      escCSV(c.email),
      escCSV(c.direccion_fiscal),
      escCSV(c.vendedor),
      escCSV(c.zona),
      c.saldo.toFixed(2)
    ].join(','));
  });

  var supabasePayload = {
    exportado_el: new Date().toISOString(),
    servidor_fuente: live.dir,
    resumen: {
      total_productos_activos: productos.length,
      total_clientes: clientes.length,
      clientes_con_correo: clientesConEmail
    },
    productos: productos,
    clientes: clientes
  };

  // Guardar archivos
  var savedP = saveOutputs('mixnet_productos_activos', pRows.join('\r\n'), null);
  var savedC = saveOutputs('mixnet_clientes_cartera', cRows.join('\r\n'), null);
  var savedJ = saveOutputs('mixnet_payload_supabase', null, supabasePayload);

  say('');
  say('========================================================================');
  say('  EXTRACCION COMPLETADA CON EXITO (DATOS REALES Y ACTIVOS)');
  say('========================================================================');
  say('  Archivos listos en tu ESCRITORIO:');
  savedP.forEach(function(f) { say('    * PRODUCTOS : ' + f); });
  savedC.forEach(function(f) { say('    * CLIENTES  : ' + f); });
  savedJ.forEach(function(f) { say('    * SUPABASE  : ' + f); });
  say('========================================================================');
  say('');
}

try {
  run();
} catch (err) {
  logErr('Error en ejecucion: ' + (err.stack || err.message));
}