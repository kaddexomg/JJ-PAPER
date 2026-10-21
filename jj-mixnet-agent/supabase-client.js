/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Cliente REST Nativo Supabase (Cero NPM)
   ====================================================================== */

import { SUPABASE_URL, SERVICE_KEY, log } from './config.js';

export async function sbQuery(endpoint, options = {}) {
  const urlStr = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {})
  };

  const resp = await fetch(urlStr, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} en ${endpoint}: ${text}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await resp.json();
  }
  return null;
}

export async function sbGet(table, queryParams = '') {
  const ep = queryParams ? `${table}?${queryParams}` : table;
  return await sbQuery(ep, { method: 'GET' });
}

export async function sbPost(table, data, prefer = 'return=representation') {
  return await sbQuery(table, { method: 'POST', body: data, prefer });
}

export async function sbPatch(table, filterQuery, data) {
  return await sbQuery(`${table}?${filterQuery}`, { method: 'PATCH', body: data });
}

/**
 * Reporta el estado y pulso de vida (Heartbeat) a jjp_server_control (ID 1).
 */
export async function reportAgentHeartbeat(stats) {
  try {
    const currentControl = await sbGet('jjp_server_control', 'id=eq.1');
    const existingModules = currentControl?.[0]?.modules || {};

    const updatedModules = {
      ...existingModules,
      mixnet_agent: {
        online: true,
        version: stats.version,
        host: stats.host,
        dbf_dir: stats.dbf_dir,
        current_cot_serial: stats.current_cot_serial,
        current_ped_serial: stats.current_ped_serial,
        last_sync_at: new Date().toISOString(),
        pending_tasks_count: stats.pending_tasks_count || 0,
        sync_stats: stats.sync_stats || {}
      }
    };

    await sbPatch('jjp_server_control', 'id=eq.1', {
      heartbeat_at: new Date().toISOString(),
      modules: updatedModules
    });
  } catch (err) {
    log(`Aviso actualizando heartbeat: ${err.message}`, 'WARN');
  }
}

/**
 * Consulta tareas pendientes en jjp_mixnet_tasks
 */
export async function pollPendingTasks() {
  try {
    const tasks = await sbGet('jjp_mixnet_tasks', 'status=eq.pending&order=created_at.asc&limit=5');
    return Array.isArray(tasks) ? tasks : [];
  } catch (err) {
    log(`Aviso consultando tareas agénticas: ${err.message}`, 'WARN');
    return [];
  }
}

/**
 * Actualiza el resultado de una tarea agéntica
 */
export async function updateTaskStatus(taskId, status, result = null) {
  try {
    await sbPatch('jjp_mixnet_tasks', `id=eq.${taskId}`, {
      status,
      result: result || {},
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    log(`Error actualizando tarea ${taskId}: ${err.message}`, 'ERROR');
  }
}
