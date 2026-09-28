/**
 * JJ Paper — Módulo GSM para wa-server (Servicio Nativo de Llamadas Móviles USB)
 * Permite que el servidor ejecute y supervise llamadas automáticamente.
 */

import http from 'node:http';
import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.GSM_BRIDGE_PORT || 8789;
const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools', 'adb');

let cachedAdbPath = null;
let activeCallStartTime = null;
let activeCallPhone = null;
let lastKnownCallState = 0; // 0=IDLE, 1=RINGING, 2=OFFHOOK
let serverInstance = null;

export function findAdb() {
  if (cachedAdbPath && fs.existsSync(cachedAdbPath)) return cachedAdbPath;

  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(TOOLS_DIR, 'adb.exe'),
    path.join(process.cwd(), 'tools', 'adb', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'C:\\adb\\adb.exe',
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

export function runAdb(args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const adb = findAdb();
    if (!adb) {
      return resolve({ ok: false, error: 'ADB no instalado o no localizado.' });
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

export async function getDeviceStatus() {
  const adb = findAdb();
  if (!adb) {
    return {
      ok: true,
      adb_installed: false,
      connected: false,
      message: 'ADB no detectado en el sistema.'
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
      message: 'Conecta el celular por cable USB con depuración activada.'
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
      message: 'Celular detectado pero no autorizado. Toca "Permitir depuración" en pantalla.'
    };
  }

  let model = 'Android Device';
  try {
    const modelRes = await runAdb(`-s ${serial} shell getprop ro.product.model`);
    if (modelRes.ok && modelRes.stdout) model = modelRes.stdout;
  } catch (_) {}

  // Comprobar estado de llamada
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

export async function makeCall(phone) {
  if (!phone) return { ok: false, error: 'Número de teléfono requerido' };
  let cleanPhone = phone.replace(/[^\d+]/g, '');

  const status = await getDeviceStatus();
  if (!status.connected) {
    return { ok: false, error: status.message || 'Celular no conectado por USB' };
  }

  if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('0') && cleanPhone.startsWith('58')) {
    cleanPhone = '+' + cleanPhone;
  }

  activeCallStartTime = null;
  activeCallPhone = cleanPhone;

  // Silenciar teléfono físico y despertar pantalla
  try {
    await runAdb(`-s ${status.serial} shell cmd audio set-ringer-mode SILENT`);
    await runAdb(`-s ${status.serial} shell input keyevent 224`);
    await runAdb(`-s ${status.serial} shell wm dismiss-keyguard`);
  } catch (_) {}

  // Intento 1: Acción CALL
  let res = await runAdb(`-s ${status.serial} shell am start -a android.intent.action.CALL -d tel:${cleanPhone}`);
  let manualTap = false;

  // Intento 2: Si el fabricante bloquea CALL, abrir DIAL y simular pulsación
  if (!res.ok || (res.stdout && res.stdout.includes('SecurityException'))) {
    await runAdb(`-s ${status.serial} shell am start -a android.intent.action.DIAL -d tel:${cleanPhone}`);
    await new Promise(r => setTimeout(r, 600));
    const keyRes = await runAdb(`-s ${status.serial} shell input keyevent 5`);
    if (!keyRes.ok || (keyRes.stdout && keyRes.stdout.includes('SecurityException'))) {
      manualTap = true;
    }
  }

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
    started_at: new Date().toISOString()
  };
}

export async function hangupCall() {
  const status = await getDeviceStatus();
  let durationSeconds = 0;
  if (activeCallStartTime) {
    durationSeconds = Math.round((Date.now() - activeCallStartTime) / 1000);
  }

  activeCallStartTime = null;
  const dialedPhone = activeCallPhone;
  activeCallPhone = null;

  if (status.connected) {
    await runAdb(`-s ${status.serial} shell input keyevent 6`);
  }

  return {
    ok: true,
    phone: dialedPhone,
    duration_seconds: durationSeconds,
    ended_at: new Date().toISOString()
  };
}

export function startGsmBridge() {
  if (serverInstance) return;

  const server = http.createServer(async (req, res) => {
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

      return json(404, { ok: false, error: 'Endpoint no encontrado' });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.info(`[GSM] Puerto ${PORT} en uso (puente GSM ya activo en este puerto)`);
    } else {
      log.warn({ err: err.message }, '[GSM] Error en servidor HTTP');
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    log.info(`[GSM] Puente GSM USB escuchando en http://127.0.0.1:${PORT}`);
  });

  serverInstance = server;
  return server;
}
