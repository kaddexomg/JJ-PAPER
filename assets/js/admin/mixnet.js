/* ==========================================================================
   JJ Paper Admin — Controlador de Interfaz Puente MixNet ERP
   --------------------------------------------------------------------------
   Conecta con public.jjp_mixnet_tasks en el VPS Soberano para enviar
   comandos a Supervisor-Pc / Servidor Central, ejecutar backups y administrar seguridad.
   ========================================================================== */

let activeTab = 'console';
let isBridgePolling = false;

async function ensureGeminiClient() {
  if (window.GeminiClient) return window.GeminiClient;
  if (!document.getElementById('geminiClientScript')) {
    const s = document.createElement('script');
    s.id = 'geminiClientScript';
    s.src = '../assets/js/gemini-client.js?v=' + Date.now();
    document.head.appendChild(s);
  }
  for (let i = 0; i < 40; i++) {
    if (window.GeminiClient) return window.GeminiClient;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof requireAuth === 'function') await requireAuth('admin');
  initMixnetBridgePanel();
});

function initMixnetBridgePanel() {
  refreshMixnetStatus();
  setInterval(refreshMixnetStatus, 15000);
}

function switchMixnetTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('[id^="tab-"]').forEach(d => d.style.display = 'none');

  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick')?.includes(tab));
  if (activeBtn) activeBtn.classList.add('active');

  const tabDiv = document.getElementById(`tab-${tab}`);
  if (tabDiv) tabDiv.style.display = 'block';

  if (tab === 'users') loadMixnetUsers();
  if (tab === 'backups') loadSnapshotsList();
}

function appendConsole(text, type = 'info') {
  const box = document.getElementById('consoleOutput');
  if (!box) return;
  const time = new Date().toLocaleTimeString('es-VE');
  const prefix = type === 'error' ? '❌ ' : (type === 'success' ? '✔ ' : '▶ ');
  box.innerHTML += `\n[${time}] ${prefix}${escapeHTML(text)}`;
  box.scrollTop = box.scrollHeight;
}

function clearConsole() {
  const box = document.getElementById('consoleOutput');
  if (box) box.innerHTML = `JJ PAPER - TERMINAL DE CONTROL MIXNET ERP\n-----------------------------------------------------------\nListo para recibir órdenes...`;
}

async function refreshMixnetStatus() {
  try {
    const badge = document.getElementById('bridgeStatusBadge');
    const qVal  = document.getElementById('taskQueueVal');

    // 1. Contar tareas pendientes
    const { count, error: qErr } = await sb.from('jjp_mixnet_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (qVal) qVal.textContent = `${count || 0} pendientes`;

    // 2. Verificar la última tarea completada para saber si el puente está vivo
    const { data: lastCompleted } = await sb.from('jjp_mixnet_tasks')
      .select('updated_at')
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCompleted && lastCompleted.updated_at) {
      const diffMs = Date.now() - new Date(lastCompleted.updated_at).getTime();
      if (diffMs < 5 * 60 * 1000) { // menos de 5 minutos
        if (badge) {
          badge.className = 'status-badge status-online';
          badge.textContent = '🟢 PC Cobranza Conectada';
        }
        return;
      }
    }

    if (badge) {
      badge.className = 'status-badge status-pending';
      badge.textContent = '🟡 Enlace en Espera (LAN Tienda)';
    }
  } catch (err) {
    console.warn('Error refrescando estado del puente:', err);
  }
}

async function sendTask(action, payload = {}) {
  appendConsole(`Enviando tarea: ${action}...`);
  try {
    const { data, error } = await sb.from('jjp_mixnet_tasks').insert({
      action,
      payload,
      status: 'pending'
    }).select().single();

    if (error) {
      appendConsole(`Error creando tarea: ${error.message}`, 'error');
      return null;
    }

    appendConsole(`Tarea #${data.id.slice(0, 8)} en cola. Esperando respuesta de PC Cobranza...`);
    return pollTaskResult(data.id);
  } catch (err) {
    appendConsole(`Excepción: ${err.message}`, 'error');
    return null;
  }
}

async function pollTaskResult(taskId, maxAttempts = 15) {
  let attempts = 0;
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      attempts++;
      const { data, error } = await sb.from('jjp_mixnet_tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();

      if (data && (data.status === 'completed' || data.status === 'failed')) {
        clearInterval(interval);
        if (data.status === 'completed') {
          appendConsole(`✔ Tarea completada con éxito por la PC Cobranza.`, 'success');
          if (data.result) appendConsole(JSON.stringify(data.result, null, 2));
          resolve(data.result);
        } else {
          appendConsole(`❌ Tarea falló en la PC Cobranza: ${JSON.stringify(data.result)}`, 'error');
          resolve(null);
        }
        refreshMixnetStatus();
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        appendConsole(`⏳ La tarea sigue en cola. La PC Cobranza la procesará en su próximo ciclo.`, 'info');
        resolve(null);
      }
    }, 2000);
  });
}

function sendQuickCommand(cmd) {
  if (cmd === 'list_users') {
    sendTask('list_users');
  } else if (cmd === 'crear_backup') {
    sendTask('crear_backup', { label: 'MANUAL_WEB' });
  } else if (cmd === 'status') {
    appendConsole('Comprobando enlace de red con PC Cobranza y unidad M:\\comp01...');
    refreshMixnetStatus();
  }
}

async function executeCommand() {
  const input = document.getElementById('cmdInput');
  const val = input?.value.trim();
  if (!val) return;
  input.value = '';

  appendConsole(`> ${val}`);

  if (val === 'usuarios' || val === 'list_users') {
    await sendTask('list_users');
  } else if (val === 'backup' || val === 'backup_preventivo') {
    await sendTask('crear_backup', { label: 'CONSOLA' });
  } else if (val.startsWith('buscar ')) {
    const query = val.replace('buscar ', '').trim();
    await sendTask('buscar_archivo', { pattern: query });
  } else {
    // Si no es un comando estricto, procesarlo con IA
    await processWithAi(val);
  }
}

async function executeAiCommand() {
  const input = document.getElementById('cmdInput');
  const val = input?.value.trim();
  if (!val) {
    showToast('Escribe una instrucción para la IA', 'warn');
    return;
  }
  input.value = '';
  await processWithAi(val);
}

async function processWithAi(instruction) {
  appendConsole(`🤖 Analizando instrucción con IA: "${instruction}"...`);
  try {
    const gemini = await ensureGeminiClient();
    if (!gemini) {
      appendConsole('Asistente IA no disponible temporalmente. Ejecutando como tarea directa.', 'info');
      await sendTask('ai_query', { text: instruction });
      return;
    }

    const systemPrompt = `Eres el Agente Autónomo de MixNet ERP para JJ Paper.
Tu rol es interpretar órdenes en lenguaje natural del administrador y traducirlas a acciones concretas en MixNet:
- Módulos disponibles: Nómina y Permisos (MXCTAVDD.DBF, MXUSER*.EXT, MXSECURI.CFG), Inventario (MXCTAINV), Pedidos (MXENCPED), Cotizaciones (MXENCCOT).
- Reglas: Cero escrituras directas invasivas sin backup preventivo; siempre usar códigos de vendedor canónicos.
Responde ÚNICAMENTE en JSON con este formato:
{ "action": "list_users" | "update_user_permissions" | "crear_backup" | "buscar_archivo", "payload": { ... }, "explanation": "Breve explicación en español" }`;

    const res = await gemini.promptJson(`${systemPrompt}\n\nInstrucción: ${instruction}`);
    if (res && res.action) {
      appendConsole(`🤖 IA interpretó: ${res.explanation || res.action}`);
      await sendTask(res.action, res.payload || {});
    } else {
      appendConsole('🤖 IA no generó una acción concluyente. Enviando instrucción cruda al puente.', 'info');
      await sendTask('ai_query', { text: instruction });
    }
  } catch (err) {
    appendConsole(`Error procesando con IA: ${err.message}`, 'error');
  }
}

// ─── PESTAÑA: USUARIOS Y PERMISOS MIXNET (MXCTAVDD + MXUSER*.EXT) ───
async function loadMixnetUsers() {
  const container = document.getElementById('usersContainer');
  if (container) container.innerHTML = '<p style="color:var(--theme-accent, #047857)">⏳ Consultando seguridad y nómina de MixNet...</p>';

  const res = await sendTask('list_users');
  if (!res || !res.users) {
    if (container) container.innerHTML = '<p style="color:#ef4444">No se pudo cargar la lista de usuarios. Verifica que el demonio en puerto 8790 esté activo.</p>';
    return;
  }

  const users = res.users;
  if (!users.length) {
    if (container) container.innerHTML = '<p style="color:var(--theme-text-muted, #64748b)">No hay vendedores activos registrados.</p>';
    return;
  }

  let html = `<table class="snap-table"><thead><tr>
    <th>#</th>
    <th>Código / Login</th>
    <th>Vendedor / Rol</th>
    <th>Permisos Clave MixNet</th>
    <th>Acción</th>
  </tr></thead><tbody>`;

  users.forEach(u => {
    const code = escapeHTML(u.code || '000');
    const name = escapeHTML(u.name || 'Vendedor');
    const role = escapeHTML(u.role || 'Vendedor');
    const perms = u.permissions || {};
    const activePerms = Object.keys(perms).filter(k => Boolean(perms[k]));
    const permSummary = activePerms.slice(0, 4).join(', ') + (activePerms.length > 4 ? ` (+${activePerms.length - 4} más)` : '');

    html += `<tr>
      <td>${u._record || '—'}</td>
      <td><strong>${code}</strong> <small style="color:#94a3b8">(${escapeHTML(u.username || ('USER_' + code))})</small></td>
      <td><strong>${name}</strong><br><small style="color:#38bdf8">${role}</small></td>
      <td style="font-size:11.5px;color:#a3e635;font-family:monospace">${permSummary || 'Sin permisos'}</td>
      <td>
        <button class="btn-o sm" onclick="promptEditUserPermission('${code}')">⚙️ Permisos</button>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  if (container) container.innerHTML = html;
}

function promptEditUserPermission(userCode) {
  const permKey = prompt(`Modificar permiso para vendedor [${userCode}].\nIngresa la clave del permiso (ej: COT_CREAR, PED_CREAR, INV_VER_STOCK, FAC_ANULAR):`);
  if (!permKey) return;
  const allow = confirm(`¿Deseas HABILITAR (Aceptar) o DENEGAR (Cancelar) el permiso "${permKey.trim().toUpperCase()}" para el usuario ${userCode}?`);

  const payload = {
    user_code: userCode,
    permissions: { [permKey.trim().toUpperCase()]: allow }
  };
  sendTask('update_user_permissions', payload).then(() => {
    loadMixnetUsers();
  });
}

// ─── PESTAÑA: HISTORIAL DE BACKUPS & ROLLBACK ───
async function loadSnapshotsList() {
  const container = document.getElementById('snapshotsContainer');
  if (container) container.innerHTML = '<p style="color:var(--theme-accent, #047857)">⏳ Consultando snapshots en la unidad M:...</p>';

  const res = await sendTask('list_snapshots');
  const snaps = (res && Array.isArray(res.snapshots)) ? res.snapshots : [];

  if (!snaps.length) {
    if (container) container.innerHTML = '<p style="color:var(--theme-text-muted, #64748b)">No hay snapshots preventivos registrados aún en M:\\comp01\\backups_live.</p>';
    return;
  }

  let html = `<table class="snap-table"><thead><tr>
    <th>Snapshot ID</th>
    <th>Fecha / Hora</th>
    <th>Operación</th>
    <th>Archivos Respaldados</th>
    <th>Estado</th>
    <th>Restaurar</th>
  </tr></thead><tbody>`;

  snaps.forEach(s => {
    const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleString('es-VE') : '—';
    const isRolledBack = s.status === 'rolled_back';
    const statusBadge = isRolledBack
      ? '<span style="color:#ef4444;font-weight:700">Revertido</span>'
      : '<span style="color:#16a34a;font-weight:700">Activo</span>';

    html += `<tr>
      <td><code style="font-size:11px">${escapeHTML(s.snapshotId)}</code></td>
      <td>${dateStr}</td>
      <td><strong>${escapeHTML(s.label || 'OPERACION')}</strong></td>
      <td>${s.fileCount || (s.files ? s.files.length : 0)} archivos</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn-o sm" style="color:#dc2626;border-color:#fca5a5" onclick="triggerRollback('${escapeHTML(s.snapshotId)}')" ${isRolledBack ? 'disabled' : ''}>
          ⏪ Rollback
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  if (container) container.innerHTML = html;
}

function triggerRollback(snapshotId) {
  if (!confirm(`⚠️ ALERTA DE SEGURIDAD:\n¿Estás seguro de que deseas revertir la base de datos de MixNet al snapshot ${snapshotId}?\nEsta acción sobreescribirá los archivos .DBF y .NTX en la unidad M: con la copia exacta de ese momento.`)) {
    return;
  }
  sendTask('rollback', { snapshotId }).then(() => {
    loadSnapshotsList();
  });
}
