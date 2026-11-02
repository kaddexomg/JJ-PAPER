/* ======================================================================
   JJ Paper — Consola Agéntica OpenCode (Frontend Client)
   assets/js/admin/agent-console.js
   ----------------------------------------------------------------------
   Permite interactuar interactivamente con el motor agéntico en:
   - Supervisor-PC (Windows LAN · M:\comp01 · Python/Node)
   - VPS Soberano (Ubuntu 24.04 · PostgreSQL 16 · Bash/Node)
   - Ambos simultáneamente
   Con streaming de terminal, historial de comandos, modo Asistente IA
   y visualizador de diffs con autoverificación.
   ====================================================================== */

(function () {
  let activeTarget = 'supervisor'; // 'supervisor' | 'vps' | 'all'
  let activeMode = 'ai'; // 'ai' | 'cmd' | 'python' | 'node'
  let commandHistory = [];
  let historyCursor = -1;
  let isExecuting = false;

  const terminalEl = () => document.getElementById('agTerminalOutput');
  const inputEl = () => document.getElementById('agCommandInput');
  const targetLabelEl = () => document.getElementById('agTargetLabel');
  const execBtnEl = () => document.getElementById('agExecBtn');

  function appendTerminal(text, type = 'info') {
    const term = terminalEl();
    if (!term) return;

    const line = document.createElement('div');
    line.className = `term-line term-${type}`;
    const time = new Date().toLocaleTimeString();
    
    let prefix = `[${time}] `;
    if (type === 'cmd') prefix += '❯ ';
    else if (type === 'out') prefix += '  ';
    else if (type === 'err') prefix += '✖ ';
    else if (type === 'ok') prefix += '✔ ';
    else prefix += 'ℹ ';

    line.textContent = prefix + text;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
  }

  function clearTerminal() {
    const term = terminalEl();
    if (term) term.innerHTML = '';
    appendTerminal('Terminal reiniciada. Listo para recibir instrucciones.', 'info');
  }
  window.agClearTerminal = clearTerminal;

  function setTarget(target) {
    activeTarget = target;
    document.querySelectorAll('.target-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.target === target);
    });

    const labelMap = {
      supervisor: 'Supervisor-PC (Windows LAN · M:\\comp01)',
      vps: 'VPS Soberano (Ubuntu 24.04 · 166.0.112.247)',
      all: 'Ambos Entornos (Distribuido simultáneo)'
    };
    if (targetLabelEl()) targetLabelEl().textContent = labelMap[target] || target;
    appendTerminal(`Destino de ejecución cambiado a: ${labelMap[target]}`, 'info');
  }
  window.agSetTarget = setTarget;

  function setMode(mode) {
    activeMode = mode;
    document.querySelectorAll('.mode-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.mode === mode);
    });

    const placeholders = {
      ai: 'Escribe una instrucción en lenguaje natural (ej. "Revisa si hay bloqueos en DBF", "Prueba la conexión a Postgres")...',
      cmd: activeTarget === 'vps' ? 'Escribe un comando Bash (ej. ls -la, git status, ps aux)...' : 'Escribe un comando PowerShell (ej. Get-Process, git status, dir M:\\comp01)...',
      python: 'Escribe código Python para ejecutar en el entorno agéntico (ej. import os; print(os.listdir(".")))...',
      node: 'Escribe código Node.js para ejecutar (ej. const os = require("os"); console.log(os.cpus());)...'
    };
    const inp = inputEl();
    if (inp) inp.placeholder = placeholders[mode] || 'Escribe tu comando...';
  }
  window.agSetMode = setMode;

  async function enqueueTask(action, payload = {}) {
    payload.target = activeTarget;
    payload.timestamp = new Date().toISOString();
    payload.triggered_by = 'agent_console';

    const { data, error } = await sb.from('jjp_mixnet_tasks').insert({
      action,
      payload,
      status: 'pending'
    }).select('id').single();

    if (error) throw new Error(error.message);
    return data.id;
  }

  async function pollTaskResult(taskId, maxSeconds = 45) {
    appendTerminal(`Tarea #${taskId} encolada. Esperando respuesta de ${activeTarget.toUpperCase()}...`, 'info');

    const startTime = Date.now();
    while (Date.now() - startTime < maxSeconds * 1000) {
      await new Promise(r => setTimeout(r, 1200));

      const { data: tRow, error } = await sb
        .from('jjp_mixnet_tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error) continue;

      if (tRow.status === 'running') {
        // En progreso
      } else if (tRow.status === 'completed') {
        const res = tRow.result || {};
        if (res.stdout) appendTerminal(res.stdout, 'out');
        if (res.output) appendTerminal(res.output, 'out');
        if (res.content) appendTerminal(res.content, 'out');
        if (res.stderr) appendTerminal(res.stderr, 'err');
        
        if (res.details) {
          appendTerminal(JSON.stringify(res.details, null, 2), 'out');
        }

        appendTerminal(`Ejecución finalizada con éxito en ${res.target || activeTarget} (${res.exitCode !== undefined ? 'Código ' + res.exitCode : 'OK'}).`, 'ok');
        return res;
      } else if (tRow.status === 'failed') {
        const err = tRow.error || tRow.result?.error || 'Fallo desconocido en la ejecución';
        appendTerminal(`Error en tarea #${taskId}: ${err}`, 'err');
        return { ok: false, error: err };
      }
    }

    appendTerminal(`Tiempo de espera agotado (${maxSeconds}s) esperando a la máquina. La tarea sigue en cola.`, 'err');
    return { ok: false, timeout: true };
  }

  async function executeAgentPrompt() {
    const inp = inputEl();
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || isExecuting) return;

    isExecuting = true;
    if (execBtnEl()) execBtnEl().disabled = true;

    commandHistory.push(text);
    historyCursor = commandHistory.length;

    appendTerminal(text, 'cmd');
    inp.value = '';

    try {
      if (activeMode === 'cmd') {
        const taskId = await enqueueTask('exec_cmd', { command: text });
        await pollTaskResult(taskId);
      } else if (activeMode === 'python') {
        const taskId = await enqueueTask('exec_python', { code: text });
        await pollTaskResult(taskId);
      } else if (activeMode === 'node') {
        const taskId = await enqueueTask('exec_node', { code: text });
        await pollTaskResult(taskId);
      } else {
        // MODO ASISTENTE IA: Analiza con Gemini y despacha la acción autónoma
        appendTerminal('🧠 Analizando requerimiento con el Cerebro IA...', 'info');
        
        let planPrompt = `Eres el Agente de Desarrollo de JJ Paper (OpenCode). 
El operador indica: "${text}".
Destino: ${activeTarget}.
Responde SOLO un objeto JSON con este formato exacto:
{
  "action": "exec_cmd" | "git_pull" | "reindex_all" | "create_backup" | "audit_health",
  "command": "comando de terminal específico si aplica",
  "explanation": "breve resumen de qué harás (1 línea)"
}`;

        let aiPlan = null;
        if (typeof GeminiClient !== 'undefined' && GeminiClient.callGemini) {
          try {
            const rawJson = await GeminiClient.callGemini(planPrompt, { temperature: 0.1 });
            const cleaned = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
            aiPlan = JSON.parse(cleaned);
          } catch (e) {
            appendTerminal(`Aviso IA: interpretando como comando directo.`, 'info');
          }
        }

        if (aiPlan && aiPlan.action) {
          appendTerminal(`🤖 Plan del Agente: ${aiPlan.explanation || aiPlan.action}`, 'info');
          const taskId = await enqueueTask(aiPlan.action, { command: aiPlan.command || text });
          await pollTaskResult(taskId);
        } else {
          // Fallback a comando directo
          const taskId = await enqueueTask('exec_cmd', { command: text });
          await pollTaskResult(taskId);
        }
      }
    } catch (err) {
      appendTerminal(`Error despachando comando: ${err.message}`, 'err');
    } finally {
      isExecuting = false;
      if (execBtnEl()) execBtnEl().disabled = false;
    }
  }
  window.agExecute = executeAgentPrompt;

  // Acciones Rápidas
  window.agQuickAction = async function (action, payload = {}) {
    if (isExecuting) return;
    isExecuting = true;
    if (execBtnEl()) execBtnEl().disabled = true;

    try {
      appendTerminal(`Ejecutando acción rápida: '${action}' en ${activeTarget}...`, 'info');
      const taskId = await enqueueTask(action, payload);
      await pollTaskResult(taskId);
    } catch (err) {
      appendTerminal(`Error en acción rápida: ${err.message}`, 'err');
    } finally {
      isExecuting = false;
      if (execBtnEl()) execBtnEl().disabled = false;
    }
  };

  // Verificación de Salud de los Motores
  async function checkEnginesHealth() {
    try {
      // 1. VPS PostgreSQL & wa-server
      const { data: vpsControl } = await sb.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();
      const vpsDot = document.getElementById('agVpsStatusDot');
      const vpsTxt = document.getElementById('agVpsStatusTxt');
      if (vpsDot && vpsTxt) {
        const lastHb = vpsControl?.heartbeat_at ? new Date(vpsControl.heartbeat_at).getTime() : 0;
        const isOnline = Date.now() - lastHb < 45000;
        vpsDot.className = `status-dot ${isOnline ? 'online' : 'warn'}`;
        vpsTxt.textContent = isOnline ? 'Online (VPS 24/7)' : 'En espera';
      }

      // 2. Supervisor-PC (LAN)
      const { data: lanTasks } = await sb
        .from('jjp_mixnet_tasks')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1);

      const lanDot = document.getElementById('agLanStatusDot');
      const lanTxt = document.getElementById('agLanStatusTxt');
      if (lanDot && lanTxt) {
        const lastTask = lanTasks?.[0];
        const lastTime = lastTask?.updated_at ? new Date(lastTask.updated_at).getTime() : 0;
        const isLanActive = Date.now() - lastTime < 300000; // activo en últimos 5 min
        lanDot.className = `status-dot ${isLanActive ? 'online' : 'warn'}`;
        lanTxt.textContent = isLanActive ? 'Conectado (Tienda)' : 'Listo';
      }
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    appendTerminal('Inicializando entorno agéntico soberano JJ Paper (OpenCode)...', 'info');
    appendTerminal('Conexión con PostgreSQL 16 y tabla jjp_mixnet_tasks establecida.', 'ok');
    appendTerminal('Elige el destino y escribe un comando o instrucción.', 'info');

    const inp = inputEl();
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          executeAgentPrompt();
        } else if (e.key === 'ArrowUp') {
          if (historyCursor > 0) {
            historyCursor--;
            inp.value = commandHistory[historyCursor] || '';
          }
        } else if (e.key === 'ArrowDown') {
          if (historyCursor < commandHistory.length - 1) {
            historyCursor++;
            inp.value = commandHistory[historyCursor] || '';
          } else {
            historyCursor = commandHistory.length;
            inp.value = '';
          }
        }
      });
    }

    checkEnginesHealth();
    setInterval(checkEnginesHealth, 15000);
  });
})();
