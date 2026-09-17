var fs = require('fs');
var path = './wa-server/extraer-todo-mixnet.cjs';
var code = fs.readFileSync(path, 'utf8');

// Replace the line that excludes VICTAINV from products
code = code.split('\n').map(function(line) {
  if (line.includes('if (/VICTAINV|FISINV|MXCTAINV|JJCTAINV/i.test(allStructs[i].fileName)) {')) {
    return '    if (/VICTAINV|FISINV|MXCTAINV|JJCTAINV/i.test(allStructs[i].fileName)) {'; // remove the "continue;" block from underneath it later
  }
  if (line.includes('continue;') && line.trim() === 'continue;') {
    return '      // continue removed'; // Hacky but works for this block
  }
  if (line.includes('var bonus = 0;')) {
    return 'var bonus = 0;\n  if (/VICTAINV|MXCTAINV/i.test(fnStr)) bonus += 20;';
  }
  return line;
}).join('\n');

// More precise replace for the exact continue block
code = code.replace(/if \(\/VICTAINV\|FISINV\|MXCTAINV\|JJCTAINV\/i\.test\(allStructs\[i\]\.fileName\)\) \{\r?\n\s*if \(\!stockTable \|\| allStructs\[i\]\.numRecords > stockTable\.numRecords\) stockTable = allStructs\[i\];\r?\n\s*\/\/ continue removed\r?\n\s*\}/g, 'if (/VICTAINV|FISINV|MXCTAINV|JJCTAINV/i.test(allStructs[i].fileName)) { if (!stockTable || allStructs[i].numRecords > stockTable.numRecords) stockTable = allStructs[i]; }');

fs.writeFileSync(path, code);
console.log("PATCHED");
