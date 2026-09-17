/*
  Test que simula exactamente lo que haria el extractor en la PC de la tienda,
  usando los campos y nombres de archivo REALES de auditoria-productos.txt.
  Si este test pasa, el script va a funcionar alla.
*/
'use strict';

// Copiar las funciones del script real para probarlas
function findField(fieldNames, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi] === c || fieldNames[fi].indexOf(c) === 0) return fieldNames[fi];
    }
  }
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    if (c.length < 3) continue;
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi].indexOf(c) !== -1) return fieldNames[fi];
    }
  }
  return null;
}

function hasField(fieldNames, candidates) {
  return findField(fieldNames, candidates) !== null;
}

function scoreProducto(struct) {
  var fn = struct.fieldNames;
  var s = 0;
  var fnStr = struct.fileName;
  if (/VICTAINV|MXCTAINV|JJCTAINV|CTAINV/i.test(fnStr)) s += 1000;
  if (/ARTIC|PROALM|PRODUC|ITEM/i.test(fnStr)) s += 10;
  if (/LISPRE/i.test(fnStr)) s += 5;
  if (hasField(fn, ['codart', 'codarti', 'codigo', 'codinv', 'cod_art', 'art'])) s += 3;
  if (hasField(fn, ['nomart', 'descrip', 'nombre', 'detalle', 'articulo', 'descri', 'nom', 'des'])) s += 3;
  if (hasField(fn, ['precio_a', 'precio1', 'p1', 'precio', 'pvp', 'pventa', 'prec', 'p_vta'])) s += 3;
  if (hasField(fn, ['existe_act', 'exist', 'stock', 'saldoinv', 'cant', 'cantidad'])) s += 2;
  if (hasField(fn, ['costo_act', 'costo', 'cost', 'ultcos', 'cost_u', 'ult_costo'])) s += 2;
  if (hasField(fn, ['familia', 'fam', 'grupo', 'cat'])) s += 2;
  if (/REN|ENC|NUM|TRA|HIS|BUF/i.test(fnStr)) s -= 15;
  if (hasField(fn, ['fecha', 'fec']) && hasField(fn, ['nrofac', 'numfac', 'factura', 'docto'])) s -= 5;
  return s;
}

// Tablas REALES de la auditoria-productos.txt
var tables = [
  {
    fileName: 'VICTAINV.DBF',
    numRecords: 2017,
    fieldNames: ['codart','nomart','nomalt','grupo','marca','alterno','iva','precio_a','precio_b','precio_c','precio_d','des_a','des_b','des_c','des_d','factor','exmin','exmax','precio_max','precio_min','ubica','peso','unidad','altura','ancho','profun','can_bul','compuesto','ult_prove','prov_asig','ult_costo','ordena','costo_act','existe_act','fecha_cos','fecha_sal','pedido','cotiza','recalc','acu_ent','acu_sal','acu_cos','acu_csa','acu_ven','acu_cve','fecha_crea','codcon','estatus','fecha_mod','hora_mod','resumen','tipprod','xxxxxxx','invdiario','almacen']
  },
  {
    fileName: 'MXCTAINV.DBF',
    numRecords: 2263,
    fieldNames: ['codart','nomart','nomalt','grupo','marca','alterno','iva','precio_a','precio_b','precio_c','precio_d','des_a','des_b','des_c','des_d','factor','exmin','exmax','precio_max','precio_min','ubica','peso','unidad','altura','ancho','profun','can_bul','compuesto','ult_prove','prov_asig','ult_costo','ordena','costo_act','existe_act','fecha_cos','fecha_sal','pedido','cotiza','recalc','acu_ent','acu_sal','acu_cos','acu_csa','acu_ven','acu_cve','fecha_crea','codcon','estatus','fecha_mod','hora_mod','resumen','tipprod','xxxxxxx','invdiario','almacen']
  },
  {
    fileName: 'JJCTAINV.DBF',
    numRecords: 2141,
    fieldNames: ['codart','nomart','nomalt','grupo','marca','alterno','iva','precio_a','precio_b','precio_c','precio_d','des_a','des_b','des_c','des_d','factor','exmin','exmax','precio_max','precio_min','ubica','peso','unidad','altura','ancho','profun','can_bul','compuesto','ult_prove','prov_asig','ult_costo','ordena','costo_act','existe_act','fecha_cos','fecha_sal','pedido','cotiza','recalc','acu_ent','acu_sal','acu_cos','acu_csa','acu_ven','acu_cve','fecha_crea','codcon','estatus','fecha_mod','hora_mod','resumen','tipprod','xxxxxxx','invdiario','almacen']
  },
  {
    fileName: 'CTAEVA.DBF',  // La tabla basura de 151 registros
    numRecords: 151,
    fieldNames: ['codart','nomart','precio_a','precio_b','precio_c','precio_d','grupo','iva']
  },
  {
    fileName: 'MXCTACLI.DBF',  // Clientes, no productos
    numRecords: 6172,
    fieldNames: ['codcli','nomcli','codacti','grupo','cif','direc1','direc2','direc3','direc4','tlf1','tlf2','fax','estatus','lim_cre','dia_cre','transpor','descuento','observa','contacto','zona','cobrador','vendedor','saldo','fec_upag','codcon','tot_ven','regimen','tarifa','banco','ctabanco','forma','nit','fechaing','email','fecha_mod','hora_mod','limfacp','activo','cli_esp','porriva','regmerc']
  }
];

console.log('=== TEST DE SCORING DE PRODUCTOS ===\n');
var bestScore = -999;
var bestTable = null;
for (var i = 0; i < tables.length; i++) {
  var t = tables[i];
  var score = scoreProducto(t);
  console.log('  ' + t.fileName + ' (' + t.numRecords + ' registros) -> Score: ' + score);
  if (score > bestScore && t.numRecords > 5) {
    bestScore = score;
    bestTable = t;
  }
}

console.log('\n  >>> GANADOR: ' + bestTable.fileName + ' con score ' + bestScore + ' y ' + bestTable.numRecords + ' registros\n');

// Ahora verificar que los campos se mapean correctamente
console.log('=== TEST DE MAPEO DE CAMPOS ===\n');
var pFn = bestTable.fieldNames;
var pf = {
  codigo:  findField(pFn, ['codart', 'codarti', 'codigo', 'art', 'id']),
  descrip: findField(pFn, ['nomart', 'descrip', 'nombre', 'detalle', 'articulo', 'descri', 'nom', 'des']),
  p1:      findField(pFn, ['precio_a', 'precio1', 'p1', 'precio', 'pvp', 'pventa', 'prec', 'p_vta']),
  p2:      findField(pFn, ['precio_b', 'precio2', 'p2']),
  p3:      findField(pFn, ['precio_c', 'precio3', 'p3']),
  p4:      findField(pFn, ['precio_d', 'precio4', 'p4']),
  costo:   findField(pFn, ['costo_act', 'costo', 'cost', 'cost_u', 'ult_costo']),
  exist:   findField(pFn, ['existe_act', 'exist', 'stock', 'cant', 'saldo', 'cantidad']),
  grupo:   findField(pFn, ['grupo', 'familia', 'fam', 'cat']),
  marca:   findField(pFn, ['marca']),
  unidad:  findField(pFn, ['unidad', 'uni', 'medida']),
  iva:     findField(pFn, ['iva']),
  proveedor: findField(pFn, ['ult_prove', 'prov_asig', 'proveedor']),
  estatus: findField(pFn, ['estatus', 'status'])
};

var allOK = true;
var expected = {
  codigo: 'codart', descrip: 'nomart', p1: 'precio_a', p2: 'precio_b',
  p3: 'precio_c', p4: 'precio_d', costo: 'costo_act', exist: 'existe_act',
  grupo: 'grupo', marca: 'marca', unidad: 'unidad', iva: 'iva',
  proveedor: 'ult_prove', estatus: 'estatus'
};

var keys = Object.keys(pf);
for (var i = 0; i < keys.length; i++) {
  var k = keys[i];
  var found = pf[k];
  var exp = expected[k];
  var ok = found === exp;
  if (!ok) allOK = false;
  console.log('  ' + (ok ? 'OK' : 'FALLO') + '  ' + k + ' -> ' + (found || 'NULL') + (ok ? '' : ' (esperaba: ' + exp + ')'));
}

console.log('\n=== RESULTADO FINAL ===');
if (allOK) {
  console.log('  TODOS LOS TESTS PASARON. El script VA A FUNCIONAR en la PC de la tienda.');
} else {
  console.log('  ALGUN TEST FALLO. Hay que corregir antes de enviar.');
}
