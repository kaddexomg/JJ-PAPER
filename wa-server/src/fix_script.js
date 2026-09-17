const fs = require('fs');
const file = 'C:\\\\Users\\\\PC\\\\Desktop\\\\JJ PAPER\\\\wa-server\\\\src\\\\product-images.js';
let content = fs.readFileSync(file, 'utf8');

let originalContent = content;

// Fix 1
content = content.replace(
  /\.replace\(\/\\b\[A-Z0-9_-\]\{7,\}\\b\/g,\s*''\)/g,
  '.replace(/\\\\b(?=[A-Z0-9_-]*\\\\d)[A-Z0-9_-]{6,}\\\\b/g, \\'\\')'
);

// Fix 2 & 3
content = content.replace(
  /const murlRegex = \/murl&quot;:&quot;\(https\?:\\\/\\\/\[\^&\]\+\?\)\&quot;\/g;[\s\S]*?title: '',[\s\S]*?source: 'bing'[\s\S]*?\}\)/g,
  `const murlRegex = /murl&quot;:&quot;(https?:\\\/\\\/[^"]+?)&quot;/g;
    const titleRegex = /class="(?:inflnk|iusc)"[^>]*(?:alt|aria-label)="([^"]+)"/gi;
    let m;
    let tMatch;
    while ((m = murlRegex.exec(html)) !== null && results.length < limit) {
      tMatch = titleRegex.exec(html);
      const titleStr = tMatch ? tMatch[1] : '';
      let imgUrl = m[1].replace(/&amp;/g, '&');
      try { imgUrl = decodeURIComponent(imgUrl); } catch(e){}
      if (!isBlockedDomain(imgUrl) && imgUrl.length > 20 && imgUrl.length < 600) {
        results.push({
          image: imgUrl,
          thumbnail: imgUrl,
          width: 800,
          height: 800,
          title: titleStr,
          source: 'bing'
        })`
);

// Fix 4
content = content.replace(
  /const GEMINI_MODELS = \[[\s\S]*?\];/g,
  `const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];`
);

// Fix 5
content = content.replace(
  /if \(status === 429 \|\| status === 403\) break;/g,
  'if (status === 429 || status === 403 || status === 400) break;'
);

// Fix 6
content = content.replace(
  /for \(const q of queries\.slice\(0, 2\)\) \{/g,
  'for (const q of queries.slice(0, 4)) {'
);

// Fix 7
content = content.replace(
  /const escaped = abbr\.replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\\\/\]\/g, '\\\\\$&'\);\s*const rx = new RegExp\('\\\\b' \+ escaped \+ '\\\\b', 'gi'\);/g,
  `const cleanAbbr = abbr.endsWith('.') ? abbr.slice(0, -1) : abbr;
    const escaped = cleanAbbr.replace(/[.*+?^\${}()|[\\]\\\\\\/]/g, '\\\\$&');
    const rx = new RegExp('\\\\b' + escaped + '\\\\.?\\\\b', 'gi');`
);

// Fix 8
content = content.replace(
  /\/\*\*[\s\S]*?async function searchGoogleImages\(query, limit = 8\) \{[\s\S]*?return \[\];\s*\}\s*\}/,
  ''
);

if (originalContent !== content) {
  fs.writeFileSync(file, content);
  console.log('Modifications applied');
} else {
  console.log('No modifications were made. Check regexes.');
}
