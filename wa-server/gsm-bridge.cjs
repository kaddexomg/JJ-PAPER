/* ============================================================================
 * JJ Paper — Puente GSM Móvil USB para Windows 7 ($0 Inversión)
 * ----------------------------------------------------------------------------
 * Permite realizar y colgar llamadas telefónicas reales (SIM Movistar/Digitel/
 * CANTV) desde la PC con Windows 7 usando un teléfono Android conectado por USB.
 * 
 * Sin costos de Twilio ni telefonía IP de pago. Compatible con Node 13+.
 * ============================================================================ */

const http = require('http');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const PORT = process.env.GSM_BRIDGE_PORT || 8789;
const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'adb');

let cachedAdbPath = null;
let activeCallStartTime = null;
let activeCallPhone = null;
let lastKnownCallState = 0; // 0=IDLE, 1=RINGING, 2=OFFHOOK

// 1. Localizar ADB Portable o del Sistema
function findAdb() {
  if (cachedAdbPath && fs.existsSync(cachedAdbPath)) return cachedAdbPath;

  const candidates = [
    path.join(TOOLS_DIR, 'adb.exe'),
    path.join(process.cwd(), 'tools', 'adb', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'C:\\adb\\adb.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'platform-tools', 'adb.exe'),
    'adb.exe'
  ];

  for (const c of candidates) {
    if (c === 'adb.exe') {
      try {
        execSync('adb version', { stdio: 'ignore' });
        cachedAdbPath = 'adb';
        return cachedAdbPath;
      } catch (_) {}
    } else if (fs.existsSync(c)) {
      cachedAdbPath = c;
      return cachedAdbPath;
    }
  }

  return null;
}

// 2. Descarga Automática de Platform-Tools (Portable Google ADB)
async function downloadPortableAdb() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TOOLS_DIR)) {
      fs.mkdirSync(TOOLS_DIR, { recursive: true });
    }

    const zipUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
    const zipPath = path.join(TOOLS_DIR, 'platform-tools.zip');

    console.log('⬇️ Descargando ADB Portable oficial de Google (~12 MB)...');
    const file = fs.createWriteStream(zipPath);

    https.get(zipUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, (res2) => {
          res2.pipe(file);
          file.on('finish', () => {
            file.close(() => extractZip(zipPath).then(resolve).catch(reject));
          });
        }).on('error', reject);
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => extractZip(zipPath).then(resolve).catch(reject));
      });
    }).on('error', reject);
  });
}

function extractZip(zipPath) {
  return new Promise((resolve, reject) => {
    console.log('📦 Descomprimiendo ADB Portable...');
    const psCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${TOOLS_DIR}' -Force"`;
    exec(psCmd, (err) => {
      if (err) return reject(err);
      try {
        // Move files from tools/adb/platform-tools to tools/adb if needed
        const subDir = path.join(TOOLS_DIR, 'platform-tools');
        if (fs.existsSync(subDir)) {
          const files = fs.readdirSync(subDir);
          for (const f of files) {
            const src = path.join(subDir, f);
            const dst = path.join(TOOLS_DIR, f);
            if (!fs.existsSync(dst)) fs.renameSync(src, dst);
          }
        }
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        cachedAdbPath = path.join(TOOLS_DIR, 'adb.exe');
        console.log('✅ ADB Portable listo en:', cachedAdbPath);
        resolve(cachedAdbPath);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// 3. Ejecutor Seguro de Comandos ADB
function runAdb(args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const adb = findAdb();
    if (!adb) {
      return resolve({ ok: false, error: 'ADB no instalado. Ejecuta la descarga automática.' });
    }

    const cmd = `"${adb}" ${args}`;
    exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        return resolve({ ok: false, error: error.message, stderr: (stderr || '').trim() });
      }
      resolve({ ok: true, stdout: (stdout || '').trim() });
    });
  });
}

// 4. Verificación del Dispositivo Móvil
async function getDeviceStatus() {
  const adb = findAdb();
  if (!adb) {
    return {
      ok: true,
      adb_installed: false,
      connected: false,
      message: 'ADB no detectado. Se puede autoinstalar con un clic.'
    };
  }

  const devRes = await runAdb('devices');
  if (!devRes.ok) {
    return { ok: true, adb_installed: true, connected: false, error: devRes.error };
  }

  const lines = devRes.stdout.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('List of devices'));
  if (lines.length === 0) {
    return {
      ok: true,
      adb_installed: true,
      connected: false,
      message: 'Conecta el celular por cable USB y activa "Depuración USB" en Ajustes de desarrollador.'
    };
  }

  const first = lines[0].split(/\s+/);
  const serial = first[0];
  const state = first[1] || 'unknown';

  if (state === 'unauthorized') {
    return {
      ok: true,
      adb_installed: true,
      connected: false,
      serial,
      state,
      message: 'Celular detectado pero NO autorizado. Mira la pantalla del celular y presiona "Permitir siempre la depuración USB".'
    };
  }

  // Obtener modelo y nivel de batería
  let model = 'Android Device';
  try {
    const modelRes = await runAdb(`-s ${serial} shell getprop ro.product.model`);
    if (modelRes.ok && modelRes.stdout) model = modelRes.stdout;
  } catch (_) {}

  if (state === 'device') {
    // Túnel automático USB para audio bidireccional (AudioRelay / Headset) sin necesidad de WiFi común
    try {
      runAdb(`-s ${serial} reverse tcp:59100 tcp:59100`);
    } catch (_) {}
  }

  // Verificar estado de llamada en telecom / telephony
  let callState = 0;
  try {
    const dumpRes = await runAdb(`-s ${serial} shell dumpsys telephony.registry`);
    if (dumpRes.ok) {
      const match = dumpRes.stdout.match(/mCallState=(\d)/);
      if (match) callState = parseInt(match[1], 10);
    }
  } catch (_) {}

  lastKnownCallState = callState;
  const isCallActive = callState === 2;

  let activeSeconds = 0;
  if (activeCallStartTime) {
    activeSeconds = Math.round((Date.now() - activeCallStartTime) / 1000);
  }

  return {
    ok: true,
    adb_installed: true,
    connected: state === 'device',
    serial,
    model,
    call_state: callState,
    call_state_text: callState === 0 ? 'IDLE' : (callState === 1 ? 'RINGING' : 'OFFHOOK / ACTIVA'),
    is_call_active: isCallActive,
    active_seconds: activeSeconds,
    active_phone: activeCallPhone
  };
}

// 5. Iniciar Llamada Celular
async function makeCall(phone) {
  if (!phone) return { ok: false, error: 'Número de teléfono requerido' };
  let cleanPhone = phone.replace(/[^\d+]/g, '');

  const status = await getDeviceStatus();
  if (!status.connected) {
    return { ok: false, error: status.message || 'Celular no conectado por USB' };
  }

  // Si el número no tiene formato nacional ni internacional válido, ajustar
  if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('0') && cleanPhone.startsWith('58')) {
    cleanPhone = '+' + cleanPhone;
  }

  activeCallStartTime = null;
  activeCallPhone = cleanPhone;

  // 1. Despertar la pantalla del dispositivo e iluminar
  try {
    await runAdb(`-s ${status.serial} shell input keyevent 224`); // KEYCODE_WAKEUP
    await runAdb(`-s ${status.serial} shell wm dismiss-keyguard`);
  } catch (_) {}

  // 2. Intento 1: Disparo directo de acción CALL
  let res = await runAdb(`-s ${status.serial} shell am start -a android.intent.action.CALL -d tel:${cleanPhone}`);
  
  // 3. Intento 2: Si el fabricante (Xiaomi/HyperOS) bloquea CALL directo, abrir DIAL y simular tecla
  let manualTap = false;
  if (!res.ok || (res.stdout && res.stdout.includes('SecurityException'))) {
    console.log('⚠️ Acción CALL directa restringida. Abriendo marcador en pantalla con número listo...');
    await runAdb(`-s ${status.serial} shell am start -a android.intent.action.DIAL -d tel:${cleanPhone}`);
    await new Promise(r => setTimeout(r, 600));
    const keyRes = await runAdb(`-s ${status.serial} shell input keyevent 5`); // KEYCODE_CALL
    if (!keyRes.ok || (keyRes.stdout && keyRes.stdout.includes('SecurityException'))) {
      manualTap = true;
    }
  }

  // 4. Comprobar estado real en telephony.registry
  let currentCallState = 0;
  try {
    const dumpRes = await runAdb(`-s ${status.serial} shell dumpsys telephony.registry`);
    if (dumpRes.ok) {
      const match = dumpRes.stdout.match(/mCallState=(\d)/);
      if (match) currentCallState = parseInt(match[1], 10);
    }
  } catch (_) {}

  if (currentCallState === 2) {
    activeCallStartTime = Date.now();
  }

  return {
    ok: true,
    phone: cleanPhone,
    status: currentCallState === 2 ? 'active' : (currentCallState === 1 ? 'ringing' : 'dialpad_ready'),
    call_state: currentCallState,
    requires_manual_tap: manualTap || currentCallState === 0,
    started_at: new Date().toISOString(),
    message: currentCallState > 0
      ? '📲 Llamada conectando en el celular...'
      : '📲 Número cargado en el teléfono. Si no llama solo, pulsa el botón verde en tu celular.'
  };
}

// 6. Colgar Llamada Celular
async function hangupCall() {
  const status = await getDeviceStatus();
  let durationSeconds = 0;
  if (activeCallStartTime) {
    durationSeconds = Math.round((Date.now() - activeCallStartTime) / 1000);
  }

  activeCallStartTime = null;
  const dialedPhone = activeCallPhone;
  activeCallPhone = null;

  if (status.connected) {
    // KEYCODE_ENDCALL es 6
    await runAdb(`-s ${status.serial} shell input keyevent 6`);
  }

  return {
    ok: true,
    phone: dialedPhone,
    duration_seconds: durationSeconds,
    ended_at: new Date().toISOString()
  };
}

// 7. Servidor HTTP Local para JJ Paper
const server = http.createServer(async (req, res) => {
  // CORS universal para localhost y app web
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  function json(status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  try {
    if (pathname === '/' || pathname === '/status' || pathname === '/api/status') {
      const status = await getDeviceStatus();
      return json(200, status);
    }

    if (pathname === '/install-adb' && req.method === 'POST') {
      await downloadPortableAdb();
      const status = await getDeviceStatus();
      return json(200, { ok: true, message: 'ADB instalado exitosamente', ...status });
    }

    if (pathname === '/call' || pathname === '/api/call') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const phone = data.phone || parsedUrl.searchParams.get('phone');
          const result = await makeCall(phone);
          return json(result.ok ? 200 : 400, result);
        } catch (e) {
          return json(400, { ok: false, error: e.message });
        }
      });
      return;
    }

    if (pathname === '/hangup' || pathname === '/api/hangup') {
      const result = await hangupCall();
      return json(200, result);
    }

    if (pathname === '/audio-guide') {
      return json(200, {
        ok: true,
        guides: [
          {
            title: 'Opción 1: Manos Libres en Escritorio ($0)',
            desc: 'Conectas el celular por USB. El sistema marca y cuelga. Hablas y escuchas con el altavoz del celular o el manos libres mientras usas la PC.'
          },
          {
            title: 'Opción 2: Cable Auxiliar 3.5mm ($0)',
            desc: 'Conectas un cable jack 3.5mm de la salida de audífonos del celular al conector azul (Line-In) o micrófono de la PC. Escuchas en tu Headset de la PC con latencia cero.'
          },
          {
            title: 'Opción 3: Audio por USB (Scrcpy 2.0+)',
            desc: 'Si tu celular tiene Android 10+, scrcpy retransmite el audio directamente por el cable USB a los audífonos de Windows 7.'
          }
        ]
      });
    }

    return json(404, { ok: false, error: 'Endpoint no encontrado' });
  } catch (err) {
    console.error('Error procesando request:', err);
    return json(500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(`🎧 JJ Paper — Puente GSM Móvil USB listo en puerto ${PORT}`);
  console.log(`👉 http://127.0.0.1:${PORT}/status`);
  console.log(`=======================================================`);
  const adb = findAdb();
  if (adb) {
    console.log(`✅ ADB detectado: ${adb}`);
  } else {
    console.log(`⚠️ ADB no encontrado aún. El puente lo descargará automáticamente.`);
  }
});

module.exports = {
  getDeviceStatus,
  makeCall,
  hangupCall,
  findAdb
};
