import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const CONFIG_FILE = path.join(__dirname, 'mixnet-config.json');

console.log('========================================================');
console.log('   BUSCADOR Y CONFIGURADOR UNIVERSAL DE MIXNET / MIXER  ');
console.log('========================================================\n');

// Unidades disponibles en Windows (locales y de red mapeadas)
const ALL_DRIVES = [
  'C:', 'D:', 'E:', 'F:', 'G:', 'H:',
  'M:', 'P:', 'Z:', 'Y:', 'X:', 'W:', 'V:', 'U:', 'T:', 'S:', 'R:', 'Q:', 'O:', 'N:', 'L:', 'K:', 'J:', 'I'
];

export function discoverMixnetEnvironment() {
  const availableDrives = [];
  for (const d of ALL_DRIVES) {
    try {
      if (fs.existsSync(d + '\\')) {
        availableDrives.push(d);
      }
    } catch (_) {}
  }
  console.log('Unidades detectadas en el sistema: ' + (availableDrives.join(', ') || 'C:'));

  // 1. Carpetas de intercambio de archivos (Drop folders para pedidos y cotizaciones)
  const dropKeywords = [
    'jj-paper-mixer', 'pedidos jj', 'pedidos', 'cotizaciones jj', 'cotizaciones', 'presupuestos', 'mixnet', 'mixer',
    'import', 'export', 'facturacion', 'caja', 'compras'
  ];

  const foundDropDirs = new Set();

  for (const d of availableDrives) {
    const root = d + '\\';
    try {
      const topItems = fs.readdirSync(root, { withFileTypes: true });
      for (const it of topItems) {
        if (!it.isDirectory()) continue;
        const nameLower = it.name.toLowerCase();
        if (dropKeywords.some(k => nameLower.includes(k))) {
          foundDropDirs.add(path.join(root, it.name));
        }

        // Explorar nivel 2 en carpetas de sistemas/programas
        if (['program files', 'program files (x86)', 'sistemas', 'archivos de programa', 'mixnet', 'mixer', 'mix11', 'respamix'].includes(nameLower)) {
          try {
            const subItems = fs.readdirSync(path.join(root, it.name), { withFileTypes: true });
            for (const s of subItems) {
              if (s.isDirectory() && dropKeywords.some(k => s.name.toLowerCase().includes(k))) {
                foundDropDirs.add(path.join(root, it.name, s.name));
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Carpetas estándar que deben asegurarse si la unidad existe
  const standardDropCandidates = [
    'C:\\JJ-PAPER-MIXER',
    'C:\\Pedidos JJ',
    'C:\\Cotizaciones JJ',
    'M:\\mixnet',
    'M:\\pedidos',
    'M:\\cotizaciones',
    'M:\\'
  ];

  for (const sc of standardDropCandidates) {
    const driveLetter = sc.slice(0, 2);
    if (availableDrives.includes(driveLetter)) {
      try {
        if (!fs.existsSync(sc)) {
          fs.mkdirSync(sc, { recursive: true });
        }
        foundDropDirs.add(sc);
      } catch (_) {}
    }
  }

  // 2. Base de datos DBF de MixNet (comp01 con tablas MXCTAINV, PED, MXRENPED, etc.)
  let foundDbfDir = null;
  const dbfCandidates = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\MIXNET\\comp01',
    'D:\\MIXNET\\comp01',
    'C:\\SISTEMAS\\comp01'
  ];

  const dbfKeyTables = ['MXCTAINV.DBF', 'VICTAINV.DBF', 'MXCTACLI.DBF', 'PED.DBF', 'MXRENPED.DBF', 'YPENCFAC.DBF'];

  for (const dc of dbfCandidates) {
    try {
      if (fs.existsSync(dc)) {
        let hasDbFiles = false;
        for (const t of dbfKeyTables) {
          if (fs.existsSync(path.join(dc, t)) || fs.existsSync(path.join(dc, t.toLowerCase()))) {
            hasDbFiles = true;
            break;
          }
        }
        if (hasDbFiles) {
          foundDbfDir = dc;
          console.log('\n[!] Base de datos activa de MixNet encontrada en: ' + foundDbfDir);
          break;
        }
      }
    } catch (_) {}
  }

  const dropList = Array.from(foundDropDirs);

  console.log('\n[!] Carpetas de intercambio de pedidos/cotizaciones detectadas:');
  dropList.forEach((r, idx) => console.log('  ' + (idx + 1) + '. ' + r));

  const primaryDir = dropList[0] || 'C:\\JJ-PAPER-MIXER';
  console.log('\n-> Carpeta principal de exportacion: ' + primaryDir);

  // Guardar configuración consolidada en mixnet-config.json
  const configData = {
    updated_at: new Date().toISOString(),
    primary_dir: primaryDir.replace(/\\/g, '/'),
    drop_dirs: dropList.map(p => p.replace(/\\/g, '/')),
    dbf_dir: foundDbfDir ? foundDbfDir.replace(/\\/g, '/') : null,
    available_drives: availableDrives
  };

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configData, null, 2), 'utf8');
    console.log('[OK] Archivo mixnet-config.json actualizado.');
  } catch (e) {
    console.error('[!] Error guardando mixnet-config.json:', e.message);
  }

  // Actualizar .env con la ruta principal
  if (fs.existsSync(ENV_FILE)) {
    try {
      let envContent = fs.readFileSync(ENV_FILE, 'utf8');
      const normalizedPath = primaryDir.replace(/\\/g, '/');
      if (envContent.includes('MIXER_EXPORT_DIR=')) {
        envContent = envContent.replace(/MIXER_EXPORT_DIR=.*/g, 'MIXER_EXPORT_DIR=' + normalizedPath);
      } else {
        envContent += '\nMIXER_EXPORT_DIR=' + normalizedPath + '\n';
      }
      fs.writeFileSync(ENV_FILE, envContent, 'utf8');
      console.log('[OK] Archivo .env sincronizado con MIXER_EXPORT_DIR=' + normalizedPath);
    } catch (e) {
      console.error('[!] Error actualizando .env:', e.message);
    }
  }

  console.log('\n========================================================');
  console.log('   CONFIGURACION DEL PUENTE COMPLETADA CON EXITO');
  console.log('========================================================\n');

  return configData;
}

// Ejecutar directamente si se llama desde CLI
if (process.argv[1] && process.argv[1].endsWith('auto-detect-mixnet.js')) {
  discoverMixnetEnvironment();
}
