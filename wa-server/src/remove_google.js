const fs = require('fs');
const file = 'C:\\\\Users\\\\PC\\\\Desktop\\\\JJ PAPER\\\\wa-server\\\\src\\\\product-images.js';
let content = fs.readFileSync(file, 'utf8');

// Use regex to remove searchGoogleImages function
content = content.replace(
  /\/\*\*\s*\*\s*Busca imágenes en Google Images[\s\S]*?async function searchGoogleImages\(query, limit = 8\) \{[\s\S]*?return \[\];\s*\}\s*\}/,
  ''
);

fs.writeFileSync(file, content);
console.log('Removed searchGoogleImages');
