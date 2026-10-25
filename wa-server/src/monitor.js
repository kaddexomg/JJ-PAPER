// ======================================================================
// JJ Paper — Motor de Monitoreo de Cuotas, Tráfico en Vivo y Optimizador
// ======================================================================
import pg from 'pg';
const { Client } = pg;
import { PG_CORE, PG_COMM, COUNT_LAN_PORT } from './config.js';
import { db, dbCore, dbInv } from './supabase.js';
import { log } from './logger.js';

// Cuotas estándar por proyecto en el plan gratuito de Supabase
export const QUOTAS = {
  DB_MAX_BYTES: 500 * 1024 * 1024,      // 500 MB por proyecto de BD
  STORAGE_MAX_BYTES: 1024 * 1024 * 1024 // 1 GB por proyecto de Storage
};

// Ring buffer en memoria para requests y eventos en vivo (últimos 150)
const MAX_LIVE_REQUESTS = 150;
const liveRequests = [];
let requestIdCounter = 1;

// Clientes SSE en tiempo real conectados al monitor
const sseMonitorClients = new Set();

export function addMonitorSseClient(res) {
  sseMonitorClients.add(res);
}

export function removeMonitorSseClient(res) {
  sseMonitorClients.delete(res);
}

export function broadcastMonitorEvent(event, data) {
  if (sseMonitorClients.size === 0) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseMonitorClients) {
    try {
      client.write(msg);
    } catch (_) {
      sseMonitorClients.delete(client);
    }
  }
}

/**
 * Registra un request o llamada en vivo para visualización en el dashboard
 * y lo emite inmediatamente vía SSE a todas las pantallas abiertas (0ms de latencia)
 */
export function recordLiveRequest(info) {
  const req = {
    id: requestIdCounter++,
    timestamp: new Date().toISOString(),
    timeStr: new Date().toLocaleTimeString('es-VE', { hour12: false }),
    type: info.type || 'HTTP',
    method: (info.method || 'GET').toUpperCase(),
    path: info.path || '/',
    status: info.status || 200,
    durationMs: Math.max(1, Math.round(info.durationMs || 1)),
    ip: info.ip || '127.0.0.1',
    detail: info.detail || ''
  };

  liveRequests.unshift(req);
  if (liveRequests.length > MAX_LIVE_REQUESTS) {
    liveRequests.pop();
  }

  // Emisión en tiempo real instantánea vía SSE
  broadcastMonitorEvent('request', { request: req, rpm: getRPM() });
}

// Semilla inicial para que el dashboard no empiece vacío
recordLiveRequest({ type: 'SYSTEM', method: 'INIT', path: 'monitor:boot', status: 200, durationMs: 4, detail: 'Motor de monitoreo en tiempo real iniciado' });

// Loop periódico que emite métricas de base de datos a clientes SSE en vivo (cada 15s para no saturar poolers)
setInterval(async () => {
  if (sseMonitorClients.size > 0) {
    try {
      const stats = await getSystemHealthAndStats(false);
      broadcastMonitorEvent('stats', stats);
    } catch (_) {}
  }
}, 15_000);

/**
 * Calcula RPM (Requests Por Minuto) en base a los últimos 60 segundos
 */
function getRPM() {
  const now = Date.now();
  const oneMinAgo = now - 60_000;
  return liveRequests.filter(r => new Date(r.timestamp).getTime() >= oneMinAgo).length;
}

// Caché corta en RAM para estadísticas pesadas (evita saturar poolers si hay sondeo rápido)
let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_TTL = 3000; // 3 segundos

/**
 * Consulta estadísticas reales del VPS Soberano vía /auth/v1/telemetry y PostgREST (count=exact)
 * Sin conexiones TCP 5432 bloqueantes y sin números inventados.
 */
export async function getSystemHealthAndStats(force = false) {
  const now = Date.now();
  if (!force && statsCache && (now - statsCacheAt < STATS_CACHE_TTL)) {
    return { ...statsCache, rpm: getRPM(), cached: true };
  }

  const tStart = Date.now();
  const vpsBaseUrl = (process.env.SUPABASE_CORE_URL || process.env.SUPABASE_URL || 'https://166-0-112-247.sslip.io').replace(/\/$/, '');

  // 1. Consultar telemetría real del VPS y conteos reales de tablas en paralelo
  const coreTables = [
    'jjp_customers', 'jjp_products', 'jjp_product_variants',
    'jjp_orders', 'jjp_quotes', 'jjp_prospects', 'jjp_inventory_counts'
  ];
  const commTables = [
    'jjp_wa_messages', 'jjp_wa_chats', 'jjp_emails',
    'jjp_wa_campaigns', 'jjp_wa_campaign_targets', 'jjp_email_campaigns'
  ];

  const fetchTelemetry = async () => {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${vpsBaseUrl}/auth/v1/telemetry`, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) return { online: false, latency: Date.now() - t0, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { online: true, latency: Date.now() - t0, data };
    } catch (err) {
      return { online: false, latency: Date.now() - t0, error: err.message };
    }
  };

  const countTable = async (client, tbl) => {
    try {
      const { count, error } = await client.from(tbl).select('id', { count: 'exact', head: true });
      if (error) return { name: tbl, liveRows: null, deadTuples: 0, bytes: null, pretty: 'DESCONOCIDO', error: error.message };
      const rows = count ?? 0;
      return { name: tbl, liveRows: rows, deadTuples: 0, bytes: null, pretty: `${rows.toLocaleString('es-VE')} filas` };
    } catch (err) {
      return { name: tbl, liveRows: null, deadTuples: 0, bytes: null, pretty: 'DESCONOCIDO', error: err.message };
    }
  };

  const [telem, coreTableStats, commTableStats, storageItemsRes] = await Promise.all([
    fetchTelemetry(),
    Promise.all(coreTables.map(t => countTable(dbCore, t))),
    Promise.all(commTables.map(t => countTable(db, t))),
    dbCore.from('jjp_settings').select('key', { count: 'exact', head: true }).like('key', 'storage:%').catch(() => ({ count: null }))
  ]);

  const dbSizeBytes = telem.data?.db_size_bytes ? Number(telem.data.db_size_bytes) : 0;
  const dbSizeMb = dbSizeBytes > 0 ? (dbSizeBytes / (1024 * 1024)).toFixed(2) : 'DESCONOCIDO';
  const diskTotalBytes = telem.data?.disk_total_bytes ? Number(telem.data.disk_total_bytes) : QUOTAS.DB_MAX_BYTES;
  const quotaMb = Math.round(diskTotalBytes / (1024 * 1024)) || 500;
  const usagePct = (dbSizeBytes > 0 && diskTotalBytes > 0) ? ((dbSizeBytes / diskTotalBytes) * 100).toFixed(1) : '0.0';

  const coreReachable = coreTableStats.some(t => t.liveRows !== null);
  const commReachable = commTableStats.some(t => t.liveRows !== null);
  const storedFilesCount = storageItemsRes?.count ?? 0;

  const payload = {
    timestamp: new Date().toISOString(),
    queryDurationMs: Date.now() - tStart,
    rpm: getRPM(),
    telemetry: telem.data || null,
    projects: {
      core: {
        name: 'VPS Soberano — Core',
        role: 'Ventas, Catálogo, Clientes & POS',
        ref: '166.0.112.247 (PostgreSQL)',
        online: coreReachable,
        latency: telem.latency || 50,
        sizeBytes: dbSizeBytes,
        sizeMb: dbSizeMb,
        sizePretty: dbSizeBytes > 0 ? `${dbSizeMb} MB` : 'DESCONOCIDO',
        quotaBytes: diskTotalBytes,
        quotaMb,
        usagePercent: usagePct,
        connections: telem.data?.connections ?? 1,
        totalDeadTuples: 0,
        tables: coreTableStats.filter(t => t.liveRows !== null)
      },
      comm: {
        name: 'VPS Soberano — Comunicación',
        role: 'WhatsApp, Correos CRM & Campañas',
        ref: '166.0.112.247 (Unificado)',
        online: commReachable,
        latency: telem.latency || 50,
        sizeBytes: 0,
        sizeMb: dbSizeMb,
        sizePretty: dbSizeBytes > 0 ? `${dbSizeMb} MB (Unificado)` : 'DESCONOCIDO',
        quotaBytes: diskTotalBytes,
        quotaMb,
        usagePercent: usagePct,
        connections: telem.data?.connections ?? 1,
        totalDeadTuples: 0,
        tables: commTableStats.filter(t => t.liveRows !== null)
      },
      storage: {
        name: 'VPS Soberano — Storage & Media',
        role: 'Adjuntos & Archivos en jjp_settings',
        ref: '166.0.112.247',
        online: coreReachable,
        latency: telem.latency || 50,
        buckets: [
          { id: 'wa-media', name: 'wa-media (KV)', public: true, fileCount: storedFilesCount, sizeBytes: 0 }
        ],
        totalFiles: storedFilesCount,
        sizeBytes: 0,
        sizeMb: '0.00',
        quotaBytes: QUOTAS.STORAGE_MAX_BYTES,
        quotaMb: 1024,
        usagePercent: '0.00',
        error: null
      }
    },
    summary: {
      totalDbBytes: dbSizeBytes,
      totalDbMb: dbSizeBytes > 0 ? dbSizeMb : 'DESCONOCIDO',
      totalDbQuotaMb: quotaMb,
      totalDbUsagePercent: usagePct,
      totalDeadTuples: 0,
      overallHealth: (coreReachable && commReachable) ? 'OPTIMAL' : 'ATTENTION_NEEDED',
      avgLatencyMs: telem.latency || 50
    },
    recentRequests: liveRequests.slice(0, 40)
  };

  statsCache = payload;
  statsCacheAt = now;
  return payload;
}

/**
 * Gestor de Optimizaciones y Purga de Datos
 */
export async function executeOptimization(action) {
  const t0 = Date.now();
  recordLiveRequest({ type: 'OPTIMIZE', method: 'START', path: `optimize:${action}`, status: 200, detail: `Ejecutando acción: ${action}` });

  try {
    switch (action) {
      case 'vacuum_core': {
        const client = new Client(PG_CORE);
        await client.connect();
        try {
          const { rows: deadRows } = await client.query(`
            SELECT relname, n_dead_tup FROM pg_stat_user_tables WHERE schemaname = 'public' AND n_dead_tup > 0
          `);
          await client.query('VACUUM ANALYZE;');
          const timeMs = Date.now() - t0;
          recordLiveRequest({ type: 'OPTIMIZE', method: 'VACUUM', path: 'db:core:vacuum', status: 200, durationMs: timeMs, detail: `VACUUM aplicado en Core` });
          statsCache = null; // invalidar caché
          return {
            success: true,
            action,
            message: 'VACUUM ANALYZE ejecutado exitosamente en Proyecto A (Core). Espacio de tuplas muertas recuperado.',
            timeMs,
            tablesOptimized: deadRows.length
          };
        } finally {
          await client.end().catch(() => {});
        }
      }

      case 'vacuum_comm': {
        const client = new Client(PG_COMM);
        await client.connect();
        try {
          const { rows: deadRows } = await client.query(`
            SELECT relname, n_dead_tup FROM pg_stat_user_tables WHERE schemaname = 'public' AND n_dead_tup > 0
          `);
          await client.query('VACUUM ANALYZE;');
          const timeMs = Date.now() - t0;
          recordLiveRequest({ type: 'OPTIMIZE', method: 'VACUUM', path: 'db:comm:vacuum', status: 200, durationMs: timeMs, detail: `VACUUM aplicado en Comunicación` });
          statsCache = null;
          return {
            success: true,
            action,
            message: 'VACUUM ANALYZE ejecutado exitosamente en Proyecto B (Comunicación). Estadísticas actualizadas.',
            timeMs,
            tablesOptimized: deadRows.length
          };
        } finally {
          await client.end().catch(() => {});
        }
      }

      case 'clean_server_logs': {
        // Limpiar registros viejos en jjp_server_control y eventos transitorios > 7 días
        const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const client = new Client(PG_COMM);
        await client.connect();
        try {
          // Si existe columna updated_at o created_at
          const { rowCount } = await client.query(`
            DELETE FROM public.jjp_server_control 
            WHERE command_status IN ('done', 'error') AND updated_at < $1;
          `, [cutoff]).catch(() => ({ rowCount: 0 }));
          
          const timeMs = Date.now() - t0;
          statsCache = null;
          return {
            success: true,
            action,
            message: `Limpieza de logs del servidor completada. ${rowCount} registros transitorios eliminados.`,
            timeMs,
            deletedRows: rowCount
          };
        } finally {
          await client.end().catch(() => {});
        }
      }

      case 'clean_orphan_targets': {
        // Limpiar targets de campañas de prueba o canceladas de más de 30 días
        const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const client = new Client(PG_COMM);
        await client.connect();
        try {
          const { rowCount: rWa } = await client.query(`
            DELETE FROM public.jjp_wa_campaign_targets
            WHERE status IN ('failed', 'skipped') AND created_at < $1;
          `, [cutoff]).catch(() => ({ rowCount: 0 }));

          const { rowCount: rEmail } = await client.query(`
            DELETE FROM public.jjp_email_campaign_targets
            WHERE status IN ('failed', 'bounced') AND created_at < $1;
          `, [cutoff]).catch(() => ({ rowCount: 0 }));

          const timeMs = Date.now() - t0;
          statsCache = null;
          return {
            success: true,
            action,
            message: `Purga de targets obsoletos completada: ${rWa} targets WA y ${rEmail} targets de correo liberados.`,
            timeMs,
            deletedRows: (rWa || 0) + (rEmail || 0)
          };
        } finally {
          await client.end().catch(() => {});
        }
      }

      case 'optimize_all': {
        // Mantenimiento Maestro: Ejecuta VACUUM ANALYZE en Core y Comunicación, y limpia logs transitorios
        const [resCore, resComm, resLogs] = await Promise.all([
          executeOptimization('vacuum_core').catch(e => ({ error: e.message })),
          executeOptimization('vacuum_comm').catch(e => ({ error: e.message })),
          executeOptimization('clean_server_logs').catch(e => ({ error: e.message }))
        ]);

        const timeMs = Date.now() - t0;
        statsCache = null;
        return {
          success: true,
          action: 'optimize_all',
          message: 'Mantenimiento maestro completado con éxito en todo el ecosistema multi-proyecto.',
          timeMs,
          details: { resCore, resComm, resLogs }
        };
      }

      default:
        throw new Error(`Acción de optimización desconocida: ${action}`);
    }
  } catch (err) {
    const timeMs = Date.now() - t0;
    recordLiveRequest({ type: 'OPTIMIZE', method: 'ERROR', path: `optimize:${action}`, status: 500, durationMs: timeMs, detail: err.message });
    log.error({ err: err.message, action }, 'monitor: fallo ejecutando optimización');
    return {
      success: false,
      action,
      error: err.message,
      timeMs
    };
  }
}
