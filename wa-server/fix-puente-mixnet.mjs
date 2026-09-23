import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const CONFIG_FILE = path.join(__dirname, 'mixnet-config.json');

const TARGET_DIR = 'M:/comp01';

console.log('===================================================');
console.log(' 🛠️ REPARADOR DEL PUENTE BIDIRECCIONAL JJ ⇄ MIXNET ');
console.log('===================================================\n');

// 1. Modificar y forzar .env
if (fs.existsSync(ENV_FILE)) {
  let env = fs.readFileSync(ENV_FILE, 'utf8');
  if (env.includes('MIXER_EXPORT_DIR=')) {
    env = env.replace(/MIXER_EXPORT_DIR=.*/g, 'MIXER_EXPORT_DIR=' + TARGET_DIR);
  } else {
    env += '\nMIXER_EXPORT_DIR=' + TARGET_DIR + '\n';
  }
  fs.writeFileSync(ENV_FILE, env, 'utf8');
  console.log('[✅] Archivo .env forzado a MIXER_EXPORT_DIR = ' + TARGET_DIR);
} else {
  console.error('[❌] No se encontró el archivo .env en wa-server.');
}

// 2. Modificar y forzar mixnet-config.json (evitando que el auto-detect lo sobreescriba erróneamente)
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config.primary_dir = TARGET_DIR;
    // Nos aseguramos de que M:/comp01 esté de primero en las opciones
    if (!config.drop_dirs) config.drop_dirs = [];
    config.drop_dirs = [TARGET_DIR, ...config.drop_dirs.filter(d => d !== TARGET_DIR && !d.toLowerCase().includes('c:/cotizaciones jj'))];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('[✅] Caché mixnet-config.json re-enfocada a ' + TARGET_DIR);
  } catch (e) {
    console.error('[!] Error modificando mixnet-config.json:', e.message);
  }
}

console.log('\n===================================================');
console.log(' REPARACION EXITOSA. PROCEDA A REINICIAR EL SERVIDOR.');
console.log(' Los próximos pedidos caerán directamente en MixNet.');
console.log('===================================================\n');
