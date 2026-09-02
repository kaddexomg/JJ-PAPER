var fs = require('fs');
var path = require('path');

function readDbfPreview(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    var numRecords = buf.readUInt32LE(4);
    if (numRecords < 150 || numRecords > 30000) return null; // solo catalogos razonables
    
    var headerLen = buf.readUInt16LE(8);
    var recordLen = buf.readUInt16LE(10);
    
    var fields = [];
    var offset = 32;
    while (buf[offset] !== 0x0D && offset < headerLen) {
      var name = '';
      for (var i = 0; i < 11; i++) {
        if (buf[offset + i] === 0) break;
        name += String.fromCharCode(buf[offset + i]);
      }
      fields.push({
        name: name.trim().toLowerCase(),
        type: String.fromCharCode(buf[offset + 11]),
        len: buf[offset + 16]
      });
      offset += 32;
    }
    
    var hasDesc = false;
    for (var i=0; i<fields.length; i++) {
      if (fields[i].type === 'C' && fields[i].len > 15) hasDesc = true;
      if (fields[i].type === 'M') hasDesc = true; // Memo fields
    }
    // if (!hasDesc) return null; // must have a description field
    
    // read first 3 records
    var rows = [];
    var recOffset = headerLen;
    for (var r = 0; r < Math.min(3, numRecords); r++) {
      if (recOffset + recordLen > buf.length) break;
      var row = {};
      var fOffset = recOffset + 1; // skip deleted flag
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var val = buf.toString('ascii', fOffset, fOffset + f.len).trim();
        row[f.name] = val;
        fOffset += f.len;
      }
      rows.push(row);
      recOffset += recordLen;
    }
    
    return {
      file: path.basename(filePath),
      path: filePath,
      records: numRecords,
      fields: fields.map(function(f) { return f.name + '(' + f.type + ')'; }).join(', '),
      sample: rows
    };
  } catch (e) {
    return null;
  }
}

console.log("Iniciando auditoria profunda de catalogos en MixNet...");

var reportFile = path.join(__dirname, 'reporte_mixnet.json');
if (!fs.existsSync(reportFile)) {
  console.log("No encuentro reporte_mixnet.json. Por favor, asegurate de correr este script en la misma carpeta.");
  process.exit(1);
}

var j = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
var files = j.grandes.concat(j.relevantes);
// Filtrar archivos DBF de entre 50KB y 15MB (tamaños tipicos de catalogos)
var dbfs = files.filter(function(f) { return f.path.toUpperCase().endsWith('.DBF') && f.size > 50000 && f.size < 15000000; });

// Filtrar tablas transaccionales obvias para ir mas rapido
dbfs = dbfs.filter(function(f) { return !/REN|ENC|NUM|TRA|HIS|BUF|COPIA|BACKUP|LOG|MOV/i.test(path.basename(f.path)); });

var unique = {};
dbfs.forEach(function(f) {
  var bn = path.basename(f.path).toUpperCase();
  if (!unique[bn]) unique[bn] = f;
});

var keys = Object.keys(unique);
console.log("Analizando " + keys.length + " archivos DBF potenciales...");

var results = [];
for (var i = 0; i < keys.length; i++) {
  var k = keys[i];
  var preview = readDbfPreview(unique[k].path);
  if (preview) results.push(preview);
}

var out = "=== AUDITORIA DE PRODUCTOS MIXNET ===\r\n\r\n";
results.forEach(function(r) {
  out += "Archivo: " + r.file + " | Registros: " + r.records + "\r\n";
  out += "Ruta: " + r.path + "\r\n";
  out += "Campos: " + r.fields + "\r\n";
  out += "Muestra de datos:\r\n";
  r.sample.forEach(function(row, idx) {
    out += "  Fila " + (idx+1) + ": " + JSON.stringify(row) + "\r\n";
  });
  out += "---------------------------------------------------\r\n";
});

fs.writeFileSync('auditoria-productos.txt', out);
console.log("=========================================");
console.log("Auditoria completada con exito.");
console.log("Se genero el archivo: auditoria-productos.txt");
console.log("Por favor, abre ese archivo y enviame su contenido.");
console.log("=========================================");