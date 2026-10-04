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
  let foundDbfDir = null;

  for (const d of availableDrives) {
    // Si la unidad es C:, ignorar carpetas auto-creadas previamente ya que el usuario aclaró que la info de MixNet está en la otra unidad
    const root = d + '\\';
    try {
      const topItems = fs.readdirSync(root, { withFileTypes: true });
      for (const it of topItems) {
        if (!it.isDirectory()) continue;
        const nameLower = it.name.toLowerCase();
        if (d === 'C:' && ['cotizaciones jj', 'pedidos jj', 'jj-paper-mixer'].includes(nameLower)) {
          continue; // Omitir carpetas locales no oficiales en C:
        }
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

  // Función de chequeo seguro: evita congelar el proceso síncrono durante 25s por cada ruta UNC de red inaccesible
  function safeExistsSync(p) {
    if (p.startsWith('\\\\')) return false; // Evita bloqueo SMB en red si la máquina no existe
    try { return fs.existsSync(p); } catch (_) { return false; }
  }

  // Carpetas estándar que SOLO se agregan si ya existen físicamente (NUNCA crear carpetas nuevas arbitrarias)
  const standardDropCandidates = [
    'M:\\MIX11\\comp01',
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\pedidos',
    'M:\\cotizaciones',
    'M:\\mixnet',
    'M:\\',
    'P:\\comp01',
    'P:\\mixnet',
    'P:\\pedidos',
    'P:\\'
  ];

  for (const sc of standardDropCandidates) {
    if (safeExistsSync(sc)) {
      foundDropDirs.add(sc);
    }
  }

  // 2. Base de datos DBF de MixNet (comp01 con tablas MXCTAINV, PED, MXRENPED, etc.)
  const dbfCandidates = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\MIX11\\comp01',
    '//servidor/comp01',
    '//servidor/MIX11/comp01',
    'M:\\mixnet',
    'M:\\',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\comp01',
    'C:\\MIXNET\\comp01',
    'C:\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'D:\\comp01',
    'D:\\MIXNET\\comp01',
    'C:\\SISTEMAS\\comp01'
  ];

  const dbfKeyTables = ['MXCTAINV.DBF', 'VICTAINV.DBF', 'MXCTACLI.DBF', 'PED.DBF', 'MXRENPED.DBF', 'YPENCFAC.DBF'];

  for (const dc of dbfCandidates) {
    if (safeExistsSync(dc)) {
      let hasDbFiles = false;
      for (const t of dbfKeyTables) {
        if (safeExistsSync(path.join(dc, t)) || safeExistsSync(path.join(dc, t.toLowerCase()))) {
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
  }

  const dropList = Array.from(foundDropDirs);

  console.log('\n[!] Carpetas de intercambio de pedidos/cotizaciones detectadas:');
  if (dropList.length === 0) {
    console.log('  (Ninguna carpeta detectada en este equipo - verificando servidor de red 192.168.0.185 / unidad M:)');
  } else {
    dropList.forEach((r, idx) => console.log('  ' + (idx + 1) + '. ' + r));
  }

  let explicitDir = process.env.MIXNET_DIR || process.env.MIXER_EXPORT_DIR;
  if (explicitDir && explicitDir.includes('JJ-PAPER-MIXER')) explicitDir = null;
  if (!explicitDir && fs.existsSync(CONFIG_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (prev.primary_dir && !prev.primary_dir.includes('JJ-PAPER-MIXER') && fs.existsSync(prev.primary_dir)) explicitDir = prev.primary_dir;
    } catch (_) {}
  }

  // La ruta principal es el directorio DBF real de MixNet (comp01) o la unidad mapeada M:
  const primaryDir = explicitDir || foundDbfDir || dropList[0] || 'M:/comp01';
  console.log('\n-> Carpeta principal de MixNet: ' + primaryDir);

  if (primaryDir && fs.existsSync(primaryDir) && !dropList.includes(primaryDir)) {
    dropList.unshift(primaryDir);
  }

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

  // Actualizar y auto-sanear .env
  if (fs.existsSync(ENV_FILE)) {
    try {
      let envContent = fs.readFileSync(ENV_FILE, 'utf8');
      const normalizedPath = primaryDir.replace(/\\/g, '/');
      if (envContent.includes('MIXER_EXPORT_DIR=')) {
        envContent = envContent.replace(/MIXER_EXPORT_DIR=.*/g, 'MIXER_EXPORT_DIR=' + normalizedPath);
      } else {
        envContent += '\nMIXER_EXPORT_DIR=' + normalizedPath + '\n';
      }

      // Auto-reparación si apunta al Core viejo suspendido (qxgdrfkobbhdzgtoiavv)
      if (envContent.includes('qxgdrfkobbhdzgtoiavv')) {
        console.log('[!] Detectada referencia al Core viejo en .env. Auto-migrando a nuevo Core activo...');
        envContent = envContent.replace(/https:\/\/qxgdrfkobbhdzgtoiavv\.supabase\.co/g, 'https://wwcdxqpibequfohbgejs.supabase.co');
        envContent = envContent.replace(/qxgdrfkobbhdzgtoiavv/g, 'wwcdxqpibequfohbgejs');
        // Asegurar la clave de service_role correcta de Proyecto A Core
        const coreKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2R4cXBpYmVxdWZvaGJnZWpzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDczMDA3NCwiZXhwIjoyMTA2MzA2MDc0fQ.FhQjv5Ay6PF6ClL4jlwV_9kYi_XnKjezAQ8L6pD04zg';
        envContent = envContent.replace(/SUPABASE_SERVICE_ROLE_KEY_CORE=.*/g, 'SUPABASE_SERVICE_ROLE_KEY_CORE=' + coreKey);
        envContent = envContent.replace(/PG_PASS_CORE=.*/g, 'PG_PASS_CORE=Samily*2030909109');
        envContent = envContent.replace(/PG_HOST_CORE=.*/g, 'PG_HOST_CORE=aws-0-ca-central-1.pooler.supabase.com');
        console.log('[OK] .env actualizado exitosamente con nuevo Proyecto A Core.');
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
