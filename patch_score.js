var fs = require('fs');
var path = 'wa-server/extraer-todo-mixnet.cjs';
var code = fs.readFileSync(path, 'utf8');

code = code.replace("if (/LISPRE/i.test(fnStr)) s += 5;", "if (/LISPRE/i.test(fnStr)) s += 5;\n  if (/VICTAINV|MXCTAINV|CTAINV/i.test(fnStr)) s += 1000; /* SUPER BONUS FOR ACTUAL TABLES */");

fs.writeFileSync(path, code);
console.log("PATCH DONE");
