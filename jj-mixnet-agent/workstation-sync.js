/* ======================================================================
   JJ Paper — Instalador y Sincronizador de Estación MixNet (Laptop ⇄ Supervisor-PC)
   ======================================================================
   Sincroniza C:\vDos, C:\MIX11 y C:\MIX11\comp01 en tiempo real contra
   el puente de Supervisor-PC (http://100.103.110.44:8790).
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const BRIDGE_HOST = process.env.MIXNET_BRIDGE_URL || 'http://100.103.110.44:8790';
const VDOS_DIR = 'C:\\vDos';
const MIX11_DIR = 'C:\\MIX11';
const COMP01_DIR = 'C:\\MIX11\\comp01';

function ensureDirs() {
  for (const d of [VDOS_DIR, MIX11_DIR, COMP01_DIR, path.join(COMP01_DIR, 'backups')]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} en ${urlStr}`));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout en ${urlStr}`)); });
  });
}

function downloadFile(scope, name, destPath, mtimeMs) {
  return new Promise((resolve, reject) => {
    const urlStr = `${BRIDGE_HOST}/workstation/file?scope=${encodeURIComponent(scope)}&name=${encodeURIComponent(name)}`;
    const tmpPath = `${destPath}.tmp_${process.pid}`;
    const req = http.get(urlStr, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} descargando ${scope}/${name}`));
      }
      const ws = fs.createWriteStream(tmpPath);
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close(() => {
          try {
            fs.renameSync(tmpPath, destPath);
            if (mtimeMs) {
              const dt = new Date(mtimeMs);
              fs.utimesSync(destPath, dt, dt);
            }
            resolve(true);
          } catch (err) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            reject(err);
          }
        });
      });
      ws.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout descargando ${scope}/${name}`)); });
  });
}

async function syncScope(scope, targetDir, concurrency = 12, quiet = false) {
  const manifest = await fetchJson(`${BRIDGE_HOST}/workstation/manifest?scope=${scope}`);
  if (!manifest || !Array.isArray(manifest.files)) return { downloaded: 0, total: 0 };

  // Ordenar de menor a mayor tamaño para que todas las tablas operativas y binarios bajen al instante
  const files = manifest.files.slice().sort((a, b) => a.size - b.size);
  const toDownload = [];

  for (const f of files) {
    // No sobrescribir autoexec.txt local de vDos una vez configurado para la laptop
    if (scope === 'vdos' && f.name.toLowerCase() === 'autoexec.txt' && fs.existsSync(path.join(targetDir, f.name))) {
      continue;
    }
    const localPath = path.join(targetDir, f.name);
    let needsSync = true;
    if (fs.existsSync(localPath)) {
      try {
        const st = fs.statSync(localPath);
        if (st.size === f.size && Math.abs(Math.round(st.mtimeMs) - f.mtimeMs) <= 2000) {
          needsSync = false;
        }
      } catch (_) {}
    }
    if (needsSync) toDownload.push(f);
  }

  if (toDownload.length === 0) {
    if (!quiet) console.log(`[${scope.toUpperCase()}] Al día (${files.length} archivos verificados).`);
    return { downloaded: 0, total: files.length };
  }

  if (!quiet) {
    const totalMb = (toDownload.reduce((s, x) => s + x.size, 0) / 1048576).toFixed(2);
    console.log(`[${scope.toUpperCase()}] Sincronizando ${toDownload.length} de ${files.length} archivos (${totalMb} MB)...`);
  }

  let idx = 0;
  let downloaded = 0;
  const workers = Array.from({ length: Math.min(concurrency, toDownload.length) }, async () => {
    while (idx < toDownload.length) {
      const item = toDownload[idx++];
      const dest = path.join(targetDir, item.name);
      try {
        await downloadFile(scope, item.name, dest, item.mtimeMs);
        downloaded++;
        if (!quiet && (downloaded % 100 === 0 || downloaded === toDownload.length)) {
          console.log(`  -> [${scope.toUpperCase()}] ${downloaded}/${toDownload.length} completados (${item.name})`);
        }
      } catch (err) {
        if (!quiet) console.warn(`  [!] Aviso en ${scope}/${item.name}: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);
  return { downloaded, total: files.length };
}

function configureLaptopVdos() {
  // Configurar autoexec.txt en C:\vDos para que monte M: en C:\MIX11 y arranque MIXNET.EXE sv
  const autoexecPath = path.join(VDOS_DIR, 'autoexec.txt');
  const autoexecContent = [
    '@echo off',
    'USE C: C:\\',
    'USE M: C:\\MIX11',
    'M:',
    'MIXNET.EXE sv',
    'EXIT'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(autoexecPath, autoexecContent, 'latin1');

  // Crear script lanzador en C:\MIX11\ABRIR-MIXNET-LAPTOP.bat que inicia el sincronizador en vivo y abre vDos
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const syncScriptPath = path.join(repoRoot, 'jj-mixnet-agent', 'workstation-sync.js');
  const launcherBatPath = path.join(MIX11_DIR, 'ABRIR-MIXNET-LAPTOP.bat');
  const launcherBat = [
    '@echo off',
    'title Estacion MixNet JJ Paper (Conectada a Puente Supervisor-PC)',
    'echo Sincronizando cambios recientes con el Puente de Supervisor-PC...',
    `node "${syncScriptPath}" --quick`,
    'start "MixNet Live Sync" /min node "' + syncScriptPath + '" --watch-only',
    'cd /d C:\\vDos',
    'start "" "C:\\vDos\\vDos.exe"'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(launcherBatPath, launcherBat, 'latin1');
}

async function main() {
  const args = process.argv.slice(2);
  const watchOnly = args.includes('--watch-only');
  const quickOnly = args.includes('--quick');

  ensureDirs();

  if (!watchOnly) {
    console.log(`Conectando al Puente MixNet en Supervisor-PC (${BRIDGE_HOST})...`);
    if (!quickOnly) {
      await syncScope('vdos', VDOS_DIR, 8, false);
      await syncScope('mixnet', MIX11_DIR, 16, false);
    }
    await syncScope('comp01', COMP01_DIR, 16, false);
    configureLaptopVdos();
    console.log('Estacion MixNet sincronizada y lista en C:\\MIX11 y C:\\vDos.');
  }

  if (watchOnly || args.includes('--watch')) {
    console.log('[LIVE-SYNC] Demonio de sincronización continua MixNet (Laptop ⇄ Supervisor-PC) activo cada 5s...');
    setInterval(async () => {
      try {
        const res = await syncScope('comp01', COMP01_DIR, 8, true);
        if (res.downloaded > 0) {
          console.log(`[${new Date().toLocaleTimeString()}] [LIVE-SYNC] ${res.downloaded} archivo(s) DBF/NTX actualizados desde Supervisor-PC.`);
        }
      } catch (_) {}
    }, 5000);
  }
}

main().catch(err => {
  console.error('Error en sincronizador de estacion MixNet:', err.message);
  process.exit(1);
});
