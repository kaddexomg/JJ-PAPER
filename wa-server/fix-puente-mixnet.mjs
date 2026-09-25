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

// 2. Modificar y forzar mixnet-config.json
const dropDirs = [
  TARGET_DIR,
  'M:/pedidos',
  'M:/cotizaciones',
  'M:/mixnet'
].filter(d => {
  try { return fs.existsSync(d); } catch (_) { return false; }
});

const configData = {
  updated_at: new Date().toISOString(),
  primary_dir: TARGET_DIR,
  drop_dirs: dropDirs.length > 0 ? dropDirs : [TARGET_DIR],
  dbf_dir: TARGET_DIR,
  available_drives: ['C:', 'M:']
};

fs.writeFileSync(CONFIG_FILE, JSON.stringify(configData, null, 2), 'utf8');
console.log('[✅] Archivo mixnet-config.json configurado correctamente:');
console.log(JSON.stringify(configData, null, 2));

console.log('\n===================================================');
console.log(' REPARACION EXITOSA. PROCEDA A REINICIAR EL SERVIDOR.');
console.log(' Los próximos pedidos caerán directamente en MixNet.');
console.log('===================================================\n');
