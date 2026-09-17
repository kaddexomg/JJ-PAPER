const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'wa-server', 'src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
const extPkgs = new Set();
const builtins = new Set([
  'fs', 'path', 'url', 'http', 'https', 'net', 'os', 'crypto',
  'child_process', 'readline', 'events', 'util', 'stream', 'buffer', 'tls'
]);

files.forEach(f => {
  const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
  // Match: from 'pkg' or from "pkg"
  const importRegex = /from\s+['"]([^'".][^'"]*)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let pkg = match[1];
    if (pkg.startsWith('node:')) continue;
    if (pkg.startsWith('@')) {
      // Scoped: @supabase/supabase-js
      const parts = pkg.split('/');
      pkg = parts[0] + '/' + parts[1];
    } else {
      pkg = pkg.split('/')[0];
    }
    if (!builtins.has(pkg)) extPkgs.add(pkg);
  }

  // Match: require('pkg')
  const reqRegex = /require\(['"]([^'".][^'"]*)['"]\)/g;
  while ((match = reqRegex.exec(content)) !== null) {
    let pkg = match[1];
    if (pkg.startsWith('node:')) continue;
    if (pkg.startsWith('@')) {
      const parts = pkg.split('/');
      pkg = parts[0] + '/' + parts[1];
    } else {
      pkg = pkg.split('/')[0];
    }
    if (!builtins.has(pkg)) extPkgs.add(pkg);
  }
});

console.log('=== External packages imported in wa-server/src ===');
console.log([...extPkgs]);

const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'wa-server', 'package.json'), 'utf8'));
const installed = Object.keys(pkgJson.dependencies || {});
console.log('\n=== Declared in wa-server/package.json ===');
console.log(installed);

const missing = [...extPkgs].filter(p => !pkgJson.dependencies[p]);
console.log('\n=== MISSING in package.json ===');
console.log(missing);
