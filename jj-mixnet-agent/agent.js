/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Demonio Autónomo y Guardián de Red
   ======================================================================
   Diseñado para correr de forma permanente en Supervisor-Pc o Servidor Central
   MixNet (192.168.0.185). Cero dependencia de la laptop personal.
   ====================================================================== */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  getMixnetDir, AGENT_PORT, AGENT_VERSION, log
} from './config.js';
import { reportAgentHeartbeat } from './supabase-client.js';
import { processAgentTasks } from './task-runner.js';
import { syncCatalogFromMixnet } from './sync-catalog.js';
import { syncSuppliersFromMixnet } from './sync-suppliers.js';
import { importMixnetDocuments, exportPendingDocumentsToMixnet } from './sync-documents.js';
import { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup } from './client-reconciler.js';
import { getMixnetUsers, updateMixnetUserPermissions } from './mixnet-usuar.js';

let activeCompDir = null;
let currentCotSerial = '—';
let currentPedSerial = '—';
let lastSyncTime = null;
let syncStats = { quotesImported: 0, ordersImported: 0, productsUpdated: 0, suppliersSynced: 0 };
let isSyncing = false;

function refreshCorrelatives() {
  if (!activeCompDir) return;
  try {
    const numCotPath = path.join(activeCompDir, 'MXNUMCOT.DBF');
    const numPedPath = path.join(activeCompDir, 'MXNUMPED.DBF');

    if (fs.existsSync(numCotPath)) {
      const buf = fs.readFileSync(numCotPath);
      const hLen = buf.readUInt16LE(8);
      currentCotSerial = buf.toString('ascii', hLen + 1, hLen + 9).trim();
    }
    if (fs.existsSync(numPedPath)) {
      const buf = fs.readFileSync(numPedPath);
      const hLen = buf.readUInt16LE(8);
      currentPedSerial = buf.toString('ascii', hLen + 1, hLen + 9).trim();
    }
  } catch (err) {
    log(`Aviso leyendo correlativos: ${err.message}`, 'WARN');
  }
}

async function runScheduledSync() {
  if (isSyncing || !activeCompDir) return;
  isSyncing = true;
  try {
    const impRes = await importMixnetDocuments(activeCompDir);
    syncStats.quotesImported += impRes.importedQuotes;
    syncStats.ordersImported += impRes.importedOrders;

    refreshCorrelatives();
    lastSyncTime = new Date().toISOString();
  } catch (err) {
    log(`Aviso en ciclo de sincronización: ${err.message}`, 'WARN');
  } finally {
    isSyncing = false;
  }
}

async function runScheduledCatalogSync() {
  if (isSyncing || !activeCompDir) return;
  isSyncing = true;
  try {
    const res = await syncCatalogFromMixnet(activeCompDir, false);
    syncStats.productsUpdated += res.updatedCount;
  } catch (err) {
    log(`Aviso en ciclo de catálogo: ${err.message}`, 'WARN');
  } finally {
    isSyncing = false;
  }
}

async function runScheduledSupplierSync() {
  if (!activeCompDir) return;
  try {
    const res = await syncSuppliersFromMixnet(activeCompDir);
    if (res && res.ok) {
      syncStats.suppliersSynced = (res.created || 0) + (res.updated || 0);
    }
  } catch (err) {
    log(`Aviso en ciclo de proveedores: ${err.message}`, 'WARN');
  }
}

/**
 * Servidor Micro-API HTTP local en puerto 8790
 */
function startMicroApi() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/status' || url.pathname === '/health') {
      refreshCorrelatives();
      const statusPayload = {
        online: true,
        version: AGENT_VERSION,
        host: os.hostname(),
        platform: os.platform(),
        mixnet_dir: activeCompDir,
        current_cot_serial: currentCotSerial,
        current_ped_serial: currentPedSerial,
        last_sync_at: lastSyncTime,
        stats: syncStats,
        uptime_seconds: Math.round(process.uptime())
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(statusPayload, null, 2));
      return;
    }

    if (url.pathname === '/sync-now') {
      log('[API] Señal forzada de sincronización recibida.');
      runScheduledSync().catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Sincronización encolada' }));
      return;
    }

    const readBody = () => new Promise(resolve => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
      });
      req.on('error', () => resolve({}));
    });

    if (url.pathname === '/clients/discrepancies' && req.method === 'GET') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const resData = await getClientsDiscrepancies(activeCompDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...resData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/clients/reconcile' && req.method === 'POST') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const resData = await reconcileClients(activeCompDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...resData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/backup' && req.method === 'POST') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const body = await readBody();
        const resData = createBackup(activeCompDir, body.label || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...resData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/rollback' && req.method === 'POST') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const body = await readBody();
        const target = body.snapshot || body.snapshotId;
        if (!target) throw new Error('Debe especificar "snapshot" en el cuerpo JSON.');
        const resData = rollbackBackup(activeCompDir, target);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...resData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/users' && req.method === 'GET') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const resData = getMixnetUsers(activeCompDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/users/permissions' && req.method === 'POST') {
      try {
        if (!activeCompDir) throw new Error('Directorio comp01 no detectado.');
        const body = await readBody();
        const resData = updateMixnetUserPermissions(activeCompDir, Number(body.recordIndex), body.values);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
  });

  server.listen(AGENT_PORT, '0.0.0.0', () => {
    log(`Micro-API del Agente MixNet escuchando en http://0.0.0.0:${AGENT_PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Micro-API (puerto ${AGENT_PORT}) ya está en uso por otra instancia. Saliendo limpiamente.`, 'WARN');
      process.exit(0);
    }
    log(`Aviso en Micro-API (puerto ${AGENT_PORT}): ${err.message}`, 'WARN');
  });
}

/**
 * Inicialización principal
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║               JJ PAPER — JJ-MIXNET-AGENT v${AGENT_VERSION}             ║
║            Demonio Residente de Sincronización y Control           ║
╚════════════════════════════════════════════════════════════════════╝
`);

  activeCompDir = getMixnetDir();
  if (activeCompDir) {
    log(`Directorio maestro MixNet detectado: ${activeCompDir}`);
    refreshCorrelatives();
    log(`Correlativos actuales de producción: Cotizaciones=#${currentCotSerial} | Pedidos=#${currentPedSerial}`);
  } else {
    log(`ADVERTENCIA: No se detectó la carpeta comp01 de MixNet. Esperando conexión...`, 'WARN');
  }

  // 1. Iniciar Micro-API local
  startMicroApi();

  // 2. Bucle de Tareas Agénticas (cada 3 segundos)
  setInterval(async () => {
    if (activeCompDir) {
      await processAgentTasks(activeCompDir);
    } else {
      activeCompDir = getMixnetDir();
      if (activeCompDir) refreshCorrelatives();
    }
  }, 3000);

  // 3. Bucle de Sincronización de Documentos (cada 10 segundos)
  setInterval(async () => {
    if (activeCompDir) {
      await runScheduledSync();
    }
  }, 10000);

  // 4. Bucle de Sincronización de Catálogo e Inventario (cada 60 segundos)
  setInterval(async () => {
    if (activeCompDir) {
      await runScheduledCatalogSync();
    }
  }, 60000);

  // 5. Bucle de Sincronización de Proveedores (cada 5 minutos)
  setInterval(async () => {
    if (activeCompDir) {
      await runScheduledSupplierSync();
    }
  }, 300000);

  // 6. Bucle de Heartbeat hacia Supabase (cada 15 segundos)
  setInterval(async () => {
    refreshCorrelatives();
    await reportAgentHeartbeat({
      version: AGENT_VERSION,
      host: os.hostname(),
      dbf_dir: activeCompDir,
      current_cot_serial: currentCotSerial,
      current_ped_serial: currentPedSerial,
      sync_stats: syncStats
    });
  }, 15000);

  // Ejecución inicial inmediata
  if (activeCompDir) {
    await runScheduledSync();
    await runScheduledSupplierSync();
  }

  log('Agente MixNet iniciado y en modo guardián autónomo 24/7.');
}

// Prevención de caídas (Self-Healing)
process.on('uncaughtException', (err) => {
  log(`[CIRCUIT BREAKER] Excepción no capturada neutralizada: ${err.message}\n${err.stack}`, 'ERROR');
});

process.on('unhandledRejection', (reason) => {
  log(`[CIRCUIT BREAKER] Rechazo no controlado neutralizado: ${reason}`, 'ERROR');
});

main().catch((err) => {
  log(`Error crítico al arrancar agente: ${err.message}`, 'FATAL');
});
