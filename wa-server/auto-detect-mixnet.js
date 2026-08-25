import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');

console.log('========================================================');
console.log('   BUSCADOR Y CONFIGURADOR AUTOMATICO DE MIXNET / MIXER  ');
console.log('========================================================\n');

function findMixerFolder() {
  const drives = ['C:', 'D:', 'E:', 'F:'];
  const keywords = ['mixnet', 'mixer', 'pedidos', 'import', 'facturacion', 'jj-paper-mixer'];
  
  const found = [];

  for (const d of drives) {
    if (!fs.existsSync(d + '\\')) continue;
    console.log('Buscando en unidad ' + d + '...');
    
    try {
      const topItems = fs.readdirSync(d + '\\', { withFileTypes: true });
      for (const it of topItems) {
        if (it.isDirectory()) {
          const nameLower = it.name.toLowerCase();
          if (keywords.some(k => nameLower.includes(k))) {
            found.push(path.join(d + '\\', it.name));
          }
          if (['program files', 'program files (x86)', 'sistemas', 'archivos de programa'].includes(nameLower)) {
            try {
              const subItems = fs.readdirSync(path.join(d + '\\', it.name), { withFileTypes: true });
              for (const s of subItems) {
                if (s.isDirectory() && keywords.some(k => s.name.toLowerCase().includes(k))) {
                  found.push(path.join(d + '\\', it.name, s.name));
                }
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }
  return found;
}

const results = findMixerFolder();

let targetPath = 'C:\\JJ-PAPER-MIXER';

if (results.length > 0) {
  console.log('\n[!] Se encontraron las siguientes carpetas de MixNet / Facturacion:');
  results.forEach((r, idx) => console.log('  ' + (idx + 1) + '. ' + r));
  targetPath = results[0];
  console.log('\n-> Se selecciono automaticamente la ruta principal: ' + targetPath);
} else {
  console.log('\n[i] No se detecto una instalacion previa de MixNet en carpetas estandar.');
  console.log('-> Se utilizara la carpeta predeterminada de puente: ' + targetPath);
}

try {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
} catch (_) {}

if (fs.existsSync(ENV_FILE)) {
  let envContent = fs.readFileSync(ENV_FILE, 'utf8');
  const normalizedPath = targetPath.replace(/\\/g, '/');
  if (envContent.includes('MIXER_EXPORT_DIR=')) {
    envContent = envContent.replace(/MIXER_EXPORT_DIR=.*/g, 'MIXER_EXPORT_DIR=' + normalizedPath);
  } else {
    envContent += '\nMIXER_EXPORT_DIR=' + normalizedPath + '\n';
  }
  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  console.log('\n[OK] Archivo .env actualizado con MIXER_EXPORT_DIR=' + normalizedPath);
}

console.log('\n========================================================');
console.log('   CONFIGURACION DEL PUENTE COMPLETADA CON EXITO');
console.log('========================================================\n');
